// Collaboration realtime — Phase 2 live sync.
//
// One Supabase realtime channel per open trip. Gated behind
// VITE_REALTIME_ENABLED, so `subscribeTrip` is a no-op when off. RLS is enforced
// on realtime rows, so a subscriber only receives changes for trips they're a
// member of.
//
// Merge policy (applied by the caller's handlers, see App.jsx):
//   - append for chat / activity feed / polls
//   - patch-by-id (author-suppressed echo) for days / brainstorm_items
//   - members: refetch on any change
//
// NOTE: only tables that carry a `trip_id` column can be server-filtered by
// trip. `activities` (day_id) is parent-scoped — live activity sync is driven by
// the `days` channel: a DB trigger touches `days.updated_at` on any activity
// write, so the caller's `days` handler refetches that day's activities.
// `poll_votes` (poll_id) and `comments` (entity_id) are likewise deferred.

import { supabase } from "./supabase";

export const REALTIME_ENABLED =
  import.meta.env.VITE_REALTIME_ENABLED === "true";

const TRIP_SCOPED_TABLES = [
  "days",
  "trip_messages",
  "activity_log",
  "polls",
  "brainstorm_items",
  "trip_members",
  "trip_preferences",
  // Tier 2 board live-sync (REPLICA IDENTITY FULL so filtered DELETEs deliver).
  "trip_todos",
  "trip_expenses",
  "trip_bookmarks",
];

/**
 * Subscribe to collaboration changes for one trip.
 * @param {string} tripId
 * @param {Record<string, (payload: object) => void>} handlers - keyed by table name
 * @param {() => void} [onSubscribed] - called when the channel (re)connects
 *   (status SUBSCRIBED). postgres_changes does NOT replay missed events, so the
 *   caller should refetch/reconcile here (initial connect + every reconnect).
 * @returns {() => void} unsubscribe (safe no-op when disabled)
 */
export function subscribeTrip(tripId, handlers = {}, onSubscribed = null) {
  if (!REALTIME_ENABLED || !tripId) return () => {};

  const channel = supabase.channel(`trip:${tripId}`);
  for (const table of TRIP_SCOPED_TABLES) {
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table, filter: `trip_id=eq.${tripId}` },
      (payload) => {
        try {
          handlers[table]?.(payload);
        } catch (e) {
          if (import.meta.env.DEV)
            console.warn(`realtime handler for ${table} threw:`, e);
        }
      },
    );
  }
  channel.subscribe((status, err) => {
    if (import.meta.env.DEV)
      console.debug(
        `[realtime] channel trip:${tripId} → ${status}`,
        err ? err.message : "",
      );
    if (status === "SUBSCRIBED") {
      try {
        onSubscribed?.();
      } catch (e) {
        if (import.meta.env.DEV)
          console.warn("realtime onSubscribed threw:", e);
      }
    }
  });

  return () => {
    supabase.removeChannel(channel);
  };
}
