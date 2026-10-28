import { test, expect, Page } from "@playwright/test";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import { login, dismissTripOverlays } from "./helpers";

// Only the owner can create or revoke the public view-only link
// (trips_protect_owner_columns rejects anyone else's share_token change). The
// share sheet used to offer both to co-travellers and fail silently; now a
// co-traveller sees the link only once it exists, and never Revoke.

const OWNER = "qa-tester";
const MEMBER = "collab-e2e-b";
const PASSWORD = "qaTest123!";

function readEnv() {
  const here = dirname(fileURLToPath(import.meta.url));
  let url = process.env.VITE_SUPABASE_URL || "";
  let anon = process.env.VITE_SUPABASE_ANON_KEY || "";
  let invite = process.env.VITE_INVITE_ENABLED || "";
  try {
    for (const line of readFileSync(join(here, "..", ".env"), "utf8").split(
      "\n",
    )) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const v = m[2].replace(/^["']|["']$/g, "");
      if (m[1] === "VITE_SUPABASE_URL" && !url) url = v;
      if (m[1] === "VITE_SUPABASE_ANON_KEY" && !anon) anon = v;
      if (m[1] === "VITE_INVITE_ENABLED" && !invite) invite = v;
    }
  } catch {
    /* fall back to process.env */
  }
  return { url, anon, inviteEnabled: invite === "true" };
}
const ENV = readEnv();

async function signedClient(username: string): Promise<SupabaseClient | null> {
  if (!ENV.url || !ENV.anon) return null;
  const sb = createClient(ENV.url, ENV.anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await sb.auth.signInWithPassword({
    email: `${username}@tripjam.app`,
    password: PASSWORD,
  });
  return error ? null : sb;
}

async function openShareSheet(page: Page, tripId: string) {
  for (const fn of ["generate-brainstorm", "generate-itinerary"])
    await page.route(`**/functions/v1/${fn}`, (r) =>
      r.fulfill({ status: 500, body: "{}" }),
    );
  await page.goto(`/trip/${tripId}`);
  await dismissTripOverlays(page, 4000);
  await page.getByRole("button", { name: /Share/ }).first().click();
  await expect(page.getByText("Invite to plan together")).toBeVisible({
    timeout: 10000,
  });
}

test.describe("Share link is owner-managed", () => {
  test.skip(!ENV.inviteEnabled, "VITE_INVITE_ENABLED not true");
  test.setTimeout(120000);

  let owner: SupabaseClient | null = null;
  let member: SupabaseClient | null = null;
  let tripId = "";

  test.beforeAll(async () => {
    owner = await signedClient(OWNER);
    member = await signedClient(MEMBER);
    if (!owner || !member) return;
    const ownerId = (await owner.auth.getUser()).data.user?.id as string;
    tripId = randomUUID();
    const { error } = await owner.from("trips").insert({
      id: tripId,
      name: "ZZ share owner fixture",
      destination: "Probe",
      start_date: "2026-12-01",
      end_date: "2026-12-02",
      created_by: ownerId,
      owner_id: ownerId,
      ig_response: { name: "ZZ share owner fixture" },
    });
    if (error) throw error;
    await owner
      .from("trip_members")
      .insert({ trip_id: tripId, user_id: ownerId, role: "edit" });
    const { error: daysErr } = await owner.rpc("replace_trip_days", {
      p_trip: tripId,
      p_days: [
        { label: "Day 1", city: "Probe", activities: [{ title: "Kept" }] },
      ],
    });
    if (daysErr) throw daysErr;
    const { data: token } = await owner.rpc("create_or_get_invite_link", {
      p_trip: tripId,
    });
    const { error: joinErr } = await member.rpc("accept_invite", {
      p_token: token,
    });
    if (joinErr) throw joinErr;
  });

  test.afterAll(async () => {
    if (!tripId) return;
    await member?.rpc("leave_trip", { p_trip: tripId });
    await owner?.rpc("delete_trip", { p_trip: tripId });
  });

  test("co-traveller: no link to create, and no Revoke once one exists", async ({
    page,
  }) => {
    test.skip(!tripId, "fixture setup failed");
    await login(page, MEMBER);
    await openShareSheet(page, tripId);
    await expect(page.getByText("Share a view-only link")).toHaveCount(0);

    // Once the owner has made a link, the co-traveller can pass it on.
    const { error } = await owner!
      .from("trips")
      .update({ share_token: randomUUID() })
      .eq("id", tripId);
    expect(error).toBeNull();
    await openShareSheet(page, tripId);
    await expect(page.getByText("Share a view-only link")).toBeVisible();
    await expect(page.getByText("Revoke share link")).toHaveCount(0);
  });

  test("owner: creates the link and can revoke it", async ({ page }) => {
    test.skip(!tripId, "fixture setup failed");
    await owner!.from("trips").update({ share_token: null }).eq("id", tripId);
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript(() => {
      // Desktop Chromium path: no Web Share sheet, so the link is copied.
      Object.defineProperty(navigator, "share", { value: undefined });
    });
    await login(page, OWNER);
    await openShareSheet(page, tripId);
    await expect(page.getByText("Revoke share link")).toHaveCount(0);
    await page.getByText("Share a view-only link").click();
    await expect(page.getByText("Link copied")).toBeVisible({ timeout: 10000 });
    const { data } = await owner!
      .from("trips")
      .select("share_token")
      .eq("id", tripId)
      .single();
    expect(data?.share_token).toBeTruthy();

    await openShareSheet(page, tripId);
    await page.getByText("Revoke share link").click();
    await page.getByRole("button", { name: "Revoke link" }).click();
    await expect(page.getByText("Share link revoked")).toBeVisible({
      timeout: 10000,
    });
    const { data: after } = await owner!
      .from("trips")
      .select("share_token")
      .eq("id", tripId)
      .single();
    expect(after?.share_token).toBeNull();
  });
});
