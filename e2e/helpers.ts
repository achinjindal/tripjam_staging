import { Page, expect } from "@playwright/test";

const TEST_PASSWORD = "qaTest123!";

/** Login with username — signs up first if account doesn't exist.
 *
 *  Post auth-redesign (2026-05-28):
 *  - /signin and /signup are separate single-purpose screens (no in-card toggle).
 *  - Sign-in field [0] = "Email or username", [1] = password. Submit = "Log in".
 *  - Sign-up field [0] = email only (username auto-derived from email local part),
 *    [1] = password. No emoji picker, no terms checkbox (terms baked into button
 *    copy). Submit = "Create account".
 *  - To switch between screens, click the bottom link ("Sign up" / "Log in")
 *    OR navigate directly to /signup.
 */
export async function login(page: Page, username = "qa-tester") {
  await page.goto("/signin");
  await page.waitForSelector("text=/TripJam|Welcome back/i", {
    timeout: 10000,
  });
  await page.waitForTimeout(300);

  // Sign-in: [0]=email-or-username, [1]=password
  const inputs = page.locator("input");
  await inputs.nth(0).fill(username);
  await inputs.nth(1).fill(TEST_PASSWORD);

  // Submit. "Log in" (current) or "Sign In" (legacy fallback if pre-redesign
  // build is loaded in cache during rollout).
  const submitBtn = page
    .locator("button", { hasText: /^(Log in|Sign In)$/i })
    .last();
  await submitBtn.click();
  await page.waitForTimeout(3000);

  // Check if we landed on home (Auth.jsx doesn't redirect post-sign-in,
  // so the URL stays at /signin even though the Home screen renders).
  const home = page.locator("text=/Your Trips|No trips yet/i").first();
  if (await home.isVisible({ timeout: 2000 }).catch(() => false)) {
    await page.goto("/");
    await page.waitForTimeout(300);
    await dismissBanners(page);
    return;
  }

  // Sign-in failed — go to /signup to create the account
  await page.goto("/signup");
  await page.waitForSelector("text=/Create your account|TripJam/i", {
    timeout: 10000,
  });
  await page.waitForTimeout(300);

  // Sign-up: [0]=email, [1]=password. Username is auto-derived from email
  // local part by the new client + DB trigger.
  const inputs2 = page.locator("input");
  await inputs2.nth(0).fill(`${username}@tripjam.app`);
  await inputs2.nth(1).fill(TEST_PASSWORD);

  // Submit. "Create account" (current) or "Create Account" / "Sign Up"
  // (legacy fallback).
  const createBtn = page
    .locator("button", {
      hasText: /^(Create account|Create Account|Sign Up)$/i,
    })
    .last();
  await createBtn.click();

  // Wait for home screen
  await page.waitForSelector("text=/Your Trips|No trips yet/i", {
    timeout: 15000,
  });
  await page.goto("/");
  await page.waitForTimeout(300);
  await dismissBanners(page);
}

// Day 5 + Day 3: dismiss the top-of-page sticky banners that would otherwise
// intercept clicks on header buttons during tests (AddRealEmailPrompt for
// legacy synthetic emails, LowCreditsBanner for ≤10 credits).
async function dismissBanners(page: Page) {
  for (const label of ["Dismiss", "✕"]) {
    const btn = page.locator(`button[aria-label="${label}"]`);
    const count = await btn.count();
    for (let i = 0; i < count; i++) {
      const el = btn.nth(i);
      if (await el.isVisible({ timeout: 200 }).catch(() => false)) {
        await el.click({ timeout: 500 }).catch(() => {});
        await page.waitForTimeout(100);
      }
    }
  }
}

/** Take a labeled screenshot */
export async function snap(page: Page, name: string) {
  await page.screenshot({
    path: `e2e/screenshots/${name}.png`,
    fullPage: false,
  });
}

/** Close stacked auto-sheets on trip open (style nudge ✕ → while-away
 *  "Got it" → paywall "Maybe later"). Shared trips can stack all three. */
export async function dismissTripOverlays(page: Page, settleMs = 0) {
  // settleMs > 0: keep watching for LATE-appearing sheets (while-away fires
  // after the async activity fetch) until the window elapses quietly.
  const deadline = Date.now() + settleMs;
  for (let i = 0; i < 15; i++) {
    let closed = false;
    for (const re of [/^✕$/, /^Got it$/, /^Maybe later$/]) {
      const el = page.locator("button, div", { hasText: re }).last();
      if (!(await el.isVisible({ timeout: 500 }).catch(() => false))) continue;
      const ok = await el
        .click({ timeout: 2500 })
        .then(() => true)
        .catch(() => false);
      if (ok) {
        closed = true;
        break;
      }
    }
    if (closed) {
      await page.waitForTimeout(600);
      continue;
    }
    if (Date.now() >= deadline) return;
    await page.waitForTimeout(800);
  }
}

/** Ensure a named trip exists for `client`'s user, creating it if absent.
 *
 *  The collab specs pin a trip by name (`collab-invite`, `collab-chat`), and
 *  that trip used to have to be created BY HAND. When it was missing — which
 *  it was on staging — five invite tests `test.skip`ed and one asserted, so the
 *  suite reported a phantom "members affordance is broken" UI failure while the
 *  real coverage was simply not running (issue #14).
 *
 *  Seeding it here makes the collab suite self-sufficient: the skips become
 *  real Phase 1 coverage, and a failure now means the feature broke rather than
 *  that nobody set the fixture up.
 *
 *  Returns the trip id, or null if the trip could not be created (the caller
 *  should skip rather than assert, so a seeding outage isn't read as a UI bug).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ensureTripByName(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  name: string,
): Promise<string | null> {
  const { data: found } = await client
    .from("trips")
    .select("id")
    .ilike("name", `${name}%`)
    .limit(1);
  if (found && found[0]) return found[0].id as string;

  const { data: who } = await client.auth.getUser();
  const uid = who?.user?.id;
  if (!uid) return null;

  // Trip ids are generated client-side everywhere in this app to avoid RLS
  // round-trips; match that rather than relying on a DB default.
  const id = crypto.randomUUID();
  const { error: tripErr } = await client.from("trips").insert({
    id,
    name,
    destination: "Tokyo → Kyoto",
    start_date: "2027-03-01",
    end_date: "2027-03-05",
    created_by: uid,
    owner_id: uid,
  });
  if (tripErr) return null;

  // Without the membership row the owner fails is_trip_member() and their own
  // trip is invisible to the collab RLS policies.
  const { error: memErr } = await client
    .from("trip_members")
    .insert({ trip_id: id, user_id: uid, role: "edit" });
  if (memErr) return null;

  return id;
}
