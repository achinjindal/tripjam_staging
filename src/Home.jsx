import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import { confirmSheet, showToast } from "./dialogs.jsx";
import { fetchMembers, leaveTrip, memberName } from "./members.js";
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

// Trip names carry an auto-appended date range ("Japan · Oct 7–Oct 13") —
// redundant on cards where dates render on the next line, and the main
// reason titles truncated instantly on phones. Strip ONLY that suffix.
function displayTripName(name) {
  return (name || "").replace(
    /\s*·\s*[A-Z][a-z]{2}\s?\d{1,2}\s*[–-]\s*[A-Z][a-z]{2}\s?\d{1,2}$/,
    "",
  );
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

  // The owner deletes the trip for everyone (one RPC; rows cascade). Anyone
  // else only leaves it: the old client-side deletes, run by a co-member,
  // wiped the shared itinerary for the whole group.
  async function deleteTrip(e, trip) {
    e.stopPropagation();
    const isOwner = trip.owner_id === session.user.id;
    let others = [];
    if (isOwner) {
      // fetchMembers returns [] on an RPC error; the catch covers a network
      // throw, so the sheet still opens (without the names).
      others = (await fetchMembers(trip.id).catch(() => [])).filter(
        (m) => m.user_id !== session.user.id,
      );
    }
    const names = others.map((m) => memberName(m, session.user.id));
    const ok = await confirmSheet(
      !isOwner
        ? {
            title: "Leave this trip?",
            message:
              "It will disappear from your trips. Everyone else keeps it, and the owner can invite you back.",
            confirmLabel: "Leave trip",
            danger: true,
          }
        : {
            title: "Delete this trip?",
            message: names.length
              ? `This deletes it for everyone: ${names.join(", ")} will lose the itinerary, board, and chat too. This can't be undone.`
              : "The itinerary, board, and chat history will be permanently deleted. This can't be undone.",
            confirmLabel: names.length ? "Delete for everyone" : "Delete trip",
            danger: true,
          },
    );
    if (!ok) return;
    setDeletingId(trip.id);
    try {
      if (isOwner) {
        const { error } = await supabase.rpc("delete_trip", {
          p_trip: trip.id,
        });
        if (error) throw error;
      } else {
        await leaveTrip(trip.id);
      }
      setTrips((prev) => prev.filter((t) => t.id !== trip.id));
    } catch (err) {
      console.error("deleteTrip failed:", err);
      showToast(
        isOwner ? "Couldn't delete the trip" : "Couldn't leave the trip",
      );
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      // Fetch the current user's trip memberships. Profile + face icon are
      // now owned by the global Avatar component (mounted in main.jsx), so
      // we don't need to load the profile here anymore.
      const { data: myMemberships, error: membersErr } = await supabase
        .from("trip_members")
        .select("trip_id, role")
        .eq("user_id", session.user.id);
      // postgrest-js RESOLVES on a network/HTTP failure — it does not reject.
      // So `error` has to be read explicitly, or an offline load falls into
      // `!myMemberships?.length` and returns "No trips yet" having never
      // consulted the cache. Throw so the offline fallback below runs.
      if (membersErr) throw membersErr;

      if (!myMemberships.length) {
        // A genuine empty state (the query succeeded), so the cache must
        // follow — otherwise deleting your last trip resurrects it offline.
        setTrips([]);
        try {
          localStorage.removeItem("tripjam_trips");
        } catch {}
        setLoading(false);
        return;
      }

      const tripIds = myMemberships.map((m) => m.trip_id);

      // 2. Fetch the trips — SLIM columns only. select("*") was pulling
      // every trip's ig_response/magazine/inspirations JSONB (multi-MB over
      // the wire on mobile) just to paint cards; has_itinerary is a
      // PostgREST computed column replacing the ig_response truthiness
      // check. The full trip is fetched on card open (onOpenTripById).
      const TRIP_LIST_COLS =
        "id,name,destination,start_date,end_date,created_by,owner_id,origin_city," +
        "arrival_time,departure_time,created_at,updated_at,arrival_city," +
        "departure_city,summary,notes,arrival_mode,departure_mode,has_car," +
        "share_token,ig_count,budget_amount,budget_currency,base_location," +
        "arrival_airport_iata,departure_airport_iata,has_itinerary";
      const { data: tripsData, error: tripsErr } = await supabase
        .from("trips")
        .select(TRIP_LIST_COLS)
        .in("id", tripIds)
        .order("created_at", { ascending: false });
      if (tripsErr) throw tripsErr;

      setTrips(tripsData || []);
      // Cache for offline
      try {
        localStorage.setItem("tripjam_trips", JSON.stringify(tripsData || []));
      } catch {}
    } catch (err) {
      console.error("fetchData error:", err);
      // Offline fallback. Two rules here, both learned the hard way:
      //   1. RESTORE from the cache — this is the path that exists for a
      //      paused project, a dead network, or an ISP hijacking
      //      *.supabase.co (all three have happened in production).
      //   2. Do NOT write to the cache. The old code reached
      //      `setItem(…, JSON.stringify(tripsData || []))` on a failed
      //      fetch and overwrote it with [], so one transient fault
      //      permanently destroyed the user's offline copy and the app
      //      showed "No trips yet" with a Create CTA.
      let restored = 0;
      try {
        const cached = localStorage.getItem("tripjam_trips");
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length) {
            setTrips(parsed);
            restored = parsed.length;
          }
        }
      } catch {}
      // Never let a load failure masquerade as an empty account.
      showToast(
        restored
          ? "Offline — showing your saved trips"
          : "Couldn't load your trips. Check your connection and retry.",
      );
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
                // Slim rows carry has_itinerary; old cached full rows (and
                // any other caller) still pass ig_response.
                trip.has_itinerary ?? trip.ig_response,
              );
              const days = daysBetween(trip.start_date, trip.end_date);
              return (
                <div
                  key={trip.id}
                  onClick={() =>
                    status.label === "Planning"
                      ? onEditTrip(trip)
                      : // Slim list rows lack the trip-screen blobs — fetch
                        // the full trip on open (slim row as offline
                        // fallback).
                        onOpenTripById(trip.id, trip)
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
                          overflow: "hidden",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          lineHeight: 1.3,
                        }}
                      >
                        {displayTripName(trip.name)}
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
                      onClick={(e) => deleteTrip(e, trip)}
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
                      title={
                        trip.owner_id === session.user.id
                          ? "Delete trip"
                          : "Leave trip"
                      }
                      aria-label={
                        trip.owner_id === session.user.id
                          ? "Delete trip"
                          : "Leave trip"
                      }
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
