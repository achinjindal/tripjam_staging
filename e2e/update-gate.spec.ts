import { test, expect, type Page } from "@playwright/test";

// Minimum-client-build gate (src/UpdateGate.jsx). The app_config read is
// mocked, so this never touches the real row. The dev server's build number
// is its start time (vite.config.js), so "outdated" = a minimum far in the
// future and "current" = 0 / a minimum in the past.

async function mockMinBuild(page: Page, value: unknown, status = 200) {
  await page.route("**/rest/v1/app_config*", (route) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(status === 200 ? { value } : { message: "boom" }),
    }),
  );
}

test("outdated web client sees a blocking update screen", async ({ page }) => {
  await mockMinBuild(page, {
    web: 999912312359,
    android: 0,
    message: null,
  });
  await page.goto("/");
  const dialog = page.getByRole("alertdialog", { name: "Update TripJam" });
  await expect(dialog).toBeVisible({ timeout: 15000 });
  await expect(dialog.getByRole("button", { name: "Reload" })).toBeVisible();
  await expect(dialog).toContainText("your trips are saved");
});

test("custom message from the config is shown", async ({ page }) => {
  await mockMinBuild(page, {
    web: 999912312359,
    android: 0,
    message: "E2E: please update for the new chat.",
  });
  await page.goto("/");
  await expect(
    page.getByText("E2E: please update for the new chat."),
  ).toBeVisible({ timeout: 15000 });
});

for (const [name, value, status] of [
  ["no minimum (0)", { web: 0, android: 0, message: null }, 200],
  [
    "minimum in the past",
    { web: 202001010000, android: 0, message: null },
    200,
  ],
  [
    "only the Android minimum is raised",
    { web: 0, android: 999912312359 },
    200,
  ],
  ["config read fails (fail open)", null, 500],
] as const) {
  test(`no gate when ${name}`, async ({ page }) => {
    await mockMinBuild(page, value, status);
    await page.goto("/");
    await page.waitForTimeout(3000);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });
}
