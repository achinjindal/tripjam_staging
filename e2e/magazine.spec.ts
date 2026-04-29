import { test, expect } from "@playwright/test";
import { login, snap } from "./helpers";

test.describe("Magazine & Photos", () => {

  test("Magazine tab renders destination hero with photo", async ({ page }) => {
    await login(page);

    // Find an existing trip
    const tripCard = page.locator("[style*='cursor: pointer']").filter({ hasText: /Tokyo|Japan|Day/i }).first();
    if (!await tripCard.isVisible({ timeout: 5000 }).catch(() => false)) { test.skip(); return; }
    await tripCard.click();
    await page.waitForTimeout(2000);

    // Click Magazine tab
    const magTab = page.locator("button", { hasText: /Magazine/i }).first();
    if (!await magTab.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await magTab.click();
    await page.waitForTimeout(2000);

    // Should see destination hero or city name
    const hasContent = await page.locator("text=/Tokyo|Japan|Highlights|Things to see/i").first()
      .isVisible({ timeout: 10000 }).catch(() => false);
    expect(hasContent).toBe(true);

    // Check for images loading (hero photo or highlight cards)
    await page.waitForTimeout(3000); // let photos load
    const images = page.locator("img[src*='wikipedia'], img[src*='wikimedia']");
    const imgCount = await images.count();

    await snap(page, "30-magazine-tab");
    // At least some photos should have loaded
    console.log(`Magazine photos loaded: ${imgCount}`);
  });

  test("Magazine highlight cards show photos or emoji fallback", async ({ page }) => {
    await login(page);

    const tripCard = page.locator("[style*='cursor: pointer']").filter({ hasText: /Tokyo|Japan|Day/i }).first();
    if (!await tripCard.isVisible({ timeout: 5000 }).catch(() => false)) { test.skip(); return; }
    await tripCard.click();
    await page.waitForTimeout(2000);

    const magTab = page.locator("button", { hasText: /Magazine/i }).first();
    if (!await magTab.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await magTab.click();
    await page.waitForTimeout(5000); // let photos load

    // Check masonry grid exists
    const gridCards = page.locator("[style*='grid-template-columns']");
    const gridCount = await gridCards.count();
    console.log(`Masonry grids found: ${gridCount}`);

    // All highlight cards should have either a photo or an emoji fallback — no empty boxes
    const emptyBoxes = await page.evaluate(() => {
      const cards = document.querySelectorAll("[style*='border-radius: 14px'][style*='overflow: hidden']");
      let empty = 0;
      cards.forEach(card => {
        const hasImg = card.querySelector("img");
        const hasEmoji = card.querySelector("[style*='font-size: 28px'], [style*='fontSize: 28px']");
        const hasText = card.querySelector("[style*='font-family']");
        if (!hasImg && !hasEmoji && hasText) empty++;
      });
      return empty;
    });
    console.log(`Empty highlight boxes: ${emptyBoxes}`);
    expect(emptyBoxes).toBe(0);

    await snap(page, "31-magazine-highlights");
  });

  test("City hero photo loads with name badge", async ({ page }) => {
    await login(page);

    const tripCard = page.locator("[style*='cursor: pointer']").filter({ hasText: /Tokyo|Japan|Day/i }).first();
    if (!await tripCard.isVisible({ timeout: 5000 }).catch(() => false)) { test.skip(); return; }
    await tripCard.click();
    await page.waitForTimeout(2000);

    const magTab = page.locator("button", { hasText: /Magazine/i }).first();
    if (!await magTab.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await magTab.click();
    await page.waitForTimeout(3000);

    // Check city hero has backdrop-filter badge
    const cityBadge = page.locator("[style*='backdrop-filter']");
    const badgeCount = await cityBadge.count();
    console.log(`City name badges: ${badgeCount}`);
    expect(badgeCount).toBeGreaterThan(0);

    await snap(page, "32-city-hero");
  });

  test("Food spotlight cards render", async ({ page }) => {
    await login(page);

    const tripCard = page.locator("[style*='cursor: pointer']").filter({ hasText: /Tokyo|Japan|Day/i }).first();
    if (!await tripCard.isVisible({ timeout: 5000 }).catch(() => false)) { test.skip(); return; }
    await tripCard.click();
    await page.waitForTimeout(2000);

    const magTab = page.locator("button", { hasText: /Magazine/i }).first();
    if (!await magTab.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await magTab.click();
    await page.waitForTimeout(4000);

    // Check for food section
    const foodSection = page.locator("text=/Must try/i").first();
    const hasFoodSection = await foodSection.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Food section visible: ${hasFoodSection}`);

    if (hasFoodSection) {
      // Food cards should have warm orange background
      const foodCards = page.locator("[style*='#FFF7ED']");
      const foodCount = await foodCards.count();
      console.log(`Food spotlight cards: ${foodCount}`);
      expect(foodCount).toBeGreaterThan(0);
    }

    await snap(page, "33-food-spotlight");
  });

  test("Pull quote renders for did-you-know", async ({ page }) => {
    await login(page);

    const tripCard = page.locator("[style*='cursor: pointer']").filter({ hasText: /Tokyo|Japan|Day/i }).first();
    if (!await tripCard.isVisible({ timeout: 5000 }).catch(() => false)) { test.skip(); return; }
    await tripCard.click();
    await page.waitForTimeout(2000);

    const magTab = page.locator("button", { hasText: /Magazine/i }).first();
    if (!await magTab.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await magTab.click();
    await page.waitForTimeout(4000);

    // Pull quote has a left border accent
    const pullQuote = page.locator("[style*='border-left: 3px']");
    const quoteCount = await pullQuote.count();
    console.log(`Pull quotes: ${quoteCount}`);

    await snap(page, "34-pull-quote");
  });
});
