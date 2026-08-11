// WS6 — one-time briefing after joining a trip (Gap 4: the join airlock).
// Fully deterministic — assembled from trip state, zero LLM calls. Shown once
// per (trip, user), triggered by the `tripjam_just_joined_<tripId>` flag the
// accept paths set (JoinTrip link flow + PendingInvitesBanner).
import { T, RADIUS, SHADOW } from "../theme";

export default function WelcomeSheet({
  trip,
  days = [],
  routes = [],
  polls = [],
  members = [],
  selfId = null,
  onShareStyle,
  onClose,
}) {
  const fmt = (d) =>
    d
      ? new Date(d).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })
      : null;
  const dates =
    fmt(trip?.start_date) && fmt(trip?.end_date)
      ? `${fmt(trip.start_date)} – ${fmt(trip.end_date)}`
      : null;
  const others = (members || [])
    .filter((m) => m.user_id !== selfId)
    .map((m) => m.profiles?.username || "a co-traveller");
  const openPolls = (polls || []).filter((p) => p.status === "open").length;
  const liveRoutes = (routes || []).filter((r) => !r.dismissed);

  const lines = [];
  if (days?.length)
    lines.push(
      `The day-by-day plan is ready — ${days.length} days mapped out.`,
    );
  else if (liveRoutes.length)
    lines.push(
      `${liveRoutes.length} route idea${liveRoutes.length === 1 ? "" : "s"} on the table — nothing locked in yet.`,
    );
  else lines.push("Planning is just getting started.");
  if (others.length)
    lines.push(
      `You're travelling with ${others.slice(0, 3).join(", ")}${others.length > 3 ? ` and ${others.length - 3} more` : ""}.`,
    );
  if (openPolls)
    lines.push(
      `${openPolls} open poll${openPolls === 1 ? "" : "s"} waiting for your vote.`,
    );

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10001,
        background: "rgba(15,25,35,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          background: T.warm,
          borderRadius: 22,
          padding: "24px 20px",
          width: "100%",
          maxWidth: 440,
          boxShadow: SHADOW.lg,
        }}
      >
        <div
          style={{
            fontFamily: "'DM Serif Display', serif",
            fontSize: 21,
            color: T.ink,
          }}
        >
          You're on the trip 🎉
        </div>
        <div
          style={{
            fontSize: 13.5,
            color: T.ink,
            fontFamily: "Georgia,serif",
            marginTop: 4,
          }}
        >
          {trip?.name || trip?.destination || "Your trip"}
          {dates ? ` · ${dates}` : ""}
        </div>
        <div style={{ margin: "14px 0 18px" }}>
          {lines.map((l, i) => (
            <div
              key={i}
              style={{
                fontSize: 13,
                color: T.mist,
                fontFamily: "Georgia,serif",
                lineHeight: 1.6,
              }}
            >
              {l}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          <button
            onClick={onShareStyle}
            style={{
              padding: 13,
              borderRadius: RADIUS.lg,
              border: "none",
              background: `linear-gradient(135deg, ${T.ocean}, ${T.dusk})`,
              color: T.chalk,
              fontFamily: "'DM Serif Display', serif",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            Share your travel style
          </button>
          <button
            onClick={onClose}
            style={{
              padding: 11,
              borderRadius: RADIUS.lg,
              border: `1.5px solid ${T.border}`,
              background: "transparent",
              color: T.mist,
              fontFamily: "Georgia,serif",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Look around first
          </button>
        </div>
      </div>
    </div>
  );
}
