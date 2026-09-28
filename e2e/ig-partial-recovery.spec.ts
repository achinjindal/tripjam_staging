import { test, expect } from "@playwright/test";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import { login } from "./helpers";

// IG partial-build recovery (2026-09-28): when the detailed IG stream dies
// mid-delivery, the client now salvages the days that arrived (gated
// completion side effects, detailed_ready_at stays NULL) and the itinerary
// shows a "Built through Day k of N — Finish the rest" banner instead of
// silently looking complete or losing everything.
//
// This spec seeds the post-salvage DB state directly (trip + header-only
// ig_response + 2 of 5 days + NULL detailed_ready_at) — no LLM spend — and
// asserts the banner logic both ways.

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

test.describe.serial("IG partial-build recovery banner", () => {
  let sb: SupabaseClient | null = null;
  let tripId = "";

  test.beforeAll(async () => {
    sb = await signedClient();
    if (!sb) return;
    const uid = (await sb.auth.getUser()).data.user?.id;
    if (!uid) return;

    tripId = randomUUID();
    // 5-day trip; salvage left 2 days and no detailed_ready_at.
    const { error: tripErr } = await sb.from("trips").insert({
      id: tripId,
      name: "Partial Build Regression",
      destination: "Sri Lanka",
      start_date: "2026-11-02",
      end_date: "2026-11-06",
      created_by: uid,
      owner_id: uid,
      ig_request: { destinations: ["Sri Lanka"], travelers: "2" },
      ig_response: { name: "Partial Build Regression", cities: [] },
      detailed_ready_at: null,
    });
    if (tripErr) {
      tripId = "";
      return;
    }
    await sb
      .from("trip_members")
      .insert({ trip_id: tripId, user_id: uid, role: "edit" });
    const { error: dayErr } = await sb.from("days").insert([
      {
        trip_id: tripId,
        label: "Day 1",
        date: "2026-11-02",
        city: "Galle",
        position: 0,
      },
      {
        trip_id: tripId,
        label: "Day 2",
        date: "2026-11-03",
        city: "Galle",
        position: 1,
      },
    ]);
    if (dayErr) tripId = "";
  });

  test.afterAll(async () => {
    if (sb && tripId) await sb.from("trips").delete().eq("id", tripId);
    await sb?.auth.signOut();
  });

  test("partial trip shows the banner; completed trip does not", async ({
    page,
  }) => {
    test.setTimeout(120000);
    test.skip(!sb || !tripId, "Could not seed trip via supabase-js");

    await login(page);
    await page.goto(`/trip/${tripId}`);
    await page.waitForTimeout(2500);

    // Banner with exact progress + the recovery CTA.
    await expect(
      page.locator("text=/Built through Day 2 of 5/").first(),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.locator("button", { hasText: /Finish the rest/ }).first(),
    ).toBeVisible();
    // The zero-days empty state must NOT show alongside it.
    await expect(page.locator("text=never finished building")).toHaveCount(0);

    // Mark the trip complete → banner must disappear on reload.
    await sb!
      .from("trips")
      .update({ detailed_ready_at: new Date().toISOString() })
      .eq("id", tripId);
    await page.reload();
    await page.waitForTimeout(2500);
    await expect(page.locator("text=/Built through Day/")).toHaveCount(0);
  });
});
