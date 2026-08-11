// Phase 4 minimal slice — client helper for the send-email edge function.
//
// All sends are fire-and-forget: email is a nicety, never a blocker, so every
// failure is swallowed. `emailEnabled()` probes once per session so UI can
// hide email actions when the function ships dark (no RESEND_API_KEY).

import { supabase } from "./supabase";

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`;

async function call(body) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("no_session");
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

let _enabledPromise = null;
/** Whether email sending is configured server-side. Cached per session. */
export function emailEnabled() {
  if (!_enabledPromise)
    _enabledPromise = call({ type: "config" })
      .then((r) => !!r?.enabled)
      .catch(() => false);
  return _enabledPromise;
}

/** Fire-and-forget transactional email. Never throws, never blocks. */
export function sendTripEmail(type, tripId, payload = {}) {
  call({ type, tripId, ...payload }).catch(() => {});
}

/** Await-able variant for flows that show a toast on the outcome. */
export function sendTripEmailWithResult(type, tripId, payload = {}) {
  return call({ type, tripId, ...payload });
}
