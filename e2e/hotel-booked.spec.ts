import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { login, dismissTripOverlays } from "./helpers";

// Travel & Hotels slice 2: booked state + confirmation, surfaced on the
// itinerary's hotel row (badge replaces the Check-rates link).
test("mark stay booked → persists, shows on itinerary, rates link gone", async ({
  page,
}) => {
  test.setTimeout(120000);
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
    .select("id, hotels_data")
    .ilike("name", "Tokyo to Kyoto Classic%")
    .eq("created_by", me)
    .not("ig_response", "is", null)
    .limit(1);
  const tripId = trips?.[0]?.id;
  test.skip(!tripId, "QA trip not found");
  const originalHotels = trips![0].hotels_data;

  try {
    await login(page);
    await page.goto(`/trip/${tripId}`);
    await page.waitForTimeout(2500);
    await dismissTripOverlays(page, 2000);
    await page.locator("button:visible", { hasText: /Board/ }).first().click();
    await page.waitForTimeout(800);
    await page.getByText("Travel & Hotels").first().click();
    await page.waitForTimeout(800);

    // Fill first hotel (suggestion chip or typed), mark booked + confirmation
    const chip = page.getByText(/From your itinerary:/).first();
    if (await chip.isVisible({ timeout: 3000 }).catch(() => false))
      await chip.click();
    const firstInput = page.locator("input[placeholder^='Hotel in']").first();
    if (!(await firstInput.inputValue()))
      await firstInput.fill("Test Hotel Shinjuku");
    await page.getByRole("button", { name: "Mark booked" }).first().click();
    await expect(page.getByText(/1 of \d+ booked/)).toBeVisible();
    await page
      .getByPlaceholder("Confirmation # (optional)")
      .first()
      .fill("QA-777");
    await page
      .getByRole("button", { name: /Save and update itinerary/ })
      .click();
    await expect(page.getByRole("button", { name: /✓ Saved/ })).toBeVisible({
      timeout: 15000,
    });

    // Persisted?
    const { data: after } = await sb
      .from("trips")
      .select("hotels_data")
      .eq("id", tripId)
      .single();
    const booked = (after!.hotels_data || []).find(
      (h: any) => h.status === "booked",
    );
    expect(booked).toBeTruthy();
    expect(booked.confirmation).toBe("QA-777");

    // Itinerary hotel row: booked badge, no rates link on that day
    await page
      .locator("button:visible", { hasText: /Itinerary/ })
      .first()
      .click();
    await page.waitForTimeout(1500);
    const planToggle = page.getByRole("button", { name: "Plan", exact: true });
    if (await planToggle.isVisible({ timeout: 2000 }).catch(() => false))
      await planToggle.click();
    await page.waitForTimeout(1000);
    // Compact row: inline booked marker, and no rates link on that row
    await expect(page.getByText("· ✓ booked").first()).toBeVisible({
      timeout: 10000,
    });
    // Expand Day 1 → full badge with confirmation
    await page.getByText(/Day 1/).first().click();
    await page.waitForTimeout(800);
    await expect(page.getByText("✓ Booked").first()).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByText("· #QA-777").first()).toBeVisible();
  } finally {
    await sb
      .from("trips")
      .update({ hotels_data: originalHotels })
      .eq("id", tripId)
      .select("id");
  }
});
