import { useState, useRef, useEffect } from "react";
import { supabase } from "./supabase";

const FACE_ICONS = ["👦","👧","🧑","👨","👩","🧔","👱","🧓","🥸","😎"];

/* ─── THEME ─────────────────────────────────────────────────────────── */
const T = {
  ink:    "#0F1923",
  dusk:   "#1E2D3D",
  ocean:  "#2563A8",
  sky:    "#4A90D9",
  sand:   "#F0E6D3",
  warm:   "#FAF6F0",
  terra:  "#C4622D",
  gold:   "#D4A847",
  moss:   "#3D7A5C",
  mist:   "#8BA5BB",
  chalk:  "#FFFFFF",
};

const PLACES_PROXY = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/places-proxy`;
const PLACES_HEADERS = { "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`, "Content-Type": "application/json" };

/* ─── PHOTO HOOK ─────────────────────────────────────────────────────── */
const _photoCache = {};

async function _fetchPhoto(geocode, city) {
  // Tier 1: Wikipedia (free)
  try {
    const data = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(geocode)}&prop=pageimages&format=json&pithumbsize=700&redirects=1&origin=*`
    ).then(r => r.json());
    const src = Object.values(data?.query?.pages || {})[0]?.thumbnail?.source;
    if (src) return src;
  } catch {}

  // Tier 2: Wikimedia Commons (free)
  try {
    const q = city ? `${geocode} ${city}` : geocode;
    const data = await fetch(
      `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(q)}&gsrlimit=10&prop=imageinfo&iiprop=url&iiurlwidth=700&format=json&origin=*`
    ).then(r => r.json());
    const pages = Object.values(data?.query?.pages || {});
    const photo = pages.find(p => /\.(jpe?g|png)/i.test(p.imageinfo?.[0]?.url || ""));
    if (photo) return photo.imageinfo[0].url;
  } catch {}

  return null;
}

function useActivityPhoto(geocode, city) {
  const [url, setUrl] = useState(undefined);
  const key = `${geocode}||${city || ""}`;
  useEffect(() => {
    if (!geocode) { setUrl(null); return; }
    if (_photoCache[key] !== undefined) { setUrl(_photoCache[key]); return; }
    _fetchPhoto(geocode, city).then(src => {
      _photoCache[key] = src ?? null;
      setUrl(src ?? null);
    });
  }, [key]);
  return url;
}

function PhotoStrip({ activity, city }) {
  const stored = activity?.photo_url;
  const geocode = activity?.geocode || activity?.title;
  const [liveUrl, setLiveUrl] = useState(stored ? null : undefined);

  useEffect(() => {
    if (stored) return; // already have a URL from DB
    if (!geocode) { setLiveUrl(null); return; }
    const key = `${geocode}||${city || ""}`;
    if (_photoCache[key] !== undefined) { setLiveUrl(_photoCache[key]); return; }
    _fetchPhoto(geocode, city).then(src => {
      _photoCache[key] = src ?? null;
      setLiveUrl(src ?? null);
    });
  }, [stored, geocode, city]);

  const url = stored || liveUrl;
  if (url === undefined) return (
    <div style={{marginTop:10,height:130,borderRadius:10,background:T.sand,animation:"shimmer 1.5s ease-in-out infinite"}}/>
  );
  if (!url) return null;
  return (
    <div style={{marginTop:10,borderRadius:10,overflow:"hidden",height:130,background:T.sand}}>
      <img src={url} alt={geocode} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
    </div>
  );
}

/* ─── DATA ───────────────────────────────────────────────────────────── */
const SAMPLE_TRIP = {
  name: "Rajasthan Golden Trail",
  dates: "Apr 12 – Apr 19, 2026",
  travelers: 3,
  collaborators: [
    { name: "Priya", avatar: "P", color: T.terra },
    { name: "Arjun", avatar: "A", color: T.moss },
    { name: "You",   avatar: "Y", color: T.ocean },
  ],
  days: [
    {
      id: 1, label: "Day 1", date: "Apr 12", city: "Jaipur",
      activities: [
        { id: 1,  time: "09:00", title: "Amber Fort",            type: "sight",   duration: "3h",   note: "Book tickets online!", confirmed: true,  icon: "🏯" },
        { id: 2,  time: "13:00", title: "Suvarna Mahal Lunch",   type: "food",    duration: "1.5h", note: "Rambagh Palace",        confirmed: true,  icon: "🍛" },
        { id: 3,  time: "16:00", title: "Hawa Mahal",            type: "sight",   duration: "1h",   note: "Best at sunset",       confirmed: false, icon: "🏛️" },
        { id: 4,  time: "20:00", title: "Chokhi Dhani Dinner",   type: "food",    duration: "2h",   note: "Cultural show included",confirmed: true,  icon: "🎭" },
      ],
    },
    {
      id: 2, label: "Day 2", date: "Apr 13", city: "Jaipur",
      activities: [
        { id: 5,  time: "08:30", title: "City Palace Museum",    type: "sight",   duration: "2h",   note: "",                     confirmed: true,  icon: "🏰" },
        { id: 6,  time: "11:00", title: "Jantar Mantar",         type: "sight",   duration: "1h",   note: "UNESCO World Heritage", confirmed: false, icon: "🔭" },
        { id: 7,  time: "13:30", title: "Lassiwala",             type: "food",    duration: "45m",  note: "Famous since 1944",    confirmed: true,  icon: "🥛" },
        { id: 8,  time: "15:00", title: "Johari Bazaar",         type: "shop",    duration: "2h",   note: "Bargain hard!",        confirmed: false, icon: "🛍️" },
      ],
    },
    {
      id: 3, label: "Day 3", date: "Apr 14", city: "Jodhpur",
      activities: [
        { id: 9,  time: "07:00", title: "Drive to Jodhpur",      type: "transit", duration: "5h",   note: "Hire private cab",     confirmed: true,  icon: "🚗" },
        { id: 10, time: "13:00", title: "Check-in & Lunch",      type: "hotel",   duration: "1h",   note: "Umaid Bhawan area",    confirmed: false, icon: "🏨" },
        { id: 11, time: "15:00", title: "Mehrangarh Fort",       type: "sight",   duration: "3h",   note: "Audio guide essential",confirmed: false, icon: "🏯" },
        { id: 12, time: "19:30", title: "Rooftop Dinner",        type: "food",    duration: "2h",   note: "Blue City panorama",   confirmed: false, icon: "🌆" },
      ],
    },
  ],
};

/* ─── DESTINATION DATA ───────────────────────────────────────────────── */
const DESTINATION_DATA = {
  bangkok: {
    name: "Bangkok Explorer",
    days: [
      {
        id: 1, label: "Day 1", date: "Day 1", city: "Bangkok",
        activities: [
          { id: 1,  time: "08:00", title: "Wat Phra Kaew",           type: "sight",   duration: "2h",   note: "Arrive early to beat crowds", confirmed: false, icon: "🛕" },
          { id: 2,  time: "10:30", title: "Grand Palace",             type: "sight",   duration: "1.5h", note: "Dress code enforced",         confirmed: false, icon: "🏯" },
          { id: 3,  time: "13:00", title: "Lunch at Err Restaurant",  type: "food",    duration: "1h",   note: "Modern Thai cuisine",         confirmed: false, icon: "🍜" },
          { id: 4,  time: "20:00", title: "Khao San Road night out",  type: "food",    duration: "2h",   note: "Lively street food scene",    confirmed: false, icon: "🌃" },
        ],
      },
      {
        id: 2, label: "Day 2", date: "Day 2", city: "Bangkok",
        activities: [
          { id: 5,  time: "07:00", title: "Floating Market",          type: "sight",   duration: "3h",   note: "Damnoen Saduak — book early", confirmed: false, icon: "🛶" },
          { id: 6,  time: "12:00", title: "Pad Thai at Thip Samai",   type: "food",    duration: "1h",   note: "Best pad thai in Bangkok",    confirmed: false, icon: "🍛" },
          { id: 7,  time: "15:00", title: "Chatuchak Weekend Market", type: "shop",    duration: "2.5h", note: "8,000+ stalls!",              confirmed: false, icon: "🛍️" },
          { id: 8,  time: "19:30", title: "Rooftop bar, Silom",       type: "food",    duration: "2h",   note: "Sky Bar at Lebua",            confirmed: false, icon: "🌆" },
        ],
      },
      {
        id: 3, label: "Day 3", date: "Day 3", city: "Bangkok",
        activities: [
          { id: 9,  time: "09:00", title: "Wat Arun (Temple of Dawn)", type: "sight",   duration: "1.5h", note: "Best viewed from river",     confirmed: false, icon: "🛕" },
          { id: 10, time: "11:00", title: "Chao Phraya river cruise",  type: "sight",   duration: "1h",   note: "Scenic & cheap ~฿15",        confirmed: false, icon: "⛵" },
          { id: 11, time: "14:00", title: "Jim Thompson House",        type: "sight",   duration: "1.5h", note: "Iconic silk merchant villa", confirmed: false, icon: "🏛️" },
          { id: 12, time: "19:00", title: "Yaowarat Chinatown",        type: "food",    duration: "2.5h", note: "Best street food in BKK",    confirmed: false, icon: "🏮" },
        ],
      },
      {
        id: 4, label: "Day 4", date: "Day 4", city: "Ayutthaya",
        activities: [
          { id: 13, time: "08:00", title: "Day trip to Ayutthaya",     type: "transit", duration: "1.5h", note: "Train from Hua Lamphong",    confirmed: false, icon: "🚂" },
          { id: 14, time: "10:00", title: "Wat Mahathat ruins",        type: "sight",   duration: "1.5h", note: "Famous Buddha-in-tree roots",confirmed: false, icon: "🛕" },
          { id: 15, time: "13:00", title: "Lunch at local riverside",  type: "food",    duration: "1h",   note: "Fresh river fish",           confirmed: false, icon: "🍽️" },
          { id: 16, time: "16:00", title: "Wat Phra Si Sanphet",       type: "sight",   duration: "1.5h", note: "Three iconic chedis",        confirmed: false, icon: "🏯" },
        ],
      },
      {
        id: 5, label: "Day 5", date: "Day 5", city: "Chiang Mai",
        activities: [
          { id: 17, time: "06:30", title: "Flight to Chiang Mai",      type: "transit", duration: "1.5h", note: "AirAsia ~฿800",              confirmed: false, icon: "✈️" },
          { id: 18, time: "10:00", title: "Doi Suthep Temple",         type: "sight",   duration: "2h",   note: "Take the songthaew up",      confirmed: false, icon: "🛕" },
          { id: 19, time: "14:00", title: "Thai cooking class",        type: "sight",   duration: "3h",   note: "Thai Farm Cooking School",   confirmed: false, icon: "👨‍🍳" },
          { id: 20, time: "20:00", title: "Chiang Mai Night Bazaar",   type: "shop",    duration: "2h",   note: "Great for souvenirs",        confirmed: false, icon: "🏮" },
        ],
      },
    ],
  },
  kyoto: {
    name: "Kyoto Explorer",
    days: [
      {
        id: 1, label: "Day 1", date: "Day 1", city: "Kyoto",
        activities: [
          { id: 1,  time: "08:00", title: "Fushimi Inari Shrine",     type: "sight",   duration: "2.5h", note: "Go early — fewer crowds",    confirmed: false, icon: "⛩️" },
          { id: 2,  time: "11:00", title: "Nishiki Market",           type: "food",    duration: "1.5h", note: "Kyoto's Kitchen",           confirmed: false, icon: "🍱" },
          { id: 3,  time: "14:00", title: "Gion District walk",       type: "sight",   duration: "2h",   note: "Spot geiko in late evening",  confirmed: false, icon: "🏮" },
          { id: 4,  time: "19:00", title: "Kaiseki dinner",           type: "food",    duration: "2h",   note: "Book weeks in advance",      confirmed: false, icon: "🍣" },
        ],
      },
      {
        id: 2, label: "Day 2", date: "Day 2", city: "Kyoto",
        activities: [
          { id: 5,  time: "07:30", title: "Arashiyama Bamboo Grove",  type: "sight",   duration: "1.5h", note: "Magical at dawn",            confirmed: false, icon: "🎋" },
          { id: 6,  time: "10:00", title: "Tenryu-ji Garden",         type: "sight",   duration: "1h",   note: "UNESCO World Heritage",      confirmed: false, icon: "🌸" },
          { id: 7,  time: "12:30", title: "Tofu cuisine lunch",       type: "food",    duration: "1h",   note: "Shoraian restaurant",        confirmed: false, icon: "🥢" },
          { id: 8,  time: "16:00", title: "Philosopher's Path",      type: "sight",   duration: "2h",   note: "Cherry blossoms in April",   confirmed: false, icon: "🌿" },
        ],
      },
    ],
  },
  rajasthan: {
    name: "Rajasthan Golden Trail",
    days: SAMPLE_TRIP.days,
  },
};

function generateGenericDays(destination, numDays) {
  const cap = d => d.charAt(0).toUpperCase() + d.slice(1);
  const city = cap(destination);
  return Array.from({ length: numDays }, (_, i) => ({
    id: i + 1, label: `Day ${i + 1}`, date: `Day ${i + 1}`, city,
    activities: [
      { id: i*4+1, time:"09:00", title:`Morning at ${city}`,        type:"sight",   duration:"2h",   note:"Explore the area",          confirmed:false, icon:"🗺️" },
      { id: i*4+2, time:"12:30", title:"Local lunch",               type:"food",    duration:"1h",   note:"Ask locals for best spots",  confirmed:false, icon:"🍽️" },
      { id: i*4+3, time:"15:00", title:`Afternoon in ${city}`,      type:"sight",   duration:"2h",   note:"",                          confirmed:false, icon:"📍" },
      { id: i*4+4, time:"19:30", title:"Dinner & evening stroll",   type:"food",    duration:"1.5h", note:"",                          confirmed:false, icon:"🌙" },
    ],
  }));
}

function getItineraryForForm(form) {
  const numDays = form.startDate && form.endDate
    ? Math.max(1, Math.round((new Date(form.endDate) - new Date(form.startDate)) / (1000*60*60*24)) + 1)
    : 3;
  const dests = form.destinations.length > 0 ? form.destinations : ["Travel"];
  const daysPerDest = Math.ceil(numDays / dests.length);

  let allDays = [];
  for (const dest of dests) {
    const remaining = numDays - allDays.length;
    if (remaining <= 0) break;
    const take = Math.min(daysPerDest, remaining);
    const key = dest.toLowerCase();
    const matched = Object.keys(DESTINATION_DATA).find(k => key.includes(k) || k.includes(key));
    let destDays;
    if (matched) {
      const slice = DESTINATION_DATA[matched].days.slice(0, take);
      const pad = slice.length < take ? generateGenericDays(key, take - slice.length) : [];
      destDays = [...slice, ...pad];
    } else {
      destDays = generateGenericDays(dest, take);
    }
    const offset = allDays.length;
    allDays = allDays.concat(destDays.map((d, i) => ({
      ...d,
      id: offset + i + 1,
      label: `Day ${offset + i + 1}`,
      date: `Day ${offset + i + 1}`,
      city: dest,
    })));
  }

  const name = dests.length === 1
    ? `${dests[0]} Explorer`
    : dests.join(" → ");
  return { name, days: allDays };
}

const typeStyle = {
  sight:   { bg: "#EBF3FD", color: T.ocean,   label: "Sightseeing" },
  food:    { bg: "#FFF4E8", color: T.terra,   label: "Dining" },
  shop:    { bg: "#FDF0E0", color: T.gold,    label: "Shopping" },
  transit: { bg: "#F0F4F0", color: T.moss,    label: "Transit" },
  hotel:   { bg: "#F5F0FA", color: "#7B5EA7", label: "Stay" },
};


/* ─── COMMUTE UTILS ─────────────────────────────────────────────────── */
function fmtTime(mins) {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// Extract the core place name from a verbose activity title.
// "Star Ferry to Elephanta Island"          → "Elephanta Island"
// "Street food walk at Mohammed Ali Road"   → "Mohammed Ali Road"
// "Hiking at Aarey Milk Colony"             → "Aarey Milk Colony"
// "Gateway of India"                        → "Gateway of India"
// "Dharavi Slum tour"                       → "Dharavi Slum"
function extractPlace(title) {
  // Try preposition FIRST — catches "walk at X", "trip to X", "experience in X"
  const prep = title.match(/\b(?:at|to|in|near|around|from)\s+(.+)$/i);
  if (prep) return prep[1].trim();
  // Fall back: strip trailing activity descriptor and return remainder
  const stripped = title.replace(/\b(walk|tour|trip|trek|hike|hiking|cycling|trail|experience|exploration|visit|cruise|ferry ride|boat ride|day trip)\b.*$/i, "").trim();
  return stripped || title.trim();
}

// Global serialized geocoding queue — prevents rate-limiting from concurrent requests
const _geocodeCache = new Map();
const _cityCache = new Map();
const _queue = [];
let _queueRunning = false;

function runQueue() {
  if (_queueRunning || _queue.length === 0) return;
  _queueRunning = true;
  (async () => {
    while (_queue.length > 0) {
      _queue.shift()();
      await new Promise(r => setTimeout(r, 120)); // 120ms between requests — prevents rate-limiting
    }
    _queueRunning = false;
  })();
}

function queuedFetch(url) {
  return new Promise(resolve => {
    _queue.push(async () => {
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(tid);
        resolve(res.ok ? await res.json() : null);
      } catch { resolve(null); }
    });
    runQueue();
  });
}

async function getCityCenter(city) {
  if (_cityCache.has(city)) return _cityCache.get(city);
  const data = await queuedFetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(city)}&limit=1`);
  const feat = data?.features?.[0];
  const result = feat ? { lat: feat.geometry.coordinates[1], lng: feat.geometry.coordinates[0] } : null;
  _cityCache.set(city, result);
  return result;
}

