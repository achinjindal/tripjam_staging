// Join screen — Phase 1. Where a /join/:token invite link lands.
// Previews the trip (via the get_invite_preview RPC, safe for a not-yet-member),
// then accepts on tap. Unauthenticated users sign in first and resume via a
// stashed token (see main.jsx).

import { useEffect, useState } from "react";
import { T } from "./theme";
import { previewInvite, acceptInvite } from "./members.js";

const PENDING_KEY = "tripjam_pending_join_token";

export function stashPendingJoin(token) {
  try {
    localStorage.setItem(PENDING_KEY, token);
  } catch {}
}
export function takePendingJoin() {
  try {
    const t = localStorage.getItem(PENDING_KEY);
    if (t) localStorage.removeItem(PENDING_KEY);
    return t;
  } catch {
    return null;
  }
}

function fmtDates(start, end) {
  if (!start) return "";
  const opt = { month: "short", day: "numeric" };
  try {
    const s = new Date(start).toLocaleDateString(undefined, opt);
    const e = end ? new Date(end).toLocaleDateString(undefined, opt) : "";
    return e ? `${s} – ${e}` : s;
  } catch {
    return "";
  }
}

export default function JoinTrip({
  token,
  session,
  onNavigate,
  onOpenTripById,
}) {
  const [state, setState] = useState({ status: "loading" });
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    let cancelled = false;
    previewInvite(token)
      .then((p) => {
        if (cancelled) return;
        setState(
          p?.valid ? { status: "ready", preview: p } : { status: "invalid" },
        );
      })
      .catch(() => !cancelled && setState({ status: "invalid" }));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const doJoin = async () => {
    if (joining) return;
    setJoining(true);
    try {
      const tripId = await acceptInvite(token);
      onOpenTripById(tripId);
    } catch (e) {
      const msg = e?.message || "";
      setState({
        status: "error",
        message: msg.includes("trip_full")
          ? "This trip is already full."
          : "This invite is no longer valid.",
      });
      setJoining(false);
    }
  };

  const signInToJoin = () => {
    stashPendingJoin(token);
    onNavigate("/signin");
  };

  const wrap = {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: "34px 30px",
    background: `linear-gradient(180deg, ${T.bgPage}, ${T.warm})`,
    fontFamily: "Georgia, serif",
  };

  if (state.status === "loading") {
    return (
      <div style={wrap}>
        <div style={{ color: T.mist, fontSize: 14 }}>Loading invite…</div>
      </div>
    );
  }

  if (state.status === "invalid" || state.status === "error") {
    return (
      <div style={wrap}>
        <div style={{ fontSize: 52, marginBottom: 16 }}>🗺️</div>
        <div
          style={{
            fontFamily: "'DM Serif Display', serif",
            fontSize: 22,
            color: T.ink,
          }}
        >
          Link no longer active
        </div>
        <div
          style={{
            fontSize: 13,
            color: T.mist,
            margin: "8px 0 22px",
            maxWidth: 280,
          }}
        >
          {state.message ||
            "This invite may have expired or been revoked. Ask the trip owner for a fresh link."}
        </div>
        <div
          onClick={() => onNavigate("/")}
          style={{ fontSize: 13, color: T.ocean, cursor: "pointer" }}
        >
          Go to my trips
        </div>
      </div>
    );
  }

  const p = state.preview;
  return (
    <div style={wrap}>
      <div
        style={{
          fontSize: 12,
          letterSpacing: 3,
          color: T.mist,
          textTransform: "uppercase",
          marginBottom: 26,
        }}
      >
        ✈️ TripJam
      </div>
      {p.inviter && (
        <div style={{ fontSize: 13, color: T.mist, marginBottom: 16 }}>
          {p.inviter} invited you to
        </div>
      )}
      <div
        style={{
          fontFamily: "'DM Serif Display', serif",
          fontSize: 26,
          color: T.ink,
          lineHeight: 1.2,
          marginBottom: 8,
        }}
      >
        “{p.trip_name || p.destination || "a trip"}”
      </div>
      <div style={{ fontSize: 13, color: T.mist, marginBottom: 22 }}>
        📅 {fmtDates(p.start_date, p.end_date)} · {p.member_count} traveler
        {p.member_count === 1 ? "" : "s"}
      </div>
      <div
        style={{
          fontSize: 13,
          color: T.ink,
          lineHeight: 1.6,
          marginBottom: 26,
          maxWidth: 280,
        }}
      >
        You'll be able to edit the plan and chat with Trippy together.
      </div>
      {session ? (
        <div
          onClick={doJoin}
          style={{
            width: "100%",
            maxWidth: 320,
            padding: 15,
            borderRadius: 26,
            background: `linear-gradient(135deg, ${T.ocean}, ${T.dusk})`,
            color: T.chalk,
            fontFamily: "'DM Serif Display', serif",
            fontSize: 16,
            cursor: "pointer",
            opacity: joining ? 0.7 : 1,
          }}
        >
          {joining ? "Joining…" : "Join trip →"}
        </div>
      ) : (
        <div
          onClick={signInToJoin}
          style={{
            width: "100%",
            maxWidth: 320,
            padding: 15,
            borderRadius: 26,
            background: `linear-gradient(135deg, ${T.ocean}, ${T.dusk})`,
            color: T.chalk,
            fontFamily: "'DM Serif Display', serif",
            fontSize: 16,
            cursor: "pointer",
          }}
        >
          Sign in to join
        </div>
      )}
      <div
        onClick={() => onNavigate("/")}
        style={{
          marginTop: 14,
          fontSize: 13,
          color: T.mist,
          cursor: "pointer",
        }}
      >
        Maybe later
      </div>
    </div>
  );
}
