import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import { confirmSheet } from "./dialogs.jsx";
import { T, RADIUS, SHADOW, MOTION } from "./theme";
import PendingInvitesBanner from "./PendingInvitesBanner.jsx";

function tripStatus(startDate, endDate, igResponse) {
  // Draft = RG done but no IG yet (ig_response is null)
  if (!igResponse) return { label: "Planning", color: T.gold };
  const now = new Date();
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (end < now) return { label: "Past", color: T.mist };
  if (start <= now && end >= now)
    return { label: "In Progress", color: T.moss };
  return { label: "Upcoming", color: T.sky };
}

function daysBetween(startDate, endDate) {
  const diff = new Date(endDate) - new Date(startDate);
  return Math.round(diff / (1000 * 60 * 60 * 24)) + 1;
}

function formatDateRange(startDate, endDate) {
  const opts = { month: "short", day: "numeric" };
  const s = new Date(startDate).toLocaleDateString("en-US", opts);
  const e = new Date(endDate).toLocaleDateString("en-US", {
    ...opts,
    year: "numeric",
  });
  return `${s} – ${e}`;
}

function fmtTs(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function Home({
  session,
  onOpenTrip,
  onOpenTripById,
  onCreateTrip,
  onEditTrip,
}) {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const [infoOpenId, setInfoOpenId] = useState(null);

  async function deleteTrip(e, tripId) {
    e.stopPropagation();
    const ok = await confirmSheet({
      title: "Delete this trip?",
      message:
        "The itinerary, board, and chat history will be permanently deleted. This can't be undone.",
      confirmLabel: "Delete trip",
      danger: true,
    });
    if (!ok) return;
    setDeletingId(tripId);
    await supabase
      .from("activities")
      .delete()
      .in(
        "day_id",
        (
          await supabase.from("days").select("id").eq("trip_id", tripId)
        ).data?.map((d) => d.id) || [],
      );
    await supabase.from("days").delete().eq("trip_id", tripId);
    await supabase.from("trip_members").delete().eq("trip_id", tripId);
    await supabase.from("trips").delete().eq("id", tripId);
    setTrips((prev) => prev.filter((t) => t.id !== tripId));
    setDeletingId(null);
  }

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      // Fetch the current user's trip memberships. Profile + face icon are
      // now owned by the global Avatar component (mounted in main.jsx), so
      // we don't need to load the profile here anymore.
      const { data: myMemberships } = await supabase
        .from("trip_members")
        .select("trip_id, role")
        .eq("user_id", session.user.id);

      if (!myMemberships?.length) {
        setLoading(false);
        return;
      }

      const tripIds = myMemberships.map((m) => m.trip_id);

      // 2. Fetch the trips
      const { data: tripsData } = await supabase
        .from("trips")
        .select("*")
        .in("id", tripIds)
        .order("created_at", { ascending: false });

      setTrips(tripsData || []);
      // Cache for offline
      try {
        localStorage.setItem("tripjam_trips", JSON.stringify(tripsData || []));
      } catch {}
    } catch (err) {
      console.error("fetchData error:", err);
      // Offline fallback
      try {
        const cached = localStorage.getItem("tripjam_trips");
        if (cached) setTrips(JSON.parse(cached));
      } catch {}
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        // The app body is position:fixed/overflow:hidden (index.html), so
        // Home must own its scrolling — minHeight alone left the trip list
        // unscrollable past the first viewport.
        height: "100dvh",
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
        background: T.bgPage,
        fontFamily: "Georgia, serif",
      }}
    >
      {/* Header — TripJam wordmark on the left. The right-side avatar/menu
          was removed: the global D20 Avatar component (mounted in main.jsx)
          already lives at top:12 / right:12 and handles face icon, username,
          credits balance, top-up, and sign-out. Two avatars at the same
          position were stacking on top of each other. */}
      <div
        style={{
          background: T.chalk,
          borderBottom: `1px solid ${T.border}`,
          padding: "0 24px",
          height: 60,
          display: "flex",
          alignItems: "center",
          // Left-align the wordmark; leave the right-side reserved for the
          // global Avatar overlay so it doesn't collide with header content.
          paddingRight: 64,
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 20 }}>✈️</span>
          <span
            style={{
              fontFamily: "'DM Serif Display', serif",
              fontWeight: 700,
              fontSize: 16,
              color: T.ink,
            }}
          >
            TripJam
          </span>
        </div>
      </div>

      {/* Main content */}
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
        {/* Pending co-traveller invites (behind INVITE_ENABLED). Persistent
            until Accept/Decline. */}
        <PendingInvitesBanner
          session={session}
          onOpenTripById={onOpenTripById}
        />

        {/* Page title + new trip button (hidden in empty state — CTA is in the empty card) */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 28,
          }}
        >
          <div>
            <h1
              style={{
                fontFamily: "'DM Serif Display', serif",
                fontSize: 22,
                fontWeight: 700,
                color: T.ink,
                margin: 0,
              }}
            >
              Your Trips
            </h1>
            {!loading && trips.length > 0 && (
              <p style={{ fontSize: 13, color: T.mist, margin: "4px 0 0" }}>
                {trips.length} trip{trips.length !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          {trips.length > 0 && (
            <button
              onClick={onCreateTrip}
              style={{
                background: T.ocean,
                color: T.chalk,
                border: "none",
                borderRadius: RADIUS.md,
                padding: "10px 18px",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                transition: `all ${MOTION.normal}`,
              }}
            >
              <span style={{ fontSize: 16 }}>+</span> New Trip
            </button>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div
            style={{
              textAlign: "center",
              padding: "60px 0",
              color: T.mist,
              fontSize: 14,
            }}
          >
            Loading your trips...
          </div>
        )}

        {/* Empty state */}
        {!loading && trips.length === 0 && (
          <div
            style={{
              textAlign: "center",
              padding: "64px 24px",
              background: T.chalk,
              borderRadius: RADIUS.lg,
              border: `1px solid ${T.border}`,
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 16 }}>🗺️</div>
            <h2
              style={{
                fontFamily: "'DM Serif Display', serif",
                fontSize: 18,
                fontWeight: 600,
                color: T.ink,
                margin: "0 0 8px",
              }}
            >
              No trips yet
            </h2>
            <p style={{ fontSize: 14, color: T.mist, margin: "0 0 24px" }}>
              Create your first trip and start planning together.
            </p>
            <button
              onClick={onCreateTrip}
              style={{
                background: T.ocean,
                color: T.chalk,
                border: "none",
                borderRadius: RADIUS.md,
                padding: "12px 24px",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                transition: `all ${MOTION.normal}`,
              }}
            >
              Create a Trip
            </button>
          </div>
        )}

        {/* Trip cards */}
        {!loading && trips.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {trips.map((trip) => {
              const status = tripStatus(
                trip.start_date,
                trip.end_date,
                trip.ig_response,
              );
              const days = daysBetween(trip.start_date, trip.end_date);
              return (
                <div
                  key={trip.id}
                  onClick={() =>
                    status.label === "Planning"
                      ? onEditTrip(trip)
                      : onOpenTrip(trip)
                  }
                  style={{
                    background: T.chalk,
                    borderRadius: RADIUS.lg,
                    border: `1px solid ${T.border}`,
                    padding: "20px 22px",
                    cursor: "pointer",
                    boxShadow: SHADOW.sm,
                    transition: `all ${MOTION.normal}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 16,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow = SHADOW.md;
                    e.currentTarget.style.transform = "translateY(-1px)";
                    e.currentTarget.style.borderColor = T.mist;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = SHADOW.sm;
                    e.currentTarget.style.transform = "none";
                    e.currentTarget.style.borderColor = T.border;
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 4,
                      }}
                    >
                      <h3
                        style={{
                          fontSize: 15,
                          fontWeight: 600,
                          color: T.ink,
                          margin: 0,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {trip.name}
                      </h3>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: status.color,
                          background: `${status.color}18`,
                          borderRadius: RADIUS.sm,
                          padding: "2px 8px",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {status.label}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        flexWrap: "wrap",
                      }}
                    >
                      <span style={{ fontSize: 13, color: T.mist }}>
                        📍 {trip.destination}
                      </span>
                      <span style={{ fontSize: 13, color: T.mist }}>
                        🗓 {formatDateRange(trip.start_date, trip.end_date)}
                      </span>
                      <span style={{ fontSize: 13, color: T.mist }}>
                        {days} day{days !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>

                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    {/* Info tooltip */}
                    <div style={{ position: "relative" }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setInfoOpenId(
                            infoOpenId === trip.id ? null : trip.id,
                          );
                        }}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          fontSize: 14,
                          color: T.disabled,
                          padding: "4px",
                          lineHeight: 1,
                        }}
                        title="Trip info"
                      >
                        ⓘ
                      </button>
                      {infoOpenId === trip.id && (
                        <>
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              setInfoOpenId(null);
                            }}
                            style={{ position: "fixed", inset: 0, zIndex: 99 }}
                          />
                          <div
                            style={{
                              position: "absolute",
                              right: 0,
                              top: 28,
                              zIndex: 100,
                              background: T.chalk,
                              borderRadius: RADIUS.md,
                              boxShadow: SHADOW.md,
                              border: `1px solid ${T.border}`,
                              padding: "10px 14px",
                              minWidth: 210,
                              whiteSpace: "nowrap",
                            }}
                          >
                            <div
                              style={{
                                fontSize: 11,
                                color: T.mist,
                                marginBottom: 6,
                                fontWeight: 600,
                                textTransform: "uppercase",
                                letterSpacing: 0.5,
                              }}
                            >
                              Trip info
                            </div>
                            <div
                              style={{
                                fontSize: 12,
                                color: T.ink,
                                marginBottom: 4,
                              }}
                            >
                              <span style={{ color: T.mist }}>Generated </span>
                              {fmtTs(trip.created_at)}
                            </div>
                            <div style={{ fontSize: 12, color: T.ink }}>
                              <span style={{ color: T.mist }}>Modified </span>
                              {fmtTs(trip.updated_at)}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditTrip(trip);
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontSize: 15,
                        color: T.disabled,
                        padding: "4px",
                      }}
                      title="Edit trip"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={(e) => deleteTrip(e, trip.id)}
                      disabled={deletingId === trip.id}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontSize: 15,
                        color: T.disabled,
                        padding: "4px",
                        opacity: deletingId === trip.id ? 0.4 : 1,
                      }}
                      title="Delete trip"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
