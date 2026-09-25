import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Share flow: trips.share_token → /share/:token renders the read-only
// public view WITHOUT auth; revoking the token kills the link. The
// url-routing spec only covers a bogus token — this covers the real loop.
test("share link: public view renders unauthenticated, revocation kills it", async ({
  browser,
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
    .select("id, name, share_token")
    .ilike("name", "Tokyo to Kyoto Classic%")
    .eq("created_by", me)
    .not("ig_response", "is", null)
    .limit(1);
  const trip = trips?.[0];
  test.skip(!trip, "QA trip not found");
  const originalToken = trip!.share_token ?? null;
  const token = randomUUID();

  // Fresh context with NO auth — the whole point of a share link.
  const anonCtx = await browser.newContext();
  const page = await anonCtx.newPage();
  try {
    const { error: setErr } = await sb
      .from("trips")
      .update({ share_token: token })
      .eq("id", trip!.id);
    expect(setErr).toBeNull();

    await page.goto(`/share/${token}`);
    // Public view renders the trip: name, day content, and the TripJam CTA
    await expect(page.getByText(trip!.name.split("·")[0].trim())).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByText(/Day 1/).first()).toBeVisible();
    await expect(page.getByText(/Try TripJam/)).toBeVisible();
    // Read-only: no owner-side controls
    await expect(page.getByText("Save and update itinerary")).toHaveCount(0);
    await expect(
      page.locator("button", { hasText: /^＋ Invite$/ }),
    ).toHaveCount(0);

    // Revoke → link dies
    await sb.from("trips").update({ share_token: null }).eq("id", trip!.id);
    await page.goto(`/share/${token}`);
    await expect(page.getByText("Trip not found")).toBeVisible({
      timeout: 15000,
    });
  } finally {
    await sb
      .from("trips")
      .update({ share_token: originalToken })
      .eq("id", trip!.id);
    await anonCtx.close();
  }
});
