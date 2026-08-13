// Phase 3 — activity feed (bottom sheet). Opened from the header 🔔 bell.
//
// Reverse-chronological, grouped by day. Each row: actor avatar + "who did what"
// + relative time + inline Undo (undoable rows only). Info rows (member joins,
// pool top-ups) render muted with no undo. New rows prepend live via realtime.
// Shared-trip only; mounted behind INVITE_ENABLED at the call site.

import { T, RADIUS, SHADOW, MOTION } from "../theme";
import { isUndoable } from "../feed.js";

const nameFor = (members, uid, selfId) => {
  if (uid === selfId) return "You";
  return (
    members.find((m) => m.user_id === uid)?.profiles?.username || "Traveler"
  );
};

const colorFor = (uid) => {
  let h = 0;
  for (const c of uid || "") h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 45% 55%)`;
};

function relTime(iso) {
  const d = new Date(iso).getTime();
  const s = Math.max(0, (Date.now() - d) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function dayBucket(iso) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  if (same(d, y)) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const INFO_ACTIONS = new Set([
  "member_join",
  "credits_topup",
  "undo",
  "trip_created",
  "routes_generated",
  "routes_added",
  "itinerary_generated",
]);

export default function ActivityFeed({
  members = [],
  session,
  activity = [],
  onUndo,
  onClose,
}) {
  const selfId = session?.user?.id;

  // Rows that have since been undone (a later action='undo' row points at them
  // via undo_payload.undid) — annotated "· undone" and their Undo hidden.
  const undoneIds = new Set(
    (activity || [])
      .filter((r) => r.action === "undo" && r.undo_payload?.undid)
      .map((r) => r.undo_payload.undid),
  );

  // Group consecutive rows by day bucket (rows already newest-first).
  const groups = [];
  for (const row of activity) {
    const bucket = dayBucket(row.created_at);
    if (!groups.length || groups[groups.length - 1].bucket !== bucket)
      groups.push({ bucket, rows: [] });
    groups[groups.length - 1].rows.push(row);
  }

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10001,
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
          width: "100%",
          maxWidth: 480,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: SHADOW.lg,
          animation: `slideUp ${MOTION.normal}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "18px 18px 12px",
            borderBottom: `1px solid ${T.sand}`,
          }}
        >
          <div
            style={{
              fontFamily: "'DM Serif Display', serif",
              fontSize: 20,
              color: T.ink,
            }}
          >
            Activity
          </div>
          <div
            onClick={onClose}
            style={{ fontSize: 18, color: T.mist, cursor: "pointer" }}
          >
            ✕
          </div>
        </div>

        <div style={{ overflowY: "auto", padding: "8px 0 24px" }}>
          {activity.length === 0 && (
            <div
              style={{
                textAlign: "center",
                color: T.mist,
                fontFamily: "Georgia,serif",
                fontStyle: "italic",
                padding: "48px 24px",
                fontSize: 13,
              }}
            >
              No changes yet — start planning together.
            </div>
          )}

          {groups.map((g) => (
            <div key={g.bucket}>
              <div
                style={{
                  fontSize: 11,
                  color: T.mist,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  padding: "12px 18px 6px",
                }}
              >
                {g.bucket}
              </div>
              {g.rows.map((row) => {
                const info = INFO_ACTIONS.has(row.action);
                const undone = undoneIds.has(row.id);
                const undoable = isUndoable(row) && !undone;
                return (
                  <div
                    key={row.id}
                    style={{
                      display: "flex",
                      gap: 10,
                      padding: "9px 18px",
                      alignItems: "flex-start",
                      opacity: info ? 0.72 : 1,
                    }}
                  >
                    <div
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: "50%",
                        flexShrink: 0,
                        background: colorFor(row.user_id),
                        color: "#fff",
                        fontSize: 12,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        marginTop: 1,
                      }}
                    >
                      {nameFor(members, row.user_id, selfId)
                        .charAt(0)
                        .toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          color: T.ink,
                          lineHeight: 1.4,
                          textDecoration: undone ? "line-through" : "none",
                          opacity: undone ? 0.6 : 1,
                        }}
                      >
                        <b>{nameFor(members, row.user_id, selfId)}</b>{" "}
                        {row.summary || row.action}
                      </div>
                      <div
                        style={{ fontSize: 11, color: T.mist, marginTop: 1 }}
                      >
                        {relTime(row.created_at)}
                        {undone && " · undone"}
                        {undoable && onUndo && (
                          <>
                            {" · "}
                            <span
                              onClick={() => onUndo(row)}
                              style={{ color: T.ocean, cursor: "pointer" }}
                            >
                              Undo
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
