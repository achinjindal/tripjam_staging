import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { login, dismissTripOverlays } from "./helpers";

// How chat replies are APPLIED, against a mocked chat endpoint (no LLM, no
// credits) and the real staging database:
//  - a day edit keeps the saved data of activities it didn't change
//    (coordinates, note, booked status) and logs an undo snapshot with them;
//  - an unusable reply (server "error" event) changes nothing and isn't saved;
//  - starter chips send on tap.
// Uses day 1 of the qa "Tokyo to Kyoto Classic" trip and restores it after.

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

const sse = (events: unknown[]) =>
  events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") +
  "data: [DONE]\n\n";

async function mockChat(page: Page, events: unknown[]) {
  const bodies: Array<Record<string, unknown>> = [];
  await page.route("**/functions/v1/chat", async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sse(events),
    });
  });
  return bodies;
}

async function openTripChat(page: Page, tripId: string) {
  await login(page);
  await page.goto(`/trip/${tripId}`);
  await page.waitForTimeout(3000);
  await dismissTripOverlays(page, 3000);
  const ask = page.getByPlaceholder(/Ask Trippy/i).first();
  await ask.waitFor({ timeout: 20000 });
  return ask;
}

// Replies are saved to the trip's chat history, so a fixed reply text would
// match a bubble from an earlier run. Tag every mocked reply with this run.
const RUN = `r${Date.now().toString(36)}`;

let sb: SupabaseClient;
let tripId: string;
let day: { id: string; label: string; city: string };
let snapshot: any[] = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const env = readEnv();
  sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sb.auth.signInWithPassword({
    email: "qa-tester@tripjam.app",
    password: "qaTest123!",
  });
  const me = (await sb.auth.getUser()).data.user!.id;
  const { data: trips } = await sb
    .from("trips")
    .select("id")
    .ilike("name", "Tokyo to Kyoto Classic%")
    .eq("created_by", me)
    .not("ig_response", "is", null)
    .limit(1);
  tripId = trips?.[0]?.id;
  if (!tripId) return;
  const { data: dayRows } = await sb
    .from("days")
    .select("id, label, city")
    .eq("trip_id", tripId)
    .order("position")
    .limit(1);
  day = dayRows![0];
  const { data: acts } = await sb
    .from("activities")
    .select("*")
    .eq("day_id", day.id)
    .order("position");
  snapshot = acts || [];
});

test.afterAll(async () => {
  if (!tripId || !snapshot.length) return;
  // Put day 1 back exactly as it was (same ids).
  await sb.from("activities").delete().eq("day_id", day.id);
  const { error } = await sb.from("activities").insert(snapshot);
  if (error) console.error("chat-apply restore failed:", error.message);
});

test("day edit keeps untouched activities' saved data", async ({ page }) => {
  test.skip(!tripId || snapshot.length < 2, "QA trip day 1 not usable");
  test.setTimeout(120000);
  const keep = snapshot.find((a) => a.type !== "transit") || snapshot[0];
  // Give the kept activity data the model never sees.
  await sb
    .from("activities")
    .update({
      lat: 35.0001,
      lng: 139.0001,
      note: "E2E keep note",
      confirmed: true,
    })
    .eq("id", keep.id);

  await mockChat(page, [
    { type: "delta", text: "Added a cafe to " },
    {
      type: "final",
      data: {
        message: `Added a cafe to ${day.label} (${RUN}).`,
        actions: [
          {
            type: "update_day",
            day: {
              label: day.label,
              city: day.city,
              activities: [
                {
                  time: "09:00",
                  title: keep.title,
                  // The model's guesses for a kept activity must be ignored.
                  geocode: "E2E WRONG GUESS",
                  note: "model rewrote this",
                  type: "sight",
                  duration: "1h",
                  icon: "📍",
                },
                {
                  time: "11:00",
                  title: "E2E Inserted Cafe",
                  geocode: "Shibuya, Tokyo",
                  type: "food",
                  duration: "45m",
                  note: "Coffee stop",
                  icon: "☕",
                },
              ],
            },
          },
        ],
      },
    },
  ]);

  const ask = await openTripChat(page, tripId);
  await ask.fill("e2e: add a cafe");
  await ask.press("Enter");
  await expect(
    page.getByText(`Added a cafe to ${day.label} (${RUN}).`).last(),
  ).toBeVisible({ timeout: 15000 });

  await expect
    .poll(
      async () => {
        const { data } = await sb
          .from("activities")
          .select("id")
          .eq("day_id", day.id);
        return data?.length;
      },
      { timeout: 15000 },
    )
    .toBe(2);
  const { data: after } = await sb
    .from("activities")
    .select("*")
    .eq("day_id", day.id)
    .order("position");
  const kept = after!.find((a) => a.title === keep.title)!;
  expect(kept).toBeTruthy();
  expect(kept.lat).toBeCloseTo(35.0001);
  expect(kept.lng).toBeCloseTo(139.0001);
  expect(kept.note).toBe("E2E keep note");
  expect(kept.confirmed).toBe(true);
  expect(kept.geocode).toBe(keep.geocode);
  expect(kept.time).toBe("09:00");
  const added = after!.find((a) => a.title === "E2E Inserted Cafe")!;
  expect(added.confirmed).toBe(false);
  // Old rows were replaced, not left behind.
  expect(after!.some((a) => snapshot.some((s) => s.id === a.id))).toBe(false);

  // The undo snapshot carries the coordinates, so undo restores them.
  const { data: logRows } = await sb
    .from("activity_log")
    .select("undo_payload")
    .eq("trip_id", tripId)
    .eq("action", "update_day")
    .order("created_at", { ascending: false })
    .limit(1);
  const undoActs = logRows?.[0]?.undo_payload?.activities || [];
  const undoKeep = undoActs.find((a: { id: string }) => a.id === keep.id);
  expect(undoKeep?.lat).toBeCloseTo(35.0001);
});

