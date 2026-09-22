import { useState, useEffect, Fragment } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { T } from "../theme";
import {
  geocodePlace,
  verifyActivity,
  needsVerification,
  _fetchPhoto,
} from "../photos";
import { supabase } from "../supabase";

/* ─── DAY COLOURS (map + board) ─────────────────────────────────────── */
export const DAY_COLORS = [
  "#E05C5C",
  "#D4A847",
  "#3D7A5C",
  "#2563A8",
  "#C4622D",
  "#7B5EA7",
  "#2E86AB",
  "#E91E63",
  "#00897B",
  "#F4511E",
];

function makeDayIcon(color) {
  return L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2.5px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.35)"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -10],
  });
}

// Numbered photo-card marker (Odessia-style polaroid): thumbnail + "N. Label"
// caption + pointer. Falls back to a caption-only chip when no photo exists;
// a broken thumbnail hides itself rather than showing the broken-image glyph.
const escHtml = (s) =>
  String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");

function makePolaroidIcon({ photoUrl, label, number, color = "#2563A8" }) {
  const cap = `${number != null ? `${number}. ` : ""}${escHtml(label)}`;
  const img = photoUrl
    ? `<img src="${escHtml(photoUrl)}" style="width:100%;height:44px;object-fit:cover;border-radius:3px;display:block" onerror="this.style.display='none'"/>`
    : "";
  const W = 74;
  const H = photoUrl ? 68 : 24;
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;background:white;padding:3px;border-radius:6px;box-shadow:0 2px 8px rgba(15,25,35,0.35);width:${W}px;border:1px solid rgba(0,0,0,0.08);box-sizing:border-box">
      ${img}
      <div style="font-family:Georgia,serif;font-size:10px;font-weight:700;color:#0F1923;padding:2px 2px 1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><span style="color:${color}">${cap}</span></div>
      <div style="position:absolute;left:50%;bottom:-6px;transform:translateX(-50%);width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid white;filter:drop-shadow(0 2px 1px rgba(15,25,35,0.2))"></div>
    </div>`,
    iconSize: [W, H],
    iconAnchor: [W / 2, H + 6],
    popupAnchor: [0, -H],
  });
}

/* ─── MAP VIEW ───────────────────────────────────────────────────────── */

// Cancels in-flight Leaflet animations on unmount so _getMapPanePos never
// reads _leaflet_pos on a detached DOM element (onZoomTransitionEnd crash).
// Guard: react-leaflet's own cleanup calls map.remove() which sets _mapPane=undefined
// (Leaflet 1.9.x); if that runs first, stop() would itself crash reading _mapPane.
function MapCleanup() {
  const map = useMap();
  useEffect(() => {
    return () => {
      if (map._mapPane) map.stop();
    };
  }, [map]);
  return null;
}

// Fits the map to the destination bbox when it arrives (before any route pins exist).
// Falls back to setView+zoom if no bbox (e.g. Photon returned a point-only result).
function DestCenter({ bounds, coords }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      map.fitBounds(bounds, { padding: [20, 20], maxZoom: 12 });
    } else if (coords) {
      map.setView(coords, 8);
    }
  }, [bounds, coords?.[0], coords?.[1]]);
  return null;
}

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
    map.fitBounds(
      pins.map((p) => [p.lat, p.lng]),
      { padding: [40, 40], maxZoom: 15 },
    );
  }, [pins]);
  return null;
}

export function MapView({
  days,
  session = null,
  tripId = null,
  focusDay = null,
  onDayFocus = null,
}) {
  const [pins, setPins] = useState(null);
  const [resolving, setResolving] = useState(true);
  const [selectedDays, setSelectedDays] = useState(new Set()); // empty = show all
  const [multiSelect, setMultiSelect] = useState(false);

  // Follow the itinerary scroll: the parent reports the day currently in
  // view (scroll-spy activeDay) and the map focuses it. A manual
  // multi-select wins while active; single-day pill taps are simply the
  // same state, so the next scroll re-syncs.
  useEffect(() => {
    if (focusDay == null || multiSelect) return;
    setSelectedDays((prev) =>
      prev.size === 1 && prev.has(focusDay) ? prev : new Set([focusDay]),
    );
  }, [focusDay, multiSelect]);

  useEffect(() => {
    let cancelled = false;
    setResolving(true);
    (async () => {
      // Geocode all days in parallel; update pins as each day resolves
      const allPins = days.map(() => []);
      await Promise.all(
        days.map(async (day, di) => {
          const seenPackages = new Set();
          const dayPins = await Promise.all(
            day.activities
              .filter((act) => {
                if (act.type === "transit") return false;
                if (act.package) {
                  if (seenPackages.has(act.package)) return false;
                  seenPackages.add(act.package);
                }
                return true;
              })
              .map(async (act) => {
                // 1. Properly verified coords (or non-legacy stored coords) — use as is.
                //    needsVerification handles three cases:
                //      - new row with no coords → returns true
                //      - legacy backfill (lat set, no metadata) → returns true (re-verify)
                //      - properly verified row → returns false (use stored)
                if (!needsVerification(act) && act.lat != null) {
                  return {
                    ...act,
                    dayIndex: di,
                    dayLabel: day.label,
                  };
                }
                // 2. Authenticated path — full verify-place ladder (Photon
                //    with name-similarity → Nominatim → Haiku repair → Google
                //    with validation). Persists coords + metadata so this
                //    activity never goes through this slow path again.
                if (session?.access_token) {
                  const r = await verifyActivity(
                    act,
                    day.city,
                    session,
                    tripId,
                  );
                  if (r?.status === "verified" && r.coords) {
                    return {
                      ...act,
                      ...(r.updateFields || {}),
                      dayIndex: di,
                      dayLabel: day.label,
                    };
                  }
                  // Picker / unresolved — if the row already had legacy coords,
                  // keep them rather than dropping the pin entirely (still better
                  // than no pin while the user sorts out alternatives via the
                  // ActivityCard picker UI).
                  if (act.lat != null && act.lng != null) {
                    return {
                      ...act,
                      dayIndex: di,
                      dayLabel: day.label,
                    };
                  }
                  return null;
                }
                // 3. Unauthenticated fallback (public share view, etc) — legacy
                //    geocodePlace path. No name-similarity guard, may produce
                //    wrong coords; but the public view has no session to drive
                //    the verify ladder. Write-back is intentionally skipped
                //    here so suspect coords don't pollute the DB.
                const coords = await geocodePlace(
                  act.title,
                  day.city,
                  act.geocode,
                );
                return coords
                  ? {
                      ...act,
                      lat: coords.lat,
                      lng: coords.lng,
                      dayIndex: di,
                      dayLabel: day.label,
                    }
                  : null;
              }),
          );
          allPins[di] = dayPins.filter(Boolean);
          if (!cancelled) setPins(allPins.flat());
        }),
      );
      if (!cancelled) setResolving(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [days.length]);

  const toggleDay = (i) => {
    if (multiSelect) {
      setSelectedDays((prev) => {
        const next = new Set(prev);
        next.has(i) ? next.delete(i) : next.add(i);
        return next;
      });
    } else {
      // Single-select: tap same day to deselect (show all)
      let focused = false;
      setSelectedDays((prev) => {
        focused = !(prev.size === 1 && prev.has(i));
        return focused ? new Set([i]) : new Set();
      });
      // Navigation gesture: a single-day pill tap also drives the itinerary
      // (desktop scrolls live; mobile lands there on tab return). Deselect
      // and Multiple-mode taps are browsing, not navigation — no scroll.
      if (focused) onDayFocus?.(i);
    }
  };

  const handleMultiToggle = () => {
    if (multiSelect) {
      // Collapse back to single: keep first selected day if any
      const first = [...selectedDays][0];
      setSelectedDays(first !== undefined ? new Set([first]) : new Set());
    }
    setMultiSelect((prev) => !prev);
  };

  const visiblePins = (() => {
    const flat = (pins || []).filter(
      (p) => selectedDays.size === 0 || selectedDays.has(p.dayIndex),
    );
    // Visit-order number within each day (pins arrive day-grouped, in order)
    let seq = 0;
    let lastDay = -1;
    return flat.map((p) => {
      if (p.dayIndex !== lastDay) {
        seq = 0;
        lastDay = p.dayIndex;
      }
      seq += 1;
      return { ...p, seq };
    });
  })();
  // Single-day focus (the scroll-synced default) renders rich polaroid
  // markers; multi-day/all views keep the light dots to avoid clutter.
  const singleDayFocus = selectedDays.size === 1;
  // Only fall back to a "world" centre when we actually have pins (we always do if we render
  // the map below). The empty/loading states render a placeholder instead, so Leaflet never
  // boots at [20,0] (open ocean → grey-blue tiles → the "map is broken" perception).
  const center = visiblePins.length
    ? [visiblePins[0].lat, visiblePins[0].lng]
    : pins?.length
      ? [pins[0].lat, pins[0].lng]
      : [0, 0];
  const hasPins = (pins?.length ?? 0) > 0;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      {/* Day filter pills */}
      <div
        className="no-scrollbar"
        style={{
          display: "flex",
          gap: 6,
          padding: "10px 14px",
          overflowX: "auto",
          flexShrink: 0,
          background: "#fff",
          borderBottom: `1px solid ${T.sand}`,
          alignItems: "center",
        }}
      >
        {days.map((d, i) => {
          const active = selectedDays.has(i);
          const color = DAY_COLORS[i % DAY_COLORS.length];
          return (
            <button
              key={i}
              onClick={() => toggleDay(i)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                flexShrink: 0,
                padding: "4px 11px",
                borderRadius: 20,
                border: `1.5px solid ${active ? color : T.sand}`,
                background: active ? color : T.chalk,
                color: active ? "white" : T.mist,
                fontSize: 11,
                fontFamily: "Georgia,serif",
                cursor: "pointer",
                transition: "all 0.18s",
                fontWeight: active ? 700 : 400,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: active ? "rgba(255,255,255,0.8)" : color,
                  flexShrink: 0,
                }}
              />
              {d.label}
            </button>
          );
        })}
        {/* Divider */}
        <div
          style={{
            width: 1,
            height: 18,
            background: T.sand,
            flexShrink: 0,
            marginLeft: 2,
          }}
        />
        {/* Multi-select toggle */}
        <label
          onClick={handleMultiToggle}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            flexShrink: 0,
            cursor: "pointer",
            padding: "4px 4px",
            whiteSpace: "nowrap",
          }}
        >
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 3,
              flexShrink: 0,
              border: `1.5px solid ${multiSelect ? T.ocean : T.mist}`,
              background: multiSelect ? T.ocean : "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.15s",
            }}
          >
            {multiSelect && (
              <span style={{ fontSize: 9, color: "white", lineHeight: 1 }}>
                ✓
              </span>
            )}
          </div>
          <span
            style={{ fontSize: 11, fontFamily: "Georgia,serif", color: T.mist }}
          >
            Multiple
          </span>
        </label>
      </div>

      {/* Skeleton / empty state — kept *outside* the MapContainer so Leaflet only mounts
          once we actually have coordinates to centre on. This avoids the "grey ocean"
          window where Leaflet would otherwise boot at [20,0] before any day resolves. */}
      {!hasPins && (
        <div
          style={{
            flex: 1,
            position: "relative",
            background: "#E8EEF3",
            overflow: "hidden",
          }}
        >
          {resolving && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "linear-gradient(110deg, rgba(255,255,255,0) 20%, rgba(255,255,255,0.6) 50%, rgba(255,255,255,0) 80%)",
                animation: "shimmer 1.5s ease-in-out infinite",
              }}
            />
          )}
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              pointerEvents: "none",
            }}
          >
            {resolving && (
              <div style={{ display: "flex", gap: 10 }}>
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      background: DAY_COLORS[i % DAY_COLORS.length],
                      opacity: 0.7,
                      animation: `pulse 1.2s ease-in-out ${i * 0.15}s infinite`,
                    }}
                  />
                ))}
              </div>
            )}
            <div
              style={{
                fontSize: 13,
                color: T.mist,
                fontFamily: "Georgia,serif",
                fontStyle: "italic",
              }}
            >
              {resolving ? "Plotting your trip…" : "No locations to map yet"}
            </div>
          </div>
        </div>
      )}

      {hasPins && (
        <MapContainer center={center} zoom={13} style={{ flex: 1 }}>
          <MapCleanup />
          <TileLayer
            url={
              import.meta.env.VITE_MAPBOX_TOKEN
                ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}@2x?access_token=${import.meta.env.VITE_MAPBOX_TOKEN}`
                : "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            }
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
          <FitBounds pins={visiblePins} fallback={center} />
          {visiblePins.map((pin, i) => (
            <Marker
              key={`${singleDayFocus ? "p" : "d"}-${i}`}
              position={[pin.lat, pin.lng]}
              icon={
                singleDayFocus
                  ? makePolaroidIcon({
                      photoUrl: pin.photo_url || null,
                      label: pin.title,
                      number: pin.seq,
                      color: DAY_COLORS[pin.dayIndex % DAY_COLORS.length],
                    })
                  : makeDayIcon(DAY_COLORS[pin.dayIndex % DAY_COLORS.length])
              }
            >
              <Popup>
                <div
                  style={{
                    fontFamily: "Georgia,serif",
                    fontSize: 13,
                    lineHeight: 1.5,
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>
                    {pin.icon} {pin.title}
                  </div>
                  <div style={{ color: "#666", fontSize: 12 }}>
                    {pin.time} · {pin.dayLabel}
                  </div>
                  <a
                    href={`https://maps.google.com/?q=${encodeURIComponent(pin.geocode || pin.title)}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      fontSize: 12,
                      color: "#2563A8",
                      display: "block",
                      marginTop: 6,
                    }}
                  >
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
export function RouteMapView({
  routes,
  selectedId,
  onSelectRoute,
  destination,
}) {
  const [pinsByRoute, setPinsByRoute] = useState({}); // { routeId: [{ lat, lng, city }, ...] }
  const [resolving, setResolving] = useState(true);
  const [destCoords, setDestCoords] = useState(null); // fallback center while routes load
  const [destBounds, setDestBounds] = useState(null); // [[s,w],[n,e]] for fitBounds

  // Fetch destination coords + bbox from Photon so the map shows the right region
  // while RG is still running and no route pins exist yet.
  // Photon's extent: [west, south, east, north] → Leaflet bounds [[s,w],[n,e]]
  useEffect(() => {
    if (!destination) return;
    let cancelled = false;
    fetch(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(destination)}&limit=1`,
    )
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const f = data?.features?.[0];
        if (!f) return;
        const [lon, lat] = f.geometry.coordinates;
        setDestCoords([lat, lon]);
        const ext = f.properties?.extent; // [west, south, east, north]
        if (ext)
          setDestBounds([
            [ext[1], ext[0]],
            [ext[3], ext[2]],
          ]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [destination]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setResolving(true);
      const result = {};
      await Promise.all(
        (routes || []).map(async (route) => {
          const cities = (route.city || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          // For "Help me decide" routes (destination = null), each route is
          // in a different country. Use the route's own first city as the
          // geocode hint context so cities resolve against the right region.
          const routeBias = destination || cities[0] || null;
          const coords = await Promise.all(
            cities.map(async (c) => {
              const pt = await geocodePlace(c, routeBias, c);
              return pt ? { ...pt, city: c } : null;
            }),
          );
          result[route.id] = coords.filter(Boolean);
        }),
      );
      if (!cancelled) {
        setPinsByRoute(result);
        setResolving(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [routes?.length, routes?.map((r) => r.id).join("|")]);

  const visibleRoutes = selectedId
    ? (routes || []).filter((r) => r.id === selectedId)
    : routes || [];

  const allVisiblePins = visibleRoutes.flatMap((r) => pinsByRoute[r.id] || []);

  // Focused route (exactly one visible) gets polaroid stop markers — fetch a
  // photo per city (same cacheKey convention as the Magazine's city photos,
  // so warm trips resolve instantly). Multi-route view keeps colour dots.
  const focusRouteId = visibleRoutes.length === 1 ? visibleRoutes[0].id : null;
  const [cityPhotos, setCityPhotos] = useState({});
  useEffect(() => {
    if (!focusRouteId) return undefined;
    const pins = pinsByRoute[focusRouteId] || [];
    let cancelled = false;
    pins.forEach((pin) => {
      if (cityPhotos[pin.city] !== undefined) return;
      _fetchPhoto(pin.city, null, "sight")
        .then((url) => {
          if (!cancelled)
            setCityPhotos((prev) =>
              prev[pin.city] !== undefined
                ? prev
                : { ...prev, [pin.city]: url },
            );
        })
        .catch(() => {
          if (!cancelled)
            setCityPhotos((prev) =>
              prev[pin.city] !== undefined
                ? prev
                : { ...prev, [pin.city]: null },
            );
        });
    });
    return () => {
      cancelled = true;
    };
  }, [focusRouteId, pinsByRoute]);
  const center = allVisiblePins.length
    ? [allVisiblePins[0].lat, allVisiblePins[0].lng]
    : (destCoords ?? [20, 0]);

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      {/* Header */}
      <div
        style={{
          background: T.chalk,
          borderBottom: `1px solid ${T.sand}`,
          flexShrink: 0,
        }}
      >
        <div style={{ padding: "10px 14px 6px" }}>
          <div
            style={{
              fontFamily: "'DM Serif Display',serif",
              fontSize: 15,
              color: T.ink,
              marginBottom: 2,
            }}
          >
            🗺 Plans on the map
          </div>
          <div
            style={{ fontSize: 11, color: T.mist, fontFamily: "Georgia,serif" }}
          >
            {resolving || (routes || []).length === 0
              ? "Plans are generating…"
              : selectedId
                ? (routes || []).find((r) => r.id === selectedId)?.title
                : "Tap a plan to focus"}
          </div>
        </div>
        {/* Route picker pills */}
        <div
          className="no-scrollbar"
          style={{
            display: "flex",
            gap: 6,
            padding: "2px 14px 10px",
            overflowX: "auto",
          }}
        >
          <button
            onClick={() => onSelectRoute?.(null)}
            style={{
              flexShrink: 0,
              padding: "4px 12px",
              borderRadius: 20,
              border: `1.5px solid ${!selectedId ? T.ocean : T.sand}`,
              background: !selectedId ? T.ocean : T.chalk,
              color: !selectedId ? "white" : T.mist,
              fontSize: 11,
              fontFamily: "Georgia,serif",
              cursor: "pointer",
              fontWeight: !selectedId ? 700 : 400,
            }}
          >
            All plans
          </button>
          {(routes || []).map((r, i) => {
            const active = selectedId === r.id;
            const color = DAY_COLORS[i % DAY_COLORS.length];
            return (
              <button
                key={r.id}
                onClick={() => onSelectRoute?.(r.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  flexShrink: 0,
                  padding: "4px 11px",
                  borderRadius: 20,
                  border: `1.5px solid ${active ? color : T.sand}`,
                  background: active ? color : T.chalk,
                  color: active ? "white" : T.mist,
                  fontSize: 11,
                  fontFamily: "Georgia,serif",
                  cursor: "pointer",
                  fontWeight: active ? 700 : 400,
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: active ? "rgba(255,255,255,0.8)" : color,
                    flexShrink: 0,
                  }}
                />
                {r.icon} {r.title}
              </button>
            );
          })}
        </div>
      </div>

      {/* Skeleton while resolving — shimmer block + animated pins */}
      {resolving && (
        <div
          style={{
            flex: 1,
            position: "relative",
            background: "#E8EEF3",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(110deg, rgba(255,255,255,0) 20%, rgba(255,255,255,0.6) 50%, rgba(255,255,255,0) 80%)",
              animation: "shimmer 1.5s ease-in-out infinite",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              pointerEvents: "none",
            }}
          >
            <div style={{ display: "flex", gap: 10 }}>
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: DAY_COLORS[i % DAY_COLORS.length],
                    opacity: 0.7,
                    animation: `pulse 1.2s ease-in-out ${i * 0.15}s infinite`,
                  }}
                />
              ))}
            </div>
            <div
              style={{
                fontSize: 12,
                color: T.mist,
                fontFamily: "Georgia,serif",
                fontStyle: "italic",
              }}
            >
              Plotting plans…
            </div>
          </div>
        </div>
      )}

      {!resolving &&
        allVisiblePins.length === 0 &&
        !destCoords &&
        !destBounds && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              top: 80,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: T.mist,
              fontFamily: "Georgia,serif",
              fontSize: 14,
              zIndex: 500,
              pointerEvents: "none",
            }}
          >
            No locations found
          </div>
        )}

      {!resolving && (
        <MapContainer center={center} zoom={6} style={{ flex: 1 }}>
          <MapCleanup />
          <TileLayer
            url={
              import.meta.env.VITE_MAPBOX_TOKEN
                ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}@2x?access_token=${import.meta.env.VITE_MAPBOX_TOKEN}`
                : "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            }
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
          {(destBounds || destCoords) && allVisiblePins.length === 0 && (
            <DestCenter bounds={destBounds} coords={destCoords} />
          )}
          <FitBounds pins={allVisiblePins} fallback={center} />
          {visibleRoutes.map((route, i) => {
            const pins = pinsByRoute[route.id] || [];
            const color =
              DAY_COLORS[
                routes.findIndex((r) => r.id === route.id) % DAY_COLORS.length
              ];
            return (
              <Fragment key={route.id}>
                {/* Polyline removed — dotted lines connecting pins didn't add
                    information (we don't actually know the real route between
                    cities; the markers are enough to convey route geography). */}
                {pins.map((pin, j) => (
                  <Marker
                    key={`${route.id === focusRouteId ? "p" : "d"}-${j}`}
                    position={[pin.lat, pin.lng]}
                    icon={
                      route.id === focusRouteId
                        ? makePolaroidIcon({
                            photoUrl: cityPhotos[pin.city] || null,
                            label: pin.city,
                            number: j + 1,
                            color,
                          })
                        : makeDayIcon(color)
                    }
                  >
                    <Popup>
                      <div
                        style={{
                          fontFamily: "Georgia,serif",
                          fontSize: 13,
                          lineHeight: 1.5,
                        }}
                      >
                        <div style={{ fontWeight: 700, marginBottom: 2 }}>
                          📍 {pin.city}
                        </div>
                        <div style={{ color: "#666", fontSize: 12 }}>
                          Stop {j + 1} · {route.title}
                        </div>
                        <a
                          href={`https://maps.google.com/?q=${encodeURIComponent(pin.city)}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            fontSize: 12,
                            color: "#2563A8",
                            display: "block",
                            marginTop: 6,
                          }}
                        >
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
