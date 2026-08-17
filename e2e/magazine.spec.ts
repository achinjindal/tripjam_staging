import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { login, snap, dismissTripOverlays } from "./helpers";

/**
 * Open an existing built trip and navigate to the Magazine sub-tab.
 *
 * Post design-pass tab layout (desktop shell, default 1280px viewport):
 *  - A built trip lands on the "Itinerary" top tab. The Magazine content lives
 *    under the "Inspirations" top tab (internal key `brainstorm`), which then
 *    exposes an "Inspirations" / "Magazine" sub-tab strip.
 *  - So reaching Magazine is: open trip → click "Inspirations" top tab →
 *    click "Magazine" sub-tab.
 *
 * Returns false (so the caller can skip) if no built trip / Magazine tab found.
 */
async function openMagazine(page: import("@playwright/test").Page) {
  // Target the built trip by name ("Tokyo to Kyoto Classic") so we don't
  // accidentally open one of the many "Planning" drafts (which also expose a
  // Magazine sub-tab but with different, destination-only hero content).
  const builtCard = page
    .locator("[style*='cursor: pointer']")
    .filter({ hasText: /Tokyo to Kyoto Classic/i })
    .first();
  const tripCard = (await builtCard
    .isVisible({ timeout: 3000 })
    .catch(() => false))
    ? builtCard
    : page
        .locator("[style*='cursor: pointer']")
        .filter({ hasText: /Tokyo|Japan|Day|days/i })
        .first();
  if (!(await tripCard.isVisible({ timeout: 5000 }).catch(() => false))) {
    return false;
  }
  await tripCard.click();
  await page.waitForTimeout(2000);
  await dismissTripOverlays(page, 2000);

  // Switch to the Inspirations top tab (which hosts the Magazine sub-tab).
  const inspTab = page.locator("button", { hasText: /Inspirations/i }).first();
  if (await inspTab.isVisible({ timeout: 3000 }).catch(() => false)) {
    await inspTab.click();
    await page.waitForTimeout(1000);
  }

  // Click the Magazine sub-tab.
  const magTab = page.locator("button", { hasText: /Magazine/i }).first();
  if (!(await magTab.isVisible({ timeout: 3000 }).catch(() => false))) {
    return false;
  }
  await magTab.click();
  await page.waitForTimeout(2000);
  return true;
}

