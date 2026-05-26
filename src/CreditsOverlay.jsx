import { useEffect, useState } from "react";
import { T, RADIUS, SHADOW, MOTION } from "./theme";
import {
  useCredits,
  usePaywall,
  closePaywall,
  refreshCredits,
  displayCredits,
} from "./credits";
import { supabase } from "./supabase";

// D19: no persistent CreditPill anywhere — avatar dropdown (Day 3) is the
// single entry point for balance + top-up. We keep PaywallSheet + a pack
// selector modal here for the gated 402 flow.

const PACKS = [
  { id: "small", credits: 300, price: 5, label: "Small", subtitle: "300 credits · $5" },
  { id: "large", credits: 1000, price: 10, label: "Large", subtitle: "1000 credits · $10", badge: "Best value · 3.3× more per dollar" },
];

const PAYMENTS_ENABLED = import.meta.env.VITE_PAYMENTS_ENABLED === "true";

async function startCheckout(packId, session) {
  if (!session?.access_token) {
    return { error: "Please sign in to top up." };
  }
  if (!PAYMENTS_ENABLED) {
    return { error: "Top-up is launching soon. Hang tight!" };
  }
  try {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout?pack=${packId}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
    });
    const data = await res.json();
    if (!res.ok || !data.url) {
      return { error: data.error || "Checkout failed. Try again." };
    }
    window.location.href = data.url;
    return {};
  } catch (e) {
    return { error: e.message || "Network error. Try again." };
  }
}

