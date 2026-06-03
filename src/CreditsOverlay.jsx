import { useEffect, useState } from "react";
import { T, RADIUS, SHADOW, MOTION } from "./theme";
import {
  useCredits,
  usePaywall,
  closePaywall,
  refreshCredits,
  displayCredits,
} from "./credits";

async function redeemCoupon(code, session) {
  if (!session?.access_token) return { error: "Please sign in first." };
  try {
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/redeem-coupon`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code }),
      },
    );
    const data = await res.json();
    if (!res.ok) return { error: data.error || "Redemption failed." };
    return { granted: data.granted, balance: data.balance };
  } catch (e) {
    return { error: e.message || "Network error. Try again." };
  }
}

export function CouponModal({ open, onClose, session }) {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(null);

  if (!open) return null;

  async function handleRedeem() {
    if (!code.trim()) return;
    setError("");
    setSubmitting(true);
    const result = await redeemCoupon(code.trim(), session);
    setSubmitting(false);
    if (result.error) {
      setError(result.error);
    } else {
      setSuccess(result.granted);
      if (session?.user?.id) refreshCredits(session.user.id);
      setTimeout(() => {
        setSuccess(null);
        setCode("");
        onClose();
      }, 1800);
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
          background: T.warm,
          borderRadius: "20px 20px 0 0",
          padding: "24px 22px 32px",
          width: "100%",
          maxWidth: 480,
          boxShadow: SHADOW.lg,
          animation: `slideUp ${MOTION.normal} ease-out`,
        }}
      >
        <div
          style={{
            fontFamily: "'DM Serif Display', Georgia, serif",
            fontSize: 22,
            color: T.ink,
            marginBottom: 6,
          }}
        >
          Redeem a coupon
        </div>
        <div style={{ fontSize: 12, color: T.mist, marginBottom: 20 }}>
          Enter your coupon code to add credits to your account.
        </div>

        {success ? (
          <div
            style={{
              textAlign: "center",
              padding: "20px 0",
              color: T.moss,
              fontFamily: "Georgia, serif",
              fontSize: 16,
            }}
          >
            ✓ {success} credits added!
          </div>
        ) : (
          <>
            <input
              type="text"
              value={code}
              onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleRedeem()}
              placeholder="COUPON CODE"
              autoFocus
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "13px 14px",
                borderRadius: RADIUS.md,
                border: `1px solid ${error ? T.errorBorder : T.border}`,
                background: "white",
                fontFamily: "Georgia, serif",
                fontSize: 15,
                letterSpacing: 2,
                color: T.ink,
                marginBottom: 10,
                outline: "none",
              }}
            />
            {error && (
              <div
                style={{
                  fontSize: 12,
                  color: T.error,
                  marginBottom: 10,
                  textAlign: "center",
                }}
              >
                {error}
              </div>
            )}
            <button
              onClick={handleRedeem}
              disabled={submitting || !code.trim()}
              style={{
                width: "100%",
                padding: 14,
                borderRadius: RADIUS.md,
                border: "none",
                fontFamily: "Georgia, serif",
                fontSize: 15,
                fontWeight: 600,
                background:
                  submitting || !code.trim()
                    ? T.disabled
                    : `linear-gradient(135deg, ${T.ocean}, ${T.dusk})`,
                color: "white",
                cursor: submitting || !code.trim() ? "not-allowed" : "pointer",
                marginBottom: 8,
                transition: `background ${MOTION.fast}`,
              }}
            >
              {submitting ? "Redeeming…" : "Redeem"}
            </button>
            <button
              onClick={onClose}
              style={{
                width: "100%",
                padding: 12,
                borderRadius: RADIUS.md,
                border: `1px solid ${T.border}`,
                background: "white",
                color: T.mist,
                fontFamily: "Georgia, serif",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </>
        )}
      </div>
      <style>{`@keyframes slideUp { from { transform: translateY(20%); opacity: 0 } to { transform: translateY(0); opacity: 1 } }`}</style>
    </div>
  );
}

export function PaywallSheet({ session }) {
  const reason = usePaywall();
  const credits = useCredits();
  const [showCoupon, setShowCoupon] = useState(false);

  useEffect(() => {
    if (reason && session?.user?.id) refreshCredits(session.user.id);
  }, [reason, session?.user?.id]);

  if (!reason) return null;

  return (
    <>
      <div
        onClick={(e) => { if (e.target === e.currentTarget) closePaywall(); }}
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
            background: T.warm,
            borderRadius: "20px 20px 0 0",
            padding: "28px 22px 28px",
            width: "100%",
            maxWidth: 480,
            boxShadow: SHADOW.lg,
            animation: `slideUp ${MOTION.normal} ease-out`,
          }}
        >
          <div style={{ textAlign: "center", fontSize: 38, marginBottom: 10 }}>🔒</div>
          <div
            style={{
              fontFamily: "'DM Serif Display', Georgia, serif",
              fontSize: 22,
              textAlign: "center",
              color: T.ink,
              marginBottom: 8,
            }}
          >
            You're out of credits
          </div>
          <div
            style={{
              fontSize: 13,
              color: T.mist,
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
              borderRadius: RADIUS.md,
              padding: "14px 16px",
              border: `1px solid ${T.border}`,
              textAlign: "center",
              marginBottom: 18,
            }}
          >
            <div
              style={{
                fontFamily: "'DM Serif Display', Georgia, serif",
                fontSize: 26,
                color: T.ink,
              }}
            >
              {displayCredits(credits)}
            </div>
            <div
              style={{
                fontSize: 10,
                color: T.mist,
                textTransform: "uppercase",
                letterSpacing: 0.6,
                marginTop: 2,
              }}
            >
              credits remaining
            </div>
          </div>
          <button
            onClick={() => setShowCoupon(true)}
            style={{
              width: "100%",
              padding: 14,
              borderRadius: RADIUS.md,
              border: "none",
              fontFamily: "Georgia, serif",
              fontSize: 15,
              fontWeight: 600,
              background: `linear-gradient(135deg, ${T.ocean}, ${T.dusk})`,
              color: "white",
              cursor: "pointer",
              marginBottom: 8,
            }}
          >
            Redeem a coupon
          </button>
          <button
            onClick={closePaywall}
            style={{
              width: "100%",
              padding: 12,
              borderRadius: RADIUS.md,
              border: `1px solid ${T.border}`,
              background: "white",
              color: T.mist,
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
      <CouponModal
        open={showCoupon}
        onClose={() => { setShowCoupon(false); closePaywall(); }}
        session={session}
      />
    </>
  );
}

export default function CreditsOverlay({ session }) {
  const [toast, setToast] = useState(null);

  // Detect post-checkout success redirect (kept for backwards compat with any
  // existing LS redirect URLs in the wild, harmless otherwise)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const granted = params.get("credits_success");
    if (granted && session?.user?.id) {
      setToast(`${granted} credits added!`);
      refreshCredits(session.user.id);
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
            background: T.ocean,
            color: "white",
            padding: "10px 16px",
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "Georgia, serif",
            boxShadow: SHADOW.md,
          }}
        >
          ✓ {toast}
        </div>
      )}
      <PaywallSheet session={session} />
    </>
  );
}
