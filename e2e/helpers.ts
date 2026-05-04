import { Page, expect } from "@playwright/test";

const TEST_PASSWORD = "qaTest123!";

/** Login with username — signs up first if account doesn't exist */
export async function login(page: Page, username = "qa-tester") {
  await page.goto("/");
  await page.waitForSelector("text=/TripJam/i", { timeout: 10000 });

  // Try sign in first
  const signInTab = page.locator("button", { hasText: /^Sign In$/i }).first();
  if (await signInTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await signInTab.click();
  }
  await page.waitForTimeout(300);

  // Fill username and password
  const inputs = page.locator("input");
  await inputs.nth(0).fill(username);
  await inputs.nth(1).fill(TEST_PASSWORD);

  // Click the submit button (Sign In)
  const submitBtn = page.locator("button", { hasText: /^Sign In$/i }).last();
  await submitBtn.click();
  await page.waitForTimeout(3000);

  // Check if we landed on home
  const home = page.locator("text=/Your Trips|No trips yet/i").first();
  if (await home.isVisible({ timeout: 2000 }).catch(() => false)) return;

  // Sign in failed — try sign up
  const signUpTab = page.locator("button", { hasText: /^Sign Up$/i }).first();
  await signUpTab.click();
  await page.waitForTimeout(300);

  const inputs2 = page.locator("input");
  await inputs2.nth(0).fill(username);
  await inputs2.nth(1).fill(TEST_PASSWORD);

  // Submit button on sign up is "Create Account"
  const createBtn = page.locator("button", { hasText: /Create Account|Sign Up/i }).last();
  await createBtn.click();

  // Wait for home screen
  await page.waitForSelector("text=/Your Trips|No trips yet/i", { timeout: 15000 });
}

/** Take a labeled screenshot */
export async function snap(page: Page, name: string) {
  await page.screenshot({ path: `e2e/screenshots/${name}.png`, fullPage: false });
}
