import { test, expect, Page } from "@playwright/test";
import { login, snap } from "./helpers";

/**
 * Story mode (Design A swipe gallery) — read-only magazine view + full-screen
 * player. Uses the seeded qa-tester trip "Tokyo to Kyoto Classic", which has
 * persisted story fields (story_title/narrative/gloss via the backfill fn)
 * and photos. Tests skip when the trip or the Story toggle is unavailable
 * (e.g. staging without the story deploys).
 */

async function openStory(page: Page): Promise<boolean> {
  await login(page);
  const card = page.getByText("Tokyo to Kyoto Classic").first();
  if (!(await card.isVisible({ timeout: 5000 }).catch(() => false)))
    return false;
  await card.click();
  await page.waitForTimeout(2500);
  // Desktop shell may need the Itinerary tab selected explicitly
  const itinTab = page.locator("button", { hasText: /^\s*Itinerary\s*$/ });
  if (
    await itinTab
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false)
  ) {
    await itinTab.first().click();
    await page.waitForTimeout(1200);
  }
  const storyBtn = page.locator("button", { hasText: "✦ Story" }).first();
  if (!(await storyBtn.isVisible({ timeout: 5000 }).catch(() => false)))
    return false;
  // Past-dated trip defaults to Plan; flip to Story unless already active
  if ((await storyBtn.getAttribute("aria-pressed")) !== "true")
    await storyBtn.click();
  await page.waitForSelector(".sv-masthead", { timeout: 10000 });
  return true;
}

test.describe("story mode", () => {
  test("renders masthead, narrative, gallery — zero edit affordances", async ({
    page,
  }) => {
    if (!(await openStory(page))) {
      test.skip();
      return;
    }
    await page.waitForTimeout(3000); // photos settle

    await expect(page.locator(".sv-masthead h1").first()).toBeVisible();
    expect(await page.locator(".sv-narrative").count()).toBeGreaterThan(0);
    expect(await page.locator(".sv-slide").count()).toBeGreaterThan(0);
    expect(await page.locator(".sv-stop").count()).toBeGreaterThan(0);

    // Read-only: none of Plan's editing affordances render inside Story
    const root = page.locator(".sv-root");
    expect(await root.locator("input, textarea, select").count()).toBe(0);
    expect(
      await root
        .locator("button", { hasText: /^(⋯|\+ Add|Edit|Delete)$/ })
        .count(),
    ).toBe(0);

    await snap(page, "80-story-view");
  });

  test("timeline row tap syncs the hero gallery", async ({ page }) => {
    if (!(await openStory(page))) {
      test.skip();
      return;
    }
    await page.waitForTimeout(3000);

    // Scope to day 1 so rows and caption belong to the same gallery. Tap two
    // different rows — each maps 1:1 to a distinct slide, so the caption must
    // differ between the two taps (slide order ≠ row order when a hotel
    // demotes, so comparing against the initial caption would be flaky).
    const day1 = page.locator(".sv-day").first();
    const rows = day1.locator(".sv-stop[data-tappable]");
    if ((await rows.count()) < 2) {
      test.skip();
      return;
    }
    const caption = day1.locator(".sv-chip-caption").first();
    await rows.nth(0).scrollIntoViewIfNeeded();
    await rows.nth(0).click();
    await page.waitForTimeout(1200);
    await expect(rows.nth(0)).toHaveClass(/sv-active/);
    const c1 = await caption.innerText();
    await rows.nth(1).click();
    await page.waitForTimeout(1200);
    await expect(rows.nth(1)).toHaveClass(/sv-active/);
    const c2 = await caption.innerText();
    expect(c2).not.toBe(c1);
  });

  test("toggling back to Plan restores the editing UI", async ({ page }) => {
    if (!(await openStory(page))) {
      test.skip();
      return;
    }
    await page
      .locator("button", { hasText: /^Plan$/ })
      .first()
      .click();
    await page.waitForTimeout(1500);
    expect(await page.locator(".sv-root").count()).toBe(0);
    // A Plan-mode day pill/header renders again (compact or detailed)
    await expect(page.getByText(/Day 1/).first()).toBeVisible({
      timeout: 5000,
    });
    await snap(page, "81-story-back-to-plan");
  });

  test("player opens, advances by tap, closes on Escape", async ({ page }) => {
    if (!(await openStory(page))) {
      test.skip();
      return;
    }
    await page.locator("button", { hasText: "Play the story" }).first().click();
    const player = page.locator(".sv-player");
    await expect(player).toBeVisible({ timeout: 5000 });
    const coverTitle = await player.locator("h2").first().innerText();

    // Tap the right third → next frame
    const box = await player.boundingBox();
    if (!box) throw new Error("player has no bounding box");
    await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.5);
    await page.waitForTimeout(800);
    const nextTitle = await player.locator("h2").first().innerText();
    expect(nextTitle).not.toBe(coverTitle);
    expect(await player.locator(".sv-seg").count()).toBeGreaterThan(0);
    await snap(page, "82-story-player");

    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
    expect(await page.locator(".sv-player").count()).toBe(0);
  });
});
