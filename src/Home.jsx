import { useState, useEffect } from "react";
import { supabase } from "./supabase";

const FACE_ICONS = ["👦", "👧", "🧑", "👨", "👩", "🧔", "👱", "🧓", "🥸", "😎"];

const T = {
  ink:   "#0F1923",
  dusk:  "#1E2D3D",
  ocean: "#2563A8",
  sky:   "#4A90D9",
  mist:  "#8BA5BB",
  chalk: "#FFFFFF",
  terra: "#C4622D",
  moss:  "#3D7A5C",
  gold:  "#D4A847",
};

function tripStatus(startDate, endDate) {
  const now = new Date();
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (end < now) return { label: "Past", color: T.mist };
  if (start <= now && end >= now) return { label: "In Progress", color: T.moss };
  return { label: "Upcoming", color: T.sky };
}

function daysBetween(startDate, endDate) {
  const diff = new Date(endDate) - new Date(startDate);
  return Math.round(diff / (1000 * 60 * 60 * 24)) + 1;
}

function formatDateRange(startDate, endDate) {
  const opts = { month: "short", day: "numeric" };
  const s = new Date(startDate).toLocaleDateString("en-US", opts);
  const e = new Date(endDate).toLocaleDateString("en-US", { ...opts, year: "numeric" });
  return `${s} – ${e}`;
}