test("v3 activity_ops apply atomically and log an undo snapshot", async ({
  page,
}) => {
  test.skip(!tripId || snapshot.length < 2, "QA trip day 1 not usable");
  test.setTimeout(120000);
  const { data: cur } = await sb
    .from("activities")
    .select("*")
    .eq("day_id", day.id)
    .order("position");
  const first = cur![0];
  const bodies = await mockChat(page, [
    {
      type: "final",
      data: {
        message: `Added a coffee stop (${RUN}).`,
        actions: [
          {
            type: "activity_ops",
            dropped: 1,
            ops: [
              { op: "set_time", activity_id: first.id, time: "07:45" },
              {
                op: "insert",
                day_id: day.id,
                after_id: first.id,
                activity: {
                  time: "08:30",
                  title: "E2E Ops Cafe",
                  geocode: "Shibuya, Tokyo",
                  geocode_end: "",
                  type: "food",
                  duration: "30m",
                  note: "",
                  icon: "☕",
                },
              },
            ],
          },
        ],
      },
    },
  ]);
  const ask = await openTripChat(page, tripId);
  const t0 = new Date().toISOString();
  await ask.fill("e2e: add a coffee stop");
  await ask.press("Enter");
  // dropped:1 → this run's bubble says part of it couldn't be applied (the
  // note is only added once the ops were applied).
  await expect(
    page.getByText(`Added a coffee stop (${RUN}).`).last(),
  ).toContainText("Part of that couldn't be applied", { timeout: 15000 });
  expect(bodies[0]?.protocol).toBe(2);
  // Slim context: only the fields the chat function reads, not the full
  // trip / activity rows (those were 47-94 KB a message).
  const body = bodies[0] as {
    trip: Record<string, unknown>;
    days: Array<{ activities: Array<Record<string, unknown>> }>;
  };
  expect(JSON.stringify(body).length).toBeLessThan(30000);
  expect(body.trip.ig_response).toBeUndefined();
  expect(body.trip.magazine_digest).toBeUndefined();
  expect(Object.keys(body.days[0].activities[0]).sort()).toEqual(
    expect.arrayContaining(["id", "position", "title"]),
  );
  expect(body.days[0].activities[0].photo_url).toBeUndefined();
  const { data: after } = await sb
    .from("activities")
    .select("*")
    .eq("day_id", day.id)
    .order("position");
  expect(after!.length).toBe(cur!.length + 1);
  expect(after![0].id).toBe(first.id);
  expect(after![0].time).toBe("07:45");
  expect(after![0].lat).toBe(first.lat);
  expect(after![1].title).toBe("E2E Ops Cafe");
  const { data: logRows } = await sb
    .from("activity_log")
    .select("summary, undo_payload")
    .eq("trip_id", tripId)
    .eq("action", "update_day")
    .gte("created_at", t0);
  expect(logRows!.length).toBe(1);
  expect(logRows![0].summary).toMatch(/^Trippy edited /);
  expect(logRows![0].undo_payload.activities.length).toBe(cur!.length);
  expect("wishlist" in logRows![0].undo_payload).toBe(false);
});

test("a failed activity_ops batch changes nothing and says so", async ({
  page,
}) => {
  test.skip(!tripId, "QA trip not found");
  test.setTimeout(120000);
  const { data: before } = await sb
    .from("activities")
    .select("id, time")
    .eq("day_id", day.id)
    .order("position");
  await mockChat(page, [
    {
      type: "final",
      data: {
        message: `Moved things around (${RUN}).`,
        actions: [
          {
            type: "activity_ops",
            dropped: 0,
            ops: [
              { op: "set_time", activity_id: before![0].id, time: "06:00" },
              { op: "remove", activity_id: crypto.randomUUID() },
            ],
          },
        ],
      },
    },
  ]);
  const ask = await openTripChat(page, tripId);
  await ask.fill("e2e: move things");
  await ask.press("Enter");
  await expect(
    page.getByText(`Moved things around (${RUN}).`).last(),
  ).toContainText("I couldn't apply that change, so nothing was changed", {
    timeout: 15000,
  });
  const { data: after } = await sb
    .from("activities")
    .select("id, time")
    .eq("day_id", day.id)
    .order("position");
  expect(after).toEqual(before);
});

