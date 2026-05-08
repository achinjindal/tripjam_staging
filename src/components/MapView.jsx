import { useState, useEffect, Fragment } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { T } from "../theme";
import { geocodePlace } from "../photos";
import { supabase } from "../supabase";

/* ─── DAY COLOURS (map + board) ─────────────────────────────────────── */
export const DAY_COLORS = ["#E05C5C","#D4A847","#3D7A5C","#2563A8","#C4622D","#7B5EA7","#2E86AB","#E91E63","#00897B","#F4511E"];

function makeDayIcon(color) {
  return L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2.5px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.35)"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -10],
  });
}

/* ─── MAP VIEW ───────────────────────────────────────────────────────── */
function FitBounds({ pins, fallback }) {
  const map = useMap();
  useEffect(() => {
    if (!pins || pins.length === 0) {
      if (fallback) map.setView(fallback, 12);
      return;
    }
    if (pins.length === 1) {
      map.setView([pins[0].lat, pins[0].lng], 14);
      return;
    }
    map.fitBounds(pins.map(p => [p.lat, p.lng]), { padding: [40, 40], maxZoom: 15 });
  }, [pins]);
  return null;
}

export function MapView({ days }) {
  const [pins, setPins] = useState(null);
  const [selectedDays, setSelectedDays] = useState(new Set()); // empty = show all
  const [multiSelect, setMultiSelect] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Geocode all days in parallel; update pins as each day resolves
      const allPins = days.map(() => []);
      await Promise.all(days.map(async (day, di) => {
        const seenPackages = new Set();
        const dayPins = await Promise.all(
          day.activities
            .filter(act => {
              if (act.type === "transit") return false;
              if (act.package) {
                if (seenPackages.has(act.package)) return false;
                seenPackages.add(act.package);
              }
              return true;
            })
            .map(async act => {
              // Always resolve via geocodePlace (server has permanent DB cache — fast for known places)
              const coords = await geocodePlace(act.title, day.city, act.geocode);
              if (coords && act.id && (coords.lat !== act.lat || coords.lng !== act.lng)) {
                supabase.from("activities").update({ lat: coords.lat, lng: coords.lng }).eq("id", act.id);
              }
              return coords ? { ...act, lat: coords.lat, lng: coords.lng, dayIndex: di, dayLabel: day.label } : null;
            })
        );
        allPins[di] = dayPins.filter(Boolean);
        if (!cancelled) setPins(allPins.flat());
      }));
    })();
    return () => { cancelled = true; };
  }, [days.length]);

  const toggleDay = (i) => {
    if (multiSelect) {
      setSelectedDays(prev => {
        const next = new Set(prev);
        next.has(i) ? next.delete(i) : next.add(i);
        return next;
      });
    } else {
      // Single-select: tap same day to deselect (show all)
      setSelectedDays(prev => prev.size === 1 && prev.has(i) ? new Set() : new Set([i]));
    }
  };

  const handleMultiToggle = () => {
    if (multiSelect) {
      // Collapse back to single: keep first selected day if any
      const first = [...selectedDays][0];
      setSelectedDays(first !== undefined ? new Set([first]) : new Set());
    }
    setMultiSelect(prev => !prev);
  };

  const visiblePins = (pins || []).filter(p => selectedDays.size === 0 || selectedDays.has(p.dayIndex));
  const center = visiblePins.length ? [visiblePins[0].lat, visiblePins[0].lng]
    : pins?.length ? [pins[0].lat, pins[0].lng] : [20, 0];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", position: "relative" }}>
      {/* Day filter pills */}
      <div className="no-scrollbar" style={{ display: "flex", gap: 6, padding: "10px 14px", overflowX: "auto", flexShrink: 0, background: "#fff", borderBottom: `1px solid ${T.sand}`, alignItems: "center" }}>
        {days.map((d, i) => {
          const active = selectedDays.has(i);
          const color = DAY_COLORS[i % DAY_COLORS.length];
          return (
            <button key={i} onClick={() => toggleDay(i)} style={{
              display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
              padding: "4px 11px", borderRadius: 20,
              border: `1.5px solid ${active ? color : T.sand}`,
              background: active ? color : T.chalk,
              color: active ? "white" : T.mist,
              fontSize: 11, fontFamily: "Georgia,serif",
              cursor: "pointer", transition: "all 0.18s",
              fontWeight: active ? 700 : 400,
            }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: active ? "rgba(255,255,255,0.8)" : color, flexShrink: 0 }} />
              {d.label}
            </button>
          );
        })}
        {/* Divider */}
        <div style={{ width: 1, height: 18, background: T.sand, flexShrink: 0, marginLeft: 2 }} />
        {/* Multi-select toggle */}
        <label onClick={handleMultiToggle} style={{
          display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
          cursor: "pointer", padding: "4px 4px", whiteSpace: "nowrap",
        }}>
          <div style={{
            width: 14, height: 14, borderRadius: 3, flexShrink: 0,
            border: `1.5px solid ${multiSelect ? T.ocean : T.mist}`,
            background: multiSelect ? T.ocean : "none",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.15s",
          }}>
            {multiSelect && <span style={{ fontSize: 9, color: "white", lineHeight: 1 }}>✓</span>}
          </div>
          <span style={{ fontSize: 11, fontFamily: "Georgia,serif", color: T.mist }}>Multiple</span>
        </label>
      </div>

      {(!pins || pins.length === 0) && (
        <div style={{ position: "absolute", inset: 0, top: 50, display: "flex", alignItems: "center", justifyContent: "center", color: T.mist, fontFamily: "Georgia,serif", fontSize: 14, zIndex: 500, pointerEvents: "none" }}>
          {!pins ? "Resolving locations…" : "No locations found"}
        </div>
      )}

      {pins !== null && (
        <MapContainer center={center} zoom={13} style={{ flex: 1 }}>
          <TileLayer
            url={import.meta.env.VITE_MAPBOX_TOKEN ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}@2x?access_token=${import.meta.env.VITE_MAPBOX_TOKEN}` : "https://tile.openstreetmap.org/{z}/{x}/{y}.png"}
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
          <FitBounds pins={visiblePins} fallback={center} />
          {visiblePins.map((pin, i) => (
            <Marker key={i} position={[pin.lat, pin.lng]} icon={makeDayIcon(DAY_COLORS[pin.dayIndex % DAY_COLORS.length])}>
              <Popup>
                <div style={{ fontFamily: "Georgia,serif", fontSize: 13, lineHeight: 1.5 }}>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>{pin.icon} {pin.title}</div>
                  <div style={{ color: "#666", fontSize: 12 }}>{pin.time} · {pin.dayLabel}</div>
                  <a href={`https://maps.google.com/?q=${encodeURIComponent(pin.geocode || pin.title)}`}
                    target="_blank" rel="noreferrer"
                    style={{ fontSize: 12, color: "#2563A8", display: "block", marginTop: 6 }}>
                    Open in Google Maps ↗
                  </a>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      )}
    </div>
  );
}

