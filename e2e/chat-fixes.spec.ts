import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { login, dismissTripOverlays } from "./helpers";

// Proactive fixes (src/tripFixes.js) in the chat panel, on a throwaway trip
// with a booked train that clashes with Day 1 and a restaurant repeated on
// Day 2. The chat endpoint is mocked: no LLM, no credits.

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
    name: "ZZ chat fixes",
    destination: "Galle → Ella",
    start_date: "2026-11-02",
    end_date: "2026-11-03",
    created_by: uid,
    owner_id: uid,
    ig_request: { destinations: ["Galle", "Ella"], travelers: "2" },
    ig_response: { name: "ZZ chat fixes", cities: [] },
    detailed_ready_at: new Date().toISOString(),
    travel_data: [
      {
        id: "leg1",
        kind: "train",
        carrier: "SLR",
        number: "1015",
        date: "2026-11-02",
        depart_time: "11:00",
        arrive_time: "13:00",
        from: "Galle",
        to: "Colombo",
        status: "booked",
        via: "email",
      },
    ],
  });
  await sb
    .from("trip_members")
    .insert({ trip_id: tripId, user_id: uid, role: "edit" });
  const { data: days } = await sb
    .from("days")
    .insert([
      {
        trip_id: tripId,
        label: "Day 1",
        city: "Galle",
        date: "2026-11-02",
        position: 0,
      },
      {
        trip_id: tripId,
        label: "Day 2",
        city: "Galle",
        date: "2026-11-03",
        position: 1,
      },
    ])
    .select("id, position")
    .order("position");
  const [d1, d2] = days!.map((d) => d.id);
  const mk = (
    day_id: string,
    position: number,
    time: string,
    title: string,
    type: string,
    duration = "1h",
  ) => ({ day_id, position, time, title, type, duration, geocode: title });
  await sb
    .from("activities")
    .insert([
      mk(d1, 0, "10:00", "Galle Fort Ramparts Walk", "sight", "2h"),
      mk(d1, 1, "19:30", "Dinner at Poonie's Kitchen", "food"),
      mk(d2, 0, "09:00", "Jungle Beach", "sight"),
      mk(d2, 1, "19:30", "Poonie's Kitchen", "food"),
    ]);
});

test.afterAll(async () => {
  if (tripId) await sb.from("trips").delete().eq("id", tripId);
});

test("fixes show in chat, send on tap, and stay dismissed", async ({
  page,
}) => {
  test.setTimeout(120000);
  const bodies: Array<Record<string, unknown>> = [];
  await page.route("**/functions/v1/chat", async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        `data: ${JSON.stringify({ type: "final", data: { message: "Which day works?", actions: [] } })}\n\n` +
        "data: [DONE]\n\n",
    });
  });
  await login(page);
  await page.goto(`/trip/${tripId}`);
  await page.waitForTimeout(3000);
  await dismissTripOverlays(page, 3000);
  await page
    .getByPlaceholder(/Ask Trippy/i)
    .first()
    .waitFor({ timeout: 20000 });

  const box = page.getByRole("region", { name: "Worth a look" }).first();
  await expect(box).toBeVisible({ timeout: 15000 });
  const leg = box.locator("[data-fix-kind='booked_leg']");
  const repeat = box.locator("[data-fix-kind='repeat']");
  await expect(leg).toContainText("Galle Fort Ramparts Walk");
  await expect(leg).toContainText("SLR 1015");
  await expect(repeat).toContainText(
    "Day 2 repeats Poonie's Kitchen from Day 1.",
  );

  // Tap: the fix's request goes to Trippy as a normal chat message.
  await repeat.getByRole("button", { name: "Swap the repeat" }).click();
  await expect.poll(() => bodies.length, { timeout: 15000 }).toBe(1);
  expect(String(bodies[0].message)).toContain(
    "Replace the repeat on Day 2 with something new nearby",
  );
  await expect(page.getByText("Which day works?").first()).toBeVisible();
  await expect(repeat).toHaveCount(0);
  await expect(leg).toBeVisible();

  // Dismiss survives a reload (per-viewer localStorage).
  await leg.getByRole("button", { name: "Dismiss" }).click();
  await expect(leg).toHaveCount(0);
  await page.reload();
  await page.waitForTimeout(3000);
  await dismissTripOverlays(page, 3000);
  await page
    .getByPlaceholder(/Ask Trippy/i)
    .first()
    .waitFor({ timeout: 20000 });
  // The repeat was only hidden for the session it was tapped in.
  await expect(
    page
      .getByRole("region", { name: "Worth a look" })
      .first()
      .locator("[data-fix-kind='repeat']"),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.locator("[data-fix-kind='booked_leg']")).toHaveCount(0);
});
