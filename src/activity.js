// Collaboration activity log — Phase 0b.
//
// Fire-and-forget change logger. Every mutating user action calls `logActivity`,
// which writes one row to the `activity_log` table (who / what / when / why + an
// optional undo payload). This drives the Phase-3 activity feed and the
// "while you were away" summary.
//
// Design rules:
//   - NEVER blocks or breaks the mutation it accompanies — all failures are swallowed.
//   - Backend RLS gates the insert to trip members/owner, so on a solo trip it just
//     logs the owner's own actions, and for non-members it silently no-ops.
//   - Solo trips log too (cheap; seeds the feed the moment a trip becomes shared).

import { supabase } from "./supabase";

// Cache the current auth user id so callers that don't already have `session`
// (e.g. BoardView's tab sub-components) don't have to prop-drill it.
let _cachedUserId = null;
async function resolveUserId() {
  if (_cachedUserId) return _cachedUserId;
  try {
    const { data } = await supabase.auth.getSession();
    _cachedUserId = data?.session?.user?.id || null;
  } catch {
    _cachedUserId = null;
  }
  return _cachedUserId;
}

/**
 * @param {object} p
 * @param {string} p.tripId       - the trip the change belongs to (required)
 * @param {string} [p.userId]     - acting user's id; resolved from the session if omitted
 * @param {string} p.action       - short verb key, e.g. "update_day", "add_todo", "remove_activity"
 * @param {string} [p.entityType] - "day" | "activity" | "todo" | "expense" | "bookmark" | "trip" | ...
 * @param {string} [p.entityId]   - the affected entity's id
 * @param {string} [p.summary]    - human-readable sentence for the feed, e.g. 'Edited "Senso-ji"'
 * @param {object} [p.undoPayload]- prior state needed to reverse the change (Phase-3 undo)
 */
export async function logActivity({
  tripId,
  userId,
  action,
  entityType = null,
  entityId = null,
  summary = null,
  undoPayload = null,
}) {
  if (!tripId || !action) return;
  try {
    const uid = userId || (await resolveUserId());
    if (!uid) return;
    await supabase.from("activity_log").insert({
      trip_id: tripId,
      user_id: uid,
      action,
      entity_type: entityType,
      entity_id: entityId,
      summary,
      undo_payload: undoPayload,
    });
  } catch (e) {
    // Logging must never surface to the user or interrupt the real mutation.
    if (import.meta.env.DEV) console.warn("logActivity failed (non-fatal):", e);
  }
}
