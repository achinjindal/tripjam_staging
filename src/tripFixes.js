// Proactive fixes: problems in a built itinerary found from the trip data
// itself (no AI), each with a ready-made request Trippy can act on in one tap.
// The chat panel shows the top few; tapping one sends `prompt` as a normal
// chat message, so the edit goes through the usual ops, change card and undo.
//
// Pure module (no React, no I/O). Thresholds were checked against recent
// production itineraries so the list doesn't fire on noise.

// Same buffers generate-itinerary gives the model (index.ts, "Buffers by
// travel mode"), so a fix never contradicts what IG was told.
const ARRIVAL_BUFFER = { flight: 90, train: 45, bus: 20, road: 20 };
const PORT_ARRIVAL_BUFFER = { flight: 120, train: 30, bus: 20, road: 0 };
const MAX_FIXES = 3;

const SKIP_TYPES = new Set(["transit", "hotel"]);
const FOOD_TYPES = new Set([
  "food",
  "restaurant",
  "meal",
  "cafe",
  "drink",
  "bar",
]);
// Meals at the hotel repeat by design ("Breakfast at Guesthouse").
const LODGING_RE =
  /\b(?:hotel|resort|guesthouse|guest house|motel|hostel|villa|homestay|lodge|inn|rest|freshen)\b/i;
// The Board's Travel tab fills these in when it finds an airport for the
// first/last city (BoardView.jsx). They are placeholders, not the traveller's
// real times, so they can't be used to call a clash.
const PLACEHOLDER_ARRIVAL = "12:00";
const PLACEHOLDER_DEPARTURE = "19:00";

/** "09:30" → 570; anything else → null. */
export function toMin(t) {
  const m = typeof t === "string" && t.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v < 24 * 60 ? v : null;
}

/** "1.5h", "45m", "1h 30m", "90 min", "2 hours" → minutes; else null. */
export function durationMin(d) {
  if (typeof d !== "string") return null;
  const s = d.toLowerCase();
  const h = s.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/);
  const m = s.match(/(\d+)\s*(?:m|min|mins|minute|minutes)\b/);
  if (!h && !m) return null;
  const v = (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
  return v > 0 ? Math.round(v) : null;
}

