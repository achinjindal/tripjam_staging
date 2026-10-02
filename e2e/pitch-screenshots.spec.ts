/**
 * Pitch deck screenshots → pitch/screenshots/
 * Run: npx playwright test e2e/pitch-screenshots.spec.ts
 */
import { test, expect } from "@playwright/test";
import { login } from "./helpers";
import { readFileSync, mkdirSync } from "fs";
import * as path from "path";

const OUT_DIR = path.join(process.cwd(), "pitch", "screenshots");
const MOBILE = { width: 390, height: 844 };

test.use({ trace: "off" });

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const raw = readFileSync(path.join(process.cwd(), ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    /* optional */
  }
  return env;
}

async function getTripWithItinerary(
  page: import("@playwright/test").Page,
): Promise<string | null> {
  const env = loadEnv();
  const url = env.VITE_SUPABASE_URL;
  const anon = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;

  const token = await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (!k.includes("auth-token")) continue;
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const data = JSON.parse(raw);
        const t = data?.access_token ?? data?.currentSession?.access_token;
        if (t) return t;
      } catch {
        /* ignore */
      }
    }
    return null;
  });
  if (!token) return null;

  const res = await page.request.get(
    `${url}/rest/v1/trips?select=id,ig_response&order=updated_at.desc&limit=30`,
    {
      headers: {
        apikey: anon,
        Authorization: `Bearer ${token}`,
      },
    },
  );
  if (!res.ok()) return null;
  const rows = (await res.json()) as {
    id: string;
    ig_response: unknown;
  }[];
  const hit = rows.find((t) => t.ig_response != null);
  return hit?.id ?? null;
}

test.describe("Pitch deck screenshots", () => {
  test.setTimeout(120000);

  test("capture routes, itinerary, share from one trip", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await login(page);

    const tripId = await getTripWithItinerary(page);
    expect(tripId, "Need a trip with ig_response in staging DB").toBeTruthy();

    mkdirSync(OUT_DIR, { recursive: true });
    const snap = (name: string) =>
      page.screenshot({
        path: path.join(OUT_DIR, name),
        animations: "disabled",
      });

    // /trip/:id opens itinerary view (no tab click; labels include emoji)
    await page.goto(`/trip/${tripId}`);
    await expect(page.locator("text=/Day 1/i").first()).toBeVisible({
      timeout: 60000,
    });
    await expect(
      page.locator("text=/Hotel|Check in|Gracery/i").first(),
    ).toBeVisible({ timeout: 15000 });

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    await snap("02-itinerary.png");

    const shareBtn = page.locator("button", { hasText: /Share/i }).first();
    await expect(shareBtn).toBeVisible({ timeout: 10000 });
    await shareBtn.click();
    await expect(page.locator("text=/Share trip/i").first()).toBeVisible({
      timeout: 10000,
    });
    await page.waitForTimeout(400);
    await snap("03-share.png");

    // Reload itinerary (share sheet blocks header); then open routes
    await page.goto(`/trip/${tripId}`);
    await expect(page.locator("text=/Day 1/i").first()).toBeVisible({
      timeout: 60000,
    });

    const exploreBtn = page
      .locator("button", { hasText: /Explore Other Plans/i })
      .first();
    await expect(exploreBtn).toBeVisible({ timeout: 10000 });
    await exploreBtn.click();

    await expect(
      page
        .locator("button", { hasText: /^Select$/ })
        .or(page.locator("text=/P1|P2|P3|P4|Recommended|Build My Itinerary/i"))
        .first(),
    ).toBeVisible({ timeout: 45000 });

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    await snap("01-routes.png");
  });
});
