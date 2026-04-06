import { useState, useEffect } from "react";
import { supabase } from "./supabase";

const T = {
  ink: "#1A1A2E", warm: "#FDFAF6", chalk: "#FFFFFF",
  sand: "#E8E0D5", mist: "#9A8F8F", ocean: "#2563A8",
  moss: "#3D7A5C", dusk: "#4A5568",
};

function ActivityRow({ activity }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: `1px solid ${T.sand}` }}>
      <div style={{ fontSize: 20, flexShrink: 0, width: 28, textAlign: "center", marginTop: 1 }}>{activity.icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, color: T.mist, fontFamily: "Georgia,serif", flexShrink: 0 }}>{activity.time}</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.ink, fontFamily: "Georgia,serif", lineHeight: 1.3 }}>{activity.title}</div>
        </div>
        {activity.note && (
          <div style={{ fontSize: 12, color: T.mist, fontFamily: "Georgia,serif", marginTop: 3, lineHeight: 1.5 }}>{activity.note}</div>
        )}
        {activity.duration && (
          <div style={{ fontSize: 11, color: T.sand, fontFamily: "Georgia,serif", marginTop: 2 }}>⏱ {activity.duration}</div>
        )}
      </div>
    </div>
  );
}

function DayCard({ day }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{ background: T.ocean, color: "white", borderRadius: 8, padding: "4px 11px", fontFamily: "Georgia,serif", fontSize: 12, flexShrink: 0 }}>{day.label}</div>
        <div>
          <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 18, color: T.ink, lineHeight: 1 }}>{day.city}</div>
          {day.date && <div style={{ fontSize: 11, color: T.mist, fontFamily: "Georgia,serif", marginTop: 2 }}>{new Date(day.date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</div>}
        </div>
      </div>
      <div>
        {(day.activities || []).map((act, i) => (
          <ActivityRow key={i} activity={act} />
        ))}
      </div>
    </div>
  );
}

export default function TripPublicView({ token }) {
  const [trip, setTrip]   = useState(null);
  const [days, setDays]   = useState([]);
  const [status, setStatus] = useState("loading"); // loading | found | notfound

  useEffect(() => {
    async function load() {
      // Fetch trip by share token (anon, no auth)
      const { data: tripData } = await supabase
        .from("trips")
        .select("*")
        .eq("share_token", token)
        .single();

      if (!tripData) { setStatus("notfound"); return; }
      setTrip(tripData);

      // Fetch days
      const { data: daysData } = await supabase
        .from("days")
        .select("*")
        .eq("trip_id", tripData.id)
        .order("position");

      if (!daysData?.length) { setDays([]); setStatus("found"); return; }

      // Fetch activities for all days
      const dayIds = daysData.map(d => d.id);
      const { data: actsData } = await supabase
        .from("activities")
        .select("*")
        .in("day_id", dayIds)
        .order("position");

      const actsByDay = (actsData || []).reduce((acc, a) => {
        (acc[a.day_id] = acc[a.day_id] || []).push(a);
        return acc;
      }, {});

      setDays(daysData.map(d => ({ ...d, activities: actsByDay[d.id] || [] })));
      setStatus("found");
    }
    load();
  }, [token]);

  if (status === "loading") {
    return (
      <div style={{ minHeight: "100dvh", background: T.warm, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: "Georgia,serif", fontSize: 14, color: T.mist }}>Loading trip…</div>
      </div>
    );
  }

  if (status === "notfound") {
    return (
      <div style={{ minHeight: "100dvh", background: T.warm, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🗺️</div>
        <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 22, color: T.ink, marginBottom: 8 }}>Trip not found</div>
        <div style={{ fontFamily: "Georgia,serif", fontSize: 14, color: T.mist }}>This link may have expired or been removed.</div>
      </div>
    );
  }

  const startDate = trip.start_date ? new Date(trip.start_date + "T00:00:00") : null;
  const endDate   = trip.end_date   ? new Date(trip.end_date   + "T00:00:00") : null;
  const dateStr   = startDate && endDate
    ? `${startDate.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${endDate.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
    : "";

  return (
    <div style={{ fontFamily: "Georgia,serif", background: T.warm, maxWidth: 480, margin: "0 auto", minHeight: "100dvh" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&display=swap');*{box-sizing:border-box;margin:0;padding:0;}`}</style>

      {/* Header */}
      <div style={{ background: `linear-gradient(160deg, #1E2D3D, ${T.ocean})`, padding: "32px 24px 28px", color: "white" }}>
        <div style={{ fontSize: 11, letterSpacing: 3, opacity: 0.5, textTransform: "uppercase", marginBottom: 10 }}>TripJam</div>
        <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 26, lineHeight: 1.2, marginBottom: 6 }}>{trip.name}</div>
        <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 2 }}>📍 {trip.destination}</div>
        {dateStr && <div style={{ fontSize: 13, opacity: 0.7 }}>📅 {dateStr}</div>}
        {trip.summary && (
          <div style={{ marginTop: 14, fontSize: 13, opacity: 0.8, fontStyle: "italic", lineHeight: 1.6, borderTop: "1px solid rgba(255,255,255,0.15)", paddingTop: 14 }}>
            {trip.summary}
          </div>
        )}
      </div>

      {/* Days */}
      <div style={{ padding: "24px 20px 40px" }}>
        {days.map(day => <DayCard key={day.id} day={day} />)}
      </div>

      {/* Footer CTA */}
      <div style={{ padding: "20px 24px 40px", borderTop: `1px solid ${T.sand}`, textAlign: "center" }}>
        <div style={{ fontSize: 12, color: T.mist, fontFamily: "Georgia,serif", marginBottom: 12 }}>Plan your own trip with AI</div>
        <a href="/" style={{ display: "inline-block", background: T.ocean, color: "white", borderRadius: 24, padding: "11px 24px", fontSize: 13, fontFamily: "'DM Serif Display',serif", textDecoration: "none" }}>
          Try TripJam →
        </a>
      </div>
    </div>
  );
}
