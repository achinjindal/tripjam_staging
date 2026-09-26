// Single top-banner slot — at most one passive banner renders at a time.
// Same module-store pattern as credits.js (useSyncExternalStore, no context).
//
// Priority: email (account recovery) preempts credits (upsell). Claims are
// idempotent; a higher-priority claim evicts a lower one reactively, so the
// async order in which banners decide to show doesn't matter.

import { useSyncExternalStore } from "react";

const PRIORITY = { email: 2, credits: 1 };

let owner = null;
const subs = new Set();
const emit = () => subs.forEach((fn) => fn());

export function claimBannerSlot(name) {
  if (owner === name) return true;
  if (!owner || (PRIORITY[name] || 0) > (PRIORITY[owner] || 0)) {
    owner = name;
    emit();
    return true;
  }
  return false;
}

export function releaseBannerSlot(name) {
  if (owner === name) {
    owner = null;
    emit();
  }
}

export function useBannerSlotOwner() {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => owner,
  );
}
