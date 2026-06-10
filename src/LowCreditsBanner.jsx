import { useEffect, useState } from "react";
import { T, RADIUS, SHADOW, MOTION } from "./theme";
import {
  useCredits,
  refreshCredits,
  displayCredits,
  CREDITS_UI_ENABLED,
  getCredits,
} from "./credits";
import { CouponModal } from "./CreditsOverlay";

// D4 (updated): show banner when displayCredits(balance) ≤ 10, dismissible per session.
// Top-of-page banner that nudges the user to top up before they hit the hard 0-credit wall.

const LOW_THRESHOLD = 10;
const SESSION_KEY = "tripjam.lowCreditsBannerDismissedAt";

export default function LowCreditsBanner({ session }) {
  const credits = useCredits();
  const [dismissedAt, setDismissedAt] = useState(() => {
    try {
      const v = sessionStorage.getItem(SESSION_KEY);
      return v ? Number(v) : 0;
    } catch {
      return 0;
    }
  });
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    if (!CREDITS_UI_ENABLED) return;
    if (session?.user?.id && getCredits() === null)
      refreshCredits(session.user.id);
  }, [session?.user?.id]);

  if (!CREDITS_UI_ENABLED) return null;
  if (!session?.user?.id) return null;
  if (credits == null) return null;

  const visible = displayCredits(credits);
  if (visible > LOW_THRESHOLD) return null;
  if (visible <= 0) return null; // hard-stop modal (PaywallSheet) handles this
  if (dismissedAt > 0) return null;

  function dismiss() {
    const now = Date.now();
    try {
      sessionStorage.setItem(SESSION_KEY, String(now));
    } catch {}
    setDismissedAt(now);
  }

  return (
    <>
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 9997,
          background: T.warm || "#FAF6F0",
          borderBottom: `2px solid ${T.accent || "#F59E0B"}`,
          padding: "10px 16px",
          boxShadow: SHADOW?.sm || "0 2px 6px rgba(0,0,0,0.08)",
          animation: `slideDownBanner ${MOTION?.medium || "240ms"} ease-out`,
          fontFamily: "Georgia, serif",
        }}
      >
        <div
          style={{
            maxWidth: 720,
            margin: "0 auto",
            display: "flex",
            gap: 12,
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              flex: "1 1 220px",
              fontSize: 13,
              color: T.ink || "#0F1923",
              lineHeight: 1.4,
            }}
          >
            <strong>
              {visible} credit{visible === 1 ? "" : "s"} left
            </strong>
            <span style={{ color: T.muted || "#8BA5BB", marginLeft: 8 }}>
              — top up to keep planning
            </span>
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setShowPicker(true)}
              style={{
                padding: "8px 14px",
                borderRadius: RADIUS?.sm || 8,
                border: "none",
                background: T.ocean || "#2563A8",
                color: "white",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "Georgia, serif",
                cursor: "pointer",
              }}
            >
              Top up
            </button>
            <button
              onClick={dismiss}
              aria-label="Dismiss"
              style={{
                padding: "8px 10px",
                borderRadius: RADIUS?.sm || 8,
                border: "none",
                background: "transparent",
                color: T.muted || "#8BA5BB",
                fontSize: 14,
                cursor: "pointer",
                fontFamily: "Georgia, serif",
              }}
              title="Dismiss for this session"
            >
              ✕
            </button>
          </div>
        </div>
        <style>{`@keyframes slideDownBanner { from { transform: translateY(-100%); opacity: 0 } to { transform: translateY(0); opacity: 1 } }`}</style>
      </div>
      <CouponModal
        open={showPicker}
        onClose={() => setShowPicker(false)}
        session={session}
      />
    </>
  );
}
