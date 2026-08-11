import { test, expect, Page, BrowserContext } from "@playwright/test";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { login, dismissTripOverlays } from "./helpers";

// Phase-6 collaboration: polls / group decisions.
//
// Two real browsers, both members of a shared trip. Exercises the live,
// realtime-driven path end-to-end: the owner creates a freeform poll from the
// ＋Poll compose sheet, the second member sees it appear LIVE in their Decisions
// view (poll INSERT → polls channel), votes, and the owner sees the tally update
// LIVE (poll_votes write → polls.updated_at trigger → polls channel → reconcile).
// Then the owner closes it and the card resolves.
//
// Freeform on purpose: closing a freeform poll just records the winner (no LLM,
// no pool spend) — the day-poll auto-apply path is covered by the API test
// scripts (Trippy's day regeneration is LLM-driven / non-deterministic).
//
// Gated on VITE_INVITE_ENABLED=true (shared-trip UI) AND VITE_REALTIME_ENABLED=
// true (live sync) + the collab RPCs + Phase-6 migration on the target DB. Skips
// cleanly otherwise. Reuses the qa-tester built trip; never triggers RG/IG.

const TRIP_NAME = "Tokyo to Kyoto Classic";
const OWNER_EMAIL = "qa-tester";
const OWNER_PASSWORD = "qaTest123!";
const SECOND_USER = "collab-e2e-b";
const SECOND_EMAIL = `${SECOND_USER}@tripjam.app`;
const SECOND_PASSWORD = "qaTest123!";

