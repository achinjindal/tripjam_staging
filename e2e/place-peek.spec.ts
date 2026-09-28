import { test, expect } from "@playwright/test";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import { login, snap } from "./helpers";

// Place Peek (RG) — Rev 6 design, gated by VITE_PLACE_PEEK_ENABLED.
//
// Route cards get two tap paths fed by the route's structured stops/city data:
//  - read path: first mention of each town in the day text (dotted underline)
//  - index path: "PLACES ON THIS ROUTE" chips (bases with nights, day-trips
//    dashed; stop-less legacy routes fall back to unlabeled chips)
// Tapping opens the PlacePeek sheet: instant title + per-route context rows,
// Wikipedia extract streamed in (or a graceful miss state).
//
// Seeds a DRAFT trip (no ig_response) — drafts open the brainstorm screen with
// editingTrip/pendingForm prefilled and saved routes loaded. Desktop shell
// (Playwright's 1280×720 ≥ 1024 breakpoint) defaults pretripTab to
// "inspirations", so the spec clicks the Route tab first.

const TRIP_NAME = "Place Peek Regression";

function readEnv(): { url: string; anon: string; peekEnabled: boolean } {
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = join(here, "..", ".env");
  let url = process.env.VITE_SUPABASE_URL || "";
  let anon = process.env.VITE_SUPABASE_ANON_KEY || "";
  let peek = process.env.VITE_PLACE_PEEK_ENABLED || "";
  try {
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const [, k, vRaw] = m;
      const v = vRaw.replace(/^["']|["']$/g, "");
      if (k === "VITE_SUPABASE_URL" && !url) url = v;
      if (k === "VITE_SUPABASE_ANON_KEY" && !anon) anon = v;
      if (k === "VITE_PLACE_PEEK_ENABLED" && !peek) peek = v;
    }
  } catch {
    /* fall back to process.env */
  }
  return { url, anon, peekEnabled: peek === "true" };
}

const PEEK_ENABLED = readEnv().peekEnabled;

async function signedClient(): Promise<SupabaseClient | null> {
  const { url, anon } = readEnv();
  if (!url || !anon) return null;
  const sb = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await sb.auth.signInWithPassword({
    email: "qa-tester@tripjam.app",
    password: "qaTest123!",
  });
  if (error) return null;
  return sb;
}

test.describe.serial("Place Peek on route cards", () => {
  test.skip(!PEEK_ENABLED, "VITE_PLACE_PEEK_ENABLED is not true");

  let sb: SupabaseClient | null = null;
  let tripId = "";

  test.beforeAll(async () => {
    sb = await signedClient();
    if (!sb) return;
    const uid = (await sb.auth.getUser()).data.user?.id;
    if (!uid) return;

    tripId = randomUUID();
    // 5-day trip → 4 nights; P1 stops must sum to exactly 4 for deriveStops
    // to trust them (validStops nights budget check).
    const { error: tripErr } = await sb.from("trips").insert({
      id: tripId,
      name: TRIP_NAME,
      destination: "Sri Lanka",
      start_date: "2026-11-02",
      end_date: "2026-11-06",
      created_by: uid,
      owner_id: uid,
      ig_request: {
        destinations: ["Sri Lanka"],
        startDate: "2026-11-02",
        endDate: "2026-11-06",
        travelers: "2",
        styles: [],
        budget: "mid",
        pace: "active",
        morningStart: "early",
      },
      // NO ig_response — draft, opens the brainstorm (Route) screen.
    });
    if (tripErr) {
      tripId = "";
      return;
    }
    await sb
      .from("trip_members")
      .insert({ trip_id: tripId, user_id: uid, role: "edit" });

    const { error: brainErr } = await sb.from("brainstorm_items").insert([
      {
        trip_id: tripId,
        title: "South Coast Loop",
        city: "Galle, Unawatuna, Hikkaduwa, Mirissa",
        category: "Route",
        note: "Minimal travel, best beaches",
        position: 0,
        tier: 1,
        data: {
          tagline: "Minimal travel, best beaches",
          days: [
            "Colombo → **Galle** (2.5h drive)",
            "**Galle Fort** walk and Unawatuna beach",
            "Day trip to **Hikkaduwa** for scuba diving, back to Galle",
            "Galle → **Mirissa**, beach day and sunset",
            "Drive back to Colombo (2.5h)",
          ],
          bestFor: "Beach lovers",
          points: [{ text: "Least transit of all routes", good: true }],
          routeLabel: "P1",
          stops: [
            { city: "Galle", nights: 3 },
            { city: "Mirissa", nights: 1 },
          ],
        },
      },
      {
        // Stop-less legacy shape + unparseable day prefixes → deriveStops
        // fails → plain unlabeled chips (fallback path).
        trip_id: tripId,
        title: "Hills Circuit",
        city: "Kandy, Nuwara Eliya",
        category: "Route",
        note: "Tea country",
        position: 1,
        tier: 1,
        data: {
          tagline: "Tea country",
          days: [
            "Drive up to Kandy (3h)",
            "Kandy temple day",
            "Kandy → Nuwara Eliya, tea estates",
            "Tea country walks",
            "Back to Colombo",
          ],
          bestFor: "Culture seekers",
          points: [{ text: "Cooler climate", good: true }],
          routeLabel: "P2",
        },
      },
    ]);
    if (brainErr) tripId = "";
  });

  test.afterAll(async () => {
    if (sb && tripId) await sb.from("trips").delete().eq("id", tripId);
    await sb?.auth.signOut();
  });

  test("chips, first-mention links, peek sheet, POI exclusion", async ({
    page,
  }) => {
    test.setTimeout(120000);
    test.skip(!sb || !tripId, "Could not seed trip via supabase-js");

    await login(page);
    await page.goto(`/trip/${tripId}`);
    await page.waitForTimeout(2500);

    // Desktop shell defaults to the Inspirations tab for drafts — go to Route.
    const routeTab = page
      .locator("button", { hasText: /^🛣️?\s*Route$/ })
      .first();
    if (await routeTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await routeTab.click();
      await page.waitForTimeout(800);
    }

    // Both cards render with their chips rows.
    await expect(page.locator("text=PLACES ON THIS ROUTE").first()).toBeVisible(
      { timeout: 15000 },
    );

    // P1 (stops present): base chip carries nights, day-trip chip labeled.
    const galleChip = page
      .locator("span", { hasText: /^Galle\s*· 3 nights$/ })
      .first();
    await expect(galleChip).toBeVisible();
    await expect(
      page.locator("span", { hasText: /^Unawatuna\s*· day trip$/ }).first(),
    ).toBeVisible();

    // P2 (no stops): plain chips, no nights / day-trip suffix.
    await expect(
      page.locator("span", { hasText: /^Kandy$/ }).first(),
    ).toBeVisible();

    await snap(page, "place-peek-cards");

    // POI "Galle Fort" is bold but NOT a link (no underlined span wraps it).
    const fortLinks = page.locator("span[style*='underline']", {
      hasText: "Galle Fort",
    });
    expect(await fortLinks.count()).toBe(0);

    // Read path: first mention of Mirissa in the day text is underlined.
    const mirissaLink = page
      .locator("span[style*='underline']", { hasText: /^Mirissa$/ })
      .first();
    await expect(mirissaLink).toBeVisible();

    // Tap the Galle base chip → peek opens instantly with context rows.
    await galleChip.click();
    const dialog = page.locator("[role='dialog'][aria-label='About Galle']");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.locator("text=ON YOUR ROUTES")).toBeVisible();
    await expect(
      dialog.locator("text=/Overnight base · 3 nights/").first(),
    ).toBeVisible();
    await expect(dialog.locator("text=/Not visited/").first()).toBeVisible();

    // Wikipedia content or the graceful miss state — never an empty body.
    await expect(
      dialog.locator("text=/From Wikipedia|keeps a low profile/").first(),
    ).toBeVisible({ timeout: 20000 });

    // CTAs present.
    await expect(dialog.locator("text=💬 Ask Trippy")).toBeVisible();
    await expect(dialog.locator("text=📖 More in Magazine")).toBeVisible();
    await snap(page, "place-peek-open");

    // Close via ✕ — card must NOT have become vote-selected by the tap.
    await dialog.locator("[aria-label='Close']").click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.locator("text=PLACES ON THIS ROUTE").first(),
    ).toBeVisible();

    // Read-path tap: underlined Mirissa opens its peek too.
    await mirissaLink.click();
    const dialog2 = page.locator("[role='dialog'][aria-label='About Mirissa']");
    await expect(dialog2).toBeVisible({ timeout: 5000 });
    await expect(
      dialog2.locator("text=/Overnight base · 1 night/").first(),
    ).toBeVisible();
    // Escape key closes.
    await page.keyboard.press("Escape");
    await expect(dialog2).toHaveCount(0);
  });
});