export function PackSelectorModal({ open, onClose, session }) {
  const [submitting, setSubmitting] = useState(null);
  const [error, setError] = useState("");

  if (!open) return null;

  async function pick(packId) {
    setError("");
    setSubmitting(packId);
    const { error: e } = await startCheckout(packId, session);
    if (e) {
      setSubmitting(null);
      setError(e);
    }
  }

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(15,25,35,0.55)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: T.warm || "#FAF6F0",
          borderRadius: "20px 20px 0 0",
          padding: "24px 22px 28px",
          width: "100%",
          maxWidth: 480,
          boxShadow: SHADOW?.lg || "0 -8px 32px rgba(0,0,0,0.2)",
          animation: `slideUp ${MOTION?.medium || "240ms"} ease-out`,
        }}
      >
        <div
          style={{
            fontFamily: "'DM Serif Display', Georgia, serif",
            fontSize: 22,
            color: T.ink || "#0F1923",
            marginBottom: 6,
          }}
        >
          Top up credits
        </div>
        <div
          style={{
            fontSize: 12,
            color: T.muted || "#8BA5BB",
            marginBottom: 18,
          }}
        >
          Choose a pack. Both work the same way — larger packs cost less per credit.
        </div>
        {PACKS.map((p) => {
          const isHighlight = !!p.badge;
          return (
            <button
              key={p.id}
              onClick={() => pick(p.id)}
              disabled={submitting !== null}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "16px 18px",
                marginBottom: 10,
                borderRadius: RADIUS?.md || 12,
                border: isHighlight ? `2px solid ${T.ocean || "#2563A8"}` : `1px solid ${T.line || "#E2DDD5"}`,
                background: isHighlight ? "rgba(37,99,168,0.06)" : "white",
                cursor: submitting !== null ? "not-allowed" : "pointer",
                fontFamily: "Georgia, serif",
                opacity: submitting && submitting !== p.id ? 0.5 : 1,
                transition: `all ${MOTION?.normal || "180ms"}`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: T.ink || "#0F1923" }}>
                    {p.label} {submitting === p.id && <span style={{ fontSize: 12, color: T.muted, fontWeight: 400 }}>· loading…</span>}
                  </div>
                  <div style={{ fontSize: 13, color: T.muted || "#8BA5BB", marginTop: 2 }}>{p.subtitle}</div>
                </div>
                <div
                  style={{
                    fontFamily: "'DM Serif Display', Georgia, serif",
                    fontSize: 24,
                    color: T.ink || "#0F1923",
                  }}
                >
                  ${p.price}
                </div>
              </div>
              {p.badge && (
                <div style={{ marginTop: 8, fontSize: 11, color: T.ocean || "#2563A8", fontWeight: 600 }}>
                  ★ {p.badge}
                </div>
              )}
            </button>
          );
        })}
        {error && (
          <div style={{ marginTop: 6, fontSize: 12, color: T.error || "#DC2626", textAlign: "center" }}>
            {error}
          </div>
        )}
        <button
          onClick={onClose}
          style={{
            width: "100%",
            marginTop: 8,
            padding: 12,
            borderRadius: RADIUS?.md || 12,
            border: `1px solid ${T.line || "#E2DDD5"}`,
            background: "white",
            color: T.muted || "#8BA5BB",
            fontFamily: "Georgia, serif",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function PaywallSheet({ session }) {
  const reason = usePaywall();
  const credits = useCredits();
  const [showPicker, setShowPicker] = useState(false);
  useEffect(() => {
    if (reason && session?.user?.id) refreshCredits(session.user.id);
  }, [reason, session?.user?.id]);

  if (!reason) return null;

  return (
    <>
      <div
        onClick={(e) => {
          if (e.target === e.currentTarget) closePaywall();
        }}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          background: "rgba(15,25,35,0.55)",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            background: T.warm || "#FAF6F0",
            borderRadius: "20px 20px 0 0",
            padding: "28px 22px 28px",
            width: "100%",
            maxWidth: 480,
            boxShadow: SHADOW?.lg || "0 -8px 32px rgba(0,0,0,0.2)",
            animation: `slideUp ${MOTION?.medium || "240ms"} ease-out`,
          }}
        >
          <div style={{ textAlign: "center", fontSize: 38, marginBottom: 10 }}>🔒</div>
          <div
            style={{
              fontFamily: "'DM Serif Display', Georgia, serif",
              fontSize: 22,
              textAlign: "center",
              color: T.ink || "#0F1923",
              marginBottom: 8,
            }}
          >
            You're out of credits
          </div>
          <div
            style={{
              fontSize: 13,
              color: T.muted || "#8BA5BB",
              textAlign: "center",
              marginBottom: 18,
              lineHeight: 1.5,
            }}
          >
            {reason}
          </div>
          <div
            style={{
              background: "white",
              borderRadius: RADIUS?.md || 12,
              padding: "14px 16px",
              border: `1px solid ${T.line || "#E2DDD5"}`,
              textAlign: "center",
              marginBottom: 18,
            }}
          >
            <div
              style={{
                fontFamily: "'DM Serif Display', Georgia, serif",
                fontSize: 26,
                color: T.ink || "#0F1923",
              }}
            >
              {displayCredits(credits)}
            </div>
            <div
              style={{
                fontSize: 10,
                color: T.muted || "#8BA5BB",
                textTransform: "uppercase",
                letterSpacing: 0.6,
                marginTop: 2,
              }}
            >
              credits remaining
            </div>
          </div>
          <button
            onClick={() => setShowPicker(true)}
            style={{
              width: "100%",
              padding: 14,
              borderRadius: RADIUS?.md || 12,
              border: "none",
              fontFamily: "Georgia, serif",
              fontSize: 15,
              fontWeight: 600,
              background: `linear-gradient(135deg, ${T.ocean || "#2563A8"}, ${T.dusk || "#1E2D3D"})`,
              color: "white",
              cursor: "pointer",
              marginBottom: 8,
            }}
          >
            Top up
          </button>
          <button
            onClick={closePaywall}
            style={{
              width: "100%",
              padding: 12,
              borderRadius: RADIUS?.md || 12,
              border: `1px solid ${T.line || "#E2DDD5"}`,
              background: "white",
              color: T.muted || "#8BA5BB",
              fontFamily: "Georgia, serif",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Maybe later
          </button>
        </div>
        <style>{`@keyframes slideUp { from { transform: translateY(20%); opacity: 0 } to { transform: translateY(0); opacity: 1 } }`}</style>
      </div>
      <PackSelectorModal open={showPicker} onClose={() => setShowPicker(false)} session={session} />
    </>
  );
}

// D19: no persistent floating pill. The overlay now only mounts the paywall
// + post-purchase success toast. Avatar dropdown (Day 3) provides the persistent
// balance view + top-up entry point.
export default function CreditsOverlay({ session }) {
  // Detect post-checkout success redirect: ?credits_success=300|1000
  const [toast, setToast] = useState(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const granted = params.get("credits_success");
    if (granted && session?.user?.id) {
      setToast(`${granted} credits added!`);
      refreshCredits(session.user.id);
      // Clean the URL
      params.delete("credits_success");
      const q = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (q ? `?${q}` : ""));
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [session?.user?.id]);

  return (
    <>
      {toast && (
        <div
          style={{
            position: "fixed",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10001,
            background: T.ocean || "#2563A8",
            color: "white",
            padding: "10px 16px",
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "Georgia, serif",
            boxShadow: SHADOW?.md || "0 4px 12px rgba(0,0,0,0.15)",
          }}
        >
          ✓ {toast}
        </div>
      )}
      <PaywallSheet session={session} />
    </>
  );
}
