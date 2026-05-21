import { useEffect } from "react";
import { T, RADIUS, SHADOW, MOTION } from "./theme";
import { useCredits, usePaywall, closePaywall, refreshCredits, getCredits } from "./credits";

export function CreditPill({ session, style }) {
  const credits = useCredits();
  useEffect(() => {
    if (session?.user?.id && getCredits() === null) refreshCredits(session.user.id);
  }, [session?.user?.id]);

  if (credits === null) return null;

  const low = credits > 0 && credits < 10;
  const empty = credits <= 0;
  const dot = empty ? "#F87171" : low ? "#FBBF24" : "#4ADE80";

  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      background: "rgba(0,0,0,0.55)", color: "white",
      borderRadius: 999, padding: "4px 12px",
      fontSize: 12, fontWeight: 600, letterSpacing: 0.2,
      backdropFilter: "blur(8px)",
      ...style,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: dot }} />
      {Math.max(0, credits)} credit{credits === 1 ? "" : "s"}
    </div>
  );
}

export function PaywallSheet({ session }) {
  const reason = usePaywall();
  const credits = useCredits();
  useEffect(() => {
    if (reason && session?.user?.id) refreshCredits(session.user.id);
  }, [reason, session?.user?.id]);

  if (!reason) return null;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) closePaywall(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(15,25,35,0.55)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
    >
      <div style={{
        background: T.warm || "#FAF6F0",
        borderRadius: "20px 20px 0 0",
        padding: "28px 22px 28px",
        width: "100%", maxWidth: 480,
        boxShadow: SHADOW?.lg || "0 -8px 32px rgba(0,0,0,0.2)",
        animation: `slideUp ${MOTION?.medium || "240ms"} ease-out`,
      }}>
        <div style={{ textAlign: "center", fontSize: 38, marginBottom: 10 }}>🔒</div>
        <div style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontSize: 22, textAlign: "center", color: T.ink || "#0F1923", marginBottom: 8 }}>
          You're out of credits
        </div>
        <div style={{ fontSize: 13, color: T.muted || "#8BA5BB", textAlign: "center", marginBottom: 18, lineHeight: 1.5 }}>
          {reason}
        </div>
        <div style={{
          background: "white", borderRadius: RADIUS?.md || 12,
          padding: "14px 16px", border: `1px solid ${T.line || "#E2DDD5"}`,
          textAlign: "center", marginBottom: 18,
        }}>
          <div style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontSize: 26, color: T.ink || "#0F1923" }}>
            {credits ?? 0}
          </div>
          <div style={{ fontSize: 10, color: T.muted || "#8BA5BB", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 2 }}>
            credits remaining
          </div>
        </div>
        <button
          disabled
          style={{
            width: "100%", padding: 14, borderRadius: RADIUS?.md || 12, border: "none",
            fontFamily: "Georgia, serif", fontSize: 15, fontWeight: 600,
            background: `linear-gradient(135deg, ${T.ocean || "#2563A8"}, ${T.dusk || "#1E2D3D"})`,
            color: "white", cursor: "not-allowed", opacity: 0.65, marginBottom: 8,
          }}
          title="Coming soon"
        >
          Buy credits (coming soon)
        </button>
        <button
          onClick={closePaywall}
          style={{
            width: "100%", padding: 12, borderRadius: RADIUS?.md || 12,
            border: `1px solid ${T.line || "#E2DDD5"}`,
            background: "white", color: T.muted || "#8BA5BB",
            fontFamily: "Georgia, serif", fontSize: 14, cursor: "pointer",
          }}
        >
          Maybe later
        </button>
      </div>
      <style>{`@keyframes slideUp { from { transform: translateY(20%); opacity: 0 } to { transform: translateY(0); opacity: 1 } }`}</style>
    </div>
  );
}

// Combined floating overlay mounted once at root.
export default function CreditsOverlay({ session }) {
  return (
    <>
      <div style={{ position: "fixed", top: 12, right: 12, zIndex: 1000, pointerEvents: "none" }}>
        <div style={{ pointerEvents: "auto" }}>
          <CreditPill session={session} />
        </div>
      </div>
      <PaywallSheet session={session} />
    </>
  );
}
