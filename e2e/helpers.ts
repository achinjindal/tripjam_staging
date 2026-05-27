import { Page, expect } from "@playwright/test";

const TEST_PASSWORD = "qaTest123!";

/** Login with username — signs up first if account doesn't exist.
 *  Day 4: navigates directly to /signin to skip the Landing page.
 *  Day 1+5: signin uses a single "Email or username" field; signup adds
 *  Email + Username + Password + a required Terms-agreement checkbox.
 */
export async function login(page: Page, username = "qa-tester") {
  await page.goto("/signin");
  await page.waitForSelector("text=/TripJam/i", { timeout: 10000 });

  // Make sure the Sign In tab is active (it's the default but be defensive)
  const signInTab = page.locator("button", { hasText: /^Sign In$/i }).first();
  if (await signInTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await signInTab.click();
  }
  await page.waitForTimeout(300);

  // Sign-in form: [0]=email-or-username, [1]=password
  const inputs = page.locator("input");
  await inputs.nth(0).fill(username);
  await inputs.nth(1).fill(TEST_PASSWORD);

  // Click the submit button (Sign In is the LAST button matching this regex,
  // not the tab at top)
  const submitBtn = page.locator("button", { hasText: /^Sign In$/i }).last();
  await submitBtn.click();
  await page.waitForTimeout(3000);

  // Check if we landed on home (Auth.jsx doesn't redirect post-sign-in,
  // so the URL stays at /signin even though the Home screen renders).
  // Navigate to "/" so tests asserting URL get the expected value.
  const home = page.locator("text=/Your Trips|No trips yet/i").first();
  if (await home.isVisible({ timeout: 2000 }).catch(() => false)) {
    await page.goto("/");
    await page.waitForTimeout(300);
    await dismissBanners(page);
    return;
  }

  // Sign in failed — try sign up
  const signUpTab = page.locator("button", { hasText: /^Sign Up$/i }).first();
  await signUpTab.click();
  await page.waitForTimeout(300);

  // Sign-up form: [0]=email, [1]=username, [2]=password
  const inputs2 = page.locator("input");
  await inputs2.nth(0).fill(`${username}@tripjam.app`);
  await inputs2.nth(1).fill(username);
  await inputs2.nth(2).fill(TEST_PASSWORD);

  // Tick the required Terms + Privacy agreement (Day 5 D8)
  const agree = page.locator('input[type="checkbox"]').first();
  if (await agree.isVisible({ timeout: 1000 }).catch(() => false)) {
    await agree.check();
  }

  // Submit button on sign up is "Create Account"
  const createBtn = page
    .locator("button", { hasText: /Create Account|Sign Up/i })
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
