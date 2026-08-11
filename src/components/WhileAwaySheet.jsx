// Phase 3 — "While you were away" sheet. Auto-shown on trip open when there are
// unseen changes (others' changes since your last_seen_at). Condensed rollup,
// max ~5 bullets + "+N more". Either action stamps last_seen_at. Shared-only.

import { T, RADIUS, SHADOW, MOTION } from "../theme";

const nameFor = (members, uid, selfId) => {
  if (uid === selfId) return "You";
  return (
    members.find((m) => m.user_id === uid)?.profiles?.username || "Traveler"
  );
};

const MAX_BULLETS = 5;

export default function WhileAwaySheet({
  members = [],
  session,
  unseen = [],
  sinceLabel,
  onReview,
  onDismiss,
}) {
  const selfId = session?.user?.id;
  const shown = unseen.slice(0, MAX_BULLETS);
  const more = unseen.length - shown.length;

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onDismiss?.()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10002,
        background: "rgba(15,25,35,0.45)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: T.warm,
          borderRadius: "22px 22px 0 0",
          padding: "22px 18px 28px",
          width: "100%",
          maxWidth: 480,
          maxHeight: "80vh",
          overflowY: "auto",
          boxShadow: SHADOW.lg,
          animation: `slideUp ${MOTION.normal}`,
        }}
      >
        <div
          style={{
            fontFamily: "'DM Serif Display', serif",
            fontSize: 20,
            color: T.ink,
          }}
        >
          While you were away
        </div>
        <div style={{ fontSize: 12, color: T.mist, margin: "2px 0 16px" }}>
          {unseen.length} change{unseen.length === 1 ? "" : "s"}
          {sinceLabel ? ` since ${sinceLabel}` : ""}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {shown.map((row) => (
            <div
              key={row.id}
              style={{ fontSize: 13, color: T.ink, lineHeight: 1.4 }}
            >
              <b>{nameFor(members, row.user_id, selfId)}</b>{" "}
              {row.summary || row.action}
            </div>
          ))}
          {more > 0 && (
            <div style={{ fontSize: 12, color: T.mist }}>+{more} more</div>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <div
            onClick={onReview}
            style={{
              flex: 1,
              padding: 13,
              borderRadius: RADIUS.lg,
              textAlign: "center",
              background: `linear-gradient(135deg, ${T.ocean}, ${T.dusk})`,
              color: T.chalk,
              fontFamily: "'DM Serif Display', serif",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            Review in feed →
          </div>
          <div
            onClick={onDismiss}
            style={{
              padding: "13px 20px",
              borderRadius: RADIUS.lg,
              textAlign: "center",
              border: `1px solid ${T.sand}`,
              color: T.mist,
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            Got it
          </div>
        </div>
      </div>
    </div>
  );
}
