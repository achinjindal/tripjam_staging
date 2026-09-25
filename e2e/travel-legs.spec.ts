import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { login, dismissTripOverlays } from "./helpers";

// Email P3: booked travel legs (trips.travel_data). Seeds legs directly as
// the qa user (RLS-scoped), then asserts the Travel card renders them
// route-first, the cancelled toggle works, remove persists, and the
// Add-a-booking sheet opens with both options. Reuses the qa-tester built
// trip "Tokyo to Kyoto Classic" — no RG/IG, no LLM calls.
test("travel legs: seeded legs render, remove persists, add-booking sheet opens", async ({
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
    .select("id, start_date, end_date, travel_data")
    .ilike("name", "Tokyo to Kyoto Classic%")
    .eq("created_by", me)
    .not("ig_response", "is", null)
    .limit(1);
  const trip = trips?.[0];
  test.skip(!trip, "QA trip not found");
  const originalLegs = trip!.travel_data ?? null;

  const legs = [
    {
      id: "e2e-leg-1",
      kind: "flight",
      carrier: "QA Air",
      number: "QA 101",
      date: trip!.start_date,
      depart_time: "08:15",
      arrive_time: "10:25",
      from: "Testville (TST)",
      to: "Tokyo (HND)",
      confirmation: "E2E7Q1",
      class: "",
      status: "booked",
      via: "email",
      created_at: new Date().toISOString(),
    },
    {
      id: "e2e-leg-2",
      kind: "train",
      carrier: "QA Express",
      number: "9999",
      date: trip!.end_date,
      depart_time: "16:25",
      arrive_time: "18:40",
      from: "Alpha Central",
      to: "Beta Terminal",
      confirmation: "E2ERAIL01",
      class: "First",
      status: "cancelled",
      via: "upload",
      created_at: new Date().toISOString(),
    },
  ];

  try {
    const { error: seedErr } = await sb
      .from("trips")
      .update({ travel_data: legs })
      .eq("id", trip!.id);
    expect(seedErr).toBeNull();

    await login(page);
    await page.goto(`/trip/${trip!.id}`);
    await page.waitForTimeout(2500);
    await dismissTripOverlays(page, 2000);
    await page.locator("button:visible", { hasText: /Board/ }).first().click();
    await page.waitForTimeout(800);
    await page.getByText("Travel & Hotels").first().click();
    await page.waitForTimeout(800);

    // Booked leg renders route-first with meta + ref
    await expect(page.getByText("Booked legs")).toBeVisible();
    await expect(page.getByText("Testville")).toBeVisible();
    await expect(page.getByText(/QA Air QA 101/)).toBeVisible();
    await expect(page.getByText(/REF E2E7Q1/)).toBeVisible();

    // Cancelled leg is hidden behind the toggle
    await expect(page.getByText("Alpha Central")).not.toBeVisible();
    await page.getByText(/show cancelled \(1\)/).click();
    await expect(page.getByText("Alpha Central")).toBeVisible();
    await expect(page.getByText(/Cancelled ·/)).toBeVisible();

    // Add-a-booking sheet: chooser shows both options + trip address
    await page.getByText("＋ Add a booking").click();
    await expect(
      page.getByText("Add a booking", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Forward the confirmation email"),
    ).toBeVisible();
    await expect(page.getByText("Upload a screenshot or PDF")).toBeVisible();
    await page.getByText("Cancel", { exact: true }).click();
    await expect(
      page.getByText("Forward the confirmation email"),
    ).not.toBeVisible();

    // Remove the cancelled leg (renders last) → persists to DB
    await page.getByLabel("Leg options").last().click();
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await page.waitForTimeout(300);
    // Confirm sheet's own Remove button
    await page
      .getByRole("button", { name: "Remove", exact: true })
      .last()
      .click();
    await page.waitForTimeout(1200);
    const { data: after } = await sb
      .from("trips")
      .select("travel_data")
      .eq("id", trip!.id)
      .single();
    const remaining = (after!.travel_data || []).map((l: any) => l.id);
    expect(remaining).toContain("e2e-leg-1");
    expect(remaining).not.toContain("e2e-leg-2");
  } finally {
    await sb
      .from("trips")
      .update({ travel_data: originalLegs })
      .eq("id", trip!.id);
  }
});
