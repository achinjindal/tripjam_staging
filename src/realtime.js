// Collaboration realtime — Phase 0b scaffold.
//
// One Supabase realtime channel per open trip. Ships DARK: gated behind
// VITE_REALTIME_ENABLED (default off), so `subscribeTrip` is a no-op until
// Phase 2 turns live sync on. RLS is enforced on realtime rows, so a subscriber
// only receives changes for trips they're a member of.
//
// Merge policy (applied by the caller's handlers, see App.jsx):
//   - append for chat / activity feed / polls
//   - last-write-wins for days / activities (already the edit model)
//
// NOTE: only tables that carry a `trip_id` column can be server-filtered by trip.
// `activities` (day_id), `poll_votes` (poll_id) and `comments` (entity_id) are
// parent-scoped and will be wired in Phase 2 via their parent rows — deliberately
// omitted here so the scaffold stays correct rather than over-broad.

import { supabase } from "./supabase";

export const REALTIME_ENABLED =
  import.meta.env.VITE_REALTIME_ENABLED === "true";

const TRIP_SCOPED_TABLES = ["days", "trip_messages", "activity_log", "polls"];

/**
 * Subscribe to collaboration changes for one trip.
 * @param {string} tripId
 * @param {Record<string, (payload: object) => void>} handlers - keyed by table name
 * @returns {() => void} unsubscribe (safe no-op when disabled)
 */
export function subscribeTrip(tripId, handlers = {}) {
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
  });

  return () => {
    supabase.removeChannel(channel);
  };
}
