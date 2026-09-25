import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { login, dismissTripOverlays } from "./helpers";

// Local gems redesign: gems anchor inline under the activity their `near`
// names; orphans land in the "Also nearby" strip; + Add is a direct
// activities insert; a gem whose title already exists as an activity is
// hidden. Seeds days.wishlist directly as the qa user on the built
// "Tokyo to Kyoto Classic" trip — no RG/IG, one verify-place call on Add.
test("gems: inline anchor, orphan strip, dedupe, direct add, dismiss", async ({
  page,
}) => {
  test.setTimeout(150000);
  page.setDefaultTimeout(15000);
  // The app renders inside a custom scroll frame in E2E — Playwright's
  // viewport-aware click can spin on "outside of the viewport" forever.
  // JS-click after asserting visibility instead.
  const jsClick = async (locator: import("@playwright/test").Locator) => {
    await expect(locator).toBeVisible();
    await locator.evaluate((el) => (el as HTMLElement).click());
  };
  const env: Record<string, string> = {};
  const raw = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", ".env"),
    "utf8",
  );
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sb.auth.signInWithPassword({
    email: "qa-tester@tripjam.app",
    password: "qaTest123!",
  });
  const me = (await sb.auth.getUser()).data.user!.id;
  const { data: trips } = await sb
    .from("trips")
    .select("id")
    .ilike("name", "Tokyo to Kyoto Classic%")
    .eq("created_by", me)
    .not("ig_response", "is", null)
    .limit(1);
  const tripId = trips?.[0]?.id;
  test.skip(!tripId, "QA trip not found");

  const { data: dayRows } = await sb
    .from("days")
    .select("id, label, city, wishlist, position")
    .eq("trip_id", tripId)
    .order("position")
    .limit(1);
  const day = dayRows?.[0];
  test.skip(!day, "No days on QA trip");
  const { data: acts } = await sb
    .from("activities")
    .select("id, title, position")
    .eq("day_id", day!.id)
    .order("position");
  test.skip(!acts?.length, "No activities on day 1");
  const anchor = acts![0];
  const existingTitle = acts![acts!.length - 1].title;
  const originalWishlist = day!.wishlist ?? null;

  const gems = [
    {
      id: "e2e-gem-inline",
      title: "E2E Hidden Teahouse",
      geocode: "Senso-ji Temple Tokyo",
      near: anchor.title,
    },
    {
      id: "e2e-gem-orphan",
      title: "E2E Orphan Bathhouse",
      geocode: "Shinjuku Tokyo",
      near: "Nonexistent Anchor XYZ",
    },
    {
      id: "e2e-gem-dupe",
      title: existingTitle, // equals an activity title → must be hidden
      geocode: "Tokyo",
      near: anchor.title,
    },
  ];

  let insertedActivityId: string | null = null;
  try {
    const { error: seedErr } = await sb
      .from("days")
      .update({ wishlist: gems })
      .eq("id", day!.id);
    expect(seedErr).toBeNull();

    await login(page);
    // Force Plan mode (trips default to Story, which has no gems) before
    // the trip loads — the app reads this per-trip localStorage key.
    await page.evaluate(
      (k) => localStorage.setItem(k, "plan"),
      `tripjam_itin_mode_${tripId}`,
    );
    await page.goto(`/trip/${tripId}`);
    await page.waitForTimeout(2500);
    await dismissTripOverlays(page, 2000);

    // Land on the Itinerary tab (trips can open on Inspirations).
    await page
      .locator("button:visible", { hasText: /Itinerary/ })
      .first()
      .click();
    await page.waitForTimeout(1000);
    // Days start in compact view (no gems there). canExpand requires
    // detailedReady — the Story toggle appears exactly then. DayCompact's
    // header onClick lives on the cursor:pointer div above the "Day 1"
    // pill, so click that ancestor.
    await page
      .getByRole("button", { name: "✦ Story" })
      .waitFor({ state: "visible", timeout: 30000 });
    await page
      .locator(`div:text-is("${day!.label}")`)
      .first()
      .evaluate((el) => {
        let node: HTMLElement | null = el as HTMLElement;
        while (node && node.style?.cursor !== "pointer")
          node = node.parentElement;
        node?.click();
      });
    await page.waitForTimeout(1000);

    // Inline gem renders under its anchor with the suggestion affordances
    await expect(page.getByText("E2E Hidden Teahouse")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("✨ nearby").first()).toBeVisible();
    // Orphan gem renders in the strip
    await expect(page.getByText("✨ Also nearby")).toBeVisible();
    await expect(page.getByText("E2E Orphan Bathhouse")).toBeVisible();
    // Dedupe: the duplicate-title gem must not render a second copy
    await expect(page.getByText(existingTitle, { exact: true })).toHaveCount(1);

    // + Add → direct insert after the anchor
    await jsClick(page.getByRole("button", { name: "+ Add" }).first());
    await expect(page.getByText("E2E Hidden Teahouse")).toHaveCount(1, {
      timeout: 20000,
    });
    // DB: activity exists, untimed, ✨, right after the anchor; positions 0..n
    await expect
      .poll(
        async () => {
          const { data: after } = await sb
            .from("activities")
            .select("id, title, position, time, icon")
            .eq("day_id", day!.id)
            .order("position");
          const inserted = (after || []).find(
            (a: any) => a.title === "E2E Hidden Teahouse",
          );
          if (!inserted) return "missing";
          insertedActivityId = inserted.id;
          const positions = (after || []).map((a: any) => a.position);
          const contiguous = positions.every((p: number, i: number) => p === i);
          const anchorPos = (after || []).find(
            (a: any) => a.id === anchor.id,
          )?.position;
          return [
            inserted.icon === "✨",
            inserted.time == null,
            contiguous,
            inserted.position === (anchorPos ?? -99) + 1,
          ].join(",");
        },
        { timeout: 20000 },
      )
      .toBe("true,true,true,true");
    // Gem retired as promoted
    const { data: dAfterAdd } = await sb
      .from("days")
      .select("wishlist")
      .eq("id", day!.id)
      .single();
    const promoted = (dAfterAdd!.wishlist || []).find(
      (w: any) => w.id === "e2e-gem-inline",
    );
    expect(promoted?.dismissed).toBe(true);
    expect(promoted?.promoted).toBe(true);

    // Dismiss the orphan via its ⋯ menu
    await jsClick(page.getByLabel("Gem options").last());
    await jsClick(page.getByRole("button", { name: /✕ Dismiss/ }));
    await expect(page.getByText("E2E Orphan Bathhouse")).not.toBeVisible();
    await expect
      .poll(async () => {
        const { data: dAfter } = await sb
          .from("days")
          .select("wishlist")
          .eq("id", day!.id)
          .single();
        return (dAfter!.wishlist || []).find(
          (w: any) => w.id === "e2e-gem-orphan",
        )?.dismissed;
      })
      .toBe(true);
  } finally {
    if (insertedActivityId)
      await sb.from("activities").delete().eq("id", insertedActivityId);
    // Restore original positions implicitly harmless (sort survives gaps);
    // restore the original wishlist.
    await sb
      .from("days")
      .update({ wishlist: originalWishlist })
      .eq("id", day!.id);
  }
});

