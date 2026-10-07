// Phase 3 — activity feed / "while you were away" / undo data layer.
//
// The `activity_log` table (member-read + author-write RLS, in the realtime
// publication) is written fire-and-forget by src/activity.js at every mutation.
// This module reads it for the feed, tracks the per-user read marker
// (trip_read_state) for "while you were away", and reverses a change via its
// stored undo_payload. All gated behind INVITE_ENABLED + shared-trip at the call
// sites. No LLM — undo just restores a snapshot.

import { supabase } from "./supabase";

// ── Feed reads ───────────────────────────────────────────────────────────────

/** Newest-first activity rows for a trip (member-read RLS). Actor names are
 *  resolved client-side from the members list (profiles RLS hides other users). */
export async function fetchActivity(tripId, { limit = 60 } = {}) {
  if (!tripId) return [];
  const { data, error } = await supabase
    .from("activity_log")
    .select(
      "id, trip_id, user_id, action, entity_type, entity_id, summary, undo_payload, created_at",
    )
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (import.meta.env.DEV)
      console.warn("fetchActivity failed:", error.message);
    return [];
  }
  return data || [];
}

/** The current user's last_seen_at for a trip (null if never seen). */
export async function fetchReadState(tripId, userId) {
  if (!tripId || !userId) return null;
  const { data } = await supabase
    .from("trip_read_state")
    .select("last_seen_at")
    .eq("trip_id", tripId)
    .eq("user_id", userId)
    .maybeSingle();
  return data?.last_seen_at || null;
}

/** Stamp last_seen_at = now() (opening the feed / dismissing the away sheet). */
export async function markSeen(tripId, userId) {
  if (!tripId || !userId) return;
  await supabase.from("trip_read_state").upsert(
    {
      trip_id: tripId,
      user_id: userId,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "trip_id,user_id" },
  );
}

/** Unseen count from already-loaded rows: newer than last_seen_at, not mine,
 *  and not an info-only 'undo' echo. Pure helper — no query. */
export function unseenCount(rows, lastSeenAt, selfId) {
  const since = lastSeenAt ? new Date(lastSeenAt).getTime() : 0;
  return (rows || []).filter(
    (r) =>
      r.user_id !== selfId &&
      r.action !== "undo" &&
      new Date(r.created_at).getTime() > since,
  ).length;
}

// ── Undo ─────────────────────────────────────────────────────────────────────

// Which actions carry a reversible undo_payload. Info rows (member_join,
// credits_topup) and the undo echo itself are never undoable.
const UNDOABLE = new Set([
  "update_day",
  "update_activity",
  "remove_activity",
  "add_todo",
  "remove_todo",
  "add_bookmark",
  "remove_bookmark",
  "add_expense",
  "remove_expense",
  "update_expense",
  "set_budget",
]);

export function isUndoable(row) {
  return UNDOABLE.has(row?.action) && row?.undo_payload != null;
}

// Whitelist an activity object (which may carry BOTH DB-shape and merged
// LLM-shape keys, e.g. geocode_end + geocodeEnd) down to the DB insert columns.
function activityInsertShape(a, dayId, i) {
  return {
    ...(a.id ? { id: a.id } : {}),
    day_id: dayId,
    time: a.time ?? null,
    title: a.title ?? null,
    geocode: a.geocode ?? null,
    geocode_end: a.geocode_end ?? a.geocodeEnd ?? null,
    type: a.type ?? null,
    duration: a.duration ?? null,
    note: a.note ?? null,
    confirmed: a.confirmed ?? false,
    icon: a.icon ?? null,
    package: a.package ?? null,
    position: a.position ?? i,
    added_by: a.added_by ?? null,
    photo_url: a.photo_url ?? null,
    transition_data: a.transition_data ?? a.transition ?? null,
    // Place + verification data: without these an undo brings activities
    // back with no coordinates (off the map, re-verified and re-billed).
    lat: a.lat ?? null,
    lng: a.lng ?? null,
    place_id: a.place_id ?? null,
    business_status: a.business_status ?? null,
    photo_query: a.photo_query ?? null,
    geocode_source: a.geocode_source ?? null,
    geocode_confidence: a.geocode_confidence ?? null,
    geocode_corrected_from: a.geocode_corrected_from ?? null,
    geocode_verified_at: a.geocode_verified_at ?? null,
    cost: a.cost ?? null,
    gloss: a.gloss ?? null,
    flagged: a.flagged ?? null,
  };
}

