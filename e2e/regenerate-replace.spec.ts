import { test, expect, Page } from "@playwright/test";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import { login, dismissTripOverlays } from "./helpers";

// Regenerating an itinerary swaps the trip's days in ONE transaction
// (replace_trip_days). Production once had no days DELETE policy, so every
// regenerate silently kept the old days beside the new ones; and the old
// per-row save could leave a half-saved trip. Drives the real save path via
// the Routes Lens rebuild with generate-itinerary answered by a canned
// stream — zero LLM spend. Run with VITE_ROUTES_LENS_ENABLED=true.

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

const CITIES = ["Ziro Town", "Ziro Town", "Hapoli", "Kile Pakho", "Kile Pakho"];

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

// 5-day trip, 3 "Old spot" activities a day, and a selected route with stops
// so the Routes Lens editor can rebuild it.
async function seedTrip(sb: SupabaseClient, name: string) {
  const userId = (await sb.auth.getUser()).data.user?.id as string;
  const id = randomUUID();
  const start = new Date();
  start.setDate(start.getDate() + 40);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const end = new Date(start);
  end.setDate(start.getDate() + 4);
  const { error } = await sb.from("trips").insert({
    id,
    name,
    destination: "Ziro Valley",
    start_date: iso(start),
    end_date: iso(end),
    created_by: userId,
    owner_id: userId,
    ig_request: {
      destinations: ["Ziro Valley"],
      travelers: "2",
      budget: "mid",
      pace: "active",
      morningStart: "early",
      startDate: iso(start),
      endDate: iso(end),
    },
    ig_response: { name: "Ziro Festival + Villages" },
  });
  if (error) throw error;
  await sb
    .from("trip_members")
    .insert({ trip_id: id, user_id: userId, role: "edit" });
  const { error: daysErr } = await sb.rpc("replace_trip_days", {
    p_trip: id,
    p_days: CITIES.map((city, i) => ({
      label: `Day ${i + 1}`,
      city,
      description: `${city} day`,
      activities: [0, 1, 2].map((k) => ({
        time: ["09:00", "13:00", "17:00"][k],
        title: `Old spot ${i + 1}.${k + 1}`,
        type: "sight",
      })),
    })),
  });
  if (daysErr) throw daysErr;
  const { error: routeErr } = await sb.from("brainstorm_items").insert({
    trip_id: id,
    title: "Ziro Festival + Villages",
    city: "Ziro Town, Hapoli, Kile Pakho",
    category: "Route",
    tier: 1,
    position: 0,
    selected: true,
    data: {
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
    },
  });
  if (routeErr) throw routeErr;
  return id;
}

// generate-itinerary streams the itinerary JSON as SSE string chunks.
function cannedItinerary() {
  const cities = [
    "Ziro Town",
    "Ziro Town",
    "Ziro Town",
    "Kile Pakho",
    "Kile Pakho",
  ];
  const itinerary = {
    name: "Ziro Rebuilt",
    summary: "Canned regenerate fixture",
    cities: ["Ziro Town", "Kile Pakho"],
    days: cities.map((city, i) => ({
      label: `Day ${i + 1}`,
      city,
      description: `New ${city} day`,
      activities: [0, 1].map((k) => ({
        time: ["10:00", "15:00"][k],
        title: `New spot ${i + 1}.${k + 1}`,
        type: "sight",
        duration: "1h",
        note: "canned",
        icon: "📍",
        confirmed: false,
      })),
    })),
  };
  const json = JSON.stringify(itinerary);
  const chunks = [json.slice(0, 120), json.slice(120)];
  return (
    chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") +
    "data: [DONE]\n\n"
  );
}

async function stubLlm(page: Page) {
  for (const fn of ["extract-preferences", "generate-brainstorm"]) {
    await page.route(`**/functions/v1/${fn}`, (route) =>
      route.fulfill({ status: 500, body: "{}" }),
    );
  }
  await page.route("**/functions/v1/generate-itinerary", (route) =>
    route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
      body: cannedItinerary(),
    }),
  );
}