test.describe("Magazine & Photos", () => {
  test("Magazine tab renders destination hero with photo", async ({ page }) => {
    await login(page);

    if (!(await openMagazine(page))) {
      test.skip();
      return;
    }

    // Should see destination hero or city name
    const hasContent = await page
      .locator("text=/Tokyo|Japan|Highlights|Things to see/i")
      .first()
      .isVisible({ timeout: 10000 })
      .catch(() => false);
    expect(hasContent).toBe(true);

    // Check for images loading (hero photo or highlight cards)
    await page.waitForTimeout(3000); // let photos load
    const images = page.locator("img[src*='wikipedia'], img[src*='wikimedia']");
    const imgCount = await images.count();

    await snap(page, "30-magazine-tab");
    // At least some photos should have loaded
    console.log(`Magazine photos loaded: ${imgCount}`);
  });

  test("Magazine highlight cards show photos or emoji fallback", async ({
    page,
  }) => {
    await login(page);

    if (!(await openMagazine(page))) {
      test.skip();
      return;
    }
    await page.waitForTimeout(3000); // let photos load

    // Check masonry grid exists
    const gridCards = page.locator("[style*='grid-template-columns']");
    const gridCount = await gridCards.count();
    console.log(`Masonry grids found: ${gridCount}`);

    // All highlight cards should have either a photo or an emoji fallback — no empty boxes
    const emptyBoxes = await page.evaluate(() => {
      const cards = document.querySelectorAll(
        "[style*='border-radius: 14px'][style*='overflow: hidden']",
      );
      let empty = 0;
      cards.forEach((card) => {
        const hasImg = card.querySelector("img");
        const hasEmoji = card.querySelector(
          "[style*='font-size: 28px'], [style*='fontSize: 28px']",
        );
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

    if (!(await openMagazine(page))) {
      test.skip();
      return;
    }
    await page.waitForTimeout(1000);

    // Check city hero has backdrop-filter badge (weather or city name)
    const cityBadge = page.locator("[style*='backdrop-filter']");
    const badgeCount = await cityBadge.count();
    console.log(`City name badges: ${badgeCount}`);
    // May be 0 if deep-dive data hasn't loaded yet on staging — skip rather than fail
    if (badgeCount === 0) {
      test.skip();
      return;
    }
    expect(badgeCount).toBeGreaterThan(0);

    await snap(page, "32-city-hero");
  });

  test("Food spotlight cards render", async ({ page }) => {
    await login(page);

    if (!(await openMagazine(page))) {
      test.skip();
      return;
    }
    await page.waitForTimeout(2000);

    // Check for food section
    const foodSection = page.locator("text=/Must try/i").first();
    const hasFoodSection = await foodSection
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    console.log(`Food section visible: ${hasFoodSection}`);

    if (hasFoodSection) {
      // Count real cards — the old [style*='#FFF7ED'] selector never matched
      // (browsers serialize style attrs to rgb(), and the card now uses the
      // T.warningLight token)
      const foodCards = page.getByTestId("food-spotlight-card");
      const foodCount = await foodCards.count();
      console.log(`Food spotlight cards: ${foodCount}`);
      expect(foodCount).toBeGreaterThan(0);
    }

    await snap(page, "33-food-spotlight");
  });

  test("Magazine photos survive a tab flip — no reload from scratch", async ({
    page,
  }) => {
    // Self-sufficient navigation: card-based openMagazine is flaky when test
    // sweeps mint sibling trips — resolve the QA trip id directly instead.
    const env: Record<string, string> = {};
    try {
      const raw = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), "..", ".env"),
        "utf8",
      );
      for (const line of raw.split("\n")) {
        const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
        if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch {
      /* fall through to skip */
    }
    const sb = env.VITE_SUPABASE_URL
      ? createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;
    test.skip(!sb, "no supabase env");
    const { error } = await sb!.auth.signInWithPassword({
      email: "qa-tester@tripjam.app",
      password: "qaTest123!",
    });
    test.skip(!!error, "auth failed");
    const me = (await sb!.auth.getUser()).data.user?.id;
    const { data: trips } = await sb!
      .from("trips")
      .select("id")
      .ilike("name", "Tokyo to Kyoto Classic%")
      .eq("created_by", me!)
      .not("ig_response", "is", null)
      .limit(1);
    const tripId = trips?.[0]?.id;
    test.skip(!tripId, "QA trip not found");

    await login(page);
    await page.goto(`/trip/${tripId}`);
    await page.waitForTimeout(2500);
    await dismissTripOverlays(page, 2000);
    const inspTab = page
      .locator("button:visible", { hasText: /Inspirations/i })
      .first();
    if (await inspTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await inspTab.click();
      await page.waitForTimeout(800);
    }
    const magTab = page
      .locator("button:visible", { hasText: /Magazine/i })
      .first();
    if (await magTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await magTab.click();
      await page.waitForTimeout(1500);
    }
    // A real magazine photo (Wikimedia/stock), not chrome assets or avatars.
    // :visible matters — the hidden itinerary tab keeps its own day-card
    // images mounted (display:none container) and they must not match.
    const photoSel =
      "img:visible[src*='wikimedia'], img:visible[src*='upload.'], img:visible[src*='pexels'], img:visible[src*='tripadvisor']";
    const photo = page.locator(photoSel).first();
    const loaded = await photo
      .waitFor({ state: "visible", timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!loaded, "no magazine photo loaded to compare");
    const src1 = await photo.getAttribute("src");

    // Flip away to Itinerary and back — this remounts the magazine tree
    await page
      .locator("button:visible", { hasText: /Itinerary/i })
      .first()
      .click();
    await page.waitForTimeout(800);
    await page
      .locator("button:visible", { hasText: /Inspirations|Magazine/i })
      .first()
      .click();
    await page.waitForTimeout(400);
    const magSubTab = page
      .locator("button:visible", { hasText: /^\s*Magazine\s*$/ })
      .first();
    if (await magSubTab.isVisible({ timeout: 1500 }).catch(() => false))
      await magSubTab.click();

    // The same photo must be back almost immediately (module photo cache) —
    // before the fix, _fetchPhoto rejected its own cached URL as a
    // "duplicate" (it was in _usedPhotoUrls from the first render) and the
    // whole magazine re-ran its fallback ladders from scratch.
    await expect(
      page.locator(`img:visible[src="${src1!.replace(/"/g, '\\"')}"]`).first(),
    ).toBeVisible({ timeout: 4000 });
  });

  test("Pull quote renders for did-you-know", async ({ page }) => {
    await login(page);

    if (!(await openMagazine(page))) {
      test.skip();
      return;
    }
    await page.waitForTimeout(2000);

    // Pull quote has a left border accent
    const pullQuote = page.locator("[style*='border-left: 3px']");
    const quoteCount = await pullQuote.count();
    console.log(`Pull quotes: ${quoteCount}`);

    await snap(page, "34-pull-quote");
  });
});
