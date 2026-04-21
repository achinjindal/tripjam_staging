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

/** Create a new trip and go through setup */
export async function createTrip(page: Page, opts: {
  destination: string;
  startDate?: string;
  endDate?: string;
  travelers?: string;
  budget?: string;
}) {
  const createBtn = page.locator("button", { hasText: /new trip|create/i }).first();
  await createBtn.click();
  await page.waitForTimeout(500);

  // Step 0: Destination
  const destInput = page.locator("input[placeholder*='Bangkok' i], input[placeholder*='destination' i], input[placeholder*='Rajasthan' i]").first();
  await destInput.fill(opts.destination);
  await page.waitForTimeout(1000);
  const suggestion = page.locator("[style*='cursor: pointer']", { hasText: new RegExp(opts.destination.split(" ")[0], "i") }).first();
  if (await suggestion.isVisible({ timeout: 2000 }).catch(() => false)) {
    await suggestion.click();
  } else {
    await destInput.press("Enter");
  }
  await page.waitForTimeout(300);
}

/** Wait for routes to load on the brainstorm/routes page */
export async function waitForRoutes(page: Page) {
  // Wait for spinner to disappear (generating = false)
  await page.waitForFunction(() => {
    const spinner = document.querySelector('[style*="spin 0.8s"]');
    return !spinner;
  }, { timeout: 90000 });
  // Verify route cards are visible
  await page.waitForSelector("text=/Choose your route|Your saved routes/i", { timeout: 5000 });
}

/** Wait for itinerary to load */
export async function waitForItinerary(page: Page) {
  await page.waitForSelector("text=/Day 1/i", { timeout: 120000 });
  await page.waitForTimeout(2000); // let activities render
}

/** Take a labeled screenshot */
export async function snap(page: Page, name: string) {
  await page.screenshot({ path: `e2e/screenshots/${name}.png`, fullPage: false });
}
