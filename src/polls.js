// Phase 6 — Polls / group decisions.
//
// Opt-in group decisions that don't block the unilateral-edit model. v1 scope:
// day / activity / freeform polls, single (radio) + approval (checkbox) modes.
// Polls are free — no LLM — except applying an anchored winner, which rides the
// existing Trippy chat/pool path (see App.jsx applyPollResult).
//
// Data model (tables already exist; RLS in 20260805000002):
//   polls        { id, trip_id, created_by, question, options[{id,label}], mode,
//                  entity_type, entity_id, status, resolved_option_id, closes_at,
//                  updated_at }
//   poll_votes   { poll_id, user_id, option_id }   -- PK(poll_id,user_id,option_id)
//   comments     { entity_id=poll_id, user_id, content, entity_type='poll' }  -- vote-notes
//
// Live tallies: a write to poll_votes/comments touches polls.updated_at (trigger),
// which fires the trip's `polls` realtime channel; the client reconciles the
// affected poll from the DB (see App.jsx). All gated behind INVITE_ENABLED +
// shared-trip checks at the call sites.

import { supabase } from "./supabase";

/**
 * All polls for a trip, each hydrated with its votes and vote-notes.
 * @returns {Promise<Array>} [{ ...poll, votes:[{user_id,option_id}], notes:[{user_id,content}] }]
 */
export async function fetchPolls(tripId) {
  if (!tripId) return [];
  const { data: polls, error } = await supabase
    .from("polls")
    .select(
      "id, trip_id, created_by, question, options, mode, entity_type, entity_id, status, resolved_option_id, closes_at, created_at, updated_at",
    )
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false });
  if (error) {
    if (import.meta.env.DEV) console.warn("fetchPolls failed:", error.message);
    return [];
  }
  const ids = (polls || []).map((p) => p.id);
  if (!ids.length) return [];

  const [{ data: votes }, { data: notes }] = await Promise.all([
    supabase
      .from("poll_votes")
      .select("poll_id, user_id, option_id")
      .in("poll_id", ids),
    supabase
      .from("comments")
      .select("entity_id, user_id, content")
      .eq("entity_type", "poll")
      .in("entity_id", ids),
  ]);

  return (polls || []).map((p) => ({
    ...p,
    votes: (votes || []).filter((v) => v.poll_id === p.id),
    notes: (notes || []).filter((n) => n.entity_id === p.id),
  }));
}

/** Re-fetch a single poll (votes + notes) — used by the realtime reconcile. */
export async function fetchPoll(pollId) {
  if (!pollId) return null;
  const { data: p, error } = await supabase
    .from("polls")
    .select(
      "id, trip_id, created_by, question, options, mode, entity_type, entity_id, status, resolved_option_id, closes_at, created_at, updated_at",
    )
    .eq("id", pollId)
    .maybeSingle();
  if (error || !p) return null;
  const [{ data: votes }, { data: notes }] = await Promise.all([
    supabase
      .from("poll_votes")
      .select("poll_id, user_id, option_id")
      .eq("poll_id", pollId),
    supabase
      .from("comments")
      .select("entity_id, user_id, content")
      .eq("entity_type", "poll")
      .eq("entity_id", pollId),
  ]);
  return { ...p, votes: votes || [], notes: notes || [] };
}

/**
 * Create a poll. options: [{id,label}] (ids are stable, never edited once votes
 * exist). entityType: 'day' | 'activity' | 'freeform'. Returns the inserted row.
 */
export async function createPoll({
  tripId,
  createdBy,
  question,
  options,
  mode = "single",
  entityType = "freeform",
  entityId = null,
  closesAt = null,
}) {
  const { data, error } = await supabase
    .from("polls")
    .insert({
      trip_id: tripId,
      created_by: createdBy,
      question,
      options,
      mode,
      entity_type: entityType,
      entity_id: entityId,
      status: "open",
      closes_at: closesAt,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Single-mode vote: replace the voter's choice. poll_votes has no unique key
 * that upsert could target for A→B (PK is the full 3-tuple), so delete-then-
 * insert (eng-review correction #2).
 */
export async function castVoteSingle(pollId, userId, optionId) {
  const del = await supabase
    .from("poll_votes")
    .delete()
    .eq("poll_id", pollId)
    .eq("user_id", userId);
  if (del.error) throw del.error;
  const { error } = await supabase
    .from("poll_votes")
    .insert({ poll_id: pollId, user_id: userId, option_id: optionId });
  if (error) throw error;
}

/** Approval-mode: toggle a single option row on/off for the voter. */
export async function toggleVoteApproval(
  pollId,
  userId,
  optionId,
  currentlyVoted,
) {
  if (currentlyVoted) {
    const { error } = await supabase
      .from("poll_votes")
      .delete()
      .eq("poll_id", pollId)
      .eq("user_id", userId)
      .eq("option_id", optionId);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("poll_votes")
      .insert({ poll_id: pollId, user_id: userId, option_id: optionId });
    if (error) throw error;
  }
}

/**
 * Set the voter's optional one-line note (one per voter per poll). Implemented as
 * delete-then-insert rather than upsert: the one-note guarantee is a *partial*
 * unique index (WHERE entity_type='poll'), which supabase-js upsert can't target
 * (ON CONFLICT can't name the partial predicate). The index still guards against
 * concurrent double-writes. Empty content just clears the note.
 */
export async function saveVoteNote(pollId, userId, content) {
  const del = await supabase
    .from("comments")
    .delete()
    .eq("entity_type", "poll")
    .eq("entity_id", pollId)
    .eq("user_id", userId);
  if (del.error) throw del.error;

  const trimmed = (content || "").trim();
  if (!trimmed) return;
  const { error } = await supabase
    .from("comments")
    .insert({
      entity_type: "poll",
      entity_id: pollId,
      user_id: userId,
      content: trimmed,
    });
  if (error) throw error;
}

/**
 * Close a poll (creator/owner only, enforced server-side). Idempotent: returns
 * { closed_now, status, winner, entity_type, entity_id }. Only the caller that
 * flips open→resolved gets closed_now=true and should apply the winner.
 */
export async function closePoll(pollId) {
  const { data, error } = await supabase.rpc("close_poll", { p_poll: pollId });
  if (error) throw error;
  return data;
}
