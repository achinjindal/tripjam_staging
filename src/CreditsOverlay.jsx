import { useEffect, useState } from "react";
import { T, RADIUS, SHADOW, MOTION } from "./theme";
import {
  useCredits,
  usePaywall,
  closePaywall,
  useForkPaywall,
  closeForkPaywall,
  refreshCredits,
  displayCredits,
} from "./credits";
import { isAndroidApp, purchaseCredits } from "./billing";

// Two credit packs offered everywhere (personal + pool funding).
const PACKS = [
  { id: "small", label: "300 credits", price: "$4.99" },
  { id: "large", label: "1000 credits", price: "$9.99" },
];

// Fund credits — personal wallet if no tripId, or the trip pool if a tripId is
// passed. Android goes through the RevenueCat SDK; web opens a Lemon Squeezy
// hosted checkout. Returns { cancelled } | { error } | {} (success = grant on
// return / webhook). The tripId option is threaded to the pool by billing.js
// (Android) and create-checkout (web) — both owned by the recharge agent.
async function fundCredits(packId, { tripId, session } = {}) {
  if (isAndroidApp()) {
    return purchaseCredits(packId, tripId ? { tripId } : undefined);
  }
  // Web: Lemon Squeezy hosted checkout.
  if (!session?.access_token) return { error: "Please sign in first." };
  try {
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pack: packId,
          ...(tripId ? { trip_id: tripId } : {}),
        }),
      },
    );
    const data = await res.json();
    if (!res.ok || !data.url)
      return { error: data.error || "Checkout failed. Try again." };
    window.location.href = data.url;
    return {};
  } catch (e) {
    return { error: e.message || "Network error. Try again." };
  }
}

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
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
                setError("");
              }}
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
  const [purchasing, setPurchasing] = useState(null); // packId or null
  const [purchaseError, setPurchaseError] = useState("");

  useEffect(() => {
    if (reason && session?.user?.id) refreshCredits(session.user.id);
  }, [reason, session?.user?.id]);

  if (!reason) return null;

  async function handleBuy(packId) {
    setPurchaseError("");
    setPurchasing(packId);
    const result = await purchaseCredits(packId);
    setPurchasing(null);
    if (result.cancelled) return;
    if (result.error) {
      setPurchaseError(result.error);
      return;
    }
    if (session?.user?.id) await refreshCredits(session.user.id);
    closePaywall();
  }

  const onAndroid = isAndroidApp();

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
            background: T.warm,
            borderRadius: "20px 20px 0 0",
            padding: "28px 22px 28px",
            width: "100%",
            maxWidth: 480,
            boxShadow: SHADOW.lg,
            animation: `slideUp ${MOTION.normal} ease-out`,
          }}
        >
          <div style={{ textAlign: "center", fontSize: 38, marginBottom: 10 }}>
            🔒
          </div>
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

          {onAndroid && (
            <>
              {PACKS.map((pack) => (
                <button
                  key={pack.id}
                  onClick={() => handleBuy(pack.id)}
                  disabled={!!purchasing}
                  style={{
                    width: "100%",
                    padding: 14,
                    borderRadius: RADIUS.md,
                    border: "none",
                    fontFamily: "Georgia, serif",
                    fontSize: 15,
                    fontWeight: 600,
                    background: purchasing
                      ? T.disabled
                      : `linear-gradient(135deg, ${T.ocean}, ${T.dusk})`,
                    color: "white",
                    cursor: purchasing ? "not-allowed" : "pointer",
                    marginBottom: 8,
                    transition: `background ${MOTION.fast}`,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span>
                    {purchasing === pack.id
                      ? "Opening Google Play…"
                      : pack.label}
                  </span>
                  {purchasing !== pack.id && (
                    <span style={{ opacity: 0.85, fontSize: 14 }}>
                      {pack.price}
                    </span>
                  )}
                </button>
              ))}
              {purchaseError && (
                <div
                  style={{
                    fontSize: 12,
                    color: T.error,
                    textAlign: "center",
                    marginBottom: 8,
                  }}
                >
                  {purchaseError}
                </div>
              )}
            </>
          )}

          <button
            onClick={() => {
              setPurchaseError("");
              setShowCoupon(true);
            }}
            style={{
              width: "100%",
              padding: onAndroid ? 12 : 14,
              borderRadius: RADIUS.md,
              border: onAndroid ? `1px solid ${T.border}` : "none",
              fontFamily: "Georgia, serif",
              fontSize: onAndroid ? 14 : 15,
              fontWeight: 600,
              background: onAndroid
                ? "white"
                : `linear-gradient(135deg, ${T.ocean}, ${T.dusk})`,
              color: onAndroid ? T.mist : "white",
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
        onClose={() => {
          setShowCoupon(false);
          closePaywall();
        }}
        session={session}
      />
    </>
  );
}

// ── Fork paywall (Phase 2.5) ──
// Shown when a SHARED trip's pool is empty. The member picks per-action:
// fund the trip pool, or spend their own personal credits just this once
// (calls the stored retry() which re-sends with spend_personal:true).
// zIndex sits above the normal personal paywall (9999) so if both ever
// stack, the fork wins. Ships dark behind the shared-trip 402 code.
export function ForkPaywallSheet({ session }) {
  const fork = useForkPaywall();
  const personalCredits = useCredits();
  const [funding, setFunding] = useState(null); // packId or null
  const [fundError, setFundError] = useState("");

  if (!fork) return null;

  const tripId = fork.tripId;
  const retry = fork.retry;

  async function handleFund(packId) {
    setFundError("");
    setFunding(packId);
    const result = await fundCredits(packId, { tripId, session });
    setFunding(null);
    if (result.cancelled) return;
    if (result.error) {
      setFundError(result.error);
      return;
    }
    // Web redirects away; Android grants via verify/webhook. Either way we
    // refresh and close — the pool balance re-fetches on the next action.
    if (session?.user?.id) await refreshCredits(session.user.id);
    closeForkPaywall();
  }

  function handleUsePersonal() {
    // Per-action choice — re-run the original request with spend_personal.
    if (typeof retry === "function") retry();
    closeForkPaywall();
  }

  const rowStyle = (primary) => ({
    width: "100%",
    textAlign: "left",
    padding: "14px 16px",
    borderRadius: RADIUS.md,
    border: primary ? "none" : `1px solid ${T.border}`,
    background: primary
      ? `linear-gradient(135deg, ${T.ocean}, ${T.dusk})`
      : "white",
    color: primary ? "white" : T.ink,
    cursor: funding ? "not-allowed" : "pointer",
    marginBottom: 10,
    fontFamily: "Georgia, serif",
    transition: `background ${MOTION.fast}`,
    display: "block",
  });

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) closeForkPaywall();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10002,
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
        <div style={{ textAlign: "center", fontSize: 38, marginBottom: 10 }}>
          🪙
        </div>
        <div
          style={{
            fontFamily: "'DM Serif Display', Georgia, serif",
            fontSize: 22,
            textAlign: "center",
            color: T.ink,
            marginBottom: 6,
          }}
        >
          This trip is out of credits
        </div>
        <div
          style={{
            fontSize: 13,
            color: T.mist,
            textAlign: "center",
            marginBottom: 20,
            lineHeight: 1.5,
          }}
        >
          Anyone on the trip can top it up.
        </div>

        <button
          onClick={() => handleFund("small")}
          disabled={!!funding}
          style={rowStyle(true)}
        >
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 3 }}>
            ➕ Add credits to this trip
          </div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>
            {funding
              ? isAndroidApp()
                ? "Opening Google Play…"
                : "Opening checkout…"
              : "300 · $4.99  ·  1000 · $9.99 — shared with everyone"}
          </div>
        </button>

        {/* Larger pool pack — same fund flow, different pack id. */}
        {!funding && (
          <button
            onClick={() => handleFund("large")}
            disabled={!!funding}
            style={{
              ...rowStyle(false),
              padding: "10px 16px",
              textAlign: "center",
              color: T.mist,
              fontSize: 13,
              marginBottom: 10,
            }}
          >
            Add 1000 credits · $9.99
          </button>
        )}

        <button
          onClick={handleUsePersonal}
          disabled={!!funding}
          style={rowStyle(false)}
        >
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 3 }}>
            👛 Use my personal credits{" "}
            <span style={{ color: T.mist, fontWeight: 400 }}>
              ({displayCredits(personalCredits)})
            </span>
          </div>
          <div style={{ fontSize: 12, color: T.mist }}>
            Just for this action. We'll ask again next visit.
          </div>
        </button>

        {fundError && (
          <div
            style={{
              fontSize: 12,
              color: T.error,
              textAlign: "center",
              marginBottom: 10,
            }}
          >
            {fundError}
          </div>
        )}

        <div
          style={{
            fontSize: 11,
            color: T.mist,
            textAlign: "center",
            lineHeight: 1.5,
            marginTop: 6,
          }}
        >
          Your personal balance is never spent on a shared trip unless you
          choose to.
        </div>
      </div>
      <style>{`@keyframes slideUp { from { transform: translateY(20%); opacity: 0 } to { transform: translateY(0); opacity: 1 } }`}</style>
    </div>
  );
}