async function geocodePlace(title, city, geocodeHint) {
  // Use AI-provided geocode hint if available, otherwise extract from title
  const place = geocodeHint || extractPlace(title);
  const cityCenter = await getCityCenter(city);
  // zoom=14 strongly biases results towards the city area
  const bias = cityCenter ? `&lat=${cityCenter.lat}&lon=${cityCenter.lng}&zoom=14` : "";
  // Deduplicate queries; if we have a hint, only use it (don't fall back to full title)
  const queries = geocodeHint
    ? [`${place} ${city}`]
    : [...new Set([`${place} ${city}`, `${title} ${city}`])];
  for (const q of queries) {
    if (_geocodeCache.has(q)) { const c = _geocodeCache.get(q); if (c) return c; continue; }
    // Fetch 5 candidates, take the first one within 30km of city center
    const data = await queuedFetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5${bias}`);
    const feats = data?.features || [];
    const hit = feats.find(f => {
      const c = { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
      return !cityCenter || haversineMeters(c, cityCenter) <= 30000;
    });
    const result = hit ? { lat: hit.geometry.coordinates[1], lng: hit.geometry.coordinates[0] } : null;
    _geocodeCache.set(q, result);
    if (result) return result;
  }
  return null;
}

function haversineMeters(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const x = Math.sin(dLat/2)**2 + Math.cos(a.lat*toR)*Math.cos(b.lat*toR)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}

/* ─── TRANSITION ROW ────────────────────────────────────────────────── */
function TransitionRow({ from, to, city, label = null }) {
  const [commute, setCommute] = useState(null);
  const [loading, setLoading] = useState(true);
  const [debug, setDebug] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const placeA = from.geocode || extractPlace(from.title);
      const placeB = to.geocode   || extractPlace(to.title);
      const [coordA, coordB] = await Promise.all([
        geocodePlace(from.title, city, from.geocode),
        geocodePlace(to.title,   city, to.geocode),
      ]);
      if (cancelled) return;
      let reason = null;
      if (!coordA && !coordB) reason = `no coords for "${placeA}" or "${placeB}" in ${city}`;
      else if (!coordA) reason = `no coords for "${placeA}" in ${city}`;
      else if (!coordB) reason = `no coords for "${placeB}" in ${city}`;
      else {
        const dist = haversineMeters(coordA, coordB);
        if (dist >= 100000) {
          reason = `distance ${Math.round(dist/1000)}km > 100km (should not happen now)`;
        } else {
          const road = dist * 1.4;
          const walkMins  = Math.max(1, Math.round(road / 80));
          const driveMins = Math.max(1, Math.round(road / 350));
          const useWalk = walkMins <= 20;
          if (!cancelled) setCommute({ mode: useWalk ? "walk" : "drive", mins: useWalk ? walkMins : driveMins });
        }
      }
      if (!cancelled) setDebug({ placeA, placeB, reason });
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [from.title, from.geocode, to.title, to.geocode, city]);

  if (loading) return (
    <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 20px"}}>
      {label && <span style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif",whiteSpace:"nowrap",flexShrink:0}}>{label}</span>}
      <div style={{flex:1,height:1,background:T.sand}}/>
      <span style={{fontSize:11,color:T.mist,letterSpacing:2}}>···</span>
      <div style={{flex:1,height:1,background:T.sand}}/>
    </div>
  );

  if (!commute) return (
    <div style={{padding:"2px 20px"}}>
      <div style={{fontSize:10,color:"#E05C5C",fontFamily:"monospace",background:"#FFF5F5",
        border:"1px solid #FCCACA",borderRadius:6,padding:"3px 8px",lineHeight:1.5}}>
        ✗ {from.title} → {to.title}<br/>
        <span style={{color:"#999"}}>extracted: "{debug?.placeA}" → "{debug?.placeB}"</span><br/>
        <span style={{color:"#999"}}>{debug?.reason}</span>
      </div>
    </div>
  );

  const origin   = encodeURIComponent(`${extractPlace(from.title)} ${city}`);
  const dest     = encodeURIComponent(`${extractPlace(to.title)} ${city}`);
  const mapsUrl  = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=${commute.mode === "walk" ? "walking" : "driving"}`;

  return (
    <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 20px"}}>
      {label && <span style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif",whiteSpace:"nowrap",flexShrink:0}}>{label}</span>}
      <div style={{flex:1,height:1,background:T.sand}}/>
      <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
        style={{fontSize:11,fontFamily:"Georgia,serif",textDecoration:"none",whiteSpace:"nowrap",
          padding:"3px 10px",borderRadius:20,
          ...(commute.mode === "walk"
            ? {color:T.moss,  border:`1px solid ${T.moss}`,  background:"#F4FAF7"}
            : {color:T.ocean, border:`1px solid ${T.ocean}`, background:"#EBF3FD"}
          )}}>
        {commute.mode === "walk" ? "🚶" : "🚗"} {fmtTime(commute.mins)} {commute.mode === "walk" ? "walk" : "drive"}
      </a>
      <div style={{flex:1,height:1,background:T.sand}}/>
    </div>
  );
}

/* ─── ACTIVITY CARD ──────────────────────────────────────────────────── */
function ActivityCard({ activity, city, onEdit }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ ...activity });
  const ts = typeStyle[draft.type] || typeStyle.sight;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${activity.geocode || activity.title} ${city}`)}`;


  const saveEdit = () => { onEdit(draft); setEditing(false); };
  const cancelEdit = () => { setDraft({...activity}); setEditing(false); };

  if (editing) {
    return (
      <div style={{padding:"0 20px",marginBottom:2}}>
        <div style={{background:T.chalk,borderRadius:16,padding:14,border:`1.5px solid ${T.ocean}`,boxShadow:"0 2px 14px rgba(15,25,35,0.07)"}}>
          <div style={{display:"flex",gap:8,marginBottom:8}}>
            <input value={draft.time} onChange={e=>setDraft(d=>({...d,time:e.target.value}))}
              placeholder="Time"
              style={{width:100,padding:"8px 10px",borderRadius:10,border:`1.5px solid ${T.sand}`,fontFamily:"Georgia,serif",fontSize:13,color:T.ink,outline:"none"}}/>
            <input value={draft.title} onChange={e=>setDraft(d=>({...d,title:e.target.value}))}
              placeholder="Activity name"
              style={{flex:1,padding:"8px 10px",borderRadius:10,border:`1.5px solid ${T.sand}`,fontFamily:"Georgia,serif",fontSize:13,color:T.ink,outline:"none"}}/>
          </div>
          <div style={{display:"flex",gap:8,marginBottom:8}}>
            <select value={draft.type} onChange={e=>setDraft(d=>({...d,type:e.target.value}))}
              style={{flex:1,padding:"8px 10px",borderRadius:10,border:`1.5px solid ${T.sand}`,fontFamily:"Georgia,serif",fontSize:13,color:T.ink,outline:"none",background:T.chalk}}>
              {Object.entries(typeStyle).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
            </select>
            <input value={draft.duration} onChange={e=>setDraft(d=>({...d,duration:e.target.value}))}
              placeholder="Duration (e.g. 2h)"
              style={{width:120,padding:"8px 10px",borderRadius:10,border:`1.5px solid ${T.sand}`,fontFamily:"Georgia,serif",fontSize:13,color:T.ink,outline:"none"}}/>
          </div>
          <input value={draft.note} onChange={e=>setDraft(d=>({...d,note:e.target.value}))}
            placeholder="Note (optional)"
            style={{width:"100%",padding:"8px 10px",borderRadius:10,border:`1.5px solid ${T.sand}`,fontFamily:"Georgia,serif",fontSize:13,color:T.ink,outline:"none",marginBottom:8}}/>
          <input value={draft.geocode || ""} onChange={e=>setDraft(d=>({...d,geocode:e.target.value}))}
            placeholder="Map pin (e.g. Gateway of India Pier Mumbai)"
            style={{width:"100%",padding:"8px 10px",borderRadius:10,border:`1.5px solid ${T.sand}`,fontFamily:"Georgia,serif",fontSize:13,color:T.ink,outline:"none",marginBottom:10}}/>
          <div style={{display:"flex",gap:8}}>
            <button onClick={saveEdit} style={{flex:1,background:T.ocean,color:"white",border:"none",borderRadius:10,padding:"9px 0",fontFamily:"Georgia,serif",fontSize:13,cursor:"pointer"}}>Save</button>
            <button onClick={cancelEdit} style={{flex:1,background:T.sand,color:T.ink,border:"none",borderRadius:10,padding:"9px 0",fontFamily:"Georgia,serif",fontSize:13,cursor:"pointer"}}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display:"flex", gap:0, padding:"0 20px" }}>
      {/* Timeline column */}
      <div style={{ width:40, flexShrink:0, display:"flex", flexDirection:"column", alignItems:"center" }}>
        <div style={{
          width:38, height:38, borderRadius:"50%",
          background:ts.bg, border:`2.5px solid ${ts.color}`,
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:17, flexShrink:0,
        }}>{activity.icon}</div>
      </div>
      {/* Card */}
      <div style={{
        flex:1, background:T.chalk, borderRadius:16,
        padding:"13px 15px", marginBottom:2, marginLeft:10,
        boxShadow:"0 2px 14px rgba(15,25,35,0.07)",
        border:`1px solid ${T.sand}`,
        position:"relative", overflow:"hidden",
      }}>
        {activity.confirmed && (
          <div style={{position:"absolute",top:0,right:0,width:4,height:"100%",background:T.moss,borderRadius:"0 16px 16px 0"}}/>
        )}
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start"}}>
          <div style={{flex:1, paddingRight:8}}>
            <div style={{display:"flex", alignItems:"center", gap:7, marginBottom:4}}>
              <span style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif",letterSpacing:0.5}}>{activity.time}</span>
              <span style={{background:ts.bg,color:ts.color,fontSize:10,borderRadius:20,padding:"1px 7px",fontFamily:"Georgia,serif",fontWeight:600}}>
                {ts.label.toUpperCase()}
              </span>
            </div>
            <div style={{fontFamily:"'DM Serif Display',serif",fontSize:15,color:T.ink,lineHeight:1.3}}>{activity.title}</div>
            {activity.note && (
              <div style={{fontSize:11,color:T.mist,marginTop:4,fontFamily:"Georgia,serif",fontStyle:"italic"}}>💬 {activity.note}</div>
            )}
          </div>
          <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:5,flexShrink:0}}>
            <div style={{display:"flex",gap:5,alignItems:"center"}}>
              {activity.duration && <span style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif"}}>⏱ {activity.duration}</span>}
              <a href={mapsUrl} target="_blank" rel="noopener noreferrer" style={{fontSize:13,lineHeight:1,color:T.mist,textDecoration:"none"}} title="Open in Google Maps">📍</a>
              <button onClick={()=>setEditing(true)} style={{background:"transparent",border:"none",cursor:"pointer",fontSize:11,padding:"0 2px",color:T.sand}}>✎</button>
            </div>
          </div>
        </div>
        {activity.type !== "transit" && (
          <PhotoStrip activity={activity} city={city}/>
        )}
      </div>
    </div>
  );
}