/** Restore a day's activities from a DB-shape snapshot (delete-then-reinsert).
 *  Standalone (NOT the LLM-shaped inline update_day path) so undo doesn't drop
 *  geocode_end / transition_data. Preserves the RLS-blocked-delete safety check. */
export async function restoreDayActivities(dayId, activities, wishlist) {
  const snapshot = activities || [];
  const { count: deleted } = await supabase
    .from("activities")
    .delete({ count: "exact" })
    .eq("day_id", dayId);
  // If there were rows to delete but RLS blocked it, don't reinsert (dup guard).
  const { count: remaining } = await supabase
    .from("activities")
    .select("id", { count: "exact", head: true })
    .eq("day_id", dayId);
  if (remaining && (deleted === null || deleted === 0)) {
    throw new Error("restore blocked (RLS) — skipped to avoid duplicates");
  }
  if (snapshot.length) {
    const rows = snapshot.map((a, i) => activityInsertShape(a, dayId, i));
    const { error } = await supabase.from("activities").insert(rows);
    if (error) throw error;
  }
  if (wishlist !== undefined) {
    await supabase
      .from("days")
      .update({ wishlist: wishlist ?? null })
      .eq("id", dayId);
  }
}

/** True if the entity was changed AFTER this logged change (best-effort R5
 *  divergence signal). Scoped to a real entity_id and non-undo rows; null-entity
 *  adds are non-conflicting by definition (undo just deletes the inserted id). */
export async function hasLaterEdit(row) {
  if (!row?.entity_id) return false;
  const { data } = await supabase
    .from("activity_log")
    .select("id")
    .eq("trip_id", row.trip_id)
    .eq("entity_id", row.entity_id)
    .neq("action", "undo")
    .gt("created_at", row.created_at)
    .limit(1);
  return (data || []).length > 0;
}

/**
 * Reverse a change from its undo_payload. Returns:
 *   { ok:true, entityType }            — applied
 *   { conflict:true }                  — entity changed since; caller confirms + retries force:true
 *   { ok:false, error }                — failed
 * Appending the action='undo' feed row + the toast are the caller's job (App has
 * member names + session, and the toast must not depend on the log write).
 */
export async function undoActivity(row, { force = false } = {}) {
  if (!isUndoable(row)) return { ok: false, error: "not undoable" };
  if (!force && (await hasLaterEdit(row))) return { conflict: true };

  const p = row.undo_payload || {};
  try {
    switch (row.action) {
      case "update_day":
        await restoreDayActivities(p.dayId, p.activities, p.wishlist);
        break;
      case "update_activity":
        if (p.activity?.id) {
          const { id, ...fields } = activityInsertShape(
            p.activity,
            p.activity.day_id,
            0,
          );
          await supabase.from("activities").update(fields).eq("id", id);
        }
        break;
      case "remove_activity":
        await supabase
          .from("activities")
          .insert(
            activityInsertShape(p.activity, p.dayId || p.activity?.day_id, 0),
          );
        break;
      case "add_todo":
        if (p.id) await supabase.from("trip_todos").delete().eq("id", p.id);
        break;
      case "remove_todo":
        if (p.todo) await supabase.from("trip_todos").insert(p.todo);
        break;
      case "add_bookmark":
        if (p.id) await supabase.from("trip_bookmarks").delete().eq("id", p.id);
        break;
      case "remove_bookmark":
        if (p.bookmark)
          await supabase.from("trip_bookmarks").insert(p.bookmark);
        break;
      case "add_expense":
        if (p.id) await supabase.from("trip_expenses").delete().eq("id", p.id);
        break;
      case "remove_expense":
        if (p.expense) await supabase.from("trip_expenses").insert(p.expense);
        break;
      case "update_expense":
        if (p.expense?.id) {
          const { id, created_at, ...fields } = p.expense;
          await supabase.from("trip_expenses").update(fields).eq("id", id);
        }
        break;
      case "set_budget":
        await supabase
          .from("trips")
          .update({ budget_amount: p.budget_amount ?? null })
          .eq("id", row.trip_id);
        break;
      default:
        return { ok: false, error: "no inverse" };
    }
  } catch (e) {
    return { ok: false, error: e?.message || "undo failed" };
  }
  return { ok: true, entityType: row.entity_type };
}
