import { test, expect } from "@playwright/test";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import { login } from "./helpers";

// Regression: itinerary → "Explore plans" must reload the trip's saved routes.
//
// IG completion clears editingTrip + pendingForm, and the pretrip
// BrainstormView loads saved routes only from editingTrip?.id. Every
// explore-plans entry point must go through openExplorePlans() (App.jsx),
// which restores both from the trip before switching screens. Before the fix,
// three of the four buttons did a bare setScreen("brainstorm"), mounting
// BrainstormView with no trip id — it sat in the "Generating your plans…"
// empty state forever even though the routes were saved in brainstorm_items.
// This has regressed multiple times; keep this test green.
//
// The trip + routes + one itinerary day are seeded directly via supabase-js
// as qa-tester (no RG/IG spend), then cleaned up.

const OWNER = "qa-tester";
const PASSWORD = "qaTest123!";
const TRIP_NAME = "Explore Plans Regression";
const ROUTE_TITLES = [
  "Ubud Culture Loop",
  "South Coast Surf Run",
  "Volcano & Lakes Circuit",
  "Island Hopper Classic",
];

function readEnv(): { url: string; anon: string } {
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = join(here, "..", ".env");
  let url = process.env.VITE_SUPABASE_URL || "";
  let anon = process.env.VITE_SUPABASE_ANON_KEY || "";
  try {
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const [, k, vRaw] = m;
      const v = vRaw.replace(/^["']|["']$/g, "");
      if (k === "VITE_SUPABASE_URL" && !url) url = v;
      if (k === "VITE_SUPABASE_ANON_KEY" && !anon) anon = v;
    }
  } catch {
    /* fall back to process.env */
  }
  return { url, anon };
}

async function signedClient(): Promise<SupabaseClient | null> {
  const { url, anon } = readEnv();
  if (!url || !anon) return null;
  const sb = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await sb.auth.signInWithPassword({
    email: `${OWNER}@tripjam.app`,
    password: PASSWORD,
  });
  if (error) return null;
  return sb;
}

test.describe.serial("Explore plans after itinerary", () => {
  let sb: SupabaseClient | null = null;
  let tripId = "";

  test.beforeAll(async () => {
    sb = await signedClient();
    if (!sb) return;
    const uid = (await sb.auth.getUser()).data.user?.id;
    if (!uid) return;

    tripId = randomUUID();
    const igRequest = {
      destinations: ["Bali, Indonesia"],
      startDate: "2026-11-02",
      endDate: "2026-11-08",
      travelers: "2",
      styles: [],
      budget: "mid",
      pace: "active",
      morningStart: "early",
    };
    const { error: tripErr } = await sb.from("trips").insert({
      id: tripId,
      name: TRIP_NAME,
      destination: "Bali, Indonesia",
      start_date: "2026-11-02",
      end_date: "2026-11-08",
      created_by: uid,
      owner_id: uid,
      ig_request: igRequest,
      // A truthy ig_response marks the trip as built (isDraft in App.jsx) —
      // without it /trip/:id opens the pretrip planner, not the itinerary.
      ig_response: { cities: [], seeded: true },
    });
    if (tripErr) {
      tripId = "";
      return;
    }
    // Mirror the app: creator is a member (ignore failure — legacy RLS
    // setups list trips by created_by alone).
    await sb
      .from("trip_members")
      .insert({ trip_id: tripId, user_id: uid, role: "edit" });

    // Saved RG routes (what "Explore plans" must bring back).
    await sb.from("brainstorm_items").insert(
      ROUTE_TITLES.map((title, i) => ({
        trip_id: tripId,
        title,
        city: "Ubud, Canggu",
        category: "Route",
        note: "Seeded regression route",
        position: i,
        tier: 1,
        selected: i === 0,
        data: {
          tagline: "Seeded regression route",
          days: ["**Day 1-3:** Ubud", "**Day 4-7:** Canggu"],
          bestFor: "Testing",
          points: [{ text: "Deterministic seed", good: true }],
          routeLabel: `P${i + 1}`,
        },
      })),
    );

    // One itinerary day so the itinerary screen has content.
    const { error: dayErr } = await sb.from("days").insert({
      trip_id: tripId,
      label: "Day 1",
      date: "2026-11-02",
      city: "Ubud",
      position: 0,
    });
    if (dayErr) {
      console.warn("day seed failed:", dayErr.message);
      tripId = "";
    }
  });

  test.afterAll(async () => {
    if (sb && tripId) {
      // Cascades to brainstorm_items, days, trip_members.
      await sb.from("trips").delete().eq("id", tripId);
    }
    await sb?.auth.signOut();
  });

  test("saved routes reappear via Explore plans", async ({ page }) => {
    test.setTimeout(120000);
    test.skip(!sb || !tripId, "Could not seed trip via supabase-js");

    await login(page);
    await page.goto(`/trip/${tripId}`);
    await page.waitForTimeout(2500);

    // On the itinerary screen — find any explore-plans entry point
    // (desktop "Explore other plans", tablet/mobile "Explore plans" /
    // "Explore Other Plans").
    const exploreBtn = page
      .locator("button", { hasText: /explore (other )?plans/i })
      .first();
    await expect(exploreBtn).toBeVisible({ timeout: 15000 });
    await exploreBtn.click();

    // The saved routes must load — the first seeded route card appears.
    await expect(page.locator(`text=${ROUTE_TITLES[0]}`).first()).toBeVisible({
      timeout: 15000,
    });

    // And the broken empty state must NOT be shown.
    await expect(page.locator("text=/Generating your plans/i")).toHaveCount(0);

    // URL reflects the plans view.
    expect(page.url()).toContain(`/trip/${tripId}/plans`);
  });
});