/* ─── ARRIVAL TIMELINE ───────────────────────────────────────────────── */
function ArrivalTimeline({ arrivalTime, hotel, city, onEditFlight }) {
  const [travelMins, setTravelMins] = useState(null);
  const [loading, setLoading]       = useState(true);

  const arrivalHHMM = arrivalTime ? arrivalTime.split("T")[1]?.substring(0, 5) : null;

  useEffect(() => {
    if (!hotel?.name || !arrivalHHMM) { setLoading(false); return; }
    let cancelled = false;
    async function load() {
      const [airCoord, hotelCoord] = await Promise.all([
        geocodePlace(`${city} Airport`, city),
        geocodePlace(hotel.name, city),
      ]);
      if (cancelled) return;
      if (airCoord && hotelCoord) {
        const dist = haversineMeters(airCoord, hotelCoord);
        if (dist < 100000) {
          if (!cancelled) setTravelMins(Math.max(10, Math.round((dist * 1.4) / 350)));
        }
      }
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [arrivalHHMM, hotel?.name, city]);

  if (!arrivalHHMM) return null;

  const [h, m]          = arrivalHHMM.split(":").map(Number);
  const effectiveTravel = loading ? null : (travelMins ?? null);
  const rawReady   = h * 60 + m + 30 + (effectiveTravel ?? 45) + 90;
  const readyTotal = Math.round(rawReady / 30) * 30;
  const readyHH    = String(Math.floor(readyTotal / 60) % 24).padStart(2, "0");
  const readyMM    = String(readyTotal % 60).padStart(2, "0");


  return (
    <div style={{padding:"0 20px 12px"}}>
      <div style={{background:"#EBF5FF",borderRadius:10,padding:"10px 14px",border:"1px solid #C5DEFF"}}>
        <div style={{fontSize:12,fontFamily:"Georgia,serif",color:T.ink,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
          <span
            onClick={onEditFlight}
            style={onEditFlight ? {cursor:"pointer",textDecoration:"underline dotted",textUnderlineOffset:3} : {}}
          >✈️ Land {arrivalHHMM}</span>
          <span style={{color:T.mist,fontSize:10}}>›</span>
          <span style={{color:T.mist}}>30 min airport exit</span>
          <span style={{color:T.mist,fontSize:10}}>›</span>
          {!hotel?.name
            ? <span style={{color:T.mist}}>add hotel to estimate travel time</span>
            : loading
              ? <span style={{color:T.mist}}>🚗 ···</span>
              : effectiveTravel
                ? <span style={{color:T.ocean}}>🚗 ~{effectiveTravel} min to {hotel.name}</span>
                : <span style={{color:T.mist}}>🚗 ~45 min to {hotel.name}</span>
          }
          {hotel?.name && <><span style={{color:T.mist,fontSize:10}}>›</span><span>🏨 ~1.5h check-in & rest</span></>}
          {hotel?.name && <><span style={{color:T.mist,fontSize:10}}>›</span>
            <span style={{fontWeight:600,color:T.moss}}>Ready ~{readyHH}:{readyMM}</span></>}
        </div>
        <div style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif",marginTop:6,fontStyle:"italic"}}>
          💡 Tip: if check-in isn&apos;t until 3pm, consider dropping bags and exploring nearby spots first
        </div>
      </div>
    </div>
  );
}

/* ─── DAY SECTION ────────────────────────────────────────────────────── */
function DaySection({ day, hotel, onAddActivity, onEditActivity, arrivalTime = null, onEditFlight }) {
  const total = day.activities.length;
  const [adding, setAdding] = useState(false);
  const [showDesc, setShowDesc] = useState(false);
  const [newAct, setNewAct] = useState({ time:"", title:"", type:"sight", duration:"", note:"" });

  const submitNew = () => {
    if (!newAct.title.trim()) return;
    onAddActivity(day.id, {
      id: Date.now(),
      time: newAct.time || "TBD",
      title: newAct.title,
      type: newAct.type || "sight",
      duration: newAct.duration,
      note: newAct.note,
      confirmed: false,
      icon: "📍",
    });
    setNewAct({ time:"", title:"", type:"sight", duration:"", note:"" });
    setAdding(false);
  };

  const dayMapsUrl = day.activities.length > 0
    ? "https://www.google.com/maps/dir/" + day.activities.map(a => encodeURIComponent(`${a.title} ${day.city}`)).join("/")
    : null;

  return (
    <div style={{marginBottom:36}}>
      {/* Sticky day header */}
      <div style={{
        display:"flex", alignItems:"center", gap:12,
        padding:"16px 20px 12px",
        position:"sticky", top:0, zIndex:10,
        background:`linear-gradient(to bottom, ${T.warm} 85%, transparent)`,
      }}>
        <div style={{background:T.ocean,color:"white",borderRadius:10,padding:"5px 13px",fontFamily:"'DM Serif Display',serif",fontSize:14}}>{day.label}</div>
        <div style={{flex:1}}>
          <div style={{fontFamily:"'DM Serif Display',serif",fontSize:20,color:T.ink,lineHeight:1}}>{day.city}</div>
          <div style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif",marginTop:2}}>{day.date} · {total} activities</div>
        </div>
        {dayMapsUrl && (
          <a href={dayMapsUrl} target="_blank" rel="noopener noreferrer"
            style={{fontSize:12,color:T.ocean,textDecoration:"none",background:"#EBF3FD",
              borderRadius:20,padding:"4px 11px",fontFamily:"Georgia,serif",flexShrink:0,whiteSpace:"nowrap"}}>
            🗺️ Route
          </a>
        )}
        {day.description && (
          <button onClick={()=>setShowDesc(s=>!s)} title="About this day"
            style={{background:showDesc?"#EBF3FD":"transparent",border:`1.5px solid ${showDesc?T.ocean:T.sand}`,
              borderRadius:20,padding:"4px 10px",cursor:"pointer",fontSize:13,color:showDesc?T.ocean:T.mist,flexShrink:0,lineHeight:1}}>
            📖
          </button>
        )}
      </div>

      {/* Day description */}
      {day.description && showDesc && (
        <div style={{margin:"0 20px 12px",padding:"12px 16px",background:"#F5F9FF",borderRadius:12,border:`1px solid #D6E8FF`}}>
          <div style={{fontSize:13,color:T.dusk,fontFamily:"Georgia,serif",fontStyle:"italic",lineHeight:1.7}}>
            {day.description}
          </div>
        </div>
      )}

      {/* Arrival timeline */}
      {arrivalTime && (
        <ArrivalTimeline arrivalTime={arrivalTime} hotel={hotel} city={day.city} onEditFlight={onEditFlight} />
      )}

      {/* Hotel → first activity */}
      {hotel?.name && day.activities.length > 0 && (
        <TransitionRow from={{ title: hotel.name }} to={day.activities[0]} city={day.city} label="🏨 Hotel"/>
      )}

      {/* Activities */}
      {day.activities.map((act, i) => (
        <div key={act.id}>
          <ActivityCard activity={act} city={day.city} onEdit={(updated)=>onEditActivity(day.id, updated)}/>
          {i < day.activities.length - 1 && (
            <TransitionRow from={act} to={day.activities[i + 1]} city={day.city}/>
          )}
        </div>
      ))}

      {/* Last activity → hotel */}
      {hotel?.name && day.activities.length > 0 && (
        <TransitionRow
          from={day.activities[day.activities.length - 1]}
          to={{ title: hotel.name }}
          city={day.city}
          label="→ Hotel 🏨"
        />
      )}

      <div style={{padding:"8px 20px 0"}}>
        <button onClick={()=>setAdding(a=>!a)} style={{
          width:"100%", border:`2px dashed ${adding?T.ocean:T.sand}`,
          background:"transparent", borderRadius:14, padding:11,
          color:adding?T.ocean:T.mist, cursor:"pointer", fontFamily:"Georgia,serif", fontSize:13,
        }}>+ Add activity to {day.city}</button>

        {adding && (
          <div style={{marginTop:10,background:T.chalk,borderRadius:14,padding:14,border:`1.5px solid ${T.sand}`}}>
            <div style={{display:"flex",gap:8,marginBottom:8}}>
              <input value={newAct.time} onChange={e=>setNewAct(a=>({...a,time:e.target.value}))}
                placeholder="Time (e.g. 14:00)"
                style={{width:100,padding:"8px 10px",borderRadius:10,border:`1.5px solid ${T.sand}`,fontFamily:"Georgia,serif",fontSize:13,color:T.ink,outline:"none"}}/>
              <input value={newAct.title} onChange={e=>setNewAct(a=>({...a,title:e.target.value}))}
                placeholder="Activity name"
                style={{flex:1,padding:"8px 10px",borderRadius:10,border:`1.5px solid ${T.sand}`,fontFamily:"Georgia,serif",fontSize:13,color:T.ink,outline:"none"}}/>
            </div>
            <div style={{display:"flex",gap:8,marginBottom:8}}>
              <select value={newAct.type} onChange={e=>setNewAct(a=>({...a,type:e.target.value}))}
                style={{flex:1,padding:"8px 10px",borderRadius:10,border:`1.5px solid ${T.sand}`,fontFamily:"Georgia,serif",fontSize:13,color:T.ink,outline:"none",background:T.chalk}}>
                {Object.entries(typeStyle).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
              </select>
              <input value={newAct.duration} onChange={e=>setNewAct(a=>({...a,duration:e.target.value}))}
                placeholder="Duration (e.g. 2h)"
                style={{width:120,padding:"8px 10px",borderRadius:10,border:`1.5px solid ${T.sand}`,fontFamily:"Georgia,serif",fontSize:13,color:T.ink,outline:"none"}}/>
            </div>
            <input value={newAct.note} onChange={e=>setNewAct(a=>({...a,note:e.target.value}))}
              placeholder="Note (optional)"
              style={{width:"100%",padding:"8px 10px",borderRadius:10,border:`1.5px solid ${T.sand}`,fontFamily:"Georgia,serif",fontSize:13,color:T.ink,outline:"none",marginBottom:10}}/>
            <div style={{display:"flex",gap:8}}>
              <button onClick={submitNew} style={{flex:1,background:T.ocean,color:"white",border:"none",borderRadius:10,padding:"9px 0",fontFamily:"Georgia,serif",fontSize:13,cursor:"pointer"}}>Add</button>
              <button onClick={()=>setAdding(false)} style={{flex:1,background:T.sand,color:T.ink,border:"none",borderRadius:10,padding:"9px 0",fontFamily:"Georgia,serif",fontSize:13,cursor:"pointer"}}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── SETUP FORM ─────────────────────────────────────────────────────── */
const PLACE_TYPE_EMOJI = { city:"🏙️", town:"🏙️", village:"🏘️", island:"🏝️", country:"🌍", state:"📍", region:"📍", district:"📍" };

function SetupForm({ onGenerate }) {
  const [step, setStep]           = useState(0);
  const [generating, setGen]      = useState(false);
  const [form, setForm]           = useState({ destinations:[], startDate:"", endDate:"", travelers:"2", styles:[], budget:"mid", pace:"active", morningStart:"early", arrivalCity:"", arrivalTime:"", departureCity:"", departureTime:"", hotelName:"", hotelArea:"" });
  const [destInput, setDestInput] = useState("");
  const [destError, setDestError] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [showSugg, setShowSugg]   = useState(false);
  const inputRef  = useRef(null);
  const destTimer = useRef(null);
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const [hotelInput,     setHotelInput]     = useState("");
  const [hotelSuggs,     setHotelSuggs]     = useState([]);
  const [hotelSearching, setHotelSearching] = useState(false);
  const [showHotelSuggs, setShowHotelSuggs] = useState(false);
  const hotelTimer = useRef(null);

  const handleHotelChange = (val) => {
    setHotelInput(val);
    set("hotelName", val);
    set("hotelArea", "");
    if (val.trim().length < 2) { setHotelSuggs([]); setShowHotelSuggs(false); return; }
    clearTimeout(hotelTimer.current);
    hotelTimer.current = setTimeout(async () => {
      setHotelSearching(true);
      try {
        const res = await fetch(`${PLACES_PROXY}?action=autocomplete`, {
          method: "POST",
          headers: PLACES_HEADERS,
          body: JSON.stringify({ q: val }),
        });
        const data = await res.json();
        const features = data.suggestions || [];
        setHotelSuggs(features);
        setShowHotelSuggs(features.length > 0);
      } catch (e) { console.error("Hotel autocomplete error:", e); setHotelSuggs([]); }
      finally { setHotelSearching(false); }
    }, 300);
  };

  const pickHotel = (sugg) => {
    const pred = sugg.placePrediction;
    const name = pred?.structuredFormat?.mainText?.text || pred?.text?.text || "";
    const area = pred?.structuredFormat?.secondaryText?.text || "";
    setHotelInput(name);
    setForm(f => ({ ...f, hotelName: name, hotelArea: area }));
    setHotelSuggs([]);
    setShowHotelSuggs(false);
  };

  const handleDestChange = (val) => {
    setDestInput(val);
    setDestError("");
    if (val.trim().length < 2) { setSuggestions([]); setShowSugg(false); return; }
    clearTimeout(destTimer.current);
    destTimer.current = setTimeout(async () => {
      try {
        const res  = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(val)}&limit=20`);
        const data = await res.json();
        const features = (data.features || [])
          .filter(f => f.properties.name && ["place","boundary","natural"].includes(f.properties.osm_key))
          .slice(0, 10);
        setSuggestions(features);
        setShowSugg(features.length > 0);
      } catch { setSuggestions([]); }
    }, 300);
  };

  const addDestination = (name, currentDests) => {
    if (!name?.trim()) return false;
    const dests = currentDests || form.destinations;
    if (!dests.includes(name)) set("destinations", [...dests, name]);
    setDestInput("");
    setSuggestions([]);
    setShowSugg(false);
    return name;
  };

  const removeDestination = (idx) => set("destinations", form.destinations.filter((_, i) => i !== idx));

  const pickSuggestion = (feature) => {
    const p    = feature.properties;
    const country = p.country || "";
    const name = (country && p.type !== "country") ? `${p.name}, ${country}` : p.name;
    addDestination(name);
    inputRef.current?.focus();
  };

  const makeAirportSearch = (formKey) => {
    const inputKey  = formKey === "arrivalCity" ? "arrivalAptInput"  : "departureAptInput";
    const suggsKey  = formKey === "arrivalCity" ? "arrivalAptSuggs"  : "departureAptSuggs";
    const showKey   = formKey === "arrivalCity" ? "showArrivalSuggs" : "showDepartureSuggs";
    return { inputKey, suggsKey, showKey };
  };

  const [arrivalAptInput,   setArrivalAptInput]   = useState("");
  const [arrivalAptSuggs,   setArrivalAptSuggs]   = useState([]);
  const [showArrivalSuggs,  setShowArrivalSuggs]  = useState(false);
  const [departureAptInput, setDepartureAptInput] = useState("");
  const [departureAptSuggs, setDepartureAptSuggs] = useState([]);
  const [showDepartureSuggs,setShowDepartureSuggs]= useState(false);
  const aptTimer = useRef(null);

  const handleAirportChange = (val, formKey) => {
    if (formKey === "arrivalCity")   { setArrivalAptInput(val);   setShowArrivalSuggs(false); }
    else                             { setDepartureAptInput(val); setShowDepartureSuggs(false); }
    set(formKey, val);
    if (val.trim().length < 2) return;
    clearTimeout(aptTimer.current);
    aptTimer.current = setTimeout(async () => {
      try {
        const res  = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(val + " airport")}&limit=15&osm_tag=aeroway:aerodrome`);
        const data = await res.json();
        const features = (data.features || []).filter(f => f.properties.name);
        if (formKey === "arrivalCity")   { setArrivalAptSuggs(features);   setShowArrivalSuggs(features.length > 0); }
        else                             { setDepartureAptSuggs(features);  setShowDepartureSuggs(features.length > 0); }
      } catch { /* silent */ }
    }, 300);
  };

  const pickAirport = (feature, formKey) => {
    const p    = feature.properties;
    const city = p.city || p.county || p.state || "";
    const label = city || p.name;
    if (formKey === "arrivalCity")   { setArrivalAptInput(p.name);   setShowArrivalSuggs(false); }
    else                             { setDepartureAptInput(p.name); setShowDepartureSuggs(false); }
    set(formKey, label);
  };

  const AirportDropdown = ({ suggs, onPick }) => (
    <div style={{position:"absolute",top:"calc(100% + 6px)",left:0,right:0,background:T.chalk,
      border:`1.5px solid ${T.sand}`,borderRadius:12,overflow:"hidden",zIndex:100,
      boxShadow:"0 4px 18px rgba(0,0,0,0.12)",maxHeight:240,overflowY:"auto"}}>
      {suggs.map((f,i) => {
        const p    = f.properties;
        const city = p.city || p.county || p.state || "";
        const country = p.country || "";
        const sub  = [city, country].filter(Boolean).join(", ");
        return (
          <div key={i} onMouseDown={()=>onPick(f)}
            style={{padding:"10px 14px",cursor:"pointer",borderBottom:`1px solid ${T.sand}`}}
            onMouseEnter={e=>e.currentTarget.style.background=T.sand}
            onMouseLeave={e=>e.currentTarget.style.background=T.chalk}>
            <div style={{fontFamily:"Georgia,serif",fontSize:13,color:T.ink,fontWeight:600}}>✈️ {p.name}</div>
            {sub && <div style={{fontFamily:"Georgia,serif",fontSize:11,color:T.mist,marginTop:2}}>{sub}</div>}
          </div>
        );
      })}
    </div>
  );

  const styles  = ["Cultural & Heritage","Adventure & Outdoors","Food & Culinary","Relaxation & Wellness","City Break","Road Trip","Beach & Coast","I'll wing it 🎲"];
  const budgets = [{key:"budget",label:"Budget 🏕️",sub:"Hostels, street food"},{key:"mid",label:"Mid-range 🏨",sub:"3★ hotels, restaurants"},{key:"luxury",label:"Luxury 🏰",sub:"5★ & fine dining"}];

  const handleGenerate = async () => {
    setGen(true);
    await new Promise(r=>setTimeout(r,1600));
    onGenerate(form);
  };

  const stepViews = [
    /* 0 – destination */
    <div key={0} style={{animation:"fadeUp 0.3s ease"}}>
      <div style={{textAlign:"center",fontSize:40,marginBottom:8}}>🌍</div>
      <div style={{fontFamily:"'DM Serif Display',serif",fontSize:24,color:T.ink,textAlign:"center",marginBottom:4}}>Where to?</div>
      <div style={{fontSize:13,color:T.mist,textAlign:"center",marginBottom:22,fontFamily:"Georgia,serif"}}>Add one or more destinations</div>

      {/* Added destination chips */}
      {form.destinations.length > 0 && (
        <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:12}}>
          {form.destinations.map((d, i) => (
            <div key={d} style={{display:"flex",alignItems:"center",gap:6,background:T.ocean,color:"white",borderRadius:20,padding:"6px 12px",fontSize:13,fontFamily:"Georgia,serif"}}>
              {i > 0 && <span style={{opacity:0.6,marginRight:2}}>→</span>}
              {d}
              <button onClick={()=>removeDestination(i)} style={{background:"none",border:"none",color:"white",cursor:"pointer",fontSize:14,lineHeight:1,padding:0,opacity:0.7}}>×</button>
            </div>
          ))}
        </div>
      )}

      <div style={{position:"relative"}}>
        <input ref={inputRef} value={destInput} onChange={e=>handleDestChange(e.target.value)}
          onBlur={()=>setTimeout(()=>setShowSugg(false),150)}
          onFocus={()=>destInput && suggestions.length && setShowSugg(true)}
          onKeyDown={e=>{ if(e.key==="Enter" && destInput.trim()) addDestination(destInput.trim()); }}
          placeholder={form.destinations.length === 0 ? "e.g. Bangkok, Kyoto, Rajasthan…" : "Add another destination…"}
          style={{width:"100%",padding:"14px 16px",borderRadius:14,border:`2px solid ${destError?"#e53e3e":destInput?T.ocean:T.sand}`,
            fontFamily:"Georgia,serif",fontSize:15,color:T.ink,background:T.chalk,outline:"none",transition:"border 0.2s"}}/>
        {showSugg && suggestions.length > 0 && (
          <div style={{position:"absolute",top:"calc(100% + 6px)",left:0,right:0,background:T.chalk,border:`1.5px solid ${T.sand}`,borderRadius:12,overflow:"hidden",zIndex:100,boxShadow:"0 4px 18px rgba(0,0,0,0.10)",maxHeight:300,overflowY:"auto"}}>
            {suggestions.map((f,i) => {
              const p       = f.properties;
              const emoji   = PLACE_TYPE_EMOJI[p.type] || "🌍";
              const country = p.country || "";
              const state   = p.state && p.state !== p.name ? p.state : "";
              const sub     = [state, country].filter(Boolean).join(", ");
              return (
                <div key={i} onMouseDown={()=>pickSuggestion(f)}
                  style={{padding:"10px 16px",cursor:"pointer",borderBottom:`1px solid ${T.sand}`}}
                  onMouseEnter={e=>e.currentTarget.style.background=T.sand}
                  onMouseLeave={e=>e.currentTarget.style.background=T.chalk}>
                  <div style={{fontFamily:"Georgia,serif",fontSize:14,color:T.ink,fontWeight:600}}>{emoji} {p.name}</div>
                  {sub && <div style={{fontFamily:"Georgia,serif",fontSize:11,color:T.mist,marginTop:2}}>{sub}</div>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{display:"flex",flexWrap:"wrap",gap:8,marginTop:14}}>
        {["Rajasthan 🏯","Kyoto 🌸","Amalfi 🌊","Patagonia 🏔️","Morocco 🕌","Koh Samui 🏝️","Bali 🌴","Santorini ☀️"].map(d=>{
          const name = d.split(" ")[0];
          const sel  = form.destinations.includes(name);
          return (
            <button key={d} onClick={()=>addDestination(name)} style={{
              background:sel?T.ocean:T.sand, color:sel?"white":T.ink,
              border:"none",borderRadius:20,padding:"6px 14px",
              fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif",
            }}>{d}</button>
          );
        })}
      </div>
    </div>,

    /* 1 – dates & travelers */
    <div key={1} style={{animation:"fadeUp 0.3s ease"}}>
      <div style={{textAlign:"center",fontSize:36,marginBottom:8}}>📅</div>
      <div style={{fontFamily:"'DM Serif Display',serif",fontSize:24,color:T.ink,textAlign:"center",marginBottom:20}}>Trip details</div>
      <div style={{display:"flex",gap:12,marginBottom:22}}>
        <div style={{flex:1}}>
          <div style={{fontFamily:"Georgia,serif",fontSize:13,color:T.mist,marginBottom:6}}>Start date</div>
          <input type="date" value={form.startDate} onChange={e=>set("startDate",e.target.value)}
            style={{width:"100%",padding:"12px 14px",borderRadius:12,border:`2px solid ${form.startDate?T.ocean:T.sand}`,
              fontFamily:"Georgia,serif",fontSize:14,color:T.ink,background:T.chalk,outline:"none",boxSizing:"border-box"}}/>
        </div>
        <div style={{flex:1}}>
          <div style={{fontFamily:"Georgia,serif",fontSize:13,color:T.mist,marginBottom:6}}>End date</div>
          <input type="date" value={form.endDate} min={form.startDate} onChange={e=>set("endDate",e.target.value)}
            style={{width:"100%",padding:"12px 14px",borderRadius:12,border:`2px solid ${form.endDate?T.ocean:T.sand}`,
              fontFamily:"Georgia,serif",fontSize:14,color:T.ink,background:T.chalk,outline:"none",boxSizing:"border-box"}}/>
        </div>
      </div>
      {form.startDate && form.endDate && (
        <div style={{fontFamily:"Georgia,serif",fontSize:13,color:T.mist,marginBottom:18,textAlign:"center"}}>
          {Math.round((new Date(form.endDate)-new Date(form.startDate))/(1000*60*60*24))+1} days
        </div>
      )}
      <div style={{fontFamily:"Georgia,serif",fontSize:13,color:T.mist,marginBottom:10}}>Travelers</div>
      <div style={{display:"flex",alignItems:"center",gap:18}}>
        <button onClick={()=>set("travelers",String(Math.max(1,+form.travelers-1)))} style={{width:42,height:42,borderRadius:"50%",border:`2px solid ${T.sand}`,background:T.chalk,fontSize:22,cursor:"pointer"}}>−</button>
        <span style={{fontFamily:"'DM Serif Display',serif",fontSize:32,color:T.ink,minWidth:44,textAlign:"center"}}>{form.travelers}</span>
        <button onClick={()=>set("travelers",String(Math.min(12,+form.travelers+1)))} style={{width:42,height:42,borderRadius:"50%",border:"none",background:T.ocean,color:"white",fontSize:22,cursor:"pointer"}}>+</button>
        <span style={{fontFamily:"Georgia,serif",fontSize:14,color:T.mist}}>{+form.travelers===1?"solo":"travelers"}</span>
      </div>
    </div>,

    /* 2 – style */
    <div key={2} style={{animation:"fadeUp 0.3s ease"}}>
      <div style={{textAlign:"center",fontSize:36,marginBottom:8}}>🎒</div>
      <div style={{fontFamily:"'DM Serif Display',serif",fontSize:24,color:T.ink,textAlign:"center",marginBottom:4}}>Trip style</div>
      <div style={{fontSize:13,color:T.mist,textAlign:"center",marginBottom:18,fontFamily:"Georgia,serif"}}>Pick all that apply</div>
      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:24}}>
        {styles.map(s=>{
          const sel = form.styles.includes(s);
          return (
            <button key={s} onClick={()=>set("styles", sel ? form.styles.filter(x=>x!==s) : [...form.styles, s])} style={{
              padding:"12px 16px",borderRadius:12,cursor:"pointer",textAlign:"left",
              border:`2px solid ${sel?T.ocean:T.sand}`,
              background:sel?"#EBF3FD":T.chalk,
              color:sel?T.ocean:T.ink,
              fontFamily:"Georgia,serif",fontSize:14,transition:"all 0.2s",
              fontWeight:sel?700:400,
              display:"flex",alignItems:"center",justifyContent:"space-between",
            }}>
              {s}
              {sel && <span style={{fontSize:14,color:T.ocean}}>✓</span>}
            </button>
          );
        })}
      </div>

      <div style={{fontFamily:"'DM Serif Display',serif",fontSize:16,color:T.ink,marginBottom:10,marginTop:24}}>When do you like to head out?</div>
      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:24}}>
        {[
          {key:"early", icon:"🌅", label:"Early bird", sub:"Out by 8–9am, beat the crowds and enjoy the cool morning"},
          {key:"late",  icon:"☕", label:"Slow starter", sub:"Leisurely breakfast, out by 11am — unless something unmissable needs an early start"},
        ].map(({key,icon,label,sub})=>{
          const sel = form.morningStart === key;
          return (
            <button key={key} onClick={()=>set("morningStart",key)} style={{
              padding:"12px 16px",borderRadius:12,cursor:"pointer",textAlign:"left",
              border:`2px solid ${sel?T.ocean:T.sand}`,
              background:sel?"#EBF3FD":T.chalk,
              transition:"all 0.2s",
            }}>
              <div style={{fontFamily:"Georgia,serif",fontSize:14,color:sel?T.ocean:T.ink,fontWeight:sel?700:400,marginBottom:2}}>{icon} {label}</div>
              <div style={{fontFamily:"Georgia,serif",fontSize:12,color:T.mist}}>{sub}</div>
            </button>
          );
        })}
      </div>

      <div style={{fontFamily:"'DM Serif Display',serif",fontSize:16,color:T.ink,marginBottom:10}}>How active should the trip be?</div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {[
          {key:"relaxed", icon:"🌿", label:"Relaxed", sub:"Enough downtime to chill and breathe"},
          {key:"active",  icon:"⚡", label:"Active",  sub:"Up for multiple activities and covering the destination well"},
        ].map(({key,icon,label,sub})=>{
          const sel = form.pace === key;
          return (
            <button key={key} onClick={()=>set("pace",key)} style={{
              padding:"12px 16px",borderRadius:12,cursor:"pointer",textAlign:"left",
              border:`2px solid ${sel?T.ocean:T.sand}`,
              background:sel?"#EBF3FD":T.chalk,
              transition:"all 0.2s",
            }}>
              <div style={{fontFamily:"Georgia,serif",fontSize:14,color:sel?T.ocean:T.ink,fontWeight:sel?700:400,marginBottom:2}}>{icon} {label}</div>
              <div style={{fontFamily:"Georgia,serif",fontSize:12,color:T.mist}}>{sub}</div>
            </button>
          );
        })}
      </div>
    </div>,

    /* 3 – budget + generate */
    <div key={3} style={{animation:"fadeUp 0.3s ease"}}>
      <div style={{textAlign:"center",fontSize:36,marginBottom:8}}>💰</div>
      <div style={{fontFamily:"'DM Serif Display',serif",fontSize:24,color:T.ink,textAlign:"center",marginBottom:4}}>Budget range</div>
      <div style={{fontSize:13,color:T.mist,textAlign:"center",marginBottom:18,fontFamily:"Georgia,serif"}}>Helps tailor accommodation & dining</div>
      <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:22}}>
        {budgets.map(b=>(
          <button key={b.key} onClick={()=>set("budget",b.key)} style={{
            padding:"14px 18px",borderRadius:14,cursor:"pointer",textAlign:"left",
            border:`2px solid ${form.budget===b.key?T.terra:T.sand}`,
            background:form.budget===b.key?"#FFF4EE":T.chalk,
            transition:"all 0.2s",
          }}>
            <div style={{fontFamily:"'DM Serif Display',serif",fontSize:16,color:T.ink}}>{b.label}</div>
            <div style={{fontFamily:"Georgia,serif",fontSize:12,color:T.mist,marginTop:2}}>{b.sub}</div>
          </button>
        ))}
      </div>
      {/* Summary card */}
      <div style={{background:T.sand,borderRadius:14,padding:16,marginBottom:20}}>
        <div style={{fontFamily:"'DM Serif Display',serif",fontSize:15,color:T.ink,marginBottom:10}}>✈️ Your trip</div>
        {[["Destinations",form.destinations.length>0?form.destinations.join(" → "):"—"],["Dates",form.startDate&&form.endDate?`${form.startDate} → ${form.endDate}`:"—"],["Travelers",form.travelers],["Style",form.styles.length>0?form.styles.join(", "):"—"],["Budget",budgets.find(b=>b.key===form.budget)?.label]].map(([k,v])=>(
          <div key={k} style={{display:"flex",justifyContent:"space-between",fontSize:13,fontFamily:"Georgia,serif",marginBottom:4}}>
            <span style={{color:T.mist}}>{k}</span>
            <span style={{color:T.ink,fontWeight:700}}>{v}</span>
          </div>
        ))}
      </div>
    </div>,

    /* 4 – flights & hotel (optional) */
    <div key={4} style={{animation:"fadeUp 0.3s ease"}}>
      <div style={{textAlign:"center",fontSize:36,marginBottom:8}}>✈️</div>
      <div style={{fontFamily:"'DM Serif Display',serif",fontSize:24,color:T.ink,textAlign:"center",marginBottom:4}}>Flights & Hotel</div>
      <div style={{fontSize:13,color:T.mist,textAlign:"center",marginBottom:22,fontFamily:"Georgia,serif"}}>Help us tailor Day 1 around your arrival — or skip to generate now</div>

      {/* Arrival flight */}
      <div style={{background:T.chalk,borderRadius:14,padding:16,border:`1.5px solid ${T.sand}`,marginBottom:12}}>
        <div style={{fontFamily:"'DM Serif Display',serif",fontSize:14,color:T.ink,marginBottom:12}}>✈️ Arrival flight</div>
        <div style={{position:"relative",marginBottom:10}}>
          <div style={{fontSize:12,color:T.mist,fontFamily:"Georgia,serif",marginBottom:5}}>Arriving at</div>
          <input value={arrivalAptInput}
            onChange={e=>handleAirportChange(e.target.value,"arrivalCity")}
            onBlur={()=>setTimeout(()=>setShowArrivalSuggs(false),150)}
            onFocus={()=>arrivalAptSuggs.length>0&&setShowArrivalSuggs(true)}
            placeholder="e.g. Hanoi, Ho Chi Minh City…"
            style={{width:"100%",padding:"10px 12px",borderRadius:10,border:`1.5px solid ${form.arrivalCity?T.ocean:T.sand}`,fontFamily:"Georgia,serif",fontSize:14,color:T.ink,outline:"none",boxSizing:"border-box"}}/>
          {showArrivalSuggs && <AirportDropdown suggs={arrivalAptSuggs} onPick={f=>pickAirport(f,"arrivalCity")}/>}
        </div>
        <div style={{display:"flex",gap:10,alignItems:"flex-end"}}>
          <div style={{flex:1}}>
            <div style={{fontSize:12,color:T.mist,fontFamily:"Georgia,serif",marginBottom:5}}>Date</div>
            <div style={{padding:"10px 12px",borderRadius:10,border:`1.5px solid ${T.sand}`,fontFamily:"Georgia,serif",fontSize:14,color:T.mist,background:"#f7f7f7"}}>
              {form.startDate ? new Date(form.startDate + "T12:00:00").toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short",year:"numeric"}) : "—"}
            </div>
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:12,color:T.mist,fontFamily:"Georgia,serif",marginBottom:5}}>Landing time</div>
            <input type="time" value={form.arrivalTime} onChange={e=>set("arrivalTime",e.target.value)}
              style={{width:"100%",padding:"10px 12px",borderRadius:10,border:`1.5px solid ${form.arrivalTime?T.ocean:T.sand}`,fontFamily:"Georgia,serif",fontSize:14,color:T.ink,outline:"none",boxSizing:"border-box"}}/>
          </div>
        </div>
      </div>

      {/* Return flight */}
      <div style={{background:T.chalk,borderRadius:14,padding:16,border:`1.5px solid ${T.sand}`,marginBottom:12}}>
        <div style={{fontFamily:"'DM Serif Display',serif",fontSize:14,color:T.ink,marginBottom:12}}>✈️ Return flight</div>
        <div style={{position:"relative",marginBottom:10}}>
          <div style={{fontSize:12,color:T.mist,fontFamily:"Georgia,serif",marginBottom:5}}>Departing from</div>
          <input value={departureAptInput}
            onChange={e=>handleAirportChange(e.target.value,"departureCity")}
            onBlur={()=>setTimeout(()=>setShowDepartureSuggs(false),150)}
            onFocus={()=>departureAptSuggs.length>0&&setShowDepartureSuggs(true)}
            placeholder="e.g. Ho Chi Minh City, Hanoi…"
            style={{width:"100%",padding:"10px 12px",borderRadius:10,border:`1.5px solid ${form.departureCity?T.ocean:T.sand}`,fontFamily:"Georgia,serif",fontSize:14,color:T.ink,outline:"none",boxSizing:"border-box"}}/>
          {showDepartureSuggs && <AirportDropdown suggs={departureAptSuggs} onPick={f=>pickAirport(f,"departureCity")}/>}
        </div>
        <div style={{display:"flex",gap:10,alignItems:"flex-end"}}>
          <div style={{flex:1}}>
            <div style={{fontSize:12,color:T.mist,fontFamily:"Georgia,serif",marginBottom:5}}>Date</div>
            <div style={{padding:"10px 12px",borderRadius:10,border:`1.5px solid ${T.sand}`,fontFamily:"Georgia,serif",fontSize:14,color:T.mist,background:"#f7f7f7"}}>
              {form.endDate ? new Date(form.endDate + "T12:00:00").toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short",year:"numeric"}) : "—"}
            </div>
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:12,color:T.mist,fontFamily:"Georgia,serif",marginBottom:5}}>Departure time</div>
            <input type="time" value={form.departureTime} onChange={e=>set("departureTime",e.target.value)}
              style={{width:"100%",padding:"10px 12px",borderRadius:10,border:`1.5px solid ${form.departureTime?T.ocean:T.sand}`,fontFamily:"Georgia,serif",fontSize:14,color:T.ink,outline:"none",boxSizing:"border-box"}}/>
          </div>
        </div>
      </div>

      {/* Hotel */}
      <div style={{background:T.chalk,borderRadius:14,padding:16,border:`1.5px solid ${T.sand}`,marginBottom:12}}>
        <div style={{fontFamily:"'DM Serif Display',serif",fontSize:14,color:T.ink,marginBottom:12}}>🏨 Hotel</div>
        <div style={{fontSize:12,color:T.mist,fontFamily:"Georgia,serif",marginBottom:5}}>Hotel name</div>
        <div style={{position:"relative"}}>
          <input value={hotelInput} onChange={e=>handleHotelChange(e.target.value)}
            onBlur={()=>setTimeout(()=>setShowHotelSuggs(false),150)}
            onFocus={()=>hotelSuggs.length>0&&setShowHotelSuggs(true)}
            placeholder="e.g. Taj Mahal Palace"
            style={{width:"100%",padding:"10px 12px",borderRadius:10,border:`1.5px solid ${form.hotelName?T.ocean:T.sand}`,fontFamily:"Georgia,serif",fontSize:14,color:T.ink,outline:"none",boxSizing:"border-box"}}/>
          {hotelSearching && (
            <div style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",fontSize:11,color:T.mist,fontFamily:"Georgia,serif"}}>searching…</div>
          )}
          {showHotelSuggs && hotelSuggs.length > 0 && (
            <div style={{position:"absolute",top:"calc(100% + 6px)",left:0,right:0,background:T.chalk,border:`1.5px solid ${T.sand}`,borderRadius:12,overflow:"hidden",zIndex:100,boxShadow:"0 4px 18px rgba(0,0,0,0.12)",maxHeight:260,overflowY:"auto"}}>
              {hotelSuggs.map((sugg,i) => {
                const pred = sugg.placePrediction;
                const name = pred?.structuredFormat?.mainText?.text || pred?.text?.text || "";
                const sub  = pred?.structuredFormat?.secondaryText?.text || "";
                return (
                  <div key={i} onMouseDown={()=>pickHotel(sugg)}
                    style={{padding:"10px 14px",cursor:"pointer",borderBottom:`1px solid ${T.sand}`}}
                    onMouseEnter={e=>e.currentTarget.style.background=T.sand}
                    onMouseLeave={e=>e.currentTarget.style.background=T.chalk}>
                    <div style={{fontFamily:"Georgia,serif",fontSize:13,color:T.ink,fontWeight:600}}>🏨 {name}</div>
                    {sub && <div style={{fontFamily:"Georgia,serif",fontSize:11,color:T.mist,marginTop:2}}>{sub}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {form.hotelArea && (
          <div style={{fontSize:11,color:T.moss,fontFamily:"Georgia,serif",marginTop:6}}>📍 {form.hotelArea}</div>
        )}
      </div>

      <div style={{fontSize:12,color:T.mist,fontFamily:"Georgia,serif",fontStyle:"italic",textAlign:"center",marginBottom:22}}>✈️ We will tailor the itinerary as per your flight times and hotel area</div>

      <button onClick={handleGenerate} disabled={generating} style={{
        width:"100%",padding:16,borderRadius:16,border:"none",
        cursor:generating?"default":"pointer",
        background:generating?T.sand:`linear-gradient(135deg,${T.ocean},${T.dusk})`,
        color:generating?T.mist:"white",
        fontFamily:"'DM Serif Display',serif",fontSize:18,
        boxShadow:generating?"none":"0 6px 22px rgba(37,99,168,0.4)",
        transition:"all 0.3s",marginBottom:12,
      }}>{generating?"✨ Generating your itinerary…":"Generate Itinerary ✨"}</button>
      <button onClick={handleGenerate} disabled={generating} style={{
        width:"100%",padding:"10px 0",background:"none",border:"none",
        color:T.mist,fontFamily:"Georgia,serif",fontSize:13,cursor:"pointer",
      }}>Skip & generate without flight details</button>
    </div>,
  ];

  return (
    <div style={{padding:"0 20px",paddingBottom:80}}>
      {/* Progress dots */}
      <div style={{display:"flex",justifyContent:"center",gap:8,marginBottom:28}}>
        {stepViews.map((_,i)=>(
          <div key={i} style={{width:i===step?26:8,height:8,borderRadius:4,background:i<=step?T.ocean:T.sand,transition:"all 0.3s"}}/>
        ))}
      </div>
      {stepViews[step]}
      <div style={{display:"flex",gap:10,marginTop:24}}>
        {step>0 && <button onClick={()=>setStep(s=>s-1)} style={{flex:1,padding:14,borderRadius:14,border:`2px solid ${T.sand}`,background:"transparent",color:T.mist,fontFamily:"Georgia,serif",fontSize:15,cursor:"pointer"}}>← Back</button>}
        {step<stepViews.length-1 && (
          <button onClick={()=>{
            if (step === 0) {
              if (destInput.trim()) {
                const added = addDestination(destInput);
                if (!added) { setDestError("We don't recognise this destination — try picking from the suggestions."); return; }
              }
              if (form.destinations.length === 0 && !destInput.trim()) {
                setDestError("Please add at least one destination.");
                return;
              }
            }
            setStep(s=>s+1);
          }} style={{
            flex:2,padding:14,borderRadius:14,border:"none",cursor:"pointer",
            background:T.ocean,color:"white",
            fontFamily:"'DM Serif Display',serif",fontSize:16,
            opacity:1,
            boxShadow:"0 4px 14px rgba(37,99,168,0.3)",
          }}>Continue →</button>
        )}
      </div>
    </div>
  );
}


/* ─── SETUP STRIP ───────────────────────────────────────────────────── */
function SetupStrip({ done, onOpen, onDismiss }) {
  const items = [
    { key:"flights", icon:"✈️", title:"Add flights", desc:"Optimise rest & airport time" },
    { key:"hotel",   icon:"🏨", title:"Add hotel",   desc:"Plan around your stay" },
  ].filter(item => !done[item.key]);

  if (items.length === 0) return null;

  return (
    <div style={{flexShrink:0, background:"#FFFBF5", borderBottom:`1px solid ${T.sand}`, padding:"10px 16px"}}>
      <div style={{fontSize:10,letterSpacing:2,color:T.mist,fontFamily:"Georgia,serif",marginBottom:8,textTransform:"uppercase"}}>Finish setting up</div>
      <div className="no-scrollbar" style={{display:"flex",gap:10,overflowX:"auto"}}>
        {items.map(item=>(
          <div key={item.key} style={{
            flexShrink:0, background:T.chalk, borderRadius:12,
            border:`1.5px solid ${T.sand}`, padding:"10px 12px",
            display:"flex", alignItems:"center", gap:10, minWidth:190,
          }}>
            <span style={{fontSize:22}}>{item.icon}</span>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:700,color:T.ink,fontFamily:"Georgia,serif"}}>{item.title}</div>
              <div style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif"}}>{item.desc}</div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:4,alignItems:"flex-end"}}>
              <button onClick={()=>onOpen(item.key)} style={{
                background:T.ocean,color:"white",border:"none",borderRadius:8,
                padding:"5px 12px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600,
              }}>Add</button>
              <button onClick={()=>onDismiss(item.key)} style={{
                background:"none",color:T.mist,border:"none",fontSize:11,
                cursor:"pointer",fontFamily:"Georgia,serif",padding:0,
              }}>dismiss</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── COLLAB TAB ─────────────────────────────────────────────────────── */
function CollabTab({ trip, session, inviteRole, setInviteRole, inviteLink, setInviteLink, linkCopied, setLinkCopied }) {
  const members = trip.trip_members || [];

  const generateInviteLink = async () => {
    const { data } = await supabase.from("invite_links").insert({
      trip_id: trip.id,
      created_by: session.user.id,
      role: inviteRole,
    }).select().single();
    if (data) setInviteLink(`${window.location.origin}/join/${data.token}`);
  };

  const copyInviteLink = () => {
    navigator.clipboard.writeText(inviteLink);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  return (
    <div style={{padding:"20px 20px 120px"}}>
      <div style={{fontFamily:"'DM Serif Display',serif",fontSize:22,color:T.ink,marginBottom:16}}>👥 Collaborators</div>

      {members.map((m) => {
        const icon = FACE_ICONS[(m.profiles?.face_icon || 1) - 1];
        const isYou = m.user_id === session.user.id;
        return (
          <div key={m.user_id} style={{background:T.chalk,borderRadius:14,padding:"12px 16px",marginBottom:8,display:"flex",alignItems:"center",gap:12,boxShadow:"0 1px 6px rgba(0,0,0,0.04)"}}>
            <span style={{fontSize:26}}>{icon}</span>
            <div style={{flex:1}}>
              <div style={{fontSize:14,fontWeight:600,color:T.ink}}>{m.profiles?.username || "Unknown"}{isYou ? " (you)" : ""}</div>
              <div style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif",textTransform:"capitalize"}}>{m.role === "edit" ? "Editor" : m.role}</div>
            </div>
          </div>
        );
      })}

      <div style={{background:"#F7F8FA",borderRadius:14,padding:16,marginTop:16,border:`1px solid #E8EAF0`}}>
        <div style={{fontSize:14,fontWeight:600,color:T.ink,marginBottom:4}}>Invite someone</div>
        <div style={{fontSize:12,color:T.mist,fontFamily:"Georgia,serif",marginBottom:14}}>Share a link — they can join this trip</div>
        <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:14}}>
          {[["edit","✏️ Editor","Can add & change anything"],["comment","💬 Comment only","Can view & comment"],["read","👁 Read only","View the itinerary"]].map(([val,label,sub])=>(
            <button key={val} onClick={()=>setInviteRole(val)} style={{
              padding:"10px 14px",borderRadius:10,cursor:"pointer",textAlign:"left",
              border:`2px solid ${inviteRole===val?T.ocean:"#E8EAF0"}`,
              background:inviteRole===val?"#EBF3FD":"white",
            }}>
              <div style={{fontSize:13,fontWeight:600,color:inviteRole===val?T.ocean:T.ink}}>{label}</div>
              <div style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif"}}>{sub}</div>
            </button>
          ))}
        </div>
        {!inviteLink
          ? <button onClick={generateInviteLink} style={{width:"100%",padding:13,borderRadius:12,border:"none",
              background:`linear-gradient(135deg,${T.ocean},${T.dusk})`,color:"white",
              fontFamily:"'DM Serif Display',serif",fontSize:15,cursor:"pointer"}}>Generate invite link</button>
          : <div>
              <div style={{background:"white",border:`1px solid #E8EAF0`,borderRadius:10,padding:"10px 12px",fontFamily:"Georgia,serif",fontSize:12,
                color:T.ink,wordBreak:"break-all",marginBottom:8}}>{inviteLink}</div>
              <button onClick={copyInviteLink} style={{width:"100%",padding:13,borderRadius:12,border:"none",
                background:linkCopied?T.moss:`linear-gradient(135deg,${T.ocean},${T.dusk})`,color:"white",
                fontFamily:"'DM Serif Display',serif",fontSize:15,cursor:"pointer",transition:"background 0.3s"}}>
                {linkCopied ? "✓ Copied!" : "Copy link"}
              </button>
            </div>
        }
      </div>
    </div>
  );
}

/* ─── ROOT ───────────────────────────────────────────────────────────── */
export default function App({ session, initialTrip, initialScreen = "setup", onHome }) {
  const [screen,    setScreen]    = useState(initialScreen);
  const [trip,      setTrip]      = useState(initialTrip || SAMPLE_TRIP);
  const [days,      setDays]      = useState([]);
  const [loading,   setLoading]   = useState(initialScreen === "itinerary");
  const [tab,         setTab]         = useState("plan");
  const [collabToast, setCollabToast] = useState(false);
  const [activeDay, setActiveDay] = useState(0);

  const [generateError, setGenerateError] = useState("");

  useEffect(() => {
    if (initialScreen === "itinerary" && initialTrip?.id) {
      supabase
        .from("days")
        .select("*, activities(*)")
        .eq("trip_id", initialTrip.id)
        .order("position")
        .then(({ data }) => {
          setDays((data || []).map(d => ({
            ...d,
            activities: (d.activities || []).sort((a, b) => a.position - b.position),
          })));
          setLoading(false);
        });
    }
  }, []);
  const [setupDone,   setSetupDone]   = useState({
    flights: !!(initialTrip?.arrival_time || initialTrip?.departure_time || initialTrip?.origin_city),
    hotel:   !!(initialTrip?.hotel_name),
  });
  const [showChat,    setShowChat]    = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput,   setChatInput]   = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [setupModal,  setSetupModal]  = useState(null);
  const [flightsForm, setFlightsForm] = useState({ origin:"", duration:"", arrivalTime:"", departureTime:"" });
  const [hotelForm,   setHotelForm]   = useState({ name:"", maps_url:"" });
  const [inviteRole,  setInviteRole]  = useState("edit");
  const [inviteLink,  setInviteLink]  = useState("");
  const [linkCopied,  setLinkCopied]  = useState(false);

  const scrollRef = useRef(null);
  const dayRefs   = useRef([]);
  const pillStrip = useRef(null);
  const isJumping = useRef(false);

  const addActivity = (dayId, activity) => {
    setDays(prev=>prev.map(d=>d.id===dayId?{...d,activities:[...d.activities,activity]}:d));
  };

  const editActivity = (dayId, updated) => {
    setDays(prev=>prev.map(d=>d.id===dayId?{...d,activities:d.activities.map(a=>a.id===updated.id?updated:a)}:d));
  };


  const saveFlights = async () => {
    const mins = flightsForm.duration ? Math.round(parseFloat(flightsForm.duration) * 60) : null;
    const arrival_time   = flightsForm.arrivalTime   ? `${trip.start_date}T${flightsForm.arrivalTime}:00`  : null;
    const departure_time = flightsForm.departureTime ? `${trip.end_date}T${flightsForm.departureTime}:00`   : null;
    await supabase.from("trips").update({
      origin_city: flightsForm.origin || null,
      flight_duration_mins: mins,
      arrival_time,
      departure_time,
    }).eq("id", trip.id);
    const updatedTrip = { ...trip, origin_city: flightsForm.origin || null, flight_duration_mins: mins, arrival_time, departure_time };
    setTrip(updatedTrip);
    setSetupDone(d=>({...d, flights:true}));
    setSetupModal(null);

    // Auto-reschedule Day 1 if arrival time is set and itinerary exists
    if (arrival_time && days.length > 0) {
      const [h, m] = flightsForm.arrivalTime.split(":").map(Number);
      const rawReady = h * 60 + m + 30 + 45 + 90; // airport exit + est. drive + check-in
      const readyMins = Math.round(rawReady / 30) * 30;
      const readyHH = String(Math.floor(readyMins / 60) % 24).padStart(2, "0");
      const readyMM = String(readyMins % 60).padStart(2, "0");
      setChatLoading(true);
      try {
        await callChatTrip(
          `The traveler lands at ${flightsForm.arrivalTime} and will be ready to start sightseeing around ${readyHH}:${readyMM}. Rebuild Day 1 with only what realistically fits between ${readyHH}:${readyMM} and 9:30pm — keep activities spaced naturally with time to travel and breathe, maximum 2-3 activities. Move any activities that no longer fit onto Day 2 (add them at the start of Day 2 before existing activities). Do not rush or compress the schedule.`,
          updatedTrip,
          days
        );
      } catch { /* silently ignore — user can adjust manually */ }
      setChatLoading(false);
    }
  };

  const saveHotel = async () => {
    await supabase.from("trips").update({
      hotel_name:     hotelForm.name     || null,
      hotel_maps_url: hotelForm.maps_url || null,
    }).eq("id", trip.id);
    setTrip(t => ({ ...t, hotel_name: hotelForm.name || null, hotel_maps_url: hotelForm.maps_url || null }));
    setSetupDone(d=>({...d, hotel:true}));
    setSetupModal(null);
  };


  const handleGenerate = async (form) => {
    setGenerateError("");
    setScreen("generating");

    const numDays = Math.max(1, Math.round((new Date(form.endDate) - new Date(form.startDate)) / (1000*60*60*24)) + 1);

    // Call edge function for AI generation; fall back to local data if unavailable
    let itinerary;
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-itinerary`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ destinations: form.destinations, numDays, travelers: form.travelers, styles: form.styles, budget: form.budget, pace: form.pace, morningStart: form.morningStart, startDate: form.startDate || null, arrivalCity: form.arrivalCity || null, arrivalTime: form.arrivalTime || null, departureCity: form.departureCity || null, departureTime: form.departureTime || null, hotelName: form.hotelName || null, hotelArea: form.hotelArea || null }),
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data?.error) throw new Error(data.error);
      itinerary = data;
    } catch (e) {
      console.warn("AI generation failed, using fallback:", e.message);
      itinerary = getItineraryForForm(form);
    }

    // 1. Insert trip — generate ID client-side to avoid .select() RLS issues
    const tripId = crypto.randomUUID();
    const tripPayload = {
      id: tripId,
      name: itinerary.name,
      destination: form.destinations.join(" → "),
      start_date: form.startDate,
      end_date: form.endDate,
      created_by: session.user.id,
      ...(form.arrivalTime   && { arrival_time: `${form.startDate}T${form.arrivalTime}:00` }),
      ...(form.departureTime && { departure_time: `${form.endDate}T${form.departureTime}:00` }),
      ...(form.hotelName     && { hotel_name: form.hotelName }),
    };
    const { error: tripErr } = await supabase.from("trips").insert(tripPayload);

    if (tripErr) {
      console.error(tripErr);
      setGenerateError(`Failed to create trip: ${tripErr.message}`);
      return;
    }
    const tripData = tripPayload;

    // 2. Add creator as organizer
    await supabase.from("trip_members").insert({
      trip_id: tripData.id,
      user_id: session.user.id,
      role: "edit",
    });

    // 3. Insert days + activities
    const start = new Date(form.startDate);
    const savedDays = [];
    for (const [i, day] of itinerary.days.entries()) {
      const dayDate = new Date(start);
      dayDate.setDate(start.getDate() + i);
      const isoDate = dayDate.toISOString().split("T")[0];

      const { data: dayData } = await supabase
        .from("days")
        .insert({ trip_id: tripData.id, label: day.label, date: isoDate, city: day.city, position: i, description: day.description || null })
        .select()
        .single();

      if (!dayData) continue;

      const activities = await Promise.all(
        day.activities.map((act, j) =>
          supabase.from("activities").insert({
            day_id: dayData.id,
            time: act.time, title: act.title, geocode: act.geocode || null, type: act.type,
            duration: act.duration, note: act.note,
            confirmed: act.confirmed, icon: act.icon,
            position: j, added_by: session.user.id,
          }).select().single().then(r => r.data)
        )
      );

      savedDays.push({ ...dayData, activities: activities.filter(Boolean) });
    }

    const fmt = (d) => new Date(d).toLocaleDateString("en-US", { month:"short", day:"numeric" });
    setTrip({
      ...tripData,
      dates: `${fmt(form.startDate)} – ${fmt(form.endDate)}, ${new Date(form.endDate).getFullYear()}`,
      travelers: parseInt(form.travelers),
      collaborators: [],
    });
    setSetupDone({
      flights: !!(form.arrivalTime || form.departureTime),
      hotel:   !!form.hotelName,
    });
    setDays(savedDays);
    setActiveDay(0);
    setScreen("itinerary");

    // Fetch and persist photos in background — itinerary is already visible
    Promise.all(savedDays.flatMap(day =>
      day.activities
        .filter(a => a.type !== "transit")
        .map(async act => {
          const url = await _fetchPhoto(act.geocode || act.title, day.city);
          if (url) await supabase.from("activities").update({ photo_url: url }).eq("id", act.id);
        })
    ));
  };

  // Click a pill → jump-scroll to that day section
  const scrollToDay = (idx) => {
    const el = dayRefs.current[idx];
    if (!el || !scrollRef.current) return;
    isJumping.current = true;
    setActiveDay(idx);
    const pill = pillStrip.current?.children[idx];
    pill?.scrollIntoView({ behavior:"smooth", block:"nearest", inline:"center" });
    const containerTop = scrollRef.current.getBoundingClientRect().top;
    const elTop        = el.getBoundingClientRect().top;
    scrollRef.current.scrollBy({ top: elTop - containerTop - 52, behavior:"smooth" });
    setTimeout(() => { isJumping.current = false; }, 700);
  };

  // Scroll → update active pill
  const handleScroll = () => {
    if (isJumping.current) return;
    const container = scrollRef.current;
    if (!container) return;
    const threshold = container.getBoundingClientRect().top + 60;
    let current = 0;
    dayRefs.current.forEach((el, i) => {
      if (el && el.getBoundingClientRect().top <= threshold) current = i;
    });
    if (current !== activeDay) {
      setActiveDay(current);
      const pill = pillStrip.current?.children[current];
      pill?.scrollIntoView({ behavior:"smooth", block:"nearest", inline:"center" });
    }
  };

  const callChatTrip = async (message, currentTrip, currentDays) => {
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat-trip`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ trip: currentTrip, days: currentDays, message, history: [] }),
      }
    );
    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { message: raw }; }
    const incoming = data.updatedDays ?? data.days ?? [];
    if (incoming.length) {
      const ts = Date.now();
      setDays(prev => prev.map(day => {
        const updated = incoming.find(u => u.label?.trim().toLowerCase() === day.label?.trim().toLowerCase());
        if (!updated) return day;
        return { ...day, city: updated.city ?? day.city, activities: (updated.activities || []).map((act, i) => ({ ...act, id: day.activities[i]?.id ?? `tmp-${ts}-${i}`, position: i })) };
      }));
    }
    return data;
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = { role: "user", content: chatInput.trim() };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput("");
    setChatLoading(true);
    try {
      const data = await callChatTrip(userMsg.content, trip, days);
      setChatMessages(prev => [...prev, { role: "assistant", content: data.message || "Done." }]);
    } catch {
      setChatMessages(prev => [...prev, { role: "assistant", content: "Sorry, something went wrong. Try again." }]);
    }
    setChatLoading(false);
  };

  return (
    <div style={{fontFamily:"Georgia,serif",background:T.warm,minHeight:"100vh",maxWidth:430,margin:"0 auto",position:"relative",display:"flex",flexDirection:"column",height:"100vh",overflow:"hidden"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:4px;}
        ::-webkit-scrollbar-thumb{background:${T.sand};border-radius:4px;}
        @keyframes fadeUp{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}
        @keyframes pulse{0%,100%{opacity:0.3;transform:scale(0.8);}50%{opacity:1;transform:scale(1);}}
        @keyframes shimmer{0%,100%{opacity:0.45;}50%{opacity:0.75;}}
        .no-scrollbar::-webkit-scrollbar{display:none;}
        .no-scrollbar{-ms-overflow-style:none;scrollbar-width:none;}
      `}</style>

      {/* ── GENERATING ── */}
      {screen==="generating" && (
        <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:20,padding:40}}>
          <div style={{fontSize:48,animation:"pulse 1.5s infinite"}}>✈️</div>
          <div style={{fontFamily:"'DM Serif Display',serif",fontSize:22,color:T.ink,textAlign:"center"}}>Building your itinerary…</div>
          <div style={{fontSize:13,color:T.mist,fontFamily:"Georgia,serif",textAlign:"center"}}>Claude is planning real activities for your trip</div>
        </div>
      )}

      {/* ── SETUP ── */}
      {screen==="setup" && (
        <div style={{flex:1,overflowY:"auto"}}>
          <div style={{background:`linear-gradient(160deg,${T.dusk},${T.ocean})`,padding:"44px 20px 36px",color:"white",position:"relative",overflow:"hidden"}}>
            <div style={{position:"absolute",top:-50,right:-50,width:200,height:200,borderRadius:"50%",background:"rgba(255,255,255,0.04)"}}/>
            {onHome && <button onClick={onHome} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:20,padding:"4px 13px",color:"white",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif",marginBottom:14}}>← Trips</button>}
            <div style={{fontSize:13,letterSpacing:3,opacity:0.6,textTransform:"uppercase",marginBottom:10,fontFamily:"Georgia,serif"}}>Wayfarer</div>
            <div style={{fontFamily:"'DM Serif Display',serif",fontSize:34,lineHeight:1.2,marginBottom:10}}>Plan your next<br/>adventure ✈️</div>
            <div style={{fontSize:14,opacity:0.7,fontFamily:"Georgia,serif"}}>AI-powered itineraries, built for you</div>
          </div>
          <div style={{padding:"28px 0 0"}}>
            {generateError && (
              <div style={{margin:"0 20px 16px",padding:"12px 16px",borderRadius:12,background:"#FFF0F0",border:"1.5px solid #e53e3e",fontSize:13,color:"#c53030",fontFamily:"Georgia,serif"}}>
                {generateError}
              </div>
            )}
            <SetupForm onGenerate={handleGenerate}/>
          </div>
        </div>
      )}

      {/* ── ITINERARY ── */}
      {screen==="itinerary" && loading && (
        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"#8BA5BB",fontFamily:"Georgia,serif",fontSize:14}}>
          Loading itinerary…
        </div>
      )}
      {screen==="itinerary" && !loading && (
        <>
          {/* Scrollable body */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            style={{flex:1,overflowY:"auto",paddingBottom: showChat ? "56vh" : 100, transition:"padding-bottom 0.3s"}}
          >
            {/* Header — scrolls away */}
            <div style={{background:`linear-gradient(160deg,${T.dusk},${T.ocean})`,padding:"28px 20px 20px",color:"white",position:"relative",overflow:"hidden"}}>
              <div style={{position:"absolute",top:-30,right:-30,width:130,height:130,borderRadius:"50%",background:"rgba(255,255,255,0.04)"}}/>
              <div style={{display:"flex",gap:8,marginBottom:12}}>
                {onHome && <button onClick={onHome} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:20,padding:"4px 13px",color:"white",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>← Trips</button>}
                <button onClick={()=>setScreen("setup")} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:20,padding:"4px 13px",color:"white",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>+ New trip</button>
              </div>
              <div style={{fontFamily:"'DM Serif Display',serif",fontSize:24,lineHeight:1.2,marginBottom:4}}>{trip.name}</div>
              <div style={{fontSize:13,opacity:0.75,fontFamily:"Georgia,serif"}}>📅 {trip.dates || (trip.start_date && trip.end_date ? `${new Date(trip.start_date).toLocaleDateString("en-US",{month:"short",day:"numeric"})} – ${new Date(trip.end_date).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}` : "")}</div>
              <div style={{display:"flex",gap:8,marginTop:16}}>
                {[["plan","🗓 Itinerary"],["collab","👥 Collab"]].map(([t,l])=>(
                  <button key={t} onClick={()=>{ if(t==="collab"){ setCollabToast(true); setTimeout(()=>setCollabToast(false),2500); } else setTab(t); }} style={{
                    background:tab===t?"white":"rgba(255,255,255,0.15)",
                    color:tab===t?T.ocean:"white",
                    border:"none",borderRadius:20,padding:"6px 18px",
                    fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif",
                    fontWeight:tab===t?700:400,transition:"all 0.2s",
                  }}>{l}</button>
                ))}
              </div>
            </div>

            {/* Coming soon toast */}
            {collabToast && (
              <div style={{position:"fixed",bottom:32,left:"50%",transform:"translateX(-50%)",
                background:T.ink,color:"white",borderRadius:20,padding:"10px 22px",
                fontFamily:"Georgia,serif",fontSize:13,zIndex:999,
                boxShadow:"0 4px 20px rgba(0,0,0,0.25)",whiteSpace:"nowrap",
                animation:"fadeUp 0.25s ease"}}>
                👥 Collaboration — coming soon
              </div>
            )}

            {/* Day-pill strip — sticky within scroll area */}
            {tab==="plan" && (
              <div style={{position:"sticky",top:0,zIndex:10,background:T.warm,borderBottom:`1px solid ${T.sand}`,padding:"8px 16px"}}>
                <div ref={pillStrip} className="no-scrollbar" style={{display:"flex",gap:6,overflowX:"auto"}}>
                  {days.map((d,i) => {
                    const active = i === activeDay;
                    return (
                      <button key={d.id} onClick={()=>scrollToDay(i)} style={{
                        flexShrink:0,
                        display:"flex", alignItems:"center", gap:5,
                        padding: active ? "5px 13px" : "5px 11px",
                        borderRadius:20,
                        border:`1.5px solid ${active ? T.ocean : T.sand}`,
                        background: active ? T.ocean : T.chalk,
                        color: active ? "white" : T.mist,
                        fontSize:12, fontFamily:"Georgia,serif",
                        cursor:"pointer", transition:"all 0.22s",
                        fontWeight: active ? 700 : 400,
                        boxShadow: active ? "0 2px 8px rgba(37,99,168,0.28)" : "none",
                        whiteSpace:"nowrap",
                      }}>
                        <span style={{fontSize:14, lineHeight:1}}>{d.activities[0]?.icon}</span>
                        <span>{d.label}</span>
                        {active && <span style={{opacity:0.8, fontSize:11}}>· {d.city}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Setup strip */}
            <SetupStrip
              done={setupDone}
              onOpen={(key) => {
                if (key === "flights") {
                  setFlightsForm({
                    origin: trip.origin_city || "",
                    duration: trip.flight_duration_mins ? String(trip.flight_duration_mins / 60) : "",
                    arrivalTime: trip.arrival_time ? trip.arrival_time.split("T")[1]?.substring(0, 5) : "",
                    departureTime: trip.departure_time ? trip.departure_time.split("T")[1]?.substring(0, 5) : "",
                  });
                } else if (key === "hotel") {
                  setHotelForm({ name: trip.hotel_name || "", maps_url: trip.hotel_maps_url || "" });
                }
                setSetupModal(key);
              }}
              onDismiss={(key)=>setSetupDone(d=>({...d,[key]:true}))}
            />
            {tab==="plan"
              ? days.map((day,i)=>(
                  <div key={day.id} ref={el=>{ dayRefs.current[i]=el; }}>
                    <DaySection
                      day={day}
                      hotel={{ name: trip.hotel_name, area: trip.hotel_area, maps_url: trip.hotel_maps_url }}
                      onAddActivity={addActivity}
                      onEditActivity={editActivity}
                      arrivalTime={i === 0 ? trip.arrival_time : null}
                      onEditFlight={i === 0 ? () => {
                        setFlightsForm({
                          origin: trip.origin_city || "",
                          duration: trip.flight_duration_mins ? String(trip.flight_duration_mins / 60) : "",
                          arrivalTime: trip.arrival_time ? trip.arrival_time.split("T")[1]?.substring(0, 5) : "",
                          departureTime: trip.departure_time ? trip.departure_time.split("T")[1]?.substring(0, 5) : "",
                        });
                        setSetupModal("flights");
                      } : undefined}
                    />
                  </div>
                ))
              : <CollabTab
                  trip={trip}
                  session={session}
                  inviteRole={inviteRole}
                  setInviteRole={setInviteRole}
                  inviteLink={inviteLink}
                  setInviteLink={setInviteLink}
                  linkCopied={linkCopied}
                  setLinkCopied={setLinkCopied}
                />
            }
          </div>

          {/* Bottom bar */}
          <div style={{
            flexShrink:0,
            background:T.chalk,
            borderTop:`1px solid ${T.sand}`,
            padding:"12px 20px 24px",
            display:"flex",gap:10,
          }}>
            <button onClick={()=>setShowChat(true)} style={{flex:1,background:`linear-gradient(135deg,${T.ocean},${T.dusk})`,color:"white",border:"none",borderRadius:14,padding:"14px 18px",fontFamily:"'DM Serif Display',serif",fontSize:15,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:7}}>
              ✨ Tweak my trip
            </button>
            <button style={{width:52,background:T.sand,color:T.ink,border:"none",borderRadius:14,padding:"14px 0",fontFamily:"Georgia,serif",fontSize:17,cursor:"pointer"}}>📤</button>
          </div>

          {/* ── CHAT PANEL ── */}
          {showChat && (
            <>
            <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,height:"52%",zIndex:300,display:"flex",flexDirection:"column",background:T.warm,borderTop:`2px solid ${T.sand}`,borderRadius:"20px 20px 0 0",boxShadow:"0 -8px 32px rgba(0,0,0,0.12)"}}>
              {/* Chat header */}
              <div style={{background:`linear-gradient(135deg,${T.dusk},${T.ocean})`,padding:"20px 20px 16px",color:"white",flexShrink:0}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                  <div style={{fontFamily:"'DM Serif Display',serif",fontSize:18}}>✨ AI Trip Assistant</div>
                  <button onClick={()=>setShowChat(false)} style={{background:"rgba(255,255,255,0.2)",border:"none",borderRadius:20,padding:"4px 12px",color:"white",cursor:"pointer",fontSize:13,fontFamily:"Georgia,serif"}}>Done</button>
                </div>
                <div style={{fontSize:12,opacity:0.75,fontFamily:"Georgia,serif"}}>{trip.name} · ask me to change anything</div>
              </div>

              {/* Messages */}
              <div style={{flex:1,overflowY:"auto",padding:"16px 16px 8px",display:"flex",flexDirection:"column",gap:10}}>
                {chatMessages.length === 0 && (
                  <div style={{textAlign:"center",padding:"40px 20px",color:T.mist,fontFamily:"Georgia,serif",fontSize:13}}>
                    <div style={{fontSize:32,marginBottom:12}}>💬</div>
                    <div>Ask me to change activities, swap a day, add a restaurant, adjust the pace — anything.</div>
                    <div style={{marginTop:16,display:"flex",flexDirection:"column",gap:8}}>
                      {["Make day 2 more food-focused","Add a beach day","Replace morning activities with something relaxing"].map(s=>(
                        <button key={s} onClick={()=>{ setChatInput(s); }} style={{background:T.chalk,border:`1px solid ${T.sand}`,borderRadius:20,padding:"8px 14px",fontSize:12,fontFamily:"Georgia,serif",color:T.ink,cursor:"pointer",textAlign:"left"}}>
                          "{s}"
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {chatMessages.map((m,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
                    <div style={{maxWidth:"80%",background:m.role==="user"?T.ocean:T.chalk,color:m.role==="user"?"white":T.ink,borderRadius:m.role==="user"?"18px 18px 4px 18px":"18px 18px 18px 4px",padding:"10px 14px",fontSize:13,fontFamily:"Georgia,serif",lineHeight:1.5,boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}>
                      {m.content}
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div style={{display:"flex",justifyContent:"flex-start"}}>
                    <div style={{background:T.chalk,borderRadius:"18px 18px 18px 4px",padding:"10px 14px",fontSize:13,color:T.mist,fontFamily:"Georgia,serif",letterSpacing:2}}>···</div>
                  </div>
                )}
              </div>

              {/* Input */}
              <div style={{padding:"8px 12px 28px",background:T.chalk,borderTop:`1px solid ${T.sand}`,display:"flex",gap:8,flexShrink:0}}>
                <input
                  value={chatInput}
                  onChange={e=>setChatInput(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&sendChatMessage()}
                  placeholder="e.g. Make day 2 more relaxing…"
                  style={{flex:1,padding:"11px 14px",borderRadius:24,border:`1.5px solid ${T.sand}`,fontFamily:"Georgia,serif",fontSize:13,color:T.ink,outline:"none",background:T.warm}}
                />
                <button onClick={sendChatMessage} disabled={chatLoading||!chatInput.trim()} style={{width:44,height:44,borderRadius:"50%",background:chatInput.trim()?T.ocean:T.sand,color:"white",border:"none",fontSize:18,cursor:chatInput.trim()?"pointer":"default"}}>↑</button>
              </div>
            </div>
            </>
          )}
        </>
      )}


      {/* ── SETUP MODALS ── */}
      {setupModal && (
        <div onClick={()=>setSetupModal(null)} style={{
          position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:200,
          display:"flex",alignItems:"flex-end",justifyContent:"center",
        }}>
          <div onClick={e=>e.stopPropagation()} style={{
            background:T.chalk,borderRadius:"20px 20px 0 0",
            padding:"24px 20px 36px",width:"100%",maxWidth:430,
          }}>

            {/* FLIGHTS */}
            {setupModal==="flights" && <>
              <div style={{fontFamily:"'DM Serif Display',serif",fontSize:20,color:T.ink,marginBottom:4}}>✈️ Add flights</div>
              <div style={{fontSize:13,color:T.mist,fontFamily:"Georgia,serif",marginBottom:20}}>Helps plan rest time and airport transfers</div>
              {[
                ["Origin city","text","origin","e.g. Mumbai"],
                ["Flight duration (hours)","number","duration","e.g. 2.5"],
              ].map(([label,type,key,ph])=>(
                <div key={key} style={{marginBottom:14}}>
                  <div style={{fontSize:12,color:T.mist,fontFamily:"Georgia,serif",marginBottom:4}}>{label}</div>
                  <input type={type} placeholder={ph} value={flightsForm[key]}
                    onChange={e=>setFlightsForm(f=>({...f,[key]:e.target.value}))}
                    style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1.5px solid ${T.sand}`,
                      fontFamily:"Georgia,serif",fontSize:14,color:T.ink,outline:"none",boxSizing:"border-box"}}/>
                </div>
              ))}
              <div style={{display:"flex",gap:12,marginBottom:20}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,color:T.mist,fontFamily:"Georgia,serif",marginBottom:4}}>Arrival time (Day 1)</div>
                  <input type="time" value={flightsForm.arrivalTime}
                    onChange={e=>setFlightsForm(f=>({...f,arrivalTime:e.target.value}))}
                    style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1.5px solid ${T.sand}`,
                      fontFamily:"Georgia,serif",fontSize:14,color:T.ink,outline:"none",boxSizing:"border-box"}}/>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,color:T.mist,fontFamily:"Georgia,serif",marginBottom:4}}>Departure time (last day)</div>
                  <input type="time" value={flightsForm.departureTime}
                    onChange={e=>setFlightsForm(f=>({...f,departureTime:e.target.value}))}
                    style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1.5px solid ${T.sand}`,
                      fontFamily:"Georgia,serif",fontSize:14,color:T.ink,outline:"none",boxSizing:"border-box"}}/>
                </div>
              </div>
              <button onClick={saveFlights} style={{width:"100%",padding:14,borderRadius:14,border:"none",
                background:`linear-gradient(135deg,${T.ocean},${T.dusk})`,color:"white",
                fontFamily:"'DM Serif Display',serif",fontSize:16,cursor:"pointer"}}>Save flights</button>
            </>}

            {/* HOTEL */}
            {setupModal==="hotel" && <>
              <div style={{fontFamily:"'DM Serif Display',serif",fontSize:20,color:T.ink,marginBottom:4}}>🏨 Add hotel</div>
              <div style={{fontSize:13,color:T.mist,fontFamily:"Georgia,serif",marginBottom:20}}>Paste the Google Maps link for your hotel</div>
              <div style={{marginBottom:14}}>
                <div style={{fontSize:12,color:T.mist,fontFamily:"Georgia,serif",marginBottom:4}}>Google Maps link</div>
                <input placeholder="Paste link from Google Maps"
                  value={hotelForm.maps_url}
                  onChange={e=>{
                    const url = e.target.value;
                    const match = url.match(/\/maps\/place\/([^/@]+)/);
                    const extracted = match ? decodeURIComponent(match[1].replace(/\+/g," ")) : "";
                    setHotelForm({ maps_url: url, name: extracted });
                  }}
                  style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1.5px solid ${T.sand}`,
                    fontFamily:"Georgia,serif",fontSize:14,color:T.ink,outline:"none",boxSizing:"border-box"}}/>
              </div>
              {hotelForm.maps_url.trim() && (
                <div style={{marginBottom:20}}>
                  <div style={{fontSize:12,color:T.mist,fontFamily:"Georgia,serif",marginBottom:4}}>Hotel name {hotelForm.name ? "(auto-detected)" : "(couldn't detect — enter manually)"}</div>
                  <input placeholder="Hotel name"
                    value={hotelForm.name}
                    onChange={e=>setHotelForm(f=>({...f,name:e.target.value}))}
                    style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1.5px solid ${hotelForm.name?T.ocean:T.sand}`,
                      fontFamily:"Georgia,serif",fontSize:14,color:T.ink,outline:"none",boxSizing:"border-box"}}/>
                </div>
              )}
              <button onClick={saveHotel} disabled={!hotelForm.maps_url.trim()} style={{width:"100%",padding:14,borderRadius:14,border:"none",
                background:hotelForm.maps_url.trim()?`linear-gradient(135deg,${T.ocean},${T.dusk})`:T.sand,
                color:hotelForm.maps_url.trim()?"white":T.mist,
                fontFamily:"'DM Serif Display',serif",fontSize:16,cursor:hotelForm.maps_url.trim()?"pointer":"default"}}>Save hotel</button>
            </>}


          </div>
        </div>
      )}
    </div>
  );
}
