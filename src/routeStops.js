// Routes Lens data helpers — pure functions, no React, no I/O.
//
// The stops model: [{ city, nights, lat?, lng? }] in route order, stored at
// brainstorm_items.data.stops (exposed top-level after the {...row, ...row.data}
// flatten used across the app). Written by RG going forward and by the Route
// Editor's write-back; older routes fall back to deriveStops' parsing ladder.
//
// Nights rule (used everywhere): trip nights = trip days − 1. The final day
// belongs to the last stop's day range but consumes no night (departure day).

export const MAX_STOPS = 8;

// Local haversine (same math as photos.js) — importing photos.js would drag
// the supabase client into this dependency-free module.
function haversineMeters(a, b) {
  const R = 6371000,
    toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR,
    dLng = (b.lng - a.lng) * toR;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function tripNightsOf(numDays) {
  return Math.max(1, (Number(numDays) || 0) - 1);
}

// A stops array is trustworthy only if it is fully well-formed AND (when the
// trip length is known) its nights sum exactly to the trip's night budget.
// LLM-written shapes are never trusted blindly.
export function validStops(stops, tripNights = null) {
  if (!Array.isArray(stops) || stops.length < 1 || stops.length > MAX_STOPS)
    return false;
  const wellFormed = stops.every(
    (s) =>
      s &&
      typeof s.city === "string" &&
      s.city.trim().length > 0 &&
      Number.isInteger(s.nights) &&
      s.nights >= 1,
  );
  if (!wellFormed) return false;
  if (tripNights != null) {
    const sum = stops.reduce((a, s) => a + s.nights, 0);
    if (sum !== tripNights) return false;
  }
  return true;
}

function normalizeStops(stops) {
  return stops.map((s) => ({
    city: s.city.trim(),
    nights: s.nights,
    ...(Number.isFinite(s.lat) && Number.isFinite(s.lng)
      ? { lat: s.lat, lng: s.lng }
      : {}),
  }));
}

// Derivation ladder (design Rev 6 §3.3):
//   1. stored data.stops, validated → source "stored"
//   2. parse the **bold** prefixes of data.days into runs → source "derived"
//      (consecutive same-prefix days collapse; a day without a prefix continues
//      the previous run; the trip's final day contributes 0 nights; the result
//      must sum exactly to tripNights or it is rejected)
//   3. otherwise { stops: null } → the overview hides for this trip.
export function deriveStops(routeRow, tripNights) {
  const stored = routeRow?.stops ?? routeRow?.data?.stops;
  if (validStops(stored, tripNights))
    return { stops: normalizeStops(stored), source: "stored" };

  const days = routeRow?.days ?? routeRow?.data?.days ?? [];
  if (Array.isArray(days) && days.length >= 2) {
    const runs = [];
    let ok = true;
    for (let i = 0; i < days.length; i++) {
      const text = typeof days[i] === "string" ? days[i] : "";
      const m = text.match(/^\s*\*\*(.+?)\*\*/);
      const prefix = m ? m[1].trim() : null;
      if (prefix) {
        const last = runs[runs.length - 1];
        if (last && last.city.toLowerCase() === prefix.toLowerCase())
          last.days += 1;
        else runs.push({ city: prefix, days: 1 });
      } else if (runs.length) {
        runs[runs.length - 1].days += 1; // continuation of previous base
      } else {
        ok = false; // first day has no prefix — can't anchor the chain
        break;
      }
    }
    if (ok && runs.length >= 1 && runs.length <= MAX_STOPS) {
      const stops = runs.map((r, i) => ({
        city: r.city,
        // the trip's final day sits in the last run but adds no night
        nights: i === runs.length - 1 ? r.days - 1 : r.days,
      }));
      // A final run that only covers the departure day is not an overnight base
      if (stops.length > 1 && stops[stops.length - 1].nights === 0) stops.pop();
      if (validStops(stops, tripNights))
        return { stops: normalizeStops(stops), source: "derived" };
    }
  }
  return { stops: null, source: null };
}

export function ledger(stops, tripNights) {
  const assigned = (stops || []).reduce((a, s) => a + (s.nights || 0), 0);
  const delta = assigned - tripNights;
  return { assigned, delta, balanced: delta === 0 };
}

// Storage form of the city field — COMMA-joined. Three consumers split city on
// commas (IG destinations, the IG edge function, the map plot); the " → " arrow
// chain is a UI-only rendering, never stored.
export function cityChain(stops) {
  return (stops || []).map((s) => s.city).join(", ");
}

export function chainArrow(stops) {
  return (stops || []).map((s) => s.city).join(" → ");
}

// Regenerated data.days outline: one line per NIGHT plus a final departure
// line, so the array length equals trip days and every legacy reader (route
// card, IG regex ladder) stays per-day-correct.
export function outlineDays(stops) {
  const lines = [];
  for (const s of stops || []) {
    for (let n = 0; n < s.nights; n++)
      lines.push(`**${s.city}** — overnight in ${s.city}`);
  }
  const last = (stops || [])[stops.length - 1];
  if (last) lines.push(`**${last.city}** — departure day`);
  return lines;
}

// Day ranges for the overview's segment bar. Ground truth for "which day am I
// on" is the ACTUAL generated days when they can be matched to the stops
// (day.city contains / is contained by the stop city, case-insensitive, each
// stop getting a contiguous non-empty range); otherwise fall back to the
// cumulative-nights mapping so the bar still renders.
export function dRanges(stops, days) {
  const n = (days || []).length;
  const fallback = () => {
    const out = [];
    let d = 1;
    (stops || []).forEach((s, i) => {
      const lastStop = i === stops.length - 1;
      const first = d;
      const lastDay = lastStop
        ? Math.max(first, n || first + s.nights)
        : d + s.nights - 1;
      out.push({ first, last: lastDay });
      d = lastDay + 1;
    });
    return out;
  };
  if (!n || !stops?.length) return fallback();

  const norm = (x) => (x || "").toLowerCase().trim();
  const matches = (dayCity, stopCity) => {
    const a = norm(dayCity);
    const b = norm(stopCity);
    return !!a && !!b && (a.includes(b) || b.includes(a));
  };
  const out = [];
  let cursor = 0;
  for (let i = 0; i < stops.length; i++) {
    let first = -1;
    let last = -1;
    for (let d = cursor; d < n; d++) {
      if (matches(days[d]?.city, stops[i].city)) {
        if (first === -1) first = d;
        last = d;
      } else if (first !== -1) break; // contiguous range ended
    }
    if (first === -1) return fallback();
    out.push({ first: first + 1, last: last + 1 });
    cursor = last + 1;
  }
  // the final day always belongs to the last stop's range
  if (out.length)
    out[out.length - 1].last = Math.max(out[out.length - 1].last, n);
  return out;
}

// Compact human diff — one function, three consumers (pending-edits summary,
// replace-confirm Route line, route_edited activity row).
export function editSummary(before, after) {
  const parts = [];
  const beforeByCity = new Map(
    (before || []).map((s) => [s.city.toLowerCase(), s]),
  );
  const afterByCity = new Map(
    (after || []).map((s) => [s.city.toLowerCase(), s]),
  );
  for (const s of after || []) {
    const prev = beforeByCity.get(s.city.toLowerCase());
    if (!prev) parts.push(`+${s.city} ${s.nights}N`);
    else if (prev.nights !== s.nights)
      parts.push(`${s.city} ${prev.nights}→${s.nights}N`);
  }
  for (const s of before || []) {
    if (!afterByCity.get(s.city.toLowerCase())) parts.push(`−${s.city}`);
  }
  const beforeOrder = (before || [])
    .filter((s) => afterByCity.has(s.city.toLowerCase()))
    .map((s) => s.city.toLowerCase())
    .join("|");
  const afterOrder = (after || [])
    .filter((s) => beforeByCity.has(s.city.toLowerCase()))
    .map((s) => s.city.toLowerCase())
    .join("|");
  if (beforeOrder !== afterOrder && beforeOrder && afterOrder)
    parts.push("reordered");
  return parts.join(" · ");
}

export function stopsEqual(a, b) {
  if ((a || []).length !== (b || []).length) return false;
  return (a || []).every(
    (s, i) =>
      s.city.toLowerCase() === b[i].city.toLowerCase() &&
      s.nights === b[i].nights,
  );
}

// Geo-sanity: a candidate point is "far" when it sits over thresholdKm from
// every known stop coordinate. Warn-only — callers must never block on this.
export function farFromRoute(point, stopCoords, thresholdKm = 800) {
  const coords = (stopCoords || []).filter(
    (c) => c && Number.isFinite(c.lat) && Number.isFinite(c.lng),
  );
  if (!coords.length || !point) return null;
  const minKm = Math.min(
    ...coords.map((c) => haversineMeters(point, c) / 1000),
  );
  return minKm > thresholdKm ? Math.round(minKm / 50) * 50 : null;
}