const hhmm = (mins) =>
  `${String(Math.floor(mins / 60) % 24).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

const timeOf = (iso) => {
  const m = typeof iso === "string" && iso.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : null;
};
const dateOf = (iso) =>
  typeof iso === "string" && /^\d{4}-\d{2}-\d{2}/.test(iso)
    ? iso.slice(0, 10)
    : null;

// "Evening Dinner at Huen Phen" → "huen phen". Mirrors placeKey in
// supabase/functions/chat/_ops.ts (the server's already-in-trip guard).
export function placeKey(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(
      /^(?:(?:early|late|evening|afternoon|morning|sunset|riverside|quick)\s+)*(?:breakfast|brunch|lunch|dinner|drinks|coffee|visit|explore)?\s*(?:at|in)?\s+/,
      "",
    );
}
function samePlace(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 8 && ` ${long} `.includes(` ${short} `);
}

function metersBetween(a, b) {
  const R = 6371000;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const sorted = (day) =>
  [...(day?.activities || [])].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  );
const dayName = (day, i) => day?.label || `Day ${i + 1}`;
const short = (title) => {
  const t = String(title || "").replace(/^Check in at /i, "");
  return t.length > 40 ? `${t.slice(0, 38).trim()}…` : t;
};
const list = (xs) =>
  xs.length <= 1
    ? xs.join("")
    : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

// ── Detectors (each returns fixes for one kind, most important first) ───────

// Day 1 plans that start before the traveller can get there.
function arrivalClash(trip, days) {
  const day = days[0];
  const raw = timeOf(trip?.arrival_time);
  const at = toMin(raw);
  if (!day || at == null || raw === PLACEHOLDER_ARRIVAL) return [];
  const date = dateOf(trip.arrival_time);
  if (day.date && date && day.date !== date) return [];
  const mode = trip.arrival_mode || "flight";
  const ready = at + (ARRIVAL_BUFFER[mode] ?? 90);
  const early = sorted(day).filter((a) => {
    const t = toMin(a.time);
    return t != null && a.type !== "transit" && t < ready - 30;
  });
  if (!early.length) return [];
  const verb = mode === "flight" ? "land" : "arrive";
  return [
    {
      kind: "arrival",
      dayIdx: 0,
      text: `${dayName(day, 0)} has ${short(early[0].title)} at ${early[0].time}, but you ${verb} at ${hhmm(at)}.`,
      prompt: `I ${verb} at ${hhmm(at)} on ${dayName(day, 0)}, so I can't start before about ${hhmm(ready)}. Move or drop what's planned before then.`,
      label: `Fix ${dayName(day, 0)}`,
    },
  ];
}

// Last-day plans that run into the trip home.
function departureClash(trip, days) {
  const i = days.length - 1;
  const day = days[i];
  const raw = timeOf(trip?.departure_time);
  const dep = toMin(raw);
  if (!day || dep == null || raw === PLACEHOLDER_DEPARTURE) return [];
  const date = dateOf(trip.departure_time);
  if (day.date && date && day.date !== date) return [];
  const mode = trip.departure_mode || "flight";
  const atPort = dep - (PORT_ARRIVAL_BUFFER[mode] ?? 120);
  const late = sorted(day).filter((a) => {
    const t = toMin(a.time);
    if (t == null || SKIP_TYPES.has(a.type)) return false;
    return t + (durationMin(a.duration) ?? 60) > atPort - 30;
  });
  if (!late.length) return [];
  const what =
    { flight: "flight", train: "train", bus: "bus" }[mode] || "departure";
  const where =
    { flight: "the airport", train: "the station", bus: "the bus station" }[
      mode
    ] || "your departure point";
  return [
    {
      kind: "departure",
      dayIdx: i,
      text: `${dayName(day, i)} has ${short(late[0].title)} at ${late[0].time}, but your ${what} leaves at ${hhmm(dep)}.`,
      prompt: `My ${what} leaves at ${hhmm(dep)} on ${dayName(day, i)} and I need to be at ${where} by ${hhmm(Math.max(atPort, 0))}. Drop or move what doesn't fit before the transfer.`,
      label: `Fix ${dayName(day, i)}`,
    },
  ];
}

// Activities that overlap a booked flight or train on the same date.
function bookedLegClash(trip, days) {
  const legs = (Array.isArray(trip?.travel_data) ? trip.travel_data : [])
    .filter((l) => l && l.status !== "cancelled" && l.date)
    .map((l) => ({
      ...l,
      dep: toMin(l.depart_time),
      arr: toMin(l.arrive_time),
    }))
    .filter((l) => l.dep != null);
  const out = [];
  days.forEach((day, i) => {
    if (!day?.date) return;
    for (const leg of legs.filter((l) => l.date === day.date)) {
      const from = leg.dep - (leg.kind === "flight" ? 120 : 30);
      const to = leg.arr != null && leg.arr > leg.dep ? leg.arr : leg.dep;
      const hit = sorted(day).find((a) => {
        const t = toMin(a.time);
        if (t == null || SKIP_TYPES.has(a.type)) return false;
        const end = t + (durationMin(a.duration) ?? 60);
        return t < to && end > from;
      });
      if (!hit) continue;
      const name =
        [leg.carrier, leg.number].filter(Boolean).join(" ") || leg.kind;
      out.push({
        kind: "booked_leg",
        dayIdx: i,
        text: `${short(hit.title)} on ${dayName(day, i)} clashes with your ${leg.kind} (${name}, ${leg.depart_time}).`,
        prompt: `On ${dayName(day, i)} I have a booked ${leg.kind}, ${name}, departing ${leg.depart_time}${leg.arrive_time ? ` and arriving ${leg.arrive_time}` : ""}. Rearrange that day around it.`,
        label: `Fix ${dayName(day, i)}`,
      });
      break;
    }
  });
  return out;
}

