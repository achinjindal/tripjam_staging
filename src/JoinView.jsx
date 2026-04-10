import { useState, useEffect } from "react";
import { supabase } from "./supabase";

const T = {
  ink: "#1A1A2E", warm: "#FDFAF6", chalk: "#FFFFFF",
  sand: "#E8E0D5", mist: "#9A8F8F", ocean: "#2563A8", dusk: "#4A5568",
};

export default function JoinView({ token, session }) {
  const [status, setStatus] = useState("loading"); // loading | ready | joining | joined | invalid | already
  const [invite, setInvite] = useState(null);
  const [trip, setTrip] = useState(null);

  useEffect(() => {
    async function load() {
      const { data: inv } = await supabase
        .from("invite_links")
        .select("*, trips(id, name, destination)")
        .eq("token", token)
        .single();

      if (!inv) { setStatus("invalid"); return; }
      if (new Date(inv.expires_at) < new Date()) { setStatus("invalid"); return; }

      // Check if already a member
      const { data: existing } = await supabase
        .from("trip_members")
        .select("id")
        .eq("trip_id", inv.trip_id)
        .eq("user_id", session.user.id)
        .single();

      if (existing) { setStatus("already"); setTrip(inv.trips); return; }

      setInvite(inv);
      setTrip(inv.trips);
      setStatus("ready");
    }
    load();
  }, [token]);

  const join = async () => {
    setStatus("joining");
    await supabase.from("trip_members").upsert({
      trip_id: invite.trip_id,
      user_id: session.user.id,
      role: invite.role,
      invited_by: invite.created_by,
    }, { onConflict: "trip_id,user_id" });
    setStatus("joined");
    setTimeout(() => { window.location.href = "/"; }, 1500);
  };

  const roleLabel = { edit: "Editor", comment: "Commenter", read: "Viewer" };

  if (status === "loading") {
    return (
      <div style={{ minHeight: "100dvh", background: T.warm, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: "Georgia,serif", fontSize: 14, color: T.mist }}>Loading invite…</div>
      </div>
    );
  }

  if (status === "invalid") {
    return (
      <div style={{ minHeight: "100dvh", background: T.warm, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔗</div>
        <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 22, color: T.ink, marginBottom: 8 }}>Invite not found</div>
        <div style={{ fontFamily: "Georgia,serif", fontSize: 14, color: T.mist }}>This link may have expired or been removed.</div>
      </div>
    );
  }

  if (status === "already" || status === "joined") {
    return (
      <div style={{ minHeight: "100dvh", background: T.warm, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
        <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 22, color: T.ink, marginBottom: 8 }}>
          {status === "joined" ? "You're in!" : "Already a member"}
        </div>
        <div style={{ fontFamily: "Georgia,serif", fontSize: 14, color: T.mist, marginBottom: 24 }}>{trip?.name}</div>
        <a href="/" style={{ background: T.ocean, color: "white", borderRadius: 24, padding: "11px 28px", fontSize: 14, fontFamily: "'DM Serif Display',serif", textDecoration: "none" }}>
          Go to my trips →
        </a>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100dvh", background: T.warm, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&display=swap');*{box-sizing:border-box;margin:0;padding:0;}`}</style>
      <div style={{ maxWidth: 380, width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 20 }}>✈️</div>
        <div style={{ fontSize: 11, letterSpacing: 3, color: T.mist, textTransform: "uppercase", marginBottom: 10 }}>You've been invited</div>
        <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 26, color: T.ink, lineHeight: 1.2, marginBottom: 6 }}>{trip?.name}</div>
        <div style={{ fontFamily: "Georgia,serif", fontSize: 14, color: T.mist, marginBottom: 4 }}>📍 {trip?.destination}</div>
        <div style={{ fontFamily: "Georgia,serif", fontSize: 13, color: T.mist, marginBottom: 32 }}>
          Joining as <strong style={{ color: T.ink }}>{roleLabel[invite?.role] || invite?.role}</strong>
        </div>
        <button onClick={join} disabled={status === "joining"} style={{
          width: "100%", padding: 16, borderRadius: 16, border: "none", cursor: "pointer",
          background: `linear-gradient(135deg, ${T.ocean}, ${T.dusk})`,
          color: "white", fontFamily: "'DM Serif Display',serif", fontSize: 18,
          boxShadow: "0 6px 22px rgba(37,99,168,0.35)",
        }}>
          {status === "joining" ? "Joining…" : "Join trip →"}
        </button>
      </div>
    </div>
  );
}
