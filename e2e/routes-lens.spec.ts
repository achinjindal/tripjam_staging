import { test, expect, Page } from "@playwright/test";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import { login, dismissTripOverlays } from "./helpers";

// Routes Lens (criteria/18-routes-lens.md): Route Overview block + Route
// Editor sheet + rebuild funnel up to the Pre-IG sheet. All deterministic:
// fixtures are seeded directly into staging; extract-preferences and
// generate-itinerary are network-blocked so no test spends LLM tokens.

const OWNER = "qa-tester";
const PASSWORD = "qaTest123!";

function readEnv() {
  const here = dirname(fileURLToPath(import.meta.url));
  let url = process.env.VITE_SUPABASE_URL || "";
  let anon = process.env.VITE_SUPABASE_ANON_KEY || "";
  let lens = process.env.VITE_ROUTES_LENS_ENABLED || "";
  try {
    const raw = readFileSync(join(here, "..", ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const v = m[2].replace(/^["']|["']$/g, "");
      if (m[1] === "VITE_SUPABASE_URL" && !url) url = v;
      if (m[1] === "VITE_SUPABASE_ANON_KEY" && !anon) anon = v;
      if (m[1] === "VITE_ROUTES_LENS_ENABLED" && !lens) lens = v;
    }
  } catch {
    /* fall back to process.env */
  }
  return { url, anon, lensEnabled: lens === "true" };
}
const ENV = readEnv();

async function signedClient(): Promise<SupabaseClient | null> {
  if (!ENV.url || !ENV.anon) return null;
  const sb = createClient(ENV.url, ENV.anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await sb.auth.signInWithPassword({
    email: `${OWNER}@tripjam.app`,
    password: PASSWORD,
  });
  return error ? null : sb;
}

// 5-day / 4-night fixture: future dates so the active-trip auto-collapse
// never kicks in and the full overview block renders.
function tripDates() {
  const start = new Date();
  start.setDate(start.getDate() + 40);
  const end = new Date(start);
  end.setDate(start.getDate() + 4);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

const DAY_CITIES = [
  "Ziro Town",
  "Ziro Town",
  "Hapoli",
  "Kile Pakho",
  "Kile Pakho",
];

type Fixture = { id: string; name: string };

async function seedTrip(
  sb: SupabaseClient,
  userId: string,
  name: string,
  routeData: Record<string, unknown> | null,
): Promise<Fixture | null> {
  const id = randomUUID();
  const { start, end } = tripDates();
  const { error: tripErr } = await sb.from("trips").insert({
    id,
    name,
    destination: "Ziro Valley",
    start_date: start,
    end_date: end,
    created_by: userId,
    owner_id: userId,
    ig_request: {
      destinations: ["Ziro Valley"],
      travelers: "2",
      budget: "mid",
      pace: "active",
      morningStart: "early",
      startDate: start,
      endDate: end,
    },
    ig_response: { name: "Ziro Festival + Villages" },
  });
  if (tripErr) {
    console.warn(`seed ${name}: trips insert failed:`, tripErr.message);
    return null;
  }
  // RLS on days/brainstorm_items requires a trip_members row with role
  // 'edit' — ownership alone grants nothing (learned the hard way)
  const { error: memErr } = await sb
    .from("trip_members")
    .insert({ trip_id: id, user_id: userId, role: "edit" });
  if (memErr && !/duplicate/i.test(memErr.message)) {
    console.warn(`seed ${name}: membership failed:`, memErr.message);
    return null;
  }
  const { data: dayRows, error: daysErr } = await sb
    .from("days")
    .insert(
      DAY_CITIES.map((city, i) => ({
        trip_id: id,
        label: `Day ${i + 1}`,
        city,
        position: i,
        description: `${city} day`,
      })),
    )
    .select("id, position");
  if (daysErr || !dayRows?.length) {
    console.warn(`seed ${name}: days insert failed:`, daysErr?.message);
    return null;
  }
  // 3 activities per day — realistic card heights so the itinerary actually
  // scrolls (18.4) and stops have coordinates (geo-warning path)
  const acts = dayRows.flatMap((d: { id: string; position: number }) =>
    [0, 1, 2].map((k) => ({
      day_id: d.id,
      time: ["09:00", "13:00", "17:00"][k],
      title: `${DAY_CITIES[d.position]} spot ${k + 1}`,
      type: "sight",
      icon: "📍",
      position: k,
      lat: 27.55 + d.position * 0.01,
      lng: 93.83 + d.position * 0.01,
    })),
  );
  const { error: actErr } = await sb.from("activities").insert(acts);
  if (actErr) {
    console.warn(`seed ${name}: activities insert failed:`, actErr.message);
    return null;
  }
  if (routeData) {
    const { error: routeErr } = await sb.from("brainstorm_items").insert({
      trip_id: id,
      title: "Ziro Festival + Villages",
      city: "Ziro Town, Hapoli, Kile Pakho",
      category: "Route",
      tier: 1,
      position: 0,
      selected: true,
      data: routeData,
    });
    if (routeErr) {
      console.warn(`seed ${name}: route insert failed:`, routeErr.message);
      return null;
    }
  }
  return { id, name };
}

// Block every endpoint that would spend LLM tokens; extract-preferences
// failing makes openPreIgSheet fall back to defaults (still opens).
async function blockLlm(page: Page) {
  for (const fn of [
    "extract-preferences",
    "generate-itinerary",
    "generate-brainstorm",
  ]) {
    await page.route(`**/functions/v1/${fn}`, (route) =>
      route.fulfill({ status: 500, body: "{}" }),
    );
  }
}

async function openTrip(page: Page, tripId: string) {
  await page.goto(`/trip/${tripId}`);
  await page.waitForTimeout(2500);
  await dismissTripOverlays(page, 2000);
  // Completed trips open in Story mode, where the overview is (by design)
  // hidden — the tests exercise the Plan view.
  const planToggle = page.getByRole("button", { name: "Plan", exact: true });
  if (await planToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
    await planToggle.click();
    await page.waitForTimeout(600);
  }
}

test.describe("18 · Routes Lens", () => {
  test.skip(!ENV.lensEnabled, "VITE_ROUTES_LENS_ENABLED not true");
  // The overview/editor's primary surface is mobile; the desktop column
  // layout is exercised manually.
  test.use({ viewport: { width: 390, height: 844 } });

  let sb: SupabaseClient | null = null;
  let stored: Fixture | null = null; // route with data.stops
  let legacy: Fixture | null = null; // bold-prefix days, no stops
  let underivable: Fixture | null = null; // prose days, no stops

  test.beforeAll(async () => {
    sb = await signedClient();
    if (!sb) return;
    const userId = (await sb.auth.getUser()).data.user?.id as string;
    stored = await seedTrip(sb, userId, "RL Stored Fixture", {
      days: [
        "**Ziro Town** — arrive and settle in",
        "**Ziro Town** — festival grounds",
        "**Hapoli** — craft market day",
        "**Kile Pakho** — ridge viewpoint",
        "**Kile Pakho** — departure",
      ],
      stops: [
        { city: "Ziro Town", nights: 2 },
        { city: "Hapoli", nights: 1 },
        { city: "Kile Pakho", nights: 1 },
      ],
    });
    legacy = await seedTrip(sb, userId, "RL Legacy Fixture", {
      days: [
        "**Ziro Town** — arrive and settle in",
        "**Ziro Town** — festival grounds",
        "**Hapoli** — craft market day",
        "**Kile Pakho** — ridge viewpoint",
        "**Kile Pakho** — departure",
      ],
    });
    underivable = await seedTrip(sb, userId, "RL Underivable Fixture", {
      days: [
        "Arrive and settle in",
        "Festival grounds all day",
        "Craft market day",
        "Ridge viewpoint",
        "Departure",
      ],
    });
  });

  test.afterAll(async () => {
    if (!sb) return;
    for (const f of [stored, legacy, underivable]) {
      if (!f) continue;
      const { data: dayIds } = await sb
        .from("days")
        .select("id")
        .eq("trip_id", f.id);
      if (dayIds?.length)
        await sb
          .from("activities")
          .delete()
          .in(
            "day_id",
            dayIds.map((d) => d.id),
          );
      await sb.from("brainstorm_items").delete().eq("trip_id", f.id);
      await sb.from("days").delete().eq("trip_id", f.id);
      await sb.from("activity_log").delete().eq("trip_id", f.id);
      await sb.from("trip_members").delete().eq("trip_id", f.id);
      await sb.from("trips").delete().eq("id", f.id);
    }
  });

  test("18.1 overview renders from stored data.stops", async ({ page }) => {
    test.skip(!stored, "fixture seeding failed");
    await login(page);
    await blockLlm(page);
    await openTrip(page, stored!.id);
    const overview = page.getByTestId("route-overview");
    await expect(overview).toBeVisible({ timeout: 15000 });
    await expect(overview).toContainText("Ziro Festival + Villages");
    await expect(overview).toContainText("P1");
    await expect(overview).toContainText("4 nights");
    // three segments with D-ranges + nights from the actual day rows
    await expect(overview).toContainText("D1–2 · 2N");
    await expect(overview).toContainText("D3 · 1N");
    await expect(overview).toContainText("D4–5 · 1N");
  });

  test("18.2 derivation ladder renders for a legacy bold-days route", async ({
    page,
  }) => {
    test.skip(!legacy, "fixture seeding failed");
    await login(page);
    await blockLlm(page);
    await openTrip(page, legacy!.id);
    const overview = page.getByTestId("route-overview");
    await expect(overview).toBeVisible({ timeout: 15000 });
    await expect(overview).toContainText("Hapoli");
  });

  test("18.3 overview hides on an underivable route", async ({ page }) => {
    test.skip(!underivable, "fixture seeding failed");
    await login(page);
    await blockLlm(page);
    await openTrip(page, underivable!.id);
    await page.waitForTimeout(3000);
    await expect(page.getByTestId("route-overview")).toHaveCount(0);
  });

  test("18.4 segment tap scrolls to that stop's first day", async ({
    page,
  }) => {
    test.skip(!stored, "fixture seeding failed");
    await login(page);
    await blockLlm(page);
    await openTrip(page, stored!.id);
    const overview = page.getByTestId("route-overview");
    await expect(overview).toBeVisible({ timeout: 15000 });
    // Kile Pakho's first day is Day 4 — after the seg tap its card must have
    // moved up into the viewport
    const day4 = page.getByText(/Day 4/).first();
    const before = (await day4.boundingBox())?.y ?? 99999;
    await overview.getByRole("button", { name: /Go to Kile Pakho/ }).click();
    await page.waitForTimeout(1600); // smooth scroll settles
    const after = (await day4.boundingBox())?.y ?? 99999;
    expect(after).toBeLessThan(before);
    expect(after).toBeLessThan(600);
  });

  test("18.5 editor: ledger gates Apply with reasons", async ({ page }) => {
    test.skip(!stored, "fixture seeding failed");
    await login(page);
    await blockLlm(page);
    await openTrip(page, stored!.id);
    await page.getByText("✎ Edit route").click();
    const sheet = page.getByRole("dialog", { name: "Your route" });
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId("nights-ledger")).toContainText(
      "4 nights · balanced ✓",
    );
    const apply = page.getByTestId("route-apply");
    await expect(apply).toBeDisabled();
    await expect(apply).toContainText("Rebuild itinerary");

    // +1 night in Ziro Town → over budget, Apply names the fix
    await sheet
      .getByRole("button", { name: "More nights in Ziro Town" })
      .click();
    await expect(page.getByTestId("nights-ledger")).toContainText(
      "5 assigned · 1 night over",
    );
    await expect(apply).toBeDisabled();
    await expect(apply).toContainText("Balance nights to rebuild (1 over)");
    await expect(page.getByTestId("pending-edits")).toContainText(
      "Ziro Town 2→3N",
    );

    // Hapoli sits at the 1-night floor — its "fewer" stepper is disabled
    await expect(
      sheet.getByRole("button", { name: "Fewer nights in Hapoli" }),
    ).toBeDisabled();

    // remove Hapoli instead → 3+1 = 4, balanced, Apply enables
    await sheet.getByRole("button", { name: "Remove Hapoli" }).click();
    await expect(page.getByTestId("nights-ledger")).toContainText("balanced ✓");
    await expect(apply).toBeEnabled();
    await expect(apply).toContainText("Rebuild itinerary from this route");
  });

  test("18.6 editor: tap-to-move reorders, add-stop free text, remove floor", async ({
    page,
  }) => {
    test.skip(!stored, "fixture seeding failed");
    await login(page);
    await blockLlm(page);
    await openTrip(page, stored!.id);
    await page.getByText("✎ Edit route").click();
    const sheet = page.getByRole("dialog", { name: "Your route" });
    await expect(sheet).toBeVisible();

    // move Ziro Town down one
    await sheet.getByRole("button", { name: "Move Ziro Town down" }).click();
    const rows = sheet.locator("b");
    await expect(rows.nth(0)).toContainText("Hapoli");
    await expect(rows.nth(1)).toContainText("Ziro Town");
    await expect(page.getByTestId("pending-edits")).toContainText("reordered");

    // add a free-text stop → NEW row + over-budget ledger
    await sheet.getByText("＋ Add a stop").click();
    await sheet.getByPlaceholder("City or town…").fill("Talley Valley");
    await sheet.getByRole("button", { name: "Add stop" }).click();
    await expect(
      sheet.locator("b", { hasText: "Talley Valley" }),
    ).toBeVisible();
    await expect(sheet.getByText("NEW")).toBeVisible();
    await expect(page.getByTestId("nights-ledger")).toContainText(
      "5 assigned · 1 night over",
    );

    // remove down to one stop → last ✕ disappears
    await sheet.getByRole("button", { name: "Remove Talley Valley" }).click();
    await sheet.getByRole("button", { name: "Remove Kile Pakho" }).click();
    await sheet.getByRole("button", { name: "Remove Ziro Town" }).click();
    await expect(
      sheet.getByRole("button", { name: /Remove Hapoli/ }),
    ).toHaveCount(0);
  });

  test("18.7 discard confirm guards close; editor reopens pristine", async ({
    page,
  }) => {
    test.skip(!stored, "fixture seeding failed");
    await login(page);
    await blockLlm(page);
    await openTrip(page, stored!.id);
    await page.getByText("✎ Edit route").click();
    const sheet = page.getByRole("dialog", { name: "Your route" });
    await sheet
      .getByRole("button", { name: "More nights in Ziro Town" })
      .click();
    await sheet.getByRole("button", { name: "Close route editor" }).click();
    await expect(page.getByText("Discard route edits?")).toBeVisible();
    await page.getByRole("button", { name: "Keep editing" }).click();
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Close route editor" }).click();
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(sheet).toHaveCount(0);
    // reopen → snapshot state, no pending edits
    await page.getByText("✎ Edit route").click();
    await expect(page.getByTestId("nights-ledger")).toContainText(
      "4 nights · balanced ✓",
    );
    await expect(page.getByTestId("pending-edits")).toHaveCount(0);
  });

  test("18.8 Apply reaches Pre-IG with zero LLM spend; cancel resumes editor", async ({
    page,
  }) => {
    test.skip(!stored, "fixture seeding failed");
    await login(page);
    await blockLlm(page);
    let llmCalls = 0;
    page.on("request", (r) => {
      if (/generate-itinerary|generate-brainstorm/.test(r.url())) llmCalls++;
    });
    await openTrip(page, stored!.id);
    await page.getByText("✎ Edit route").click();
    const sheet = page.getByRole("dialog", { name: "Your route" });
    // balanced edit: Ziro Town 2→3, Hapoli... use +Ziro −Kile: Remove floor OK
    await sheet
      .getByRole("button", { name: "More nights in Ziro Town" })
      .click();
    await sheet.getByRole("button", { name: "Remove Hapoli" }).click();
    await expect(page.getByTestId("nights-ledger")).toContainText("balanced ✓");
    const apply = page.getByTestId("route-apply");
    await expect(apply).toBeEnabled();
    await apply.click();
    // Solo trip → no group checkpoint → straight to Pre-IG (extract-preferences
    // blocked → defaults). The sheet title is the assertion.
    await expect(page.getByText("Fine-tune your itinerary")).toBeVisible({
      timeout: 10000,
    });
    // Cancel the funnel via the Pre-IG scrim → editor reopens with the
    // pending edits intact (cancelRouteFunnel path)
    await page.mouse.click(10, 60);
    await expect(sheet).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId("pending-edits")).toContainText(
      "Ziro Town 2→3N",
    );
    expect(llmCalls).toBe(0);
  });
});
