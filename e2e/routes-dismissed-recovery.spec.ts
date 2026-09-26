import { test, expect } from "@playwright/test";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import { login } from "./helpers";

// Regression (prod user report, 2026-09-26): chat's dismiss_route can bulk-
// dismiss EVERY tier-1 route (destination pivot). Rows survive with
// dismissed=true, but the Route panel rendered NOTHING — the empty-state CTA
// checks items.length === 0, skeletons need loading, and tier1Items filters
// dismissed. Blank panel, no recovery, reads as lost work.
//
// The fix adds an "All your plans were dismissed" state with Restore +
// Generate-new CTAs. Restore un-dismisses in the DB, so saved work returns.

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
    email: "qa-tester@tripjam.app",
    password: "qaTest123!",
  });
  if (error) return null;
  return sb;
}

test.describe.serial("All-routes-dismissed recovery", () => {
  let sb: SupabaseClient | null = null;
  let tripId = "";

  test.beforeAll(async () => {
    sb = await signedClient();
    if (!sb) return;
    const uid = (await sb.auth.getUser()).data.user?.id;
    if (!uid) return;

    tripId = randomUUID();
    const { error: tripErr } = await sb.from("trips").insert({
      id: tripId,
      name: "Dismissed Recovery Regression",
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
      // draft — opens the brainstorm screen
    });
    if (tripErr) {
      tripId = "";
      return;
    }
    await sb
      .from("trip_members")
      .insert({ trip_id: tripId, user_id: uid, role: "edit" });

    // Two tier-1 routes, BOTH dismissed — the dead-end state from the report.
    const { error: brainErr } = await sb.from("brainstorm_items").insert(
      ["South Coast Loop", "Hills Circuit"].map((title, i) => ({
        trip_id: tripId,
        title,
        city: i === 0 ? "Galle, Mirissa" : "Kandy, Nuwara Eliya",
        category: "Route",
        note: "seed",
        position: i,
        tier: 1,
        dismissed: true,
        data: {
          tagline: "seed",
          days: [`Day in ${title}`],
          points: [],
          routeLabel: `P${i + 1}`,
        },
      })),
    );
    if (brainErr) tripId = "";
  });

  test.afterAll(async () => {
    if (sb && tripId) await sb.from("trips").delete().eq("id", tripId);
    await sb?.auth.signOut();
  });

  test("recovery state shows; Restore brings plans back and persists", async ({
    page,
  }) => {
    test.setTimeout(120000);
    test.skip(!sb || !tripId, "Could not seed trip via supabase-js");

    await login(page);
    await page.goto(`/trip/${tripId}`);
    await page.waitForTimeout(2500);

    // Desktop shell defaults drafts to Inspirations — go to Route.
    const routeTab = page
      .locator("button", { hasText: /^🛣️?\s*Route$/ })
      .first();
    if (await routeTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await routeTab.click();
      await page.waitForTimeout(800);
    }

    // The dead-end blank panel is gone — recovery state renders instead.
    await expect(
      page.locator("text=All your plans were dismissed").first(),
    ).toBeVisible({ timeout: 15000 });
    const restoreBtn = page.locator("button", {
      hasText: /^Restore 2 dismissed plans$/,
    });
    await expect(restoreBtn).toBeVisible();
    await expect(
      page.locator("button", { hasText: /^Generate new plans$/ }),
    ).toBeVisible();

    // Restore → both route cards reappear.
    await restoreBtn.click();
    await expect(page.locator("text=South Coast Loop").first()).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator("text=Hills Circuit").first()).toBeVisible();

    // And it persisted — the DB rows are un-dismissed.
    await expect
      .poll(
        async () => {
          const { data } = await sb!
            .from("brainstorm_items")
            .select("dismissed")
            .eq("trip_id", tripId);
          return (data || []).filter((r) => r.dismissed === false).length;
        },
        { timeout: 10000 },
      )
      .toBe(2);
  });
});
