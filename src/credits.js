import { useEffect, useState, useSyncExternalStore } from "react";
import { supabase } from "./supabase";

// Master switch for the entire credits UX. Day 2 re-enables this on
// STAGING with the decimal credit system (NUMERIC(10,2)). Backend credit
// deduction always runs; this flag only controls UI + paywall behavior.
//
// Per-environment: staging gets `true` to test the new flow; production
// stays `false` until Day 3 ships the avatar dropdown + Stripe Checkout.
// Falls back to `true` only on staging (detected by Supabase URL ref).
const __SB_URL = import.meta.env.VITE_SUPABASE_URL || "";
const __IS_PROD = __SB_URL.includes("viyvdqwwnbbqjuwiuzbh");
export const CREDITS_UI_ENABLED = !__IS_PROD;

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

// Inspect a fetch Response from a gated edge function. Returns true if the
// caller should abort (paywall opened); false if the response is OK.
export async function handleGatedResponse(res, userId, reason) {
  if (!CREDITS_UI_ENABLED) return false;
  if (res.status === 402) {
    setCredits(0);
    openPaywall(reason || "You're out of credits");
    // Drain body so the caller doesn't accidentally read it.
    try {
      await res.text();
    } catch {}
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
