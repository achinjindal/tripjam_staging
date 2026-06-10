#!/usr/bin/env node
/**
 * Feature 8 backfill: populate lat/lng for existing activities.
 *
 * Strategy: call the existing `places-proxy?action=geocode` endpoint (Photon + Nominatim,
 * no Google calls). Activities that Photon can't resolve are left null — users can fix
 * on-demand via the "Fix location" button (post-launch).
 *
 * Usage:
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
 *   node scripts/backfill-activity-geocodes.cjs [--env=staging|prod] [--dry-run] [--limit=N]
 *
 * Examples:
 *   # Dry run on staging (just print what would happen)
 *   SUPABASE_URL=https://wlrzvwjdrjpfqcwgmzch.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJh... \
 *   node scripts/backfill-activity-geocodes.cjs --env=staging --dry-run --limit=20
 *
 *   # Full run on staging
 *   ... node scripts/backfill-activity-geocodes.cjs --env=staging
 *
 *   # Full run on prod
 *   ... node scripts/backfill-activity-geocodes.cjs --env=prod
 */

const args = process.argv.slice(2);
const env = (args.find((a) => a.startsWith("--env=")) || "--env=staging").split(
  "=",
)[1];
const dryRun = args.includes("--dry-run");
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : null;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    "ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars required",
  );
  process.exit(1);
}

const PROXY_URL = `${SUPABASE_URL}/functions/v1/places-proxy?action=geocode`;
const REST_URL = `${SUPABASE_URL}/rest/v1`;
const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

const BATCH_SIZE = 50;
const STAGGER_MS = 200; // between activities within a batch (Photon courtesy)
const BATCH_PAUSE_MS = 1000; // between batches

const stats = { processed: 0, resolved: 0, skipped: 0, failed: 0 };

async function fetchActivitiesNeedingGeocode() {
  // Join via PostgREST embedded resource. Order by id for stable pagination.
  let url = `${REST_URL}/activities?lat=is.null&lng=is.null&select=id,title,geocode,type,day_id,days(city)&order=id`;
  if (limit) url += `&limit=${limit}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok)
    throw new Error(
      `Failed to fetch activities: ${res.status} ${await res.text()}`,
    );
  return await res.json();
}

async function geocodeOne(activity) {
  const city = activity.days?.city || null;
  const q = activity.geocode || activity.title;
  if (!q) {
    stats.skipped++;
    return { ok: false, reason: "no q" };
  }
  try {
    const res = await fetch(PROXY_URL, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ q, city }),
    });
    if (!res.ok) {
      stats.failed++;
      return { ok: false, reason: `proxy ${res.status}` };
    }
    const data = await res.json();
    if (data.lat == null || data.lng == null) {
      stats.skipped++;
      return { ok: false, reason: "no result" };
    }
    return { ok: true, lat: data.lat, lng: data.lng };
  } catch (e) {
    stats.failed++;
    return { ok: false, reason: e.message };
  }
}

async function updateActivity(id, lat, lng) {
  const res = await fetch(`${REST_URL}/activities?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...HEADERS, Prefer: "return=minimal" },
    body: JSON.stringify({
      lat,
      lng,
      geocode_source: "photon",
      geocode_confidence: "medium",
    }),
  });
  if (!res.ok) {
    stats.failed++;
    console.warn(`  ! UPDATE failed for ${id}: ${res.status}`);
    return false;
  }
  stats.resolved++;
  return true;
}

async function processBatch(batch, batchNum, totalBatches) {
  console.log(
    `\n[batch ${batchNum}/${totalBatches}] processing ${batch.length} activities...`,
  );
  for (const activity of batch) {
    stats.processed++;
    const result = await geocodeOne(activity);
    if (result.ok) {
      if (dryRun) {
        console.log(
          `  ✓ ${activity.id} "${(activity.title || "").slice(0, 40)}" → ${result.lat.toFixed(4)},${result.lng.toFixed(4)} [DRY-RUN]`,
        );
        stats.resolved++; // count it as resolved-would-have-been
      } else {
        const ok = await updateActivity(activity.id, result.lat, result.lng);
        if (ok)
          console.log(
            `  ✓ ${activity.id} "${(activity.title || "").slice(0, 40)}" → ${result.lat.toFixed(4)},${result.lng.toFixed(4)}`,
          );
      }
    } else {
      console.log(
        `  - ${activity.id} "${(activity.title || "").slice(0, 40)}" skipped: ${result.reason}`,
      );
    }
    if (STAGGER_MS > 0) await new Promise((r) => setTimeout(r, STAGGER_MS));
  }
}

async function main() {
  console.log(`=== Activity geocode backfill ===`);
  console.log(`Env: ${env}`);
  console.log(`Supabase: ${SUPABASE_URL}`);
  console.log(`Mode: ${dryRun ? "DRY RUN" : "WRITE"}`);
  console.log(`Limit: ${limit ?? "none"}`);
  console.log(
    `Batch size: ${BATCH_SIZE}, stagger: ${STAGGER_MS}ms, batch pause: ${BATCH_PAUSE_MS}ms`,
  );
  console.log("");

  console.log("Fetching activities needing geocoding...");
  const activities = await fetchActivitiesNeedingGeocode();
  console.log(`Found ${activities.length} activities without lat/lng.\n`);

  if (activities.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const startedAt = Date.now();
  const totalBatches = Math.ceil(activities.length / BATCH_SIZE);
  for (let i = 0; i < activities.length; i += BATCH_SIZE) {
    const batch = activities.slice(i, i + BATCH_SIZE);
    await processBatch(batch, Math.floor(i / BATCH_SIZE) + 1, totalBatches);
    if (i + BATCH_SIZE < activities.length) {
      await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
    }
  }
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n=== Done in ${elapsedSec}s ===`);
  console.log(`Processed: ${stats.processed}`);
  console.log(`Resolved (would-be):  ${stats.resolved}`);
  console.log(`Skipped (no result):  ${stats.skipped}`);
  console.log(`Failed:               ${stats.failed}`);
  console.log(
    `\nResolution rate: ${((stats.resolved / stats.processed) * 100).toFixed(1)}%`,
  );
  console.log(
    `Remaining un-geocoded after run: ${stats.processed - stats.resolved}`,
  );
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