function fmtTs(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function Home({ session, onOpenTrip, onCreateTrip, onEditTrip }) {
  const [profile, setProfile] = useState(null);
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showMenu, setShowMenu] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [infoOpenId, setInfoOpenId] = useState(null);

  async function deleteTrip(e, tripId) {
    e.stopPropagation();
    if (!confirm("Delete this trip? This can't be undone.")) return;
    setDeletingId(tripId);
    await supabase.from("activities").delete().in(
      "day_id",
      (await supabase.from("days").select("id").eq("trip_id", tripId)).data?.map(d => d.id) || []
    );
    await supabase.from("days").delete().eq("trip_id", tripId);
    await supabase.from("trip_members").delete().eq("trip_id", tripId);
    await supabase.from("invite_links").delete().eq("trip_id", tripId);
    await supabase.from("trips").delete().eq("id", tripId);
    setTrips(prev => prev.filter(t => t.id !== tripId));
    setDeletingId(null);
  }

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      // 1. Fetch current user's profile + their trip memberships in parallel
      const [{ data: prof }, { data: myMemberships }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", session.user.id).single(),
        supabase.from("trip_members").select("trip_id, role").eq("user_id", session.user.id),
      ]);
      setProfile(prof);

      if (!myMemberships?.length) { setLoading(false); return; }

      const tripIds = myMemberships.map(m => m.trip_id);
      const roleByTripId = Object.fromEntries(myMemberships.map(m => [m.trip_id, m.role]));

      // 2. Fetch the trips + all members of those trips in parallel
      const [{ data: tripsData }, { data: allMembers }] = await Promise.all([
        supabase.from("trips").select("*").in("id", tripIds).order("created_at", { ascending: false }),
        supabase.from("trip_members").select("trip_id, user_id").in("trip_id", tripIds),
      ]);

      // 3. Fetch profiles for every member user_id
      const memberUserIds = [...new Set((allMembers || []).map(m => m.user_id))];
      const { data: profiles } = await supabase
        .from("profiles").select("id, username, face_icon").in("id", memberUserIds);

      const profileById = Object.fromEntries((profiles || []).map(p => [p.id, p]));

      // 4. Assemble
      const assembled = (tripsData || []).map(trip => ({
        ...trip,
        myRole: roleByTripId[trip.id],
        trip_members: (allMembers || [])
          .filter(m => m.trip_id === trip.id)
          .map(m => ({ ...m, profiles: profileById[m.user_id] || null })),
      }));

      setTrips(assembled);
    } catch (err) {
      console.error("fetchData error:", err);
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  const faceIcon = profile ? FACE_ICONS[(profile.face_icon || 1) - 1] : "👤";

  return (
    <div style={{
      minHeight: "100vh",
      background: "#F7F8FA",
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
    }}>
      {/* Header */}
      <div style={{
        background: T.chalk,
        borderBottom: "1px solid #E8EAF0",
        padding: "0 24px",
        height: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 20 }}>✈️</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: T.ink }}>TripJam</span>
        </div>

        {/* Avatar + menu */}
        <div style={{ position: "relative" }}>
          <button onClick={() => setShowMenu(!showMenu)} style={{
            background: "#F0F2F5",
            border: "none",
            borderRadius: 20,
            padding: "6px 12px 6px 8px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 500,
            color: T.ink,
          }}>
            <span style={{ fontSize: 20 }}>{faceIcon}</span>
            <span>{profile?.username || "..."}</span>
          </button>

          {showMenu && (
            <div style={{
              position: "absolute",
              right: 0,
              top: 42,
              background: T.chalk,
              borderRadius: 10,
              boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
              padding: "6px 0",
              minWidth: 140,
              zIndex: 100,
            }}>
              <button onClick={signOut} style={{
                width: "100%",
                padding: "10px 16px",
                border: "none",
                background: "none",
                textAlign: "left",
                cursor: "pointer",
                fontSize: 13,
                color: "#E05C5C",
                fontWeight: 500,
              }}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main content */}
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>

        {/* Page title + new trip button */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: T.ink, margin: 0 }}>Your Trips</h1>
            {!loading && trips.length > 0 && (
              <p style={{ fontSize: 13, color: T.mist, margin: "4px 0 0" }}>{trips.length} trip{trips.length !== 1 ? "s" : ""}</p>
            )}
          </div>
          <button onClick={onCreateTrip} style={{
            background: T.ocean,
            color: T.chalk,
            border: "none",
            borderRadius: 10,
            padding: "10px 18px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}>
            <span style={{ fontSize: 16 }}>+</span> New Trip
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: "center", padding: "60px 0", color: T.mist, fontSize: 14 }}>
            Loading your trips...
          </div>
        )}

        {/* Empty state */}
        {!loading && trips.length === 0 && (
          <div style={{
            textAlign: "center",
            padding: "64px 24px",
            background: T.chalk,
            borderRadius: 16,
            border: "1px solid #E8EAF0",
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🗺️</div>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: T.ink, margin: "0 0 8px" }}>No trips yet</h2>
            <p style={{ fontSize: 14, color: T.mist, margin: "0 0 24px" }}>Create your first trip and start planning together.</p>
            <button onClick={onCreateTrip} style={{
              background: T.ocean,
              color: T.chalk,
              border: "none",
              borderRadius: 10,
              padding: "12px 24px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}>
              Create a Trip
            </button>
          </div>
        )}

        {/* Trip cards */}
        {!loading && trips.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {trips.map((trip) => {
              const status = tripStatus(trip.start_date, trip.end_date);
              const days = daysBetween(trip.start_date, trip.end_date);
              const members = trip.trip_members || [];
              return (
                <div key={trip.id} onClick={() => onOpenTrip(trip)} style={{
                  background: T.chalk,
                  borderRadius: 14,
                  border: "1px solid #E8EAF0",
                  padding: "20px 22px",
                  cursor: "pointer",
                  transition: "box-shadow 0.15s, transform 0.15s",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.08)";
                    e.currentTarget.style.transform = "translateY(-1px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = "none";
                    e.currentTarget.style.transform = "none";
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <h3 style={{ fontSize: 15, fontWeight: 600, color: T.ink, margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {trip.name}
                      </h3>
                      <span style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: status.color,
                        background: `${status.color}18`,
                        borderRadius: 6,
                        padding: "2px 8px",
                        whiteSpace: "nowrap",
                      }}>
                        {status.label}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13, color: T.mist }}>📍 {trip.destination}</span>
                      <span style={{ fontSize: 13, color: T.mist }}>🗓 {formatDateRange(trip.start_date, trip.end_date)}</span>
                      <span style={{ fontSize: 13, color: T.mist }}>{days} day{days !== 1 ? "s" : ""}</span>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {/* Info tooltip */}
                    <div style={{ position: "relative" }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); setInfoOpenId(infoOpenId === trip.id ? null : trip.id); }}
                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#CCC", padding: "4px", lineHeight: 1 }}
                        title="Trip info"
                      >ⓘ</button>
                      {infoOpenId === trip.id && (
                        <>
                          <div onClick={(e) => { e.stopPropagation(); setInfoOpenId(null); }} style={{ position: "fixed", inset: 0, zIndex: 99 }} />
                          <div style={{
                            position: "absolute", right: 0, top: 28, zIndex: 100,
                            background: T.chalk, borderRadius: 10, boxShadow: "0 4px 20px rgba(0,0,0,0.13)",
                            border: "1px solid #E8EAF0", padding: "10px 14px", minWidth: 210, whiteSpace: "nowrap",
                          }}>
                            <div style={{ fontSize: 11, color: T.mist, marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Trip info</div>
                            <div style={{ fontSize: 12, color: T.ink, marginBottom: 4 }}>
                              <span style={{ color: T.mist }}>Generated </span>{fmtTs(trip.created_at)}
                            </div>
                            <div style={{ fontSize: 12, color: T.ink }}>
                              <span style={{ color: T.mist }}>Modified </span>{fmtTs(trip.updated_at)}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                    {trip.myRole === "edit" && (
                      <>
                        <button
                          onClick={(e) => { e.stopPropagation(); onEditTrip(trip); }}
                          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, color: "#CCC", padding: "4px" }}
                          title="Edit trip"
                        >✏️</button>
                        <button
                          onClick={(e) => deleteTrip(e, trip.id)}
                          disabled={deletingId === trip.id}
                          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, color: "#CCC", padding: "4px", opacity: deletingId === trip.id ? 0.4 : 1 }}
                          title="Delete trip"
                        >🗑️</button>
                      </>
                    )}
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
