import { useEffect, useState, useSyncExternalStore } from "react";
import { supabase } from "./supabase";

// Master switch for the entire credits UX. Controls UI + paywall behavior;
// backend credit deduction in edge functions always runs regardless.
//
// Launched on 2026-05-27 with 300 free credits per signup
// (LAUNCH_PLAN D2 + handoff decision). At launch flip the prior env-aware
// guard `!__IS_PROD` (staging-only) was removed once Lemon Squeezy prod
// secrets + webhook + new-signup-default 300 + edge fn redeploys were
// all in place — RUNBOOKS "Prod credits launch" steps 1-4 complete.
export const CREDITS_UI_ENABLED = true;

// Display credits as whole integers to the user (D14). The backend stores
// NUMERIC(10,2); we render the floor so users always see "300" not "299.61".
// Admin / debug mode can show full precision via balance.toFixed(2).
export function displayCredits(balance) {
  if (balance == null || !Number.isFinite(Number(balance))) return 0;
  return Math.floor(Number(balance));
}

// Module-level credit store so every component can read the same balance
// without prop-drilling. Updated by refreshCredits() after each gated call.
let _balance = null;
const _listeners = new Set();
let _paywallReason = null;

function emit() {
  for (const l of _listeners) l();
}

export function getCredits() {
  return _balance;
}

export function setCredits(value) {
  _balance = value;
  emit();
}

export async function refreshCredits(userId) {
  if (!CREDITS_UI_ENABLED) return;
  if (!userId) return;
  const { data } = await supabase
    .from("profiles")
    .select("credits")
    .eq("id", userId)
    .maybeSingle();
  if (data) {
    _balance = data.credits;
    emit();
  }
}

export function useCredits() {
  return useSyncExternalStore(
    (cb) => {
      _listeners.add(cb);
      return () => _listeners.delete(cb);
    },
    () => _balance,
  );
}

// Paywall state — set by handleGatedResponse, read by the App-level paywall sheet.
export function getPaywallReason() {
  return _paywallReason;
}

export function openPaywall(reason) {
  if (!CREDITS_UI_ENABLED) return;
  _paywallReason = reason || "Out of credits";
  emit();
}

export function closePaywall() {
  _paywallReason = null;
  emit();
}

export function usePaywall() {
  return useSyncExternalStore(
    (cb) => {
      _listeners.add(cb);
      return () => _listeners.delete(cb);
    },
    () => _paywallReason,
  );
}

// ── Fork paywall (Phase 2.5 pooled credits) ──
// Shown ONLY when a SHARED trip's pool is empty (edge fn returns 402 with
// code "empty_trip_pool"). The member chooses per-action: fund the trip pool
// or spend their own personal credits just this once. The choice is never
// remembered for the session (per EM). Personal wallet is untouched here —
// setCredits is deliberately NOT called for this branch.
//
// Shape: { tripId, retry } where retry() re-issues the original request with
// spend_personal: true. null when closed.
let _forkPaywall = null;

export function getForkPaywall() {
  return _forkPaywall;
}

export function openForkPaywall({ tripId, retry } = {}) {
  if (!CREDITS_UI_ENABLED) return;
  _forkPaywall = { tripId: tripId || null, retry: retry || null };
  emit();
}

export function closeForkPaywall() {
  _forkPaywall = null;
  emit();
}

export function useForkPaywall() {
  return useSyncExternalStore(
    (cb) => {
      _listeners.add(cb);
      return () => _listeners.delete(cb);
    },
    () => _forkPaywall,
  );
}

// Inspect a fetch Response from a gated edge function. Returns a truthy value
// if the caller should abort (a paywall opened); false if the response is OK.
//
// Two 402 shapes:
//   - code === "empty_trip_pool" → SHARED trip pool is empty. Do NOT touch the
//     personal wallet balance; open the fork paywall. Returns "empty_trip_pool"
//     so the caller can wire a personal-retry (see openForkPaywall). Callers
//     that don't support the fork still just treat the return as truthy/abort.
//   - anything else (insufficient_credits / no code) → today's behavior:
//     setCredits(0) + open the personal paywall. Returns true.
export async function handleGatedResponse(res, userId, reason) {
  if (!CREDITS_UI_ENABLED) return false;
  if (res.status === 402) {
    // Read the body FIRST so we can branch on the code. If parsing fails we
    // fall through to the personal paywall (safe default).
    let body = null;
    try {
      body = await res.json();
    } catch {}
    if (body?.code === "empty_trip_pool") {
      // Shared-trip pool empty — personal wallet is fine, leave it alone.
      // The caller (which knows the request) opens the fork paywall with a
      // retry; here we only signal so it can do so.
      return "empty_trip_pool";
    }
    setCredits(0);
    openPaywall(reason || "You're out of credits");
    return true;
  }
  // Otherwise we still want to refresh credits after the call completes.
  // Caller is expected to invoke refreshCredits(userId) once done.
  return false;
}

// Helper for components that need the latest balance on mount.
export function useEnsureCreditsLoaded(userId) {
  const credits = useCredits();
  useEffect(() => {
    if (!CREDITS_UI_ENABLED) return;
    if (userId && credits === null) refreshCredits(userId);
  }, [userId, credits]);
  return credits;
}
