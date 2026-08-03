// Collaboration membership + invites — Phase 1 data layer.
//
// Thin wrappers over the trip_members table and the SECURITY DEFINER RPCs
// (accept_invite, create_or_get_invite_link, revoke_invite_link,
// get_invite_preview, transfer_ownership, remove_member, leave_trip).
// Gated in the UI behind VITE_INVITE_ENABLED so the whole feature ships dark.

import { supabase } from "./supabase";

export const INVITE_ENABLED = import.meta.env.VITE_INVITE_ENABLED === "true";

/** The join link a token maps to. */
export function joinUrl(token) {
  return `${window.location.origin}/join/${token}`;
}

/** Fetch a trip's members with their profile (username), owner first. */
export async function fetchMembers(tripId) {
  if (!tripId) return [];
  // Via RPC (not a direct embed): profiles RLS hides other users' rows, so a
  // client-side profiles(username) embed returns null for co-members and the
  // UI shows "Traveler". This SECURITY DEFINER RPC returns members enriched
  // with username only (never email/credits).
  const { data, error } = await supabase.rpc("list_trip_members", {
    p_trip: tripId,
  });
  if (error) {
    if (import.meta.env.DEV)
      console.warn("fetchMembers failed:", error.message);
    return [];
  }
  return data || [];
}

/** Create or reuse an invite link; returns the shareable /join URL. */
export async function getInviteUrl(tripId) {
  const { data, error } = await supabase.rpc("create_or_get_invite_link", {
    p_trip: tripId,
  });
  if (error) throw error;
  return joinUrl(data);
}

/** Revoke all invite links for a trip (owner only). */
export async function revokeInvite(tripId) {
  const { error } = await supabase.rpc("revoke_invite_link", {
    p_trip: tripId,
  });
  if (error) throw error;
}

/** Preview an invite (safe for a not-yet-member). Returns the preview object. */
export async function previewInvite(token) {
  const { data, error } = await supabase.rpc("get_invite_preview", {
    p_token: token,
  });
  if (error) throw error;
  return data;
}

/** Accept an invite; returns the trip_id joined. */
export async function acceptInvite(token) {
  const { data, error } = await supabase.rpc("accept_invite", {
    p_token: token,
  });
  if (error) throw error;
  return data;
}

/** Transfer ownership to another current member (owner only). */
export async function transferOwnership(tripId, newOwnerId) {
  const { error } = await supabase.rpc("transfer_ownership", {
    p_trip: tripId,
    p_new_owner: newOwnerId,
  });
  if (error) throw error;
}

/** Remove a member (owner only). */
export async function removeMember(tripId, userId) {
  const { error } = await supabase.rpc("remove_member", {
    p_trip: tripId,
    p_user: userId,
  });
  if (error) throw error;
}

/** Leave a trip. Returns "left" | "trip_deleted"; throws
 *  transfer_ownership_first if an owner must hand off first. */
export async function leaveTrip(tripId) {
  const { data, error } = await supabase.rpc("leave_trip", { p_trip: tripId });
  if (error) throw error;
  return data;
}

/** Human-friendly display name for a member row. */
export function memberName(m, selfId) {
  if (m.user_id === selfId) return "You";
  return m.profiles?.username || "Traveler";
}

// ── Account-targeted invites (hybrid with the link flow) ────────────────────

/** Invite a co-traveler by username or email (exact, case-insensitive).
 *  Returns { invite_id, username, already_invited }. Errors bubble so callers
 *  can map error.message codes (user_not_found / already_member / trip_full …)
 *  to toasts / inline hints. */
export async function inviteByHandle(tripId, handle) {
  const { data, error } = await supabase.rpc("invite_user_by_handle", {
    p_trip: tripId,
    p_handle: handle,
  });
  if (error) throw error;
  return data;
}

/** The current user's pending invites, enriched with trip + inviter info. */
export async function listPendingInvites() {
  const { data, error } = await supabase.rpc("list_pending_invites");
  if (error) {
    if (import.meta.env.DEV)
      console.warn("listPendingInvites failed:", error.message);
    return [];
  }
  return data || [];
}

/** Accept (true) or decline (false) a pending invite. Returns the joined
 *  trip_id on accept, null on decline. */
export async function respondInvite(inviteId, accept) {
  const { data, error } = await supabase.rpc("respond_invite", {
    p_invite: inviteId,
    p_accept: accept,
  });
  if (error) throw error;
  return data;
}

/** Cancel a pending invite (trip owner or original inviter). */
export async function cancelInvite(inviteId) {
  const { error } = await supabase.rpc("cancel_invite", { p_invite: inviteId });
  if (error) throw error;
}

/** A trip's pending invites (for the roster in MembersSheet), enriched with the
 *  invitee's username. Via SECURITY DEFINER RPC (profiles RLS hides other users'
 *  rows from a client-side embed). Members-only; returns [] on error. */
export async function fetchTripInvites(tripId) {
  if (!tripId) return [];
  const { data, error } = await supabase.rpc("list_trip_invites", {
    p_trip: tripId,
  });
  if (error) {
    if (import.meta.env.DEV)
      console.warn("fetchTripInvites failed:", error.message);
    return [];
  }
  return data || [];
}
