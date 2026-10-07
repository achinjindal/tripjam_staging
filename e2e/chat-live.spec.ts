import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { login, dismissTripOverlays } from "./helpers";

// LIVE chat edits end to end: real model, real chat function, real RPC, on a
// throwaway trip. Spends ~1 credit per run, so it only runs with CHAT_LIVE=1:
//   CHAT_LIVE=1 npx playwright test e2e/chat-live.spec.ts

test.skip(!process.env.CHAT_LIVE, "set CHAT_LIVE=1 to run (spends credits)");

function readEnv() {
  const env: Record<string, string> = {};
  const raw = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", ".env"),
    "utf8",
  );
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

let sb: SupabaseClient;
let tripId: string;
let d1: string;
let d2: string;

test.beforeAll(async () => {
  const env = readEnv();
  sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sb.auth.signInWithPassword({
    email: "qa-tester@tripjam.app",
    password: "qaTest123!",
  });
  const uid = (await sb.auth.getUser()).data.user!.id;
  tripId = crypto.randomUUID();
  await sb.from("trips").insert({
    id: tripId,
    name: "ZZ chat live edit",
    destination: "Galle → Ella",
    start_date: "2026-11-02",
    end_date: "2026-11-03",
    created_by: uid,
    owner_id: uid,
    ig_request: { destinations: ["Galle", "Ella"], travelers: "2" },
    ig_response: { name: "ZZ chat live edit", cities: [] },
    detailed_ready_at: new Date().toISOString(),
  });
  await sb
    .from("trip_members")
    .insert({ trip_id: tripId, user_id: uid, role: "edit" });
  const { data: days } = await sb
    .from("days")
    .insert([
      { trip_id: tripId, label: "Day 1", city: "Galle", position: 0 },
      { trip_id: tripId, label: "Day 2", city: "Ella", position: 1 },
    ])
    .select("id, position")
    .order("position");
  d1 = days![0].id;
  d2 = days![1].id;
  const mk = (
    day_id: string,
    position: number,
    time: string,
    title: string,
    type: string,
    extra: Record<string, unknown> = {},
  ) => ({ day_id, position, time, title, type, geocode: title, ...extra });
  await sb.from("activities").insert([
    mk(d1, 0, "09:00", "Galle Fort Ramparts Walk", "sight", {
      lat: 6.0269,
      lng: 80.217,
      note: "E2E saved note",
    }),
    mk(d1, 1, "12:30", "Lunch at Poonie's Kitchen", "food"),
    mk(d1, 2, "15:00", "Jungle Beach", "sight"),
    mk(d1, 3, "19:30", "Dinner at Isle of Gelato", "food"),
    mk(d2, 0, "08:00", "Train from Galle to Ella", "transit"),
    mk(d2, 1, "14:00", "Nine Arches Bridge", "sight"),
  ]);
});

test.afterAll(async () => {
  if (tripId) await sb.from("trips").delete().eq("id", tripId);
});

test("live: remove and move edit only what was asked", async ({ page }) => {
  test.setTimeout(180000);
  await login(page);
  await page.goto(`/trip/${tripId}`);
  await page.waitForTimeout(3000);
  await dismissTripOverlays(page, 3000);
  const ask = page.getByPlaceholder(/Ask Trippy/i).first();
  await ask.waitFor({ timeout: 20000 });

  const send = async (text: string) => {
    await ask.fill(text);
    await ask.press("Enter");
    // Reply done = the input is enabled again and no reply is streaming.
    await expect(
      page.locator("button[aria-label='Send message']"),
    ).toBeVisible();
    await page.waitForFunction(
      () => !document.querySelector("[style*='blink']"),
      null,
      { timeout: 60000 },
    );
    await page.waitForTimeout(2000);
  };
  const acts = async (dayId: string) =>
    (
      await sb
        .from("activities")
        .select("id, title, time, lat, note")
        .eq("day_id", dayId)
        .order("position")
    ).data!;

  const before1 = await acts(d1);
  await send("Remove Jungle Beach from Day 1.");
  await expect
    .poll(async () => (await acts(d1)).map((a) => a.title), { timeout: 30000 })
    .not.toContain("Jungle Beach");
  const after1 = await acts(d1);
  // Untouched rows are the same rows (not rewritten).
  for (const a of after1) expect(before1.some((b) => b.id === a.id)).toBe(true);

  const fort = before1.find((a) => a.title.startsWith("Galle Fort"))!;
  await send(
    "Move the Galle Fort Ramparts Walk to Day 2, after the Nine Arches Bridge.",
  );
  await expect
    .poll(async () => (await acts(d2)).map((a) => a.id), { timeout: 30000 })
    .toContain(fort.id);
  const moved = (await acts(d2)).find((a) => a.id === fort.id)!;
  // A move keeps the saved details.
  expect(moved.lat).toBeCloseTo(6.0269);
  expect(moved.note).toBe("E2E saved note");
});
