// Phase 5 — per-traveller preferences ("Your travel style").
//
// Each co-traveller writes a free-text style; Trippy reads all members' styles
// (via the group prompt) and plans for everyone. Members can read every row on
// the trip; each member writes only their own (RLS: "members read prefs" /
// "self writes prefs"). Gated behind INVITE_ENABLED at the call sites.

import { supabase } from "./supabase";

/** All members' preferences for a trip: [{ user_id, prefs_text, prefs_struct, updated_at }]. */
export async function fetchPreferences(tripId) {
  if (!tripId) return [];
  const { data, error } = await supabase
    .from("trip_preferences")
    .select("user_id, prefs_text, prefs_struct, updated_at")
    .eq("trip_id", tripId);
  if (error) {
    if (import.meta.env.DEV)
      console.warn("fetchPreferences failed:", error.message);
    return [];
  }
  return data || [];
}

/** Upsert the current user's own preference row (RLS enforces user_id = auth.uid()). */
export async function savePreferences(
  tripId,
  userId,
  prefsText,
  prefsStruct = null,
) {
  if (!tripId || !userId) return;
  const { error } = await supabase.from("trip_preferences").upsert(
    {
      trip_id: tripId,
      user_id: userId,
      prefs_text: prefsText,
      prefs_struct: prefsStruct,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "trip_id,user_id" },
  );
  if (error) throw error;
}

// ── WS5: quick tags ─────────────────────────────────────────────────────────

/** The fixed quick-tag set (label shown on the pill; stored as the label). */
export const STYLE_TAGS = [
  "🏖 Beaches",
  "🥾 Hikes",
  "🍜 Food",
  "🎨 Culture",
  "😌 Relaxed",
  "🌙 Nightlife",
];

/** Tags array from a preference row (defensive). */
export function styleTags(p) {
  const t = p?.prefs_struct?.tags;
  return Array.isArray(t) ? t.filter((x) => typeof x === "string") : [];
}

/** True when a row carries any style signal — free text OR tags. */
export function hasStyle(p) {
  return !!(p?.prefs_text?.trim() || styleTags(p).length);
}

/** Compose the LLM-facing style text: free text plus a tags suffix. */
export function styleTextOf(p) {
  const text = (p?.prefs_text || "").trim();
  const tags = styleTags(p);
  if (!text && !tags.length) return "";
  return [text, tags.length ? `Tags: ${tags.join(", ")}` : ""]
    .filter(Boolean)
    .join(" ");
}
