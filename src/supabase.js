import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/* ── Dead-session guard ─────────────────────────────────────────────────
   A session can die server-side while the client still holds it (Supabase
   project pause/restore invalidates refresh tokens; the tab then sends a
   rejected JWT to every API and the user sees scattered 401-shaped errors
   while looking signed in). The guard notices, verifies with one refresh
   attempt, and on a NON-network failure forces a clean local sign-out and
   lands on /signin with a "session expired" note (flag read by Auth.jsx).
   Network failures never sign the user out — offline tabs must keep their
   session (the refresh succeeds when connectivity returns).             */

export const SESSION_EXPIRED_FLAG = "tripjam_session_expired";

let _validating = null;
export function ensureLiveSession() {
  if (_validating) return _validating;
  _validating = (async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const { error } = await supabase.auth.refreshSession();
      if (!error) return; // token was merely expired — refresh healed it
      if (/network|fetch|failed to|timeout/i.test(error.message || "")) return; // offline/unreachable — keep the session
      try {
        localStorage.setItem(SESSION_EXPIRED_FLAG, String(Date.now()));
      } catch {
        /* private mode */
      }
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      window.location.assign("/signin");
    } catch {
      /* verification itself failed — do nothing, next 401 retries */
    } finally {
      _validating = null;
    }
  })();
  return _validating;
}

// Every REST/RPC/auth call the supabase client makes flows through this:
// a 401 carrying a USER token (not the anon key) triggers verification.
const guardedFetch = (input, init = {}) =>
  fetch(input, init).then((res) => {
    if (res.status === 401) {
      try {
        const auth = new Headers(init?.headers || {}).get("Authorization");
        if (auth?.startsWith("Bearer ") && auth.slice(7) !== supabaseAnonKey)
          ensureLiveSession();
      } catch {
        /* header inspection is best-effort */
      }
    }
    return res;
  });

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: guardedFetch },
});