// ── Trip Credits sheet (Phase 2.5) ──
// Opened from the shared-trip pool pill. Shows the pooled balance, credit
// packs that fund the POOL (tripId threaded through fundCredits), a coupon
// option, and the protected personal-wallet line. Rendered from App.jsx with
// the current trip/members/session; only mounted on a shared trip.
export function TripCreditsSheet({ trip, members = [], session, onClose }) {
  const personalCredits = useCredits();
  const [showCoupon, setShowCoupon] = useState(false);
  const [funding, setFunding] = useState(null); // packId or null
  const [fundError, setFundError] = useState("");

  useEffect(() => {
    if (session?.user?.id) refreshCredits(session.user.id);
  }, [session?.user?.id]);

  const tripId = trip?.id || null;
  // Clamp to >= 0 — the pool can go slightly negative but never shows negative.
  const poolBalance = Math.max(
    0,
    Math.floor(Number(trip?.credit_balance) || 0),
  );

  async function handleFund(packId) {
    setFundError("");
    setFunding(packId);
    const result = await fundCredits(packId, { tripId, session });
    setFunding(null);
    if (result.cancelled) return;
    if (result.error) {
      setFundError(result.error);
      return;
    }
    if (session?.user?.id) await refreshCredits(session.user.id);
    onClose?.();
  }

  return (
    <>
      <div
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose?.();
        }}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9998,
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
          <div
            style={{
              fontFamily: "'DM Serif Display', Georgia, serif",
              fontSize: 22,
              textAlign: "center",
              color: T.ink,
              marginBottom: 4,
            }}
          >
            Trip credits
          </div>
          <div
            style={{
              fontSize: 12,
              color: T.mist,
              textAlign: "center",
              marginBottom: 18,
            }}
          >
            Shared by everyone on this trip
          </div>

          <div
            style={{
              background: "white",
              borderRadius: RADIUS.md,
              padding: "18px 16px",
              border: `1px solid ${T.border}`,
              textAlign: "center",
              marginBottom: 18,
            }}
          >
            <div
              style={{
                fontFamily: "'DM Serif Display', Georgia, serif",
                fontSize: 30,
                color: T.ink,
              }}
            >
              👥 {poolBalance}
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
              pooled credits
              {members.length > 1 ? ` · ${members.length} travelers` : ""}
            </div>
          </div>

          <div
            style={{
              fontSize: 11,
              color: T.mist,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              marginBottom: 8,
            }}
          >
            Add credits to this trip
          </div>
          {PACKS.map((pack) => (
            <button
              key={pack.id}
              onClick={() => handleFund(pack.id)}
              disabled={!!funding}
              style={{
                width: "100%",
                padding: 14,
                borderRadius: RADIUS.md,
                border: "none",
                fontFamily: "Georgia, serif",
                fontSize: 15,
                fontWeight: 600,
                background: funding
                  ? T.disabled
                  : `linear-gradient(135deg, ${T.ocean}, ${T.dusk})`,
                color: "white",
                cursor: funding ? "not-allowed" : "pointer",
                marginBottom: 8,
                transition: `background ${MOTION.fast}`,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>
                {funding === pack.id
                  ? isAndroidApp()
                    ? "Opening Google Play…"
                    : "Opening checkout…"
                  : pack.label}
              </span>
              {funding !== pack.id && (
                <span style={{ opacity: 0.85, fontSize: 14 }}>
                  {pack.price}
                </span>
              )}
            </button>
          ))}
          {fundError && (
            <div
              style={{
                fontSize: 12,
                color: T.error,
                textAlign: "center",
                marginBottom: 8,
              }}
            >
              {fundError}
            </div>
          )}
          <button
            onClick={() => {
              setFundError("");
              setShowCoupon(true);
            }}
            style={{
              width: "100%",
              padding: 12,
              borderRadius: RADIUS.md,
              border: `1px solid ${T.border}`,
              background: "white",
              color: T.mist,
              fontFamily: "Georgia, serif",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              marginBottom: 8,
            }}
          >
            🎟 Redeem a coupon
          </button>
          <div
            style={{
              fontSize: 11,
              color: T.mist,
              textAlign: "center",
              lineHeight: 1.5,
              margin: "6px 0 16px",
            }}
          >
            Credits you add are shared with the whole trip and stay with it if
            you leave.
          </div>

          <div
            style={{
              background: T.skyLight,
              border: `1px solid ${T.skyBorder}`,
              borderRadius: RADIUS.md,
              padding: "12px 14px",
              marginBottom: 8,
            }}
          >
            <div
              style={{
                fontSize: 13,
                color: T.ink,
                fontFamily: "Georgia, serif",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>Your personal wallet</span>
              <b>{displayCredits(personalCredits)}</b>
            </div>
            <div style={{ fontSize: 11, color: T.mist, marginTop: 3 }}>
              Yours — never spent on a shared trip unless you choose to.
            </div>
          </div>

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
            Close
          </button>
        </div>
        <style>{`@keyframes slideUp { from { transform: translateY(20%); opacity: 0 } to { transform: translateY(0); opacity: 1 } }`}</style>
      </div>
      <CouponModal
        open={showCoupon}
        onClose={() => setShowCoupon(false)}
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
      window.history.replaceState(
        {},
        "",
        window.location.pathname + (q ? `?${q}` : ""),
      );
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
      <ForkPaywallSheet session={session} />
    </>
  );
}