test("places Trippy adds are verified; an unfindable one is flagged", async ({
  page,
}) => {
  test.skip(!tripId, "QA trip not found");
  test.setTimeout(120000);
  const { data: cur } = await sb
    .from("activities")
    .select("id")
    .eq("day_id", day.id)
    .order("position");
  const anchorId = cur![cur!.length - 1].id;
  const real = `E2E Real Teahouse ${RUN}`;
  const fake = `E2E Imaginary Cafe ${RUN}`;
  // verify-place: the real place resolves, the fake one is a conclusive miss.
  await page.route(
    "**/functions/v1/places-proxy?action=verify-place*",
    async (route) => {
      const name = route.request().postDataJSON()?.name || "";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          name === real
            ? {
                lat: 35.7101,
                lng: 139.8107,
                source: "google",
                confidence: "high",
              }
            : { reason: "not_found", conclusive: true },
        ),
      });
    },
  );
  const act = (title: string, time: string) => ({
    time,
    title,
    geocode: title,
    geocode_end: "",
    type: "food",
    duration: "45m",
    note: "",
    icon: "🍵",
  });
  const bodies = await mockChat(page, [
    {
      type: "final",
      data: {
        message: `Added two stops (${RUN}).`,
        actions: [
          {
            type: "activity_ops",
            dropped: 0,
            ops: [
              {
                op: "insert",
                day_id: day.id,
                after_id: anchorId,
                activity: act(real, "20:00"),
              },
              {
                op: "insert",
                day_id: day.id,
                after_id: anchorId,
                activity: act(fake, "21:00"),
              },
            ],
          },
        ],
      },
    },
  ]);
  const ask = await openTripChat(page, tripId);
  await ask.fill("e2e: add two stops");
  await ask.press("Enter");
  await expect(page.getByText(`Added two stops (${RUN}).`).last()).toBeVisible({
    timeout: 15000,
  });
  // The unfindable place gets a Trippy note with a one-tap follow-up.
  const note = page.getByText(`couldn't find “${fake}” on the map`);
  await expect(note).toBeVisible({ timeout: 15000 });
  await expect
    .poll(
      async () =>
        (
          await sb
            .from("activities")
            .select("lat, geocode_source")
            .eq("day_id", day.id)
            .eq("title", real)
            .single()
        ).data?.lat,
      { timeout: 15000 },
    )
    .toBeCloseTo(35.7101);
  await page
    .getByRole("button", { name: "Suggest alternatives" })
    .last()
    .click();
  await expect.poll(() => bodies.length, { timeout: 15000 }).toBe(2);
  expect(String(bodies[1].message)).toContain(`alternatives to "${fake}"`);
});

test("unusable reply changes nothing and isn't saved", async ({ page }) => {
  test.skip(!tripId, "QA trip not found");
  test.setTimeout(120000);
  const { data: before } = await sb
    .from("activities")
    .select("id")
    .eq("day_id", day.id);
  const errText =
    "That change was too big to apply in one go, so nothing was changed.";
  await mockChat(page, [
    { type: "delta", text: "Rewriting every day now" },
    { type: "error", error: "max_tokens", message: errText },
  ]);
  const ask = await openTripChat(page, tripId);
  const t0 = new Date().toISOString();
  await ask.fill("e2e: rewrite everything");
  await ask.press("Enter");
  await expect(page.getByText(errText).last()).toBeVisible({
    timeout: 15000,
  });
  await page.waitForTimeout(1500);
  const { data: afterActs } = await sb
    .from("activities")
    .select("id")
    .eq("day_id", day.id);
  expect(afterActs!.map((a) => a.id).sort()).toEqual(
    before!.map((a) => a.id).sort(),
  );
  const { data: saved } = await sb
    .from("trip_messages")
    .select("role, content")
    .eq("trip_id", tripId)
    .gte("created_at", t0);
  expect(saved!.some((m) => m.role === "assistant")).toBe(false);
  expect(saved!.some((m) => m.content === "e2e: rewrite everything")).toBe(
    true,
  );
});

test("starter chip sends on tap", async ({ page }) => {
  test.skip(!tripId, "QA trip not found");
  test.setTimeout(120000);
  const bodies = await mockChat(page, [
    { type: "final", data: { message: "E2E chip reply." } },
  ]);
  // Starter chips only show on an empty conversation; hide the trip's saved
  // history for this page load.
  await page.route("**/rest/v1/trip_messages*", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "[]",
        })
      : route.continue(),
  );
  await openTripChat(page, tripId);
  const chip = page.locator("button", { hasText: /must-do in/i }).first();
  const visible = await chip.isVisible({ timeout: 8000 }).catch(() => false);
  expect(visible).toBe(true);
  const chipText = ((await chip.textContent()) || "").trim();
  await chip.click();
  await expect(page.getByText("E2E chip reply.").last()).toBeVisible({
    timeout: 15000,
  });
  expect(bodies[0]?.message).toBe(chipText);
});