/* ─── ROUTE MAP VIEW (pre-trip brainstorm) ──────────────────────────── */
export function RouteMapView({ routes, selectedId, onSelectRoute, destination }) {
  const [pinsByRoute, setPinsByRoute] = useState({}); // { routeId: [{ lat, lng, city }, ...] }
  const [resolving, setResolving] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setResolving(true);
      const result = {};
      await Promise.all((routes || []).map(async (route) => {
        const cities = (route.city || "").split(",").map(s => s.trim()).filter(Boolean);
        const coords = await Promise.all(cities.map(async (c) => {
          const pt = await geocodePlace(c, destination || null, c);
          return pt ? { ...pt, city: c } : null;
        }));
        result[route.id] = coords.filter(Boolean);
      }));
      if (!cancelled) { setPinsByRoute(result); setResolving(false); }
    })();
    return () => { cancelled = true; };
  }, [routes?.length, routes?.map(r => r.id).join("|")]);

  const visibleRoutes = selectedId
    ? (routes || []).filter(r => r.id === selectedId)
    : (routes || []);

  const allVisiblePins = visibleRoutes.flatMap(r => pinsByRoute[r.id] || []);
  const center = allVisiblePins.length ? [allVisiblePins[0].lat, allVisiblePins[0].lng] : [20, 0];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", position: "relative" }}>
      {/* Header */}
      <div style={{ background: T.chalk, borderBottom: `1px solid ${T.sand}`, flexShrink: 0 }}>
        <div style={{ padding: "10px 14px 6px" }}>
          <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 15, color: T.ink, marginBottom: 2 }}>🗺 Plans on the map</div>
          <div style={{ fontSize: 11, color: T.mist, fontFamily: "Georgia,serif" }}>
            {resolving ? "Plotting your trip plans…" : selectedId ? (routes || []).find(r => r.id === selectedId)?.title : "Tap a plan to focus"}
          </div>
        </div>
        {/* Route picker pills */}
        <div className="no-scrollbar" style={{ display: "flex", gap: 6, padding: "2px 14px 10px", overflowX: "auto" }}>
          <button onClick={() => onSelectRoute?.(null)} style={{
            flexShrink: 0, padding: "4px 12px", borderRadius: 20,
            border: `1.5px solid ${!selectedId ? T.ocean : T.sand}`,
            background: !selectedId ? T.ocean : T.chalk,
            color: !selectedId ? "white" : T.mist,
            fontSize: 11, fontFamily: "Georgia,serif", cursor: "pointer",
            fontWeight: !selectedId ? 700 : 400,
          }}>All plans</button>
          {(routes || []).map((r, i) => {
            const active = selectedId === r.id;
            const color = DAY_COLORS[i % DAY_COLORS.length];
            return (
              <button key={r.id} onClick={() => onSelectRoute?.(r.id)} style={{
                display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
                padding: "4px 11px", borderRadius: 20,
                border: `1.5px solid ${active ? color : T.sand}`,
                background: active ? color : T.chalk,
                color: active ? "white" : T.mist,
                fontSize: 11, fontFamily: "Georgia,serif", cursor: "pointer",
                fontWeight: active ? 700 : 400,
              }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: active ? "rgba(255,255,255,0.8)" : color, flexShrink: 0 }} />
                {r.icon} {r.title}
              </button>
            );
          })}
        </div>
      </div>

      {/* Skeleton while resolving — shimmer block + animated pins */}
      {resolving && (
        <div style={{ flex: 1, position: "relative", background: "#E8EEF3", overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(110deg, rgba(255,255,255,0) 20%, rgba(255,255,255,0.6) 50%, rgba(255,255,255,0) 80%)", animation: "shimmer 1.5s ease-in-out infinite" }}/>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, pointerEvents: "none" }}>
            <div style={{ display: "flex", gap: 10 }}>
              {[0, 1, 2, 3].map(i => (
                <div key={i} style={{
                  width: 14, height: 14, borderRadius: "50%",
                  background: DAY_COLORS[i % DAY_COLORS.length],
                  opacity: 0.7,
                  animation: `pulse 1.2s ease-in-out ${i * 0.15}s infinite`,
                }}/>
              ))}
            </div>
            <div style={{ fontSize: 12, color: T.mist, fontFamily: "Georgia,serif", fontStyle: "italic" }}>
              Plotting plans…
            </div>
          </div>
        </div>
      )}

      {!resolving && allVisiblePins.length === 0 && (
        <div style={{ position: "absolute", inset: 0, top: 80, display: "flex", alignItems: "center", justifyContent: "center", color: T.mist, fontFamily: "Georgia,serif", fontSize: 14, zIndex: 500, pointerEvents: "none" }}>
          No locations found
        </div>
      )}

      {!resolving && (
        <MapContainer center={center} zoom={6} style={{ flex: 1 }}>
          <TileLayer
            url={import.meta.env.VITE_MAPBOX_TOKEN ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}@2x?access_token=${import.meta.env.VITE_MAPBOX_TOKEN}` : "https://tile.openstreetmap.org/{z}/{x}/{y}.png"}
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
          <FitBounds pins={allVisiblePins} fallback={center} />
          {visibleRoutes.map((route, i) => {
            const pins = pinsByRoute[route.id] || [];
            const color = DAY_COLORS[(routes.findIndex(r => r.id === route.id)) % DAY_COLORS.length];
            return (
              <Fragment key={route.id}>
                {pins.length > 1 && (
                  <Polyline positions={pins.map(p => [p.lat, p.lng])} pathOptions={{ color, weight: 3, opacity: 0.6, dashArray: "6 6" }} />
                )}
                {pins.map((pin, j) => (
                  <Marker key={j} position={[pin.lat, pin.lng]} icon={makeDayIcon(color)}>
                    <Popup>
                      <div style={{ fontFamily: "Georgia,serif", fontSize: 13, lineHeight: 1.5 }}>
                        <div style={{ fontWeight: 700, marginBottom: 2 }}>📍 {pin.city}</div>
                        <div style={{ color: "#666", fontSize: 12 }}>Stop {j + 1} · {route.title}</div>
                        <a href={`https://maps.google.com/?q=${encodeURIComponent(pin.city)}`}
                          target="_blank" rel="noreferrer"
                          style={{ fontSize: 12, color: "#2563A8", display: "block", marginTop: 6 }}>
                          Open in Google Maps ↗
                        </a>
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </Fragment>
            );
          })}
        </MapContainer>
      )}
    </div>
  );
}
