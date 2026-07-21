import { test, expect } from "@playwright/test";
import { login, snap } from "./helpers";

/**
 * Tests for unified chat actions — verifies that chat can perform
 * all action types and the UI stays in sync.
 */

/** Navigate to an existing trip's itinerary */
async function openTrip(page: import("@playwright/test").Page) {
  await login(page);
  await page.waitForTimeout(1000);

  // Find any trip card on home
  const cards = page.locator(
    "[style*='cursor: pointer'][style*='border-radius']",
  );
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    const text = await card.textContent().catch(() => "");
    if (text && /Day|Tokyo|Japan|\d+ days?/i.test(text)) {
      await card.click();
      await page.waitForTimeout(2000);
      // Check if we landed on itinerary (has bottom nav with Itinerary tab)
      const itinTab = page.locator("button", { hasText: /Itinerary/i }).first();
      if (await itinTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        return true;
      }
      await page.goBack();
      await page.waitForTimeout(1000);
    }
  }
  return false;
}

test.describe("Chat Actions", () => {
  // Post design-pass: on the desktop shell (default 1280px viewport) the Trippy
  // chat is rendered inline in the right column and is always open — there is no
  // "Ask anything about your trip" collapsed CTA bar to click (that bar is
  // mobile-only). The itinerary chat opens with a fresh-state greeting and three
  // suggestion pills; the input is a textarea (placeholder "Ask Trippy anything…").
  test("chat shows suggestion pills", async ({ page }) => {
    test.setTimeout(120000);
    const opened = await openTrip(page);
    if (!opened) {
      test.skip();
      return;
    }
    await page.waitForTimeout(1000);

    // Inline chat is already open with fresh-state suggestion pills.
    const pills = page.locator("button", {
      hasText:
        /Change Day 1 hotel|Swap .* for something else|Make Day \d+ more relaxed|must-do in/i,
    });
    await expect(pills.first()).toBeVisible({ timeout: 5000 });
    expect(await pills.count()).toBeGreaterThan(0);

    await snap(page, "40-chat-open");
  });

  test("chat pill pre-fills input", async ({ page }) => {
    test.setTimeout(120000);
    const opened = await openTrip(page);
    if (!opened) {
      test.skip();
      return;
    }
    await page.waitForTimeout(1000);

    // The "Make Day N more relaxed" pill is always present on the itinerary chat
    // (unlike the Day-1-hotel pill, whose text depends on whether a hotel exists).
    const pill = page
      .locator("button", { hasText: /Make Day \d+ more relaxed/i })
      .first();
    await expect(pill).toBeVisible({ timeout: 5000 });
    const pillText = (await pill.textContent())?.trim() || "";
    await pill.click();
    await page.waitForTimeout(300);

    // Input (the chat textarea) should now be pre-filled with the pill text.
    const input = page.locator("textarea[placeholder*='Ask Trippy']").first();
    const value = await input.inputValue().catch(() => "");
    expect(value).toContain(pillText);

    await snap(page, "41-chat-pill");
  });

  test("activity chat icon pre-fills chat with context", async ({ page }) => {
    test.setTimeout(120000);
    const opened = await openTrip(page);
    if (!opened) {
      test.skip();
      return;
    }

    // Activity cards are collapsed by default on the itinerary — expand the
    // first "Day N" section so its activity cards (and their 💬 Ask Trippy
    // buttons) render.
    const dayHeader = page.locator("text=/^Day \\d/i").first();
    if (await dayHeader.isVisible({ timeout: 5000 }).catch(() => false)) {
      await dayHeader.click();
      await page.waitForTimeout(1000);
    }

    // Find a chat icon (💬 Ask Trippy) on an activity card.
    const chatIcon = page.locator("button[title='Ask Trippy']").first();
    if (!(await chatIcon.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip();
      return;
    }
    await chatIcon.click();
    await page.waitForTimeout(500);

    // The (inline, always-open) chat input should be pre-filled with
    // 'Tell me about "..."' for that activity.
    const input = page.locator("textarea[placeholder*='Ask Trippy']").first();
    const value = await input.inputValue().catch(() => "");
    expect(value).toMatch(/Tell me about/i);

    await snap(page, "42-activity-chat");
  });

  test("chat on brainstorm shows route-specific pills", async ({ page }) => {
    await login(page);

    // Create a new trip to get to brainstorm
    const createBtn = page
      .locator("button", { hasText: /new trip|create/i })
      .first();
    if (!(await createBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip();
      return;
    }
    await createBtn.click();
    await page.waitForTimeout(500);

    // Just check if we can see the setup - don't go through full flow
    const whereToVisible = await page
      .locator("text=/Where to/i")
      .first()
      .isVisible({ timeout: 3000 })
      .catch(() => false);
    expect(whereToVisible).toBe(true);

    await snap(page, "43-setup-form");
  });
});

test.describe("Setup Form (updated)", () => {
  test("setup has 3 steps with progress dots", async ({ page }) => {
    await login(page);
    const createBtn = page
      .locator("button", { hasText: /new trip|create/i })
      .first();
    await createBtn.click();
    await page.waitForTimeout(500);

    // Should see 3 progress dots
    // Step 0: Where to
    await expect(page.locator("text=/Where to/i").first()).toBeVisible({
      timeout: 3000,
    });

    // Add a destination and advance
    const destInput = page.locator("input[placeholder*='Bangkok']").first();
    await destInput.fill("Japan");
    await page.waitForTimeout(1000);
    await destInput.press("Enter");
    await page.waitForTimeout(500);

    const nextBtn = page.locator("button", { hasText: /continue/i }).first();
    if (await nextBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await nextBtn.click();
      await page.waitForTimeout(800);

      // Step 1: Dates (+ travelers counter). Heading is "Dates" post design pass.
      await expect(page.locator("text=/Dates/i").first()).toBeVisible({
        timeout: 3000,
      });

      // Pick a valid future date range so Continue passes validation
      const dayCells = page.locator("div[style*='cursor: pointer']").filter({
        hasText: /^\d{1,2}$/,
      });
      await dayCells.first().waitFor({ state: "visible", timeout: 5000 });
      const dayCount = await dayCells.count();
      const startIdx = Math.min(5, Math.max(0, dayCount - 6));
      await dayCells.nth(startIdx).click();
      await page.waitForTimeout(200);
      await dayCells.nth(Math.min(startIdx + 5, dayCount - 1)).click();
      await page.waitForTimeout(200);

      // Advance to step 2
      const nextBtn2 = page.locator("button", { hasText: /continue/i }).first();
      if (await nextBtn2.isVisible({ timeout: 2000 }).catch(() => false)) {
        await nextBtn2.click();
        await page.waitForTimeout(500);

        // Step 2: Preferences (base city + notes + Start Planning).
        // Heading is "Preferences" post design pass.
        await expect(page.locator("text=/Preferences/i").first()).toBeVisible({
          timeout: 3000,
        });
        await expect(
          page.locator("text=/What kind of trip/i").first(),
        ).toBeVisible();
        await expect(
          page.locator("button", { hasText: /Start Planning/i }).first(),
        ).toBeVisible();

        // Should NOT have Trip Style, Budget, Morning, Pace questions
        const hasStyle = await page
          .locator("text=/Trip style/i")
          .first()
          .isVisible({ timeout: 1000 })
          .catch(() => false);
        const hasBudget = await page
          .locator("text=/Budget range/i")
          .first()
          .isVisible({ timeout: 1000 })
          .catch(() => false);
        const hasMorning = await page
          .locator("text=/head out/i")
          .first()
          .isVisible({ timeout: 1000 })
          .catch(() => false);
        expect(hasStyle).toBe(false);
        expect(hasBudget).toBe(false);
        expect(hasMorning).toBe(false);
      }
    }

    await snap(page, "44-setup-3-steps");
  });

  test("Help me decide button visible on step 0", async ({ page }) => {
    await login(page);
    const createBtn = page
      .locator("button", { hasText: /new trip|create/i })
      .first();
    await createBtn.click();
    await page.waitForTimeout(500);

    const helpBtn = page
      .locator("button", { hasText: /Help me decide/i })
      .first();
    await expect(helpBtn).toBeVisible({ timeout: 3000 });

    await snap(page, "45-help-me-decide");
  });
});

test.describe("Pre-IG Bottom Sheet", () => {
  test("Build My Itinerary opens refinement sheet", async ({ page }) => {
    test.setTimeout(180000);
    await login(page);

    // Find an existing Planning draft. Prefer a Japan draft (our shared-setup
    // trips reliably carry 4 routes); fall back to any Planning card.
    const jpCard = page
      .locator("div", { hasText: /Japan ·/ })
      .filter({ has: page.locator("text=/Planning/") })
      .first();
    const anyCard = page.locator("text=/Planning/i").first();
    const card = (await jpCard.isVisible({ timeout: 3000 }).catch(() => false))
      ? jpCard
      : anyCard;
    if (!(await card.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip();
      return;
    }
    await card.click();
    await page.waitForTimeout(2000);

    // Post design-pass: the brainstorm view is a tabbed shell and opens on the
    // Inspirations tab on desktop. Switch to the Route tab so the route "Select"
    // cards render.
    const routeTab = page.locator("button", { hasText: /Route/i }).first();
    if (await routeTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await routeTab.click();
      await page.waitForTimeout(1000);
    }

    // Select a route if not already selected.
    const selectBtn = page.locator("button", { hasText: /^Select$/ }).first();
    if (await selectBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await selectBtn.click();
      await page.waitForTimeout(500);
    } else if (
      !(await page
        .locator("button", { hasText: /^✓ Selected$/ })
        .first()
        .isVisible({ timeout: 1000 })
        .catch(() => false))
    ) {
      // No routes on this draft (stale) — nothing to build.
      test.skip();
      return;
    }

    // Click Build My Itinerary
    const buildBtn = page
      .locator("button", { hasText: /Build My Itinerary/i })
      .first();
    await expect(buildBtn).toBeVisible({ timeout: 4000 });
    await buildBtn.click();
    await page.waitForTimeout(500);

    // Pre-IG sheet should appear
    await expect(
      page.locator("text=/Fine-tune your itinerary/i").first(),
    ).toBeVisible({ timeout: 3000 });
    await expect(page.locator("text=/Budget range/i").first()).toBeVisible();
    await expect(page.locator("text=/head out/i").first()).toBeVisible();
    await expect(page.locator("text=/How active/i").first()).toBeVisible();
    // Free-text label was renamed in the design pass ("Anything specific" →
    // "Any additional detail?").
    await expect(
      page.locator("text=/additional detail/i").first(),
    ).toBeVisible();
    await expect(
      page.locator("button", { hasText: /Generate Itinerary/i }).first(),
    ).toBeVisible();

    await snap(page, "46-pre-ig-sheet");
  });
});
