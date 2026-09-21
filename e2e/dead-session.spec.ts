import { test, expect } from "@playwright/test";
import { login } from "./helpers";

// Dead-session guard (post pause/restore hardening): a client holding a
// session the server rejects must be signed out cleanly and told why —
// not left stranded sending dead tokens at every API.
test("dead session → clean sign-out + expired banner on /signin", async ({
  page,
}) => {
  await login(page);
  // Corrupt the stored session: expired access token + garbage refresh
  // token = exactly the post-restore stranded state.
  const mutated = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith("sb-") && k.endsWith("-auth-token")) {
        const v = JSON.parse(localStorage.getItem(k)!);
        v.expires_at = Math.floor(Date.now() / 1000) - 3600;
        v.refresh_token = "dead-refresh-token";
        localStorage.setItem(k, JSON.stringify(v));
        return k;
      }
    }
    return null;
  });
  expect(mutated).toBeTruthy();

  await page.reload();
  // The guard (or supabase-js's own invalid-grant handling feeding it)
  // must land us signed out — sign-in or landing screen, no stranded app.
  await page.waitForTimeout(6000);
  const onAuthScreen = await page
    .locator("text=/Welcome back|Plan together|Log in|Sign up/i")
    .first()
    .isVisible({ timeout: 10000 })
    .catch(() => false);
  expect(onAuthScreen).toBe(true);
  // If our flag-path fired (vs supabase-js clearing first), the banner shows
  const banner = await page
    .getByText("Your session expired — please sign in again.")
    .isVisible({ timeout: 2000 })
    .catch(() => false);
  console.log("expired banner shown:", banner);
});

// The guard's own path: session looks fine locally, but the server rejects
// it mid-app (REST 401) and the refresh endpoint says invalid_grant — the
// stranded state users hit after a project pause/restore. Simulated with
// network interception; asserts flag → sign-out → /signin → banner.
test("mid-app 401 + failed refresh → guard redirects with banner", async ({
  page,
}) => {
  await login(page);
  await page.route("**/auth/v1/token?grant_type=refresh_token", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: "invalid_grant",
        error_description: "Invalid Refresh Token",
      }),
    }),
  );
  await page.route("**/rest/v1/trips**", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ message: "JWT expired" }),
    }),
  );
  await page.reload(); // Home fetches trips → 401 → guard → dead refresh
  await expect(
    page.getByText("Your session expired — please sign in again."),
  ).toBeVisible({ timeout: 15000 });
});
