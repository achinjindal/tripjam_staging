import { useEffect, useState, useSyncExternalStore } from "react";
import { supabase } from "./supabase";

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
    (cb) => { _listeners.add(cb); return () => _listeners.delete(cb); },
    () => _balance,
  );
}

// Paywall state — set by handleGatedResponse, read by the App-level paywall sheet.
export function getPaywallReason() {
  return _paywallReason;
}

export function openPaywall(reason) {
  _paywallReason = reason || "Out of credits";
  emit();
}

export function closePaywall() {
  _paywallReason = null;
  emit();
}

export function usePaywall() {
  return useSyncExternalStore(
    (cb) => { _listeners.add(cb); return () => _listeners.delete(cb); },
    () => _paywallReason,
  );
}

// Inspect a fetch Response from a gated edge function. Returns true if the
// caller should abort (paywall opened); false if the response is OK.
export async function handleGatedResponse(res, userId, reason) {
  if (res.status === 402) {
    setCredits(0);
    openPaywall(reason || "You're out of credits");
    // Drain body so the caller doesn't accidentally read it.
    try { await res.text(); } catch {}
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
    if (userId && credits === null) refreshCredits(userId);
  }, [userId, credits]);
  return credits;
}
