import { test, expect, Page, BrowserContext } from "@playwright/test";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { login } from "./helpers";

// Phase-2 collaboration: shared, multi-user Trippy chat.
//
// This exercises the deterministic, LLM-free core of Steps 2–4 end-to-end in
// two real browsers: the addressing UI renders on a shared trip, and a free
// `everyone` (human) message posted by one member appears LIVE in the other
// member's chat via the realtime channel — no reload, no LLM, no credits.
//
// (The Trippy-directed clobber path is LLM-driven and non-deterministic, so it
// is validated by code review + the API test scripts/phase2-shared-chat-test.mjs,
// not here.)
//
// Gated on VITE_INVITE_ENABLED=true (shared-trip UI) AND VITE_REALTIME_ENABLED=
// true (live sync), plus the collab RPCs being live on the target DB. Skips
// cleanly otherwise. Reuses the qa-tester built trip "Tokyo to Kyoto Classic";
// no RG/IG is ever triggered.

const TRIP_NAME = "Tokyo to Kyoto Classic";
const OWNER_EMAIL = "qa-tester";
const OWNER_PASSWORD = "qaTest123!";
const SECOND_USER = "collab-e2e-b";
const SECOND_EMAIL = `${SECOND_USER}@tripjam.app`;
const SECOND_PASSWORD = "qaTest123!";

// The Playwright test process doesn't load .env (only the Vite webServer does),
// so parse it directly to learn what the running app actually sees.
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

// Wait until a member is inside the trip view with the chat composer rendered.
// On desktop (Playwright's default 1280px viewport ≥ 1024) the chat panel is
// always mounted, so the 2000-char-capped composer textarea is the anchor.
async function openTripChat(page: Page, tripId: string): Promise<boolean> {
  await page.goto(`/trip/${tripId}`);
  const composer = page.locator('textarea[maxlength="2000"]');
  return composer
    .first()
    .waitFor({ state: "visible", timeout: 20000 })
    .then(() => true)
    .catch(() => false);
}

test.describe("Collaboration — shared Trippy chat (Phase 2)", () => {
  test.skip(
    !INVITE_ENABLED || !REALTIME_ENABLED,
    "requires VITE_INVITE_ENABLED=true + VITE_REALTIME_ENABLED=true + collab RPCs on the target DB",
  );
  test.setTimeout(150000);

  test("a free 'everyone' message syncs live between two members", async ({
    browser,
  }) => {
    // ---- Setup (Node clients): B becomes a member so the trip is shared ----
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
    // Idempotent: accept the invite (no-op / harmless error if already a member).
    await bClient.rpc("accept_invite", { p_token: token });
    const { data: preview } = await owner.rpc("get_invite_preview", {
      p_token: token,
    });
    const memberCount = (preview as { member_count?: number })?.member_count;
    if (!memberCount || memberCount < 2) {
      test.skip(true, `trip is not shared (member_count=${memberCount})`);
      return;
    }

    // ---- Two browsers, both members, both inside the same trip's chat ----
    const ctxA: BrowserContext = await browser.newContext();
    const ctxB: BrowserContext = await browser.newContext();
    const a: Page = await ctxA.newPage();
    const b: Page = await ctxB.newPage();
    // Track A's realtime channel status from its console. A remounts during
    // login+goto (CLOSED → SUBSCRIBED), and postgres_changes never replays, so
    // we must not let B post until A's subscription is STABLY attached — else A
    // legitimately misses the event (a test artifact; real users navigate once).
    let aStatus = "";
    let aStatusAt = 0;
    a.on("console", (m) => {
      const mm = m.text().match(/channel trip:\S+ → (\w+)/);
      if (mm) {
        aStatus = mm[1];
        aStatusAt = Date.now();
      }
    });
    const waitForStableSubscribed = async () => {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        if (aStatus === "SUBSCRIBED" && Date.now() - aStatusAt > 2000)
          return true;
        await a.waitForTimeout(500);
      }
      return false;
    };

    try {
      await login(a, OWNER_EMAIL);
      await login(b, SECOND_USER);

      const aIn = await openTripChat(a, tripId);
      const bIn = await openTripChat(b, tripId);
      expect(aIn, "owner reached the trip chat").toBe(true);
      expect(bIn, "second member reached the trip chat").toBe(true);

      // Gate on A being stably subscribed before B posts.
      const aSubscribed = await waitForStableSubscribed();
      expect(aSubscribed, "owner's realtime channel reached SUBSCRIBED").toBe(
        true,
      );

      // ---- Step 4: the addressing UI renders on a shared trip (B) ----
      const audienceBtn = b.getByRole("button", { name: /^To: / });
      await expect(audienceBtn).toBeVisible({ timeout: 10000 });
      await audienceBtn.click();
      await expect(b.getByText("👥 Everyone")).toBeVisible();
      await expect(b.getByText(/addressing isn't private/i)).toBeVisible();

      // Select "Everyone" → a free human message (no LLM, no credits).
      await b.getByText("👥 Everyone").click();

      // ---- Post a unique message from B ----
      const marker = `e2e-realtime-${Date.now()}`;
      const composerB = b.locator('textarea[maxlength="2000"]').first();
      await composerB.click();
      await composerB.fill(marker);
      await composerB.press("Enter");

      // B sees their own message immediately (optimistic append).
      await expect(b.getByText(marker)).toBeVisible({ timeout: 10000 });

      // The optimistic bubble alone doesn't prove a DB write (the insert is
      // fire-and-forget) — assert the row actually persisted. This guards the
      // supabase-js v2 gotcha where a bare .insert() silently never sends.
      await b.waitForTimeout(2000);
      const { data: dbRows } = await owner
        .from("trip_messages")
        .select("id, content, audience")
        .eq("trip_id", tripId)
        .eq("content", marker);
      expect(dbRows, "human message persisted to trip_messages").toHaveLength(
        1,
      );

      // ---- Step 3: A receives it LIVE via realtime (no reload) ----
      await expect(a.getByText(marker)).toBeVisible({ timeout: 25000 });
    } finally {
      // ---- Cleanup: B leaves so the trip returns to solo for the next run ----
      await bClient.rpc("leave_trip", { p_trip: tripId });
      await ctxA.close();
      await ctxB.close();
    }
  });
});