// The same restaurant on two days (IG repeats favourites; earlier chat edits
// did too). Sights are left alone: going back to a beach or a sunset spot is
// often the point.
function repeatedPlaces(days) {
  const seen = []; // {key, dayIdx}
  const byDay = new Map(); // later dayIdx → {titles, firstDay}
  days.forEach((day, i) => {
    for (const a of sorted(day)) {
      if (!FOOD_TYPES.has(a.type) || LODGING_RE.test(a.title || "")) continue;
      const key = placeKey(a.title);
      if (!key) continue;
      const prev = seen.find((s) => s.dayIdx !== i && samePlace(s.key, key));
      if (prev) {
        const e = byDay.get(i) || { titles: [], firstDay: prev.dayIdx };
        if (!e.titles.includes(a.title)) e.titles.push(a.title);
        byDay.set(i, e);
      } else seen.push({ key, dayIdx: i });
    }
  });
  return [...byDay.entries()].map(([i, e]) => {
    const names = list(e.titles.map(short));
    return {
      kind: "repeat",
      dayIdx: i,
      text: `${dayName(days[i], i)} repeats ${names} from ${dayName(days[e.firstDay], e.firstDay)}.`,
      prompt: `${dayName(days[i], i)} repeats ${names} from ${dayName(days[e.firstDay], e.firstDay)}. Replace the repeat${e.titles.length > 1 ? "s" : ""} on ${dayName(days[i], i)} with something new nearby.`,
      label: "Swap the repeat" + (e.titles.length > 1 ? "s" : ""),
    };
  });
}

// One activity still running when the next one is due to start.
function timeOverlaps(days) {
  const out = [];
  days.forEach((day, i) => {
    const acts = sorted(day).filter((a) => a.type !== "transit");
    for (let k = 0; k + 1 < acts.length; k++) {
      const a = acts[k];
      const b = acts[k + 1];
      const t = toMin(a.time);
      const next = toMin(b.time);
      const dur = durationMin(a.duration);
      // Out-of-order times are a different problem; don't call them overlaps.
      if (t == null || next == null || dur == null || next < t) continue;
      if (t + dur <= next + 30) continue;
      out.push({
        kind: "overlap",
        dayIdx: i,
        text: `On ${dayName(day, i)}, ${short(a.title)} (${a.time}, ${a.duration}) runs into ${short(b.title)} at ${b.time}.`,
        prompt: `On ${dayName(day, i)}, ${a.title} starts at ${a.time} and takes ${a.duration}, so it runs into ${b.title} at ${b.time}. Fix the timing.`,
        label: "Fix the timing",
      });
      break;
    }
  });
  return out;
}

// A long ride between two stops in the same day (not a planned transfer).
function longHops(days) {
  const out = [];
  days.forEach((day, i) => {
    const acts = sorted(day);
    if (acts.some((a) => a.type === "transit")) return; // day trips, transfers
    for (let k = 0; k + 1 < acts.length; k++) {
      const a = acts[k];
      const b = acts[k + 1];
      if (a.lat == null || a.lng == null || b.lat == null || b.lng == null)
        continue;
      const meters = metersBetween(a, b);
      // Same road factor and speed as TransitionRow (App.jsx).
      const driveMins = Math.round((meters * 1.3) / 400);
      if (driveMins < 50 || meters > 200000) continue;
      out.push({
        kind: "long_hop",
        dayIdx: i,
        text: `${dayName(day, i)} has a ~${driveMins}-min ride from ${short(a.title)} to ${short(b.title)}.`,
        prompt: `On ${dayName(day, i)} it's about a ${driveMins}-minute ride from ${a.title} to ${b.title}. Reorder or swap something to cut the travel time.`,
        label: "Cut the ride",
      });
      break;
    }
  });
  return out;
}

/**
 * Up to MAX_FIXES fixes, hard clashes first, at most one per day.
 * `dismissed` is a Set of fix ids the viewer closed.
 */
export function findTripFixes(trip, days, dismissed = new Set()) {
  if (!Array.isArray(days) || !days.length) return [];
  const all = [
    ...bookedLegClash(trip, days),
    ...arrivalClash(trip, days),
    ...departureClash(trip, days),
    ...repeatedPlaces(days),
    ...timeOverlaps(days),
    ...longHops(days),
  ].map((f) => ({ ...f, id: `${f.kind}:${f.dayIdx}:${f.text}` }));
  const out = [];
  const usedDays = new Set();
  for (const f of all) {
    if (out.length >= MAX_FIXES) break;
    if (dismissed.has(f.id) || usedDays.has(f.dayIdx)) continue;
    usedDays.add(f.dayIdx);
    out.push(f);
  }
  return out;
}
