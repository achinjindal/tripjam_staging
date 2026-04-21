import { test, expect } from "@playwright/test";
import { login, snap } from "./helpers";

test.describe("Smoke tests", () => {
  test("login screen renders", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=/TripJam/i").first()).toBeVisible({ timeout: 10000 });
    await snap(page, "01-login");
  });

  test("can log in and see home", async ({ page }) => {
    await login(page);
    await expect(page.locator("text=/Your Trips/i").first()).toBeVisible();
    await snap(page, "02-home");
  });

  test("can start creating a trip", async ({ page }) => {
    await login(page);
    const btn = page.locator("button", { hasText: /new trip|create/i }).first();
    await btn.click();
    await expect(page.locator("text=/Where to/i").first()).toBeVisible({ timeout: 5000 });
    await snap(page, "03-setup");
  });
});
