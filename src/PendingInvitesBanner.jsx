// Home pending-invite banner — the invitee's in-app "you've been invited"
// surface for account-targeted invites. Persistent (no dismiss); resolved only
// by Accept/Decline. Styled after LowCreditsBanner but rendered in-flow inside
// Home's content container. Gated behind INVITE_ENABLED.

import { useEffect, useState } from "react";
import { T, RADIUS, SHADOW, MOTION } from "./theme";
import { showToast, confirmSheet } from "./dialogs.jsx";
import MemberAvatar from "./MemberAvatar.jsx";
import {
  INVITE_ENABLED,
  listPendingInvites,
  respondInvite,
} from "./members.js";

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

const card = {
  background: T.warm,
  borderTop: `2px solid ${T.ocean}`,
  borderRadius: RADIUS.md,
  boxShadow: SHADOW.sm,
  padding: "16px 18px",
  marginBottom: 24,
  animation: `invitesSlideIn ${MOTION.slow}`,
};

const KEYFRAMES = (
  <style>{`@keyframes invitesSlideIn { from { transform: translateY(-8px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }`}</style>
);

export default function PendingInvitesBanner({ session, onOpenTripById }) {
  const [invites, setInvites] = useState(null); // null = loading, [] = none
  const [actingId, setActingId] = useState(null);

  useEffect(() => {
    if (!INVITE_ENABLED || !session?.user?.id) return;
    let cancelled = false;
    listPendingInvites().then((list) => !cancelled && setInvites(list || []));
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  if (!INVITE_ENABLED || !session?.user?.id) return null;

  // Loading shimmer (single row).
  if (invites === null) {
    return (
      <div style={card}>
        <div
          style={{
            height: 44,
            borderRadius: RADIUS.sm,
            background: `linear-gradient(90deg, ${T.sand}, ${T.warm}, ${T.sand})`,
            opacity: 0.6,
          }}
        />
        {KEYFRAMES}
      </div>
    );
  }

  if (invites.length === 0) return null;

  const tripLabel = (inv) => inv.trip_name || inv.destination || "a trip";

  const accept = async (inv) => {
    if (actingId) return;
    setActingId(inv.invite_id);
    try {
      const tripId = await respondInvite(inv.invite_id, true);
      showToast(`You joined "${tripLabel(inv)}"`);
      if (tripId) onOpenTripById?.(tripId);
      else
        setInvites((prev) => prev.filter((x) => x.invite_id !== inv.invite_id));
    } catch {
      showToast("Couldn't join — try again");
      setActingId(null);
    }
  };

  const decline = async (inv) => {
    if (actingId) return;
    const ok = await confirmSheet({
      title: `Decline invite to "${tripLabel(inv)}"?`,
      confirmLabel: "Decline",
      cancelLabel: "Keep",
      danger: true,
    });
    if (!ok) return;
    setActingId(inv.invite_id);
    try {
      await respondInvite(inv.invite_id, false);
      setInvites((prev) => prev.filter((x) => x.invite_id !== inv.invite_id));
      showToast("Invite declined");
    } catch {
      showToast("Couldn't decline — try again");
    } finally {
      setActingId(null);
    }
  };

  const ghostBtn = {
    background: "transparent",
    color: T.mist,
    border: `1px solid ${T.border}`,
    borderRadius: RADIUS.sm,
    fontFamily: "Georgia, serif",
    fontWeight: 600,
    cursor: "pointer",
  };
  const acceptBtn = {
    background: T.ocean,
    color: T.chalk,
    border: "none",
    borderRadius: RADIUS.sm,
    fontFamily: "Georgia, serif",
    fontWeight: 700,
    cursor: "pointer",
  };

  // Single invite — full card.
  if (invites.length === 1) {
    const inv = invites[0];
    const acting = actingId === inv.invite_id;
    return (
      <div style={card}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <MemberAvatar name={inv.inviter || "?"} size={38} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, lineHeight: 1.5, color: T.ink }}>
              <strong>{inv.inviter || "Someone"}</strong> invited you to{" "}
              <strong style={{ fontFamily: "'DM Serif Display', serif" }}>
                “{tripLabel(inv)}”
              </strong>
            </div>
            <div style={{ fontSize: 12, color: T.mist, marginTop: 3 }}>
              📅 {fmtDates(inv.start_date, inv.end_date)} · {inv.member_count}{" "}
              traveller{inv.member_count === 1 ? "" : "s"}
            </div>
            <div style={{ fontSize: 12, color: T.mist, marginTop: 6 }}>
              You'll be able to edit the plan and chat with Trippy together.
            </div>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 14,
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={() => decline(inv)}
            disabled={acting}
            style={{ ...ghostBtn, padding: "8px 16px", fontSize: 13 }}
          >
            Decline
          </button>
          <button
            onClick={() => accept(inv)}
            disabled={acting}
            style={{
              ...acceptBtn,
              padding: "8px 18px",
              fontSize: 13,
              opacity: acting ? 0.7 : 1,
            }}
          >
            {acting ? "Joining…" : "Accept →"}
          </button>
        </div>
        {KEYFRAMES}
      </div>
    );
  }

  // Multiple invites — compact list.
  return (
    <div style={card}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 14,
          fontWeight: 700,
          color: T.ink,
          marginBottom: 12,
        }}
      >
        ✉️ Invitations ({invites.length})
      </div>
      {invites.map((inv, i) => {
        const acting = actingId === inv.invite_id;
        return (
          <div
            key={inv.invite_id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 0",
              borderTop: i === 0 ? "none" : `1px solid ${T.border}`,
            }}
          >
            <MemberAvatar name={inv.inviter || "?"} size={30} />
            <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: T.ink }}>
              <strong>{inv.inviter || "Someone"}</strong> →{" "}
              <span style={{ fontFamily: "'DM Serif Display', serif" }}>
                “{tripLabel(inv)}”
              </span>
              <span style={{ color: T.mist }}>
                {" "}
                · {fmtDates(inv.start_date, inv.end_date)}
              </span>
            </div>
            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              <button
                onClick={() => decline(inv)}
                disabled={acting}
                style={{ ...ghostBtn, padding: "5px 11px", fontSize: 12 }}
              >
                Decline
              </button>
              <button
                onClick={() => accept(inv)}
                disabled={acting}
                style={{
                  ...acceptBtn,
                  padding: "5px 12px",
                  fontSize: 12,
                  opacity: acting ? 0.7 : 1,
                }}
              >
                {acting ? "…" : "Accept"}
              </button>
            </div>
          </div>
        );
      })}
      {KEYFRAMES}
    </div>
  );
}