// Expander ("＋N more nearby") + strip-menu hit-test regression: the strip
// ⋯ menu was originally clipped by its overflow-x container (review B1);
// TRUSTED clicks (not JS clicks) prove the fixed-position menu is actually
// hittable in a real browser.
test("gems: inline expander caps at 2, strip menu is hit-testable", async ({
  page,
}) => {
  test.setTimeout(150000);
  page.setDefaultTimeout(20000);
  const env: Record<string, string> = {};
  const raw = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", ".env"),
    "utf8",
  );
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sb.auth.signInWithPassword({
    email: "qa-tester@tripjam.app",
    password: "qaTest123!",
  });
  const me = (await sb.auth.getUser()).data.user!.id;
  const { data: trips } = await sb
    .from("trips")
    .select("id")
    .ilike("name", "Tokyo to Kyoto Classic%")
    .eq("created_by", me)
    .not("ig_response", "is", null)
    .limit(1);
  const tripId = trips?.[0]?.id;
  test.skip(!tripId, "QA trip not found");
  const { data: dayRows } = await sb
    .from("days")
    .select("id, label, city, wishlist, position")
    .eq("trip_id", tripId)
    .order("position")
    .limit(1);
  const day = dayRows?.[0];
  const { data: acts } = await sb
    .from("activities")
    .select("id, title")
    .eq("day_id", day!.id)
    .order("position");
  const anchor = acts![0];
  const originalWishlist = day!.wishlist ?? null;

  const gems = [1, 2, 3].map((n) => ({
    id: `e2e-exp-${n}`,
    title: `E2E Anchored Gem ${n}`,
    geocode: "Tokyo",
    near: anchor.title,
  }));
  gems.push({
    id: "e2e-exp-orphan",
    title: "E2E Strip Menu Gem",
    geocode: "Tokyo",
    near: "No Such Anchor QQ",
  });

  try {
    await sb.from("days").update({ wishlist: gems }).eq("id", day!.id);
    await login(page);
    await page.evaluate(
      (k) => localStorage.setItem(k, "plan"),
      `tripjam_itin_mode_${tripId}`,
    );
    await page.goto(`/trip/${tripId}`);
    await page.waitForTimeout(2500);
    await dismissTripOverlays(page, 2000);
    await page
      .locator("button:visible", { hasText: /Itinerary/ })
      .first()
      .click();
    await page.waitForTimeout(1000);
    await page
      .getByRole("button", { name: "✦ Story" })
      .waitFor({ state: "visible", timeout: 30000 });
    await page
      .locator(`div:text-is("${day!.label}")`)
      .first()
      .evaluate((el) => {
        let node: HTMLElement | null = el as HTMLElement;
        while (node && node.style?.cursor !== "pointer")
          node = node.parentElement;
        node?.click();
      });
    await page.waitForTimeout(1000);

    // Cap at 2 inline + expander reveals the third
    await expect(page.getByText("E2E Anchored Gem 1")).toBeVisible();
    await expect(page.getByText("E2E Anchored Gem 2")).toBeVisible();
    await expect(page.getByText("E2E Anchored Gem 3")).not.toBeVisible();
    const expander = page.getByText("＋1 more nearby");
    await expect(expander).toBeVisible();
    await expander.evaluate((el) => (el as HTMLElement).click());
    await expect(page.getByText("E2E Anchored Gem 3")).toBeVisible();

    // Strip menu regression (review B1): REAL clicks must land — a menu
    // clipped by the strip's overflow container would fail hit-testing.
    const stripDots = page.getByLabel("Gem options").last();
    await stripDots.evaluate((el) =>
      el.scrollIntoView({ block: "center", inline: "center" }),
    );
    await page.waitForTimeout(400);
    await stripDots.click(); // trusted click
    const dismissItem = page.getByRole("button", { name: /✕ Dismiss/ });
    await expect(dismissItem).toBeVisible();
    const box = await dismissItem.boundingBox();
    expect(box).not.toBeNull();
    const vp = page.viewportSize()!;
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height);
    await dismissItem.click(); // trusted click on the fixed-position menu
    await expect(page.getByText("E2E Strip Menu Gem")).not.toBeVisible();
    await expect
      .poll(async () => {
        const { data: dAfter } = await sb
          .from("days")
          .select("wishlist")
          .eq("id", day!.id)
          .single();
        return (dAfter!.wishlist || []).find(
          (w: any) => w.id === "e2e-exp-orphan",
        )?.dismissed;
      })
      .toBe(true);
  } finally {
    await sb
      .from("days")
      .update({ wishlist: originalWishlist })
      .eq("id", day!.id);
  }
});
