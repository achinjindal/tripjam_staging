import { test, expect, Page } from "@playwright/test";
import { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { login, dismissTripOverlays } from "./helpers";
import { qaClient } from "./seedTrip";

// Prod report 2026-10-28 (mobile web, brand-new trip): the pre-trip Route
// screen sat forever on "Loading your plans…" with no title, no Invite and no
// Edit details. IG completes IN PLACE (the user stays on the pre-trip screen)
// and used to null editingTrip + pendingForm there, so:
//   - the Route tab lost its title / Invite / Edit details,
//   - any remount of the Route view had no trip id to load routes from and
//     no destinations to generate from — an endless loader,
//   - ← then "Start Planning" inserted a SECOND trip and re-ran RG.
// IG completion now keeps the context pointed at the saved trip, and the
// Route view has a recoverable state for a failed/hung saved-routes load.
//
// Zero LLM spend: routes are seeded, generate-itinerary answers with a canned
// stream, and generate-brainstorm is stubbed (and counted — it must not run).

const DEST = "Ziro Valley";

async function seedDraft(sb: SupabaseClient, name: string) {
  const uid = (await sb.auth.getUser()).data.user!.id;
  const id = randomUUID();
  const start = new Date();
  start.setDate(start.getDate() + 40);
  const end = new Date(start);
  end.setDate(start.getDate() + 2);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const { error } = await sb.from("trips").insert({
    id,
    name,
    destination: DEST,
    start_date: iso(start),
    end_date: iso(end),
    created_by: uid,
    owner_id: uid,
    ig_request: {
      destinations: [DEST],
      travelers: "2",
      styles: [],
      startDate: iso(start),
      endDate: iso(end),
    },
    // no ig_response → a draft: opens on the pre-trip Route screen
  });
  if (error) throw new Error(`seed trip: ${error.message}`);
  await sb
    .from("trip_members")
    .insert({ trip_id: id, user_id: uid, role: "edit" });
  const { error: routeErr } = await sb.from("brainstorm_items").insert(
    ["Ziro Festival Loop", "Ziro Slow Valley"].map((title, i) => ({
      trip_id: id,
      title,
      city: "Ziro Town, Hapoli",
      category: "Route",
      note: "seed",
      position: i,
      tier: 1,
      data: {
        tagline: "seed",
        days: [
          "**Ziro Town** — arrive",
          "**Hapoli** — market day",
          "**Ziro Town** — depart",
        ],
        points: [],
        stops: [
          { city: "Ziro Town", nights: 1 },
          { city: "Hapoli", nights: 1 },
        ],
      },
    })),
  );
  if (routeErr) throw new Error(`seed routes: ${routeErr.message}`);
  return id;
}

// generate-itinerary streams the itinerary JSON as SSE string chunks.
function cannedItinerary() {
  const itinerary = {
    name: "Ziro Canned",
    summary: "Canned fixture",
    cities: ["Ziro Town", "Hapoli"],
    days: ["Ziro Town", "Hapoli", "Ziro Town"].map((city, i) => ({
      label: `Day ${i + 1}`,
      city,
      description: `${city} day`,
      activities: [0, 1].map((k) => ({
        time: ["10:00", "15:00"][k],
        title: `Canned spot ${i + 1}.${k + 1}`,
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
  const calls = { rg: 0 };
  await page.route("**/functions/v1/generate-brainstorm", (route) => {
    calls.rg++;
    return route.fulfill({ status: 500, body: "{}" });
  });
  await page.route("**/functions/v1/extract-preferences", (route) =>
    route.fulfill({ status: 500, body: "{}" }),
  );
  await page.route("**/functions/v1/generate-itinerary", (route) =>
    route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
      body: cannedItinerary(),
    }),
  );
  return calls;
}

const routeHeader = (page: Page) =>
  page.getByText("Pick a route, then build your itinerary");

test.describe("Route screen keeps its trip context after IG", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  let sb: SupabaseClient | null = null;
  const trips: string[] = [];

  test.beforeAll(async () => {
    sb = await qaClient().catch(() => null);
  });

  test.afterAll(async () => {
    for (const id of trips) await sb?.rpc("delete_trip", { p_trip: id });
  });

  test("post-IG Route tab keeps title + pills; Start Planning reuses the trip", async ({
    page,
  }) => {
    test.setTimeout(150000);
    test.skip(!sb, "auth failed");
    const testStart = new Date(Date.now() - 5000).toISOString();
    const tripId = await seedDraft(sb!, "Routes Context After IG");
    trips.push(tripId);

    await login(page);
    const calls = await stubLlm(page);
    const tripInserts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && /\/rest\/v1\/trips(\?|$)/.test(r.url()))
        tripInserts.push(r.url());
    });

    await page.goto(`/trip/${tripId}`);
    await dismissTripOverlays(page, 1500);
    await expect(routeHeader(page)).toBeVisible({ timeout: 15000 });

    // Select a route → Build → Generate (canned IG)
    await page
      .locator("button", { hasText: /^Select$/ })
      .first()
      .click();
    await page
      .locator("button", { hasText: /Build My Itinerary/ })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Generate Itinerary →" })
      .click({ timeout: 15000 });
    await expect(page.getByText(/Your itinerary is ready/).first()).toBeVisible(
      { timeout: 60000 },
    );

    // The user stayed on the pre-trip screen. Route tab: title + pills intact.
    await page
      .locator("button", { hasText: /Route$/ })
      .last()
      .click();
    await expect(routeHeader(page)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(DEST).first()).toBeVisible();
    await expect(
      page.locator("button", { hasText: /Edit details/ }).first(),
    ).toBeVisible();
    await expect(
      page.locator("button", { hasText: /Invite/ }).first(),
    ).toBeVisible();
    await expect(page.getByText("Loading your plans…")).toHaveCount(0);

    // ← to setup, then Start Planning with nothing changed: back to the SAME
    // trip's routes — no second trip row, no RG run.
    await page.locator("button", { hasText: /^←$/ }).first().click();
    // The setup form reopens prefilled; step through to its final screen.
    const startPlanning = page.locator("button", { hasText: "Start Planning" });
    for (let i = 0; i < 3; i++) {
      if (await startPlanning.isVisible({ timeout: 1500 }).catch(() => false))
        break;
      await page
        .locator("button", { hasText: /^Continue/ })
        .first()
        .click();
    }
    await startPlanning.click({ timeout: 10000 });
    await expect(routeHeader(page)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Ziro Festival Loop").first()).toBeVisible();
    await page.waitForTimeout(2000); // a stray insert/RG would land by now
    expect(tripInserts).toEqual([]);
    expect(calls.rg).toBe(0);
    // And in the DB: the seeded trip is the only one created in this test.
    const { data: created } = await sb!
      .from("trips")
      .select("id")
      .eq("destination", DEST)
      .gte("created_at", testStart);
    expect((created || []).map((t) => t.id)).toEqual([tripId]);

    // A second Build targets the same trip: the replace-itinerary
    // confirmation shows instead of a silent fresh build.
    await page
      .locator("button", { hasText: /Build My Itinerary/ })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Generate Itinerary →" })
      .click({ timeout: 15000 });
    await expect(
      page.getByText(/^(Refresh|Regenerate) itinerary\?$/),
    ).toBeVisible({
      timeout: 8000,
    });
  });

  test("a failed saved-routes load shows Try again, not an endless loader", async ({
    page,
  }) => {
    test.setTimeout(90000);
    test.skip(!sb, "auth failed");
    const tripId = await seedDraft(sb!, "Routes Load Failure");
    trips.push(tripId);

    await login(page);
    await stubLlm(page);
    let failLoads = true;
    await page.route("**/rest/v1/brainstorm_items*", (route) =>
      failLoads && route.request().method() === "GET"
        ? route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ message: "simulated outage" }),
          })
        : route.fallback(),
    );

    await page.goto(`/trip/${tripId}`);
    await dismissTripOverlays(page, 1500);
    const unavailable = page.getByTestId("routes-unavailable");
    await expect(unavailable).toBeVisible({ timeout: 15000 });
    await expect(
      unavailable.getByText("We couldn't load your plans"),
    ).toBeVisible();
    await expect(page.getByText("Loading your plans…")).toHaveCount(0);

    failLoads = false;
    await unavailable.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("Ziro Festival Loop").first()).toBeVisible({
      timeout: 10000,
    });
    await expect(unavailable).toHaveCount(0);
  });
});