// The Playwright process doesn't load .env (only the Vite webServer does), so
// parse it directly to learn what the running app actually sees.
function readEnv(): {
  url: string;
  anon: string;
  inviteEnabled: boolean;
  realtimeEnabled: boolean;
} {
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = join(here, "..", ".env");
  let url = process.env.VITE_SUPABASE_URL || "";
  let anon = process.env.VITE_SUPABASE_ANON_KEY || "";
  let invite = process.env.VITE_INVITE_ENABLED || "";
  let realtime = process.env.VITE_REALTIME_ENABLED || "";
  try {
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const [, k, vRaw] = m;
      const v = vRaw.replace(/^["']|["']$/g, "");
      if (k === "VITE_SUPABASE_URL" && !url) url = v;
      if (k === "VITE_SUPABASE_ANON_KEY" && !anon) anon = v;
      if (k === "VITE_INVITE_ENABLED" && !invite) invite = v;
      if (k === "VITE_REALTIME_ENABLED" && !realtime) realtime = v;
    }
  } catch {
    /* fall back to process.env */
  }
  return {
    url,
    anon,
    inviteEnabled: invite === "true",
    realtimeEnabled: realtime === "true",
  };
}

const { inviteEnabled: INVITE_ENABLED, realtimeEnabled: REALTIME_ENABLED } =
  readEnv();

async function signedClient(
  emailOrUsername: string,
  password: string,
): Promise<SupabaseClient | null> {
  const { url, anon } = readEnv();
  if (!url || !anon) return null;
  const sb = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = emailOrUsername.includes("@")
    ? emailOrUsername
    : `${emailOrUsername}@tripjam.app`;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return null;
  return sb;
}

// Close the one-time Phase-5 "Your travel style" nudge if present. The sheet is
// a bottom overlay (flex-end) with a full-inset dimmed backdrop; clicking the
// backdrop above the sheet closes it (onClose fires only when target===backdrop).
async function dismissPrefsNudge(page: Page) {
  const nudge = page.getByText("Your travel style");
  if (await nudge.isVisible({ timeout: 4000 }).catch(() => false)) {
    await page.mouse.click(640, 40);
    await nudge.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  }
}

// Open the trip and navigate to Board → Decisions. Returns true once the
// Decisions view (its ＋Poll button) is visible.
async function openDecisions(page: Page, tripId: string): Promise<boolean> {
  await page.goto(`/trip/${tripId}`);
  // Chat composer is the reliable "trip view is mounted" anchor (desktop).
  const composer = page.locator('textarea[maxlength="2000"]').first();
  const mounted = await composer
    .waitFor({ state: "visible", timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  if (!mounted) return false;
  // A fresh member with no saved style gets the one-time Phase-5 "Your travel
  // style" nudge on first open of a shared trip; its backdrop blocks clicks.
  // Dismiss it by clicking the dimmed backdrop above the bottom sheet.
  await dismissPrefsNudge(page);
  // The while-away sheet lands late (async activity fetch) and intercepts the
  // Board/Decisions clicks — settle it out BEFORE navigating.
  await dismissTripOverlays(page, 5000);
  // Board tab → Decisions card → Decisions view. The bottom-nav "Board" also
  // exists in the DOM (hidden on desktop), so target the *visible* tab button.
  await page.locator("button:has-text('Board'):visible").first().click();
  await page.waitForTimeout(500);
  const card = page.getByText("Decisions", { exact: true }).first();
  const hasCard = await card
    .waitFor({ state: "visible", timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  if (!hasCard) return false;
  await card.click();
  await page.waitForTimeout(1000);
  await dismissTripOverlays(page);
  return page
    .getByRole("button", { name: /Poll/ })
    .first()
    .waitFor({ state: "visible", timeout: 8000 })
    .then(() => true)
    .catch(() => false);
}

// Track a page's realtime channel status from its console (App logs
// "channel trip:… → STATUS" in DEV). postgres_changes never replays, so a
// subscriber must be STABLY attached before the other side writes.
function trackChannel(page: Page) {
  const s = { status: "", at: 0 };
  page.on("console", (m) => {
    const mm = m.text().match(/channel trip:\S+ → (\w+)/);
    if (mm) {
      s.status = mm[1];
      s.at = Date.now();
    }
  });
  return async function waitStable() {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (s.status === "SUBSCRIBED" && Date.now() - s.at > 2000) return true;
      await page.waitForTimeout(500);
    }
    return false;
  };
}

test.describe("Collaboration — polls / group decisions (Phase 6)", () => {
  test.skip(
    !INVITE_ENABLED || !REALTIME_ENABLED,
    "requires VITE_INVITE_ENABLED=true + VITE_REALTIME_ENABLED=true + collab RPCs + Phase-6 migration on the target DB",
  );
  test.setTimeout(180000);

  test("a poll and its live tally sync between two members", async ({
    browser,
  }) => {
    const owner = await signedClient(OWNER_EMAIL, OWNER_PASSWORD);
    if (!owner) {
      test.skip(true, "could not sign in owner (qa-tester) via Supabase");
      return;
    }
    const { data: trips, error: tripErr } = await owner
      .from("trips")
      .select("id, name")
      .ilike("name", `${TRIP_NAME}%`)
      .limit(1);
    if (tripErr || !trips || !trips[0]) {
      test.skip(
        true,
        `owner trip "${TRIP_NAME}" not found: ${tripErr?.message}`,
      );
      return;
    }
    const tripId = trips[0].id as string;

    const { data: token, error: mintErr } = await owner.rpc(
      "create_or_get_invite_link",
      { p_trip: tripId },
    );
    if (mintErr || !token) {
      test.skip(true, `create_or_get_invite_link failed: ${mintErr?.message}`);
      return;
    }
    const bClient = await signedClient(SECOND_EMAIL, SECOND_PASSWORD);
    if (!bClient) {
      test.skip(true, "could not sign in second user via Supabase");
      return;
    }
    await bClient.rpc("accept_invite", { p_token: token });
    const { data: preview } = await owner.rpc("get_invite_preview", {
      p_token: token,
    });
    const memberCount = (preview as { member_count?: number })?.member_count;
    if (!memberCount || memberCount < 2) {
      test.skip(true, `trip is not shared (member_count=${memberCount})`);
      return;
    }

    // Pre-seed a travel style for both members so the one-time Phase-5 nudge
    // (which opens a blocking sheet on first shared-trip open when you have no
    // style) never fires — keeps this test focused on polls, deterministically.
    const ownerId = (await owner.auth.getUser()).data.user?.id;
    const bId = (await bClient.auth.getUser()).data.user?.id;
    await owner
      .from("trip_preferences")
      .upsert(
        { trip_id: tripId, user_id: ownerId, prefs_text: "e2e" },
        { onConflict: "trip_id,user_id" },
      );
    await bClient
      .from("trip_preferences")
      .upsert(
        { trip_id: tripId, user_id: bId, prefs_text: "e2e" },
        { onConflict: "trip_id,user_id" },
      );

    const ctxA: BrowserContext = await browser.newContext();
    const ctxB: BrowserContext = await browser.newContext();
    const a: Page = await ctxA.newPage();
    const b: Page = await ctxB.newPage();
    const waitA = trackChannel(a);
    const waitB = trackChannel(b);

    const marker = `e2e-poll-${Date.now()}`;
    const question = `Which first? (${marker})`;
    const optA = `Option-A ${marker}`;
    const optB = `Option-B ${marker}`;

    try {
      await login(a, OWNER_EMAIL);
      await login(b, SECOND_USER);

      const aIn = await openDecisions(a, tripId);
      const bIn = await openDecisions(b, tripId);
      expect(aIn, "owner reached Decisions").toBe(true);
      expect(bIn, "second member reached Decisions").toBe(true);

      // Both must be stably subscribed before either writes (no replay).
      expect(await waitA(), "owner channel SUBSCRIBED").toBe(true);
      expect(await waitB(), "member channel SUBSCRIBED").toBe(true);

      // ---- Owner opens the compose sheet and creates a freeform poll ----
      await a.getByRole("button", { name: /Poll/ }).first().click();
      await expect(a.getByText("New poll")).toBeVisible({ timeout: 8000 });
      await a.getByPlaceholder("What should the group decide?").fill(question);
      await a.getByPlaceholder("Option 1").fill(optA);
      await a.getByPlaceholder("Option 2").fill(optB);
      await a.getByRole("button", { name: /Create poll/ }).click();

      // Owner sees their own poll (optimistic refetch). The question renders in
      // both the PollCard and the OpenPollPin, so match the first.
      await expect(a.getByText(question).first()).toBeVisible({
        timeout: 10000,
      });

      // ---- Member sees the poll appear LIVE (poll INSERT → realtime) ----
      await expect(b.getByText(question).first()).toBeVisible({
        timeout: 25000,
      });

      // ---- Member votes; the row persists, and the owner's tally updates LIVE
      await b.getByText(optA).click();
      await b.waitForTimeout(2000);
      const { data: polls } = await owner
        .from("polls")
        .select("id")
        .eq("trip_id", tripId)
        .eq("question", question);
      const pollId = polls?.[0]?.id as string;
      expect(pollId, "poll persisted to DB").toBeTruthy();
      const { data: votes } = await owner
        .from("poll_votes")
        .select("option_id")
        .eq("poll_id", pollId);
      expect(votes, "member vote persisted").toHaveLength(1);

      // Owner's card shows the live tally (the freshly-open poll is the only one
      // showing "N voted"; resolved history shows "Closed").
      await expect(a.getByText(/1 voted/)).toBeVisible({ timeout: 25000 });

      // ---- Owner closes the poll → it resolves to the voted option ----
      await a
        .getByRole("button", { name: /Close & apply/ })
        .first()
        .click();
      // Winner label shows in the resolved header ("✓ Option-A …").
      await expect(a.getByText(new RegExp(`✓ ${optA}`))).toBeVisible({
        timeout: 15000,
      });
      const { data: closed } = await owner
        .from("polls")
        .select("status, resolved_option_id")
        .eq("id", pollId)
        .single();
      expect(closed?.status).toBe("resolved");
    } finally {
      // Return the trip to solo for the next run. (polls has no member DELETE
      // policy by design; the resolved poll stays in history — harmless, and
      // each run uses a unique marker so locators never collide.)
      await bClient.rpc("leave_trip", { p_trip: tripId });
      await ctxA.close();
      await ctxB.close();
    }
  });
});