// Routes Lens: lengthen Ziro, drop Hapoli, rebuild, accept the replace.
async function rebuild(page: Page, tripId: string) {
  await page.goto(`/trip/${tripId}`);
  await page.waitForTimeout(2500);
  await dismissTripOverlays(page, 2000);
  const planToggle = page.getByRole("button", { name: "Plan", exact: true });
  if (await planToggle.isVisible({ timeout: 3000 }).catch(() => false))
    await planToggle.click();
  await page.getByText("✎ Edit route").click();
  const sheet = page.getByRole("dialog", { name: "Your route" });
  await sheet.getByRole("button", { name: "More nights in Ziro Town" }).click();
  await sheet.getByRole("button", { name: "Remove Hapoli" }).click();
  await page.getByTestId("route-apply").click();
  await expect(page.getByText("Fine-tune your itinerary")).toBeVisible({
    timeout: 10000,
  });
  await page.getByRole("button", { name: "Generate Itinerary →" }).click();
  await expect(page.getByText("Regenerate itinerary?")).toBeVisible({
    timeout: 8000,
  });
  await page.getByRole("button", { name: "Replace Itinerary" }).click();
}

async function tripRow(sb: SupabaseClient, tripId: string) {
  const { data } = await sb
    .from("trips")
    .select("ig_count, detailed_ready_at")
    .eq("id", tripId)
    .single();
  return data;
}

async function savedDays(sb: SupabaseClient, tripId: string) {
  const { data } = await sb
    .from("days")
    .select("position, city, activities(title, position)")
    .eq("trip_id", tripId)
    .order("position");
  return (data || []).map((d) => ({
    ...d,
    activities: [...d.activities].sort((a, b) => a.position - b.position),
  }));
}

test.describe("Regenerate replaces the itinerary atomically", () => {
  test.skip(!ENV.lensEnabled, "VITE_ROUTES_LENS_ENABLED not true");
  test.use({ viewport: { width: 390, height: 844 } });

  let sb: SupabaseClient | null = null;
  const trips: string[] = [];

  test.beforeAll(async () => {
    sb = await signedClient();
  });

  test.afterAll(async () => {
    for (const id of trips) await sb?.rpc("delete_trip", { p_trip: id });
  });

  test("regenerate leaves exactly the new days, in order", async ({ page }) => {
    test.skip(!sb, "auth failed");
    const tripId = await seedTrip(sb!, "RR Replace Fixture");
    trips.push(tripId);
    await login(page);
    await stubLlm(page);
    await rebuild(page, tripId);

    await expect(page.getByText("New spot 1.1").first()).toBeVisible({
      timeout: 20000,
    });
    const days = await savedDays(sb!, tripId);
    expect(days.map((d) => d.position)).toEqual([0, 1, 2, 3, 4]);
    expect(days.map((d) => d.city)).toEqual([
      "Ziro Town",
      "Ziro Town",
      "Ziro Town",
      "Kile Pakho",
      "Kile Pakho",
    ]);
    expect(days.flatMap((d) => d.activities.map((a) => a.title))).toEqual(
      [1, 2, 3, 4, 5].flatMap((i) => [`New spot ${i}.1`, `New spot ${i}.2`]),
    );
    await expect(page.getByText("Old spot 1.1")).toHaveCount(0);
    // The trip row is written after the days, and only then.
    const trip = await tripRow(sb!, tripId);
    expect(trip?.ig_count).toBe(1);
    expect(trip?.detailed_ready_at).toBeTruthy();
  });

  test("a failed save keeps the previous itinerary whole", async ({ page }) => {
    test.skip(!sb, "auth failed");
    const tripId = await seedTrip(sb!, "RR Failure Fixture");
    trips.push(tripId);
    await login(page);
    await stubLlm(page);
    let saveAttempts = 0;
    await page.route("**/rest/v1/rpc/replace_trip_days", (route) => {
      saveAttempts++;
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "simulated outage" }),
      });
    });
    await rebuild(page, tripId);

    await expect(page.getByText(/Failed to save the itinerary/)).toBeVisible({
      timeout: 20000,
    });
    expect(saveAttempts).toBe(3); // first try + two retries on a 5xx
    const days = await savedDays(sb!, tripId);
    expect(days).toHaveLength(5);
    expect(days.flatMap((d) => d.activities.map((a) => a.title))).toEqual(
      [1, 2, 3, 4, 5].flatMap((i) => [
        `Old spot ${i}.1`,
        `Old spot ${i}.2`,
        `Old spot ${i}.3`,
      ]),
    );
    // Nor did the trip row move on to the unsaved itinerary.
    const trip = await tripRow(sb!, tripId);
    expect(trip?.ig_count).toBe(0);
    expect(trip?.detailed_ready_at).toBeNull();
  });
});
