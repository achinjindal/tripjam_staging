import { useState, useRef, useEffect, createContext, useContext } from "react";
import { supabase } from "./supabase";
import html2canvas from "html2canvas";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const FACE_ICONS = ["👦","👧","🧑","👨","👩","🧔","👱","🧓","🥸","😎"];
const DebugContext = createContext(false);

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
const _usedPhotoUrls = new Set(); // prevent same photo showing on multiple activities

// Returns true if the URL looks like a person portrait or otherwise unsuitable place photo
function _isPortrait(url) {
  return /portrait|headshot|cropped|_photo_of|mug.?shot|flag_of|coat_of_arms|logo|emblem|map_of|locator|location_map|blankmap|relief_map|seal_of/i.test(url);
}


function PhotoStrip({ activity, city }) {
  const debugMode = useContext(DebugContext);
  const stored = activity?.photo_url;
  const geocode = activity?.geocode || activity?.title;
  const [liveUrl, setLiveUrl] = useState(stored ? null : undefined);
  const [coords, setCoords] = useState(null);
  const [visible, setVisible] = useState(false);
  const ref = useRef(null);

  // Only fetch when the card scrolls into view
  useEffect(() => {
    if (stored) return;
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); obs.disconnect(); }
    }, { rootMargin: "200px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [stored]);

  useEffect(() => {
    if (stored || !visible) return;
    if (!geocode) { setLiveUrl(null); return; }
    const key = `${geocode}||${city || ""}`;
    if (_photoCache[key] !== undefined) { setLiveUrl(_photoCache[key]); return; }
    _fetchPhoto(geocode, city, activity?.type).then(src => {
      if (src) {
        _usedPhotoUrls.add(src);
        if (activity?.id) supabase.from("activities").update({ photo_url: src }).eq("id", activity.id).then();
      }
      _photoCache[key] = src ?? null;
      setLiveUrl(src ?? null);
    });
  }, [stored, visible, geocode, city]);

  useEffect(() => {
    if (!debugMode || !geocode) return;
    geocodePlace(geocode, city, activity?.geocode).then(c => setCoords(c));
  }, [debugMode, geocode, city]);

  const url = stored || liveUrl;
  if (url === undefined) return (
    <div ref={ref} style={{marginTop:10,height:130,borderRadius:10,background:T.sand,animation:"shimmer 1.5s ease-in-out infinite"}}/>
  );
  if (!url) {
    if (!debugMode) return null;
    return (
      <div style={{marginTop:8,padding:"4px 8px",borderRadius:6,background:"#FFF5F5",border:"1px solid #FCCACA",fontSize:10,color:"#E05C5C",fontFamily:"monospace"}}>
        ✗ no photo — "{activity?.geocode || activity?.title}"
      </div>
    );
  }
  return (
    <div style={{marginTop:10,borderRadius:10,overflow:"hidden",height:130,background:T.sand,position:"relative"}}>
      <img src={url} alt={geocode} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
      {debugMode && (
        <div style={{position:"absolute",bottom:0,left:0,right:0,background:"rgba(0,0,0,0.55)",color:"#fff",fontSize:10,fontFamily:"monospace",padding:"3px 6px",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
          {coords ? `📍 ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` : "📍 …"}
        </div>
      )}
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

const PACKAGE_PALETTE = [
  { bg: "#E8F4FD", color: "#1A6FA8" },
  { bg: "#FDE8F4", color: "#A8186F" },
  { bg: "#E8FDF0", color: "#1A8A4A" },
  { bg: "#FDF5E8", color: "#A85A1A" },
  { bg: "#F0E8FD", color: "#6A1AA8" },
  { bg: "#FDE8E8", color: "#A81A1A" },
  { bg: "#E8FDFD", color: "#1A8AA8" },
  { bg: "#FDF0E8", color: "#8A5A1A" },
];
function packageColor(pkg) {
  let hash = 0;
  for (let i = 0; i < pkg.length; i++) hash = (hash * 31 + pkg.charCodeAt(i)) >>> 0;
  return PACKAGE_PALETTE[hash % PACKAGE_PALETTE.length];
}


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

function playDoneChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.15;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      osc.start(t); osc.stop(t + 0.5);
    });
  } catch { /* audio not available */ }
}

// Global serialized queues — separate delays for geocoding vs Wikimedia photo API
const _geocodeCache = new Map();

function makeQueue(delayMs) {
  const q = [];
  let running = false;
  const run = () => {
    if (running || q.length === 0) return;
    running = true;
    (async () => {
      while (q.length > 0) { q.shift()(); await new Promise(r => setTimeout(r, delayMs)); }
      running = false;
    })();
  };
  return (url) => new Promise(resolve => {
    q.push(async () => {
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(tid);
        resolve(res.ok ? await res.json() : null);
      } catch { resolve(null); }
    });
    run();
  });
}

const wikiQueuedFetch = makeQueue(800); // Wikimedia — conservative to avoid rate limits

async function _fetchPhoto(geocode, city, type) {
  const BAD_PATTERNS = /\.(svg)(\.|$)|map|marker|locator|flag|coat.of.arms|emblem|logo|icon|pictogram|seal_of|coa_of|blank|skyline|panorama|aerial/i;
  const good = (url) => url && !_isPortrait(url) && !_usedPhotoUrls.has(url) && !BAD_PATTERNS.test(url);

  // Deduplicate: return cached result immediately if already fetched
  const cacheKey = `${geocode}||${city || ""}`;
  if (_photoCache[cacheKey] !== undefined) {
    const cached = _photoCache[cacheKey];
    return (cached && _usedPhotoUrls.has(cached)) ? null : cached;
  }
  // Mark in-flight to prevent concurrent duplicate fetches
  _photoCache[cacheKey] = null;

  // Hotels: skip Wikipedia entirely, go straight to Google Places for accurate property photos
  if (type === "hotel") {
    try {
      const res = await fetch(`${PLACES_PROXY}?action=photo`, {
        method: "POST", headers: PLACES_HEADERS,
        body: JSON.stringify({ q: geocode, city }),
      });
      const { url: placesUrl } = await res.json();
      if (good(placesUrl)) { _usedPhotoUrls.add(placesUrl); _photoCache[cacheKey] = placesUrl; return placesUrl; }
    } catch { /* Places proxy unavailable */ }
    _photoCache[cacheKey] = null;
    return null;
  }

  const STOPWORDS = new Set(["the","a","an","of","in","at","on","and","by","for","to","de","el","la"]);
  // Strip city words from geocode — city name alone shouldn't count as a relevance match
  // e.g. "Hang Dao Street Hanoi" → "Hang Dao Street" so "Hanoi Film Festival" doesn't pass
  const cityWords = new Set((city || "").toLowerCase().split(/\s+/).filter(Boolean));
  const geocodeWithoutCity = geocode.toLowerCase().split(/\s+/).filter(w => !cityWords.has(w)).join(" ");
  const geocodeWords = geocodeWithoutCity.split(/\s+/).filter(w => w.length > 3 && !STOPWORDS.has(w));
  // Fallback: if all words are too short (e.g. "Pho Bat Dan"), use the full geocode as one token
  const relevanceTokens = geocodeWords.length > 0 ? geocodeWords : [geocode.toLowerCase()];
  // Check that the Wikipedia page title (after redirect) is still relevant to the geocode.
  // Prevents generic city/country article thumbnails from being returned for specific places.
  const pageRelevant = (pageTitle) => {
    const t = (pageTitle || "").toLowerCase();
    return relevanceTokens.some(w => t.includes(w));
  };

  // Tier 1: Wikipedia exact title lookup
  const data1 = await wikiQueuedFetch(
    `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(geocode)}&prop=pageimages&format=json&pithumbsize=700&redirects=1&origin=*`
  );
  const page1 = Object.values(data1?.query?.pages || {})[0];
  const src = page1?.thumbnail?.source;
  if (good(src) && pageRelevant(page1?.title)) { _usedPhotoUrls.add(src); _photoCache[cacheKey] = src; return src; }
  else if (src) console.log(`[photo] T1 filtered: "${page1?.title}" / ${src.split("/").pop()} for "${geocode}"`);

  // Tier 2: Wikipedia exact lookup with city stripped (geocode often has city appended)
  if (city) {
    const stripped = geocode.replace(new RegExp(`\\s+${city}\\s*$`, "i"), "").trim();
    if (stripped && stripped !== geocode) {
      const data2 = await wikiQueuedFetch(
        `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(stripped)}&prop=pageimages&format=json&pithumbsize=700&redirects=1&origin=*`
      );
      const page2 = Object.values(data2?.query?.pages || {})[0];
      const src2 = page2?.thumbnail?.source;
      if (good(src2) && pageRelevant(page2?.title)) { _usedPhotoUrls.add(src2); _photoCache[cacheKey] = src2; return src2; }
      else if (src2) console.log(`[photo] T2 filtered: "${page2?.title}" / ${src2.split("/").pop()} for "${stripped}"`);
    }
  }

  // Tier 3: Wikipedia full-text search — finds the right article even when title doesn't match geocode exactly
  const searchQ = city ? `${geocode} ${city}` : geocode;
  const data3 = await wikiQueuedFetch(
    `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(searchQ)}&gsrlimit=5&prop=pageimages&pithumbsize=700&format=json&origin=*`
  );
  const results3 = Object.values(data3?.query?.pages || {});
  for (const page of results3) {
    if (!pageRelevant(page.title)) { console.log(`[photo] T3 skipped irrelevant: "${page.title}" for "${geocode}"`); continue; }
    const src3 = page?.thumbnail?.source;
    if (good(src3)) { _usedPhotoUrls.add(src3); _photoCache[cacheKey] = src3; return src3; }
    else if (src3) console.log(`[photo] T3 filtered: ${src3.split("/").pop()} for "${geocode}"`);
  }

  // Tier 4: Google Places fallback
  {
    try {
      const res = await fetch(`${PLACES_PROXY}?action=photo`, {
        method: "POST", headers: PLACES_HEADERS,
        body: JSON.stringify({ q: geocode, city }),
      });
      const { url: placesUrl } = await res.json();
      if (good(placesUrl)) { _usedPhotoUrls.add(placesUrl); _photoCache[cacheKey] = placesUrl; return placesUrl; }
      else if (placesUrl) console.log(`[photo] T4 filtered: ${placesUrl.split("/").pop()} for "${geocode}"`);
    } catch { /* Places proxy unavailable, skip */ }
  }

  console.log(`[photo] no photo found for "${geocode}" (${city})`);
  _photoCache[cacheKey] = null;
  return null;
}

/* ─── DAY COLOURS (map + board) ─────────────────────────────────────── */
const DAY_COLORS = ["#E05C5C","#D4A847","#3D7A5C","#2563A8","#C4622D","#7B5EA7","#2E86AB","#E91E63","#00897B","#F4511E"];

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

function MapView({ days }) {
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
              // Use stored coords if available, otherwise resolve and persist
              let coords = (act.lat && act.lng) ? { lat: act.lat, lng: act.lng } : null;
              if (!coords) {
                coords = await geocodePlace(act.title, day.city, act.geocode);
                if (coords && act.id) {
                  supabase.from("activities").update({ lat: coords.lat, lng: coords.lng }).eq("id", act.id);
                }
              }
              return coords ? { ...act, lat: coords.lat, lng: coords.lng, dayIndex: di, dayLabel: day.label } : null;
            })
        );
        allPins[di] = dayPins.filter(Boolean);
        if (!cancelled) setPins(allPins.flat());
      }));
    })();
    return () => { cancelled = true; };
  }, []);

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
            url={`https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}@2x?access_token=${import.meta.env.VITE_MAPBOX_TOKEN}`}
            attribution='&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
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

/* ─── BOARD VIEW ─────────────────────────────────────────────────────── */

function NotesView({ trip, onSaveNotes, onBack }) {
  const [text, setText] = useState(trip.board_notes || "");
  const [saveStatus, setSaveStatus] = useState(null); // null | "saving" | "saved"
  const timerRef = useRef(null);
  const textareaRef = useRef(null);
  const pendingRef = useRef(null); // tracks text waiting to be saved

  // Focus textarea on mount
  useEffect(() => { textareaRef.current?.focus(); }, []);

  const handleChange = (e) => {
    const val = e.target.value;
    setText(val);
    setSaveStatus("saving");
    pendingRef.current = val;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      await onSaveNotes(val);
      pendingRef.current = null;
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus(null), 2000);
    }, 1000);
  };

  // Flush any pending save on unmount (e.g. user navigates back within 1s)
  useEffect(() => () => {
    clearTimeout(timerRef.current);
    if (pendingRef.current !== null) onSaveNotes(pendingRef.current);
  }, []);

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: T.warm }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px 10px", borderBottom: `1px solid ${T.sand}`, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: T.ocean, padding: "0 4px", lineHeight: 1 }}>←</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 18, color: T.ink }}>Notes</div>
        </div>
        <div style={{ fontSize: 11, fontFamily: "Georgia,serif", color: saveStatus === "saving" ? T.mist : T.moss, minWidth: 50, textAlign: "right" }}>
          {saveStatus === "saving" && "Saving…"}
          {saveStatus === "saved" && "✓ Saved"}
        </div>
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        placeholder={"Jot anything down — hotel confirmation numbers, visa requirements, things to remember, packing notes…"}
        style={{
          flex: 1, width: "100%", padding: "16px 18px",
          border: "none", outline: "none", resize: "none",
          fontFamily: "Georgia,serif", fontSize: 14, lineHeight: 1.7,
          color: T.ink, background: T.warm,
          boxSizing: "border-box",
        }}
      />

      {/* Footer word count */}
      {wordCount > 0 && (
        <div style={{ padding: "6px 18px 10px", fontSize: 11, color: T.mist, fontFamily: "Georgia,serif", flexShrink: 0 }}>
          {wordCount} word{wordCount !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}

const CATEGORY_ORDER = ["Bookings", "Documents", "Health & safety", "Money", "Packing", "Day of travel"];

function TodoView({ trip, onBack }) {
  const [todos, setTodos]           = useState([]);
  const [suggestions, setSuggestions] = useState([]); // AI-generated, pending review
  const [generating, setGenerating] = useState(false);
  const [newText, setNewText]       = useState("");
  const [loading, setLoading]       = useState(true);
  const inputRef = useRef(null);

  useEffect(() => {
    supabase.from("trip_todos").select("*").eq("trip_id", trip.id).order("position")
      .then(({ data }) => { setTodos(data || []); setLoading(false); });
  }, [trip.id]);

  const generate = async () => {
    setGenerating(true);
    setSuggestions([]);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-todos`,
        { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
          body: JSON.stringify({ trip }) }
      );
      const { items } = await res.json();
      // Filter out items already in the todo list (by text)
      const existingTexts = new Set(todos.map(t => t.text.toLowerCase()));
      setSuggestions((items || []).filter(s => !existingTexts.has(s.text.toLowerCase())));
    } catch { /* silent */ }
    setGenerating(false);
  };

  const accept = async (item, idx) => {
    const { data } = await supabase.from("trip_todos")
      .insert({ trip_id: trip.id, text: item.text, done: false, position: todos.length })
      .select().single();
    if (data) setTodos(prev => [...prev, data]);
    setSuggestions(prev => prev.filter((_, i) => i !== idx));
  };

  const discard = (idx) => setSuggestions(prev => prev.filter((_, i) => i !== idx));

  const acceptAll = async () => {
    const rows = suggestions.map((s, i) => ({ trip_id: trip.id, text: s.text, done: false, position: todos.length + i }));
    const { data } = await supabase.from("trip_todos").insert(rows).select();
    setTodos(prev => [...prev, ...(data || [])]);
    setSuggestions([]);
  };

  const toggleDone = async (todo) => {
    const done = !todo.done;
    setTodos(prev => prev.map(t => t.id === todo.id ? { ...t, done } : t));
    await supabase.from("trip_todos").update({ done }).eq("id", todo.id);
  };

  const deleteTodo = async (todo) => {
    setTodos(prev => prev.filter(t => t.id !== todo.id));
    await supabase.from("trip_todos").delete().eq("id", todo.id);
  };

  const addManual = async () => {
    const text = newText.trim();
    if (!text) return;
    setNewText("");
    const { data, error } = await supabase.from("trip_todos")
      .insert({ trip_id: trip.id, text, done: false, position: todos.length })
      .select().single();
    if (error) { console.error("trip_todos insert:", error); return; }
    if (data) setTodos(prev => [...prev, data]);
  };

  const done = todos.filter(t => t.done).length;
  const total = todos.length;

  // Group suggestions by category
  const grouped = CATEGORY_ORDER.reduce((acc, cat) => {
    const items = suggestions.filter(s => s.category === cat);
    if (items.length) acc.push({ cat, items });
    return acc;
  }, []);
  // Catch any uncategorised
  const knownCats = new Set(CATEGORY_ORDER);
  const otherItems = suggestions.filter(s => !knownCats.has(s.category));
  if (otherItems.length) grouped.push({ cat: "Other", items: otherItems });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: T.warm }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px 10px", borderBottom: `1px solid ${T.sand}`, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: T.ocean, padding: "0 4px", lineHeight: 1 }}>←</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 18, color: T.ink }}>To-do</div>
          {total > 0 && <div style={{ fontSize: 11, color: T.mist, fontFamily: "Georgia,serif" }}>{done}/{total} done</div>}
        </div>
        <button onClick={generate} disabled={generating} style={{
          background: generating ? T.sand : T.ocean, color: "white", border: "none",
          borderRadius: 20, padding: "7px 14px", fontSize: 12,
          fontFamily: "Georgia,serif", cursor: generating ? "default" : "pointer",
        }}>
          {generating ? "Generating…" : suggestions.length ? "Regenerate" : "✨ Generate"}
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {/* Suggestions */}
        {suggestions.length > 0 && (
          <div style={{ margin: "16px 16px 0" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: T.ocean, fontFamily: "Georgia,serif", textTransform: "uppercase", letterSpacing: 1 }}>
                Suggestions — {suggestions.length} items
              </div>
              <button onClick={acceptAll} style={{ fontSize: 12, color: T.moss, fontFamily: "Georgia,serif", background: "none", border: `1px solid ${T.moss}`, borderRadius: 20, padding: "4px 12px", cursor: "pointer" }}>
                Accept all
              </button>
            </div>
            {grouped.map(({ cat, items }) => (
              <div key={cat} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: T.mist, fontFamily: "Georgia,serif", letterSpacing: 0.5, marginBottom: 6, paddingLeft: 2 }}>{cat}</div>
                {items.map((item, globalIdx) => {
                  const idx = suggestions.indexOf(item);
                  return (
                    <div key={globalIdx} style={{ display: "flex", alignItems: "center", gap: 8, background: "#F0F7FF", border: `1px solid #C8DFFE`, borderRadius: 10, padding: "10px 12px", marginBottom: 6 }}>
                      <div style={{ flex: 1, fontSize: 13, fontFamily: "Georgia,serif", color: T.ink, lineHeight: 1.4 }}>{item.text}</div>
                      <button onClick={() => accept(item, idx)} title="Add to list" style={{ background: T.moss, border: "none", borderRadius: "50%", width: 28, height: 28, color: "white", fontSize: 14, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>✓</button>
                      <button onClick={() => discard(idx)} title="Discard" style={{ background: "none", border: `1px solid ${T.sand}`, borderRadius: "50%", width: 28, height: 28, color: T.mist, fontSize: 14, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                    </div>
                  );
                })}
              </div>
            ))}
            <div style={{ height: 1, background: T.sand, margin: "8px 0 16px" }} />
          </div>
        )}

        {/* Todos list */}
        {loading ? (
          <div style={{ padding: "24px 16px", color: T.mist, fontFamily: "Georgia,serif", fontSize: 13, textAlign: "center" }}>Loading…</div>
        ) : todos.length === 0 && suggestions.length === 0 ? (
          <div style={{ padding: "32px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
            <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 16, color: T.ink, marginBottom: 6 }}>Nothing here yet</div>
            <div style={{ fontSize: 13, color: T.mist, fontFamily: "Georgia,serif", lineHeight: 1.6 }}>Tap <strong>✨ Generate</strong> for a personalised checklist, or add items below.</div>
          </div>
        ) : (
          <div style={{ padding: "12px 16px 0" }}>
            {todos.map(todo => (
              <div key={todo.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 4px", borderBottom: `1px solid ${T.sand}` }}>
                <button onClick={() => toggleDone(todo)} style={{
                  width: 22, height: 22, borderRadius: "50%", flexShrink: 0, marginTop: 1, cursor: "pointer",
                  border: `2px solid ${todo.done ? T.moss : T.sand}`,
                  background: todo.done ? T.moss : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 12,
                }}>
                  {todo.done ? "✓" : ""}
                </button>
                <div style={{ flex: 1, fontSize: 13, fontFamily: "Georgia,serif", color: todo.done ? T.mist : T.ink, textDecoration: todo.done ? "line-through" : "none", lineHeight: 1.5, paddingTop: 2 }}>
                  {todo.text}
                </div>
                <button onClick={() => deleteTodo(todo)} style={{ background: "none", border: "none", fontSize: 14, color: T.sand, cursor: "pointer", padding: "0 2px", flexShrink: 0 }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add manual item */}
      <div style={{ padding: "10px 16px", paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))", borderTop: `1px solid ${T.sand}`, background: T.chalk, display: "flex", gap: 8, flexShrink: 0 }}>
        <input
          ref={inputRef}
          value={newText}
          onChange={e => setNewText(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addManual()}
          placeholder="Add an item…"
          style={{ flex: 1, padding: "10px 14px", borderRadius: 22, border: `1.5px solid ${T.sand}`, fontFamily: "Georgia,serif", fontSize: 13, color: T.ink, outline: "none", background: T.warm }}
        />
        <button onClick={addManual} disabled={!newText.trim()} style={{ width: 40, height: 40, borderRadius: "50%", background: newText.trim() ? T.ocean : T.sand, color: "white", border: "none", fontSize: 18, cursor: newText.trim() ? "pointer" : "default" }}>+</button>
      </div>
    </div>
  );
}

const BRAINSTORM_CATEGORIES = ["All", "Sightseeing", "Dining", "Experiences", "Nightlife", "Nature", "Culture", "Shopping", "Day Trip"];
const BRAINSTORM_CATEGORY_ICONS = { Sightseeing:"🏛️", Dining:"🍜", Experiences:"🎭", Nightlife:"🍸", Nature:"🌿", Culture:"🎨", Shopping:"🛍️", "Day Trip":"🚌" };

function BrainstormView({ trip, session }) {
  const [items, setItems] = useState(null); // null = loading, [] = empty, [...] = loaded
  const [votes, setVotes] = useState({}); // { [item_id]: { up: n, down: n, mine: 1|-1|0 } }
  const [generating, setGenerating] = useState(false);
  const [activeCategory, setActiveCategory] = useState("All");
  const [genError, setGenError] = useState(null);

  const igReq = trip?.ig_request || {};
  const destinations = igReq.destinations?.length
    ? igReq.destinations
    : (trip?.destination || "").split(" → ").map(s => s.trim()).filter(Boolean);

  useEffect(() => {
    loadItems();
  }, [trip?.id]);

  async function loadItems() {
    if (!trip?.id) return;
    const { data } = await supabase
      .from("brainstorm_items")
      .select("*")
      .eq("trip_id", trip.id)
      .order("position");
    setItems(data || []);
    if (data?.length) loadVotes(data.map(i => i.id));
  }

  async function loadVotes(itemIds) {
    if (!itemIds.length) return;
    const { data } = await supabase
      .from("brainstorm_votes")
      .select("item_id, user_id, vote")
      .in("item_id", itemIds);
    const agg = {};
    for (const id of itemIds) agg[id] = { up: 0, down: 0, mine: 0 };
    for (const row of (data || [])) {
      if (row.vote === 1)  agg[row.item_id].up++;
      if (row.vote === -1) agg[row.item_id].down++;
      if (row.user_id === session?.user?.id) agg[row.item_id].mine = row.vote;
    }
    setVotes(agg);
  }

  async function generate() {
    if (!destinations.length) return;
    setGenerating(true);
    setGenError(null);
    setItems([]);
    try {
      const travelMonth = igReq.startDate ? new Date(igReq.startDate).toLocaleString("en-US", { month: "long" }) : null;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-brainstorm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ destinations, styles: igReq.styles, budget: igReq.budget, travelMonth }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Stream text deltas and progressively parse complete JSON objects
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let lineBuffer = "";
      let jsonBuffer = "";
      let depth = 0;
      let inString = false;
      let escape = false;
      const streamedItems = [];

      const tryParseItem = (chunk) => {
        // Track characters to find complete {...} objects at depth 1
        for (const ch of chunk) {
          jsonBuffer += ch;
          if (escape) { escape = false; continue; }
          if (ch === "\\") { escape = true; continue; }
          if (ch === '"') { inString = !inString; continue; }
          if (inString) continue;
          if (ch === "{") depth++;
          if (ch === "}") {
            depth--;
            if (depth === 0) {
              // Extract the last complete object from jsonBuffer
              const start = jsonBuffer.lastIndexOf("{", jsonBuffer.length - 1);
              // Find the matching { by scanning backwards for depth=0
              let d = 0, objStart = -1;
              for (let i = jsonBuffer.length - 1; i >= 0; i--) {
                if (jsonBuffer[i] === "}") d++;
                if (jsonBuffer[i] === "{") d--;
                if (d === 0) { objStart = i; break; }
              }
              if (objStart >= 0) {
                const objStr = jsonBuffer.slice(objStart);
                try {
                  const item = JSON.parse(objStr);
                  if (item.title && item.category) {
                    streamedItems.push(item);
                    setItems([...streamedItems]);
                  }
                } catch { /* partial object, skip */ }
              }
            }
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") continue;
          try { tryParseItem(JSON.parse(raw)); } catch { /* skip */ }
        }
      }

      if (!streamedItems.length) throw new Error("No items received");

      // Clear old items and persist all at once
      await supabase.from("brainstorm_items").delete().eq("trip_id", trip.id);
      const rows = streamedItems.map((item, i) => ({ ...item, trip_id: trip.id, position: i }));
      const { data, error: insertErr } = await supabase.from("brainstorm_items").insert(rows).select();
      if (insertErr) throw new Error(`Insert error: ${insertErr.message}`);
      setItems(data || streamedItems);
      setVotes({});
    } catch (e) {
      console.error("Brainstorm generate error:", e);
      setGenError(e.message);
    }
    setGenerating(false);
  }

  async function castVote(itemId, value) {
    const current = votes[itemId]?.mine || 0;
    const newVote = current === value ? 0 : value; // toggle off if same

    // Optimistic update
    setVotes(prev => {
      const v = { ...(prev[itemId] || { up: 0, down: 0, mine: 0 }) };
      if (current === 1)  v.up--;
      if (current === -1) v.down--;
      if (newVote === 1)  v.up++;
      if (newVote === -1) v.down++;
      v.mine = newVote;
      return { ...prev, [itemId]: v };
    });

    if (newVote === 0) {
      await supabase.from("brainstorm_votes").delete().eq("item_id", itemId).eq("user_id", session.user.id);
    } else {
      await supabase.from("brainstorm_votes").upsert({ item_id: itemId, user_id: session.user.id, vote: newVote }, { onConflict: "item_id,user_id" });
    }
  }

  const visibleItems = (items || []).filter(it => activeCategory === "All" || it.category === activeCategory);

  return (
    <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", background: T.warm }}>
      {/* Header */}
      <div style={{ padding: "20px 16px 12px", background: T.chalk, borderBottom: `1px solid ${T.sand}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 20, color: T.ink }}>Brainstorm</div>
            <div style={{ fontSize: 12, color: T.mist, fontFamily: "Georgia,serif", marginTop: 2 }}>
              {generating
                ? items?.length ? `Found ${items.length} ideas so far…` : "Curating ideas…"
                : items?.length ? `${items.length} ideas · vote to shape your itinerary` : "Generate ideas for the group to vote on"}
            </div>
          </div>
          <button
            onClick={generate}
            disabled={generating || !destinations.length}
            style={{
              padding: "8px 16px", borderRadius: 20, border: "none", cursor: generating ? "default" : "pointer",
              background: generating ? T.sand : T.ocean, color: "white",
              fontFamily: "Georgia,serif", fontSize: 13, fontWeight: 600, opacity: generating ? 0.7 : 1,
            }}
          >
            {generating ? "Generating…" : items?.length ? "Regenerate" : "Generate"}
          </button>
        </div>

        {/* Category filter pills */}
        {items?.length > 0 && (
          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
            {BRAINSTORM_CATEGORIES.filter(c => c === "All" || items.some(it => it.category === c)).map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                style={{
                  flexShrink: 0, padding: "5px 12px", borderRadius: 20, border: "none", cursor: "pointer",
                  background: activeCategory === cat ? T.ocean : T.sand,
                  color: activeCategory === cat ? "white" : T.mist,
                  fontFamily: "Georgia,serif", fontSize: 12, fontWeight: activeCategory === cat ? 600 : 400,
                }}
              >
                {cat === "All" ? "All" : `${BRAINSTORM_CATEGORY_ICONS[cat] || ""} ${cat}`}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px 80px" }}>
        {items === null && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: T.mist, fontFamily: "Georgia,serif", fontSize: 14 }}>
            Loading…
          </div>
        )}

        {genError && (
          <div style={{margin:"12px 0",padding:"10px 14px",borderRadius:10,background:"#FEE2E2",border:"1px solid #FECACA",fontSize:12,color:"#DC2626",fontFamily:"monospace",wordBreak:"break-all"}}>
            ⚠️ {genError}
          </div>
        )}

        {items?.length === 0 && !generating && (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🗺️</div>
            <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 18, color: T.ink, marginBottom: 8 }}>No ideas yet</div>
            <div style={{ fontFamily: "Georgia,serif", fontSize: 13, color: T.mist, lineHeight: 1.5 }}>
              Hit Generate to get a list of things to do,<br/>see and eat — then vote with your group.
            </div>
          </div>
        )}

        {generating && items?.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: T.mist, fontFamily: "Georgia,serif", fontSize: 14 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>✨</div>
            Curating ideas…
          </div>
        )}

        {visibleItems.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {visibleItems.map(item => {
              const v = votes[item.id] || { up: 0, down: 0, mine: 0 };
              return (
                <div key={item.id} style={{
                  background: T.chalk, borderRadius: 14, padding: "12px 14px",
                  border: `1.5px solid ${T.sand}`, display: "flex", alignItems: "center", gap: 12,
                }}>
                  {/* Icon */}
                  <div style={{ fontSize: 24, flexShrink: 0, width: 36, textAlign: "center" }}>{item.icon}</div>

                  {/* Text */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: "'DM Serif Display',serif", fontSize: 14, color: T.ink, lineHeight: 1.3 }}>{item.title}</span>
                      <span style={{
                        fontSize: 10, borderRadius: 20, padding: "1px 7px", fontFamily: "Georgia,serif", fontWeight: 600, flexShrink: 0,
                        background: "#EBF3FD", color: T.ocean,
                      }}>{item.category}</span>
                    </div>
                    {item.city && (
                      <div style={{ fontSize: 11, color: T.mist, fontFamily: "Georgia,serif", marginBottom: 2 }}>📍 {item.city}</div>
                    )}
                    {item.note && (
                      <div style={{ fontSize: 12, color: T.mist, fontFamily: "Georgia,serif", fontStyle: "italic" }}>{item.note}</div>
                    )}
                  </div>

                  {/* Vote buttons */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
                    <button
                      onClick={() => castVote(item.id, 1)}
                      style={{
                        width: 34, height: 34, borderRadius: "50%", border: "none", cursor: "pointer", fontSize: 16,
                        background: v.mine === 1 ? "#DCFCE7" : T.sand,
                        color: v.mine === 1 ? "#16A34A" : T.mist,
                        display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 0,
                        transition: "background 0.15s",
                      }}
                    >
                      👍
                    </button>
                    {v.up > 0 && <span style={{ fontSize: 10, color: "#16A34A", fontFamily: "Georgia,serif", fontWeight: 600 }}>{v.up}</span>}

                    <button
                      onClick={() => castVote(item.id, -1)}
                      style={{
                        width: 34, height: 34, borderRadius: "50%", border: "none", cursor: "pointer", fontSize: 16,
                        background: v.mine === -1 ? "#FEE2E2" : T.sand,
                        color: v.mine === -1 ? "#DC2626" : T.mist,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "background 0.15s",
                        marginTop: v.up > 0 ? 0 : 4,
                      }}
                    >
                      👎
                    </button>
                    {v.down > 0 && <span style={{ fontSize: 10, color: "#DC2626", fontFamily: "Georgia,serif", fontWeight: 600 }}>{v.down}</span>}
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

function BoardView({ trip, onSaveNotes }) {
  const [activeSection, setActiveSection] = useState(null);
  const [todoItems, setTodoItems] = useState(null);

  useEffect(() => {
    if (!trip?.id) return;
    supabase.from("trip_todos").select("id, text, done").eq("trip_id", trip.id).order("position").limit(5)
      .then(({ data }) => setTodoItems(data || []));
  }, [trip?.id, activeSection]); // re-fetch when returning from sub-view

  if (activeSection === "notes") {
    return <NotesView trip={trip} onSaveNotes={onSaveNotes} onBack={() => setActiveSection(null)} />;
  }
  if (activeSection === "todo") {
    return <TodoView trip={trip} onBack={() => setActiveSection(null)} />;
  }

  const noteText = trip.board_notes?.trim() || null;
  const notePreview = noteText ? noteText.slice(0, 120) + (noteText.length > 120 ? "…" : "") : null;
  const doneTodos = (todoItems || []).filter(t => t.done).length;

  return (
    <div style={{ padding: "16px 16px", display: "flex", flexDirection: "column", gap: 12 }}>

      {/* ── EXPENSES ── */}
      <div style={{ background: T.chalk, borderRadius: 16, border: `1px solid ${T.sand}`, opacity: 0.65 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px 10px" }}>
          <div style={{ fontSize: 24, flexShrink: 0 }}>💸</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 15, color: T.ink }}>Expenses</div>
            <div style={{ fontSize: 12, color: T.mist, fontFamily: "Georgia,serif" }}>Plan your trip budget</div>
          </div>
          <div style={{ fontSize: 11, color: T.mist, fontFamily: "Georgia,serif", background: T.sand, borderRadius: 10, padding: "3px 10px", flexShrink: 0 }}>Coming soon</div>
        </div>
        <div style={{ borderTop: `1px solid ${T.sand}`, padding: "10px 16px 14px" }}>
          <div style={{ fontSize: 12, color: T.mist, fontFamily: "Georgia,serif", fontStyle: "italic" }}>No expenses planned yet</div>
        </div>
      </div>

      {/* ── POLLS ── */}
      <div style={{ background: T.chalk, borderRadius: 16, border: `1px solid ${T.sand}`, opacity: 0.65 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px 10px" }}>
          <div style={{ fontSize: 24, flexShrink: 0 }}>🗳️</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 15, color: T.ink }}>Polls</div>
            <div style={{ fontSize: 12, color: T.mist, fontFamily: "Georgia,serif" }}>Vote on destinations, restaurants, activities</div>
          </div>
          <div style={{ fontSize: 11, color: T.mist, fontFamily: "Georgia,serif", background: T.sand, borderRadius: 10, padding: "3px 10px", flexShrink: 0 }}>Coming soon</div>
        </div>
        <div style={{ borderTop: `1px solid ${T.sand}`, padding: "10px 16px 14px" }}>
          <div style={{ fontSize: 12, color: T.mist, fontFamily: "Georgia,serif", fontStyle: "italic" }}>No polls yet</div>
        </div>
      </div>

      {/* ── NOTES ── */}
      <div onClick={() => setActiveSection("notes")} style={{ background: T.chalk, borderRadius: 16, border: `1px solid ${T.sand}`, cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px 10px" }}>
          <div style={{ fontSize: 24, flexShrink: 0 }}>📝</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 15, color: T.ink }}>Notes</div>
            <div style={{ fontSize: 12, color: T.mist, fontFamily: "Georgia,serif" }}>Shared notes for the trip</div>
          </div>
          <div style={{ fontSize: 16, color: T.mist, flexShrink: 0 }}>›</div>
        </div>
        <div style={{ borderTop: `1px solid ${T.sand}`, padding: "10px 16px 14px" }}>
          {notePreview
            ? <div style={{ fontSize: 12, color: T.ink, fontFamily: "Georgia,serif", lineHeight: 1.7, opacity: 0.8, whiteSpace: "pre-line" }}>{notePreview}</div>
            : <div style={{ fontSize: 12, color: T.mist, fontFamily: "Georgia,serif", fontStyle: "italic" }}>No notes yet — tap to add</div>
          }
        </div>
      </div>

      {/* ── TO-DO ── */}
      <div onClick={() => setActiveSection("todo")} style={{ background: T.chalk, borderRadius: 16, border: `1px solid ${T.sand}`, cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px 10px" }}>
          <div style={{ fontSize: 24, flexShrink: 0 }}>✅</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 15, color: T.ink }}>To-do</div>
            {todoItems && todoItems.length > 0
              ? <div style={{ fontSize: 12, color: T.mist, fontFamily: "Georgia,serif" }}>{doneTodos}/{todoItems.length} done</div>
              : <div style={{ fontSize: 12, color: T.mist, fontFamily: "Georgia,serif" }}>Checklist for your trip</div>
            }
          </div>
          <div style={{ fontSize: 16, color: T.mist, flexShrink: 0 }}>›</div>
        </div>
        <div style={{ borderTop: `1px solid ${T.sand}`, padding: "10px 16px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
          {todoItems === null && (
            <div style={{ fontSize: 12, color: T.mist, fontFamily: "Georgia,serif" }}>Loading…</div>
          )}
          {todoItems !== null && todoItems.length === 0 && (
            <div style={{ fontSize: 12, color: T.mist, fontFamily: "Georgia,serif", fontStyle: "italic" }}>No items yet — tap to generate or add</div>
          )}
          {(todoItems || []).slice(0, 4).map(t => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                border: `1.5px solid ${t.done ? T.ocean : T.sand}`,
                background: t.done ? T.ocean : "none",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {t.done && <span style={{ fontSize: 9, color: "white", lineHeight: 1 }}>✓</span>}
              </div>
              <span style={{ fontSize: 12, fontFamily: "Georgia,serif", color: t.done ? T.mist : T.ink, textDecoration: t.done ? "line-through" : "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.text}</span>
            </div>
          ))}
          {todoItems && todoItems.length > 4 && (
            <div style={{ fontSize: 11, color: T.mist, fontFamily: "Georgia,serif", paddingLeft: 22 }}>+{todoItems.length - 4} more</div>
          )}
        </div>
      </div>

    </div>
  );
}

async function geocodePlace(title, city, geocodeHint) {
  // If geocodeHint is raw coordinates "lat,lng", use directly
  if (geocodeHint) {
    const m = geocodeHint.trim().match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  }
  const place = geocodeHint || extractPlace(title);
  const cacheKey = `${place}|${city}`;
  if (_geocodeCache.has(cacheKey)) return _geocodeCache.get(cacheKey);

  // Google Places primary — reliable city-aware geocoding
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 2000));
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(`${PLACES_PROXY}?action=geocode`, {
        method: "POST", headers: PLACES_HEADERS,
        body: JSON.stringify({ q: place, city }),
        signal: ctrl.signal,
      });
      clearTimeout(tid);
      const { lat, lng } = await res.json();
      if (lat && lng) {
        const result = { lat, lng };
        _geocodeCache.set(cacheKey, result);
        return result;
      }
      break;
    } catch { /* timeout or network error — retry */ }
  }
  _geocodeCache.set(cacheKey, null);
  return null;
}

function haversineMeters(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const x = Math.sin(dLat/2)**2 + Math.cos(a.lat*toR)*Math.cos(b.lat*toR)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}

/* ─── TRANSITION ROW ────────────────────────────────────────────────── */
function TransitionRow({ from, to, city, label = null, delay = 0, forceDrive = false, initialCommute = null, onResolved = null }) {
  const [commute, setCommute] = useState(initialCommute);
  const [loading, setLoading] = useState(!initialCommute);
  const [debug, setDebug] = useState(null);
  const debugMode = useContext(DebugContext);

  useEffect(() => {
    // Walk: if we already have a stored walk value, skip recalculation
    if (initialCommute?.mode === "walk") return;
    let cancelled = false;
    async function load() {
      if (delay > 0) await new Promise(r => setTimeout(r, delay));
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
          const useWalk = !forceDrive && walkMins <= 20;
          const result = { mode: useWalk ? "walk" : "drive", mins: useWalk ? walkMins : driveMins };
          if (!cancelled) {
            setCommute(result);
            onResolved?.(result.mins, result.mode);
          }
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

  if (!commute) {
    if (!debugMode) return null;
    return (
      <div style={{padding:"2px 20px"}}>
        <div style={{fontSize:10,color:"#E05C5C",fontFamily:"monospace",background:"#FFF5F5",
          border:"1px solid #FCCACA",borderRadius:6,padding:"3px 8px",lineHeight:1.5}}>
          ✗ {from.title} → {to.title}<br/>
          <span style={{color:"#999"}}>extracted: "{debug?.placeA}" → "{debug?.placeB}"</span><br/>
          <span style={{color:"#999"}}>{debug?.reason}</span>
        </div>
      </div>
    );
  }

  const origin   = encodeURIComponent(from.geocode || `${extractPlace(from.title)} ${city}`);
  const dest     = encodeURIComponent(to.geocode   || `${extractPlace(to.title)} ${city}`);
  const mapsUrl  = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=${commute.mode === "walk" ? "walking" : "driving"}`;

  return (
    <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 20px"}}>
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
      {label && <span style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif",whiteSpace:"nowrap",flexShrink:0}}>{label}</span>}
    </div>
  );
}

/* ─── ACTIVITY CARD ──────────────────────────────────────────────────── */
function ActivityCard({ activity, city, onEdit, flag = null, counts = null, onFlag }) {
  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState({ ...activity });
  const ts = typeStyle[draft.type] || typeStyle.sight;
  const mapsUrl = activity.geocode_end
    ? `https://www.google.com/maps/dir/${encodeURIComponent(activity.geocode || activity.title)}/${encodeURIComponent(activity.geocode_end)}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${activity.geocode || activity.title} ${city}`)}`;


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
            placeholder={draft.type === "transit" ? "Departure (e.g. CSMT Mumbai)" : "Map pin (e.g. Gateway of India Pier Mumbai)"}
            style={{width:"100%",padding:"8px 10px",borderRadius:10,border:`1.5px solid ${T.sand}`,fontFamily:"Georgia,serif",fontSize:13,color:T.ink,outline:"none",marginBottom:8}}/>
          {draft.type === "transit" && (
            <input value={draft.geocode_end || ""} onChange={e=>setDraft(d=>({...d,geocode_end:e.target.value}))}
              placeholder="Arrival (e.g. Pune Junction)"
              style={{width:"100%",padding:"8px 10px",borderRadius:10,border:`1.5px solid ${T.sand}`,fontFamily:"Georgia,serif",fontSize:13,color:T.ink,outline:"none",marginBottom:10}}/>
          )}
          {draft.type !== "transit" && <div style={{marginBottom:10}}/>}
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
              {(() => { const ps = activity.package ? packageColor(activity.package) : ts; return (
              <span style={{background:ps.bg,color:ps.color,fontSize:10,borderRadius:20,padding:"1px 7px",fontFamily:"Georgia,serif",fontWeight:600}}>
                {activity.package ? activity.package.replace(/-/g, " ").toUpperCase() : ts.label.toUpperCase()}
              </span>
              ); })()}
            </div>
            <div style={{fontFamily:"'DM Serif Display',serif",fontSize:15,color:T.ink,lineHeight:1.3}}>{activity.title}</div>
            {activity.note && (
              <div style={{fontSize:11,color:T.mist,marginTop:4,fontFamily:"Georgia,serif",fontStyle:"italic"}}>💬 {activity.note}</div>
            )}
          </div>
          <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:5,flexShrink:0}}>
            <div style={{display:"flex",gap:5,alignItems:"center"}}>
              {activity.duration && <span style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif"}}>⏱ {activity.duration}</span>}
              <a href={mapsUrl} target="_blank" rel="noopener noreferrer" style={{lineHeight:1,textDecoration:"none"}} title="Open in Google Maps"><img src="/google-maps-icon.png" alt="Maps" style={{width:14,height:14,objectFit:"contain",display:"block"}} /></a>
              <button onClick={()=>setEditing(true)} style={{background:"transparent",border:"none",cursor:"pointer",fontSize:11,padding:"0 2px",color:T.sand}}>✎</button>
            </div>
          </div>
        </div>
        {activity.type !== "transit" && (
          <PhotoStrip activity={activity} city={city}/>
        )}
        {onFlag && (() => {
          const FLAGS = [["love","❤️"],["skip","👎"],["discuss","🤔"]];
          const activeCounts = FLAGS.filter(([t]) => counts?.[t] > 0);
          return (
            <div style={{display:"flex",gap:5,marginTop:8,alignItems:"center",flexWrap:"wrap"}}>
              {/* Existing flag counts */}
              {activeCounts.map(([type, emoji]) => (
                <button key={type} onClick={()=>{ onFlag(activity.id, type); setPickerOpen(false); }} style={{
                  display:"flex", alignItems:"center", gap:3,
                  background: flag===type ? (type==="love"?"#FFF0F0":type==="skip"?"#F0F4FF":"#F0FFF4") : T.warm,
                  border: `1px solid ${flag===type ? (type==="love"?"#FFAAAA":type==="skip"?"#AAAAEE":"#AADDBB") : T.sand}`,
                  borderRadius:20, padding:"2px 8px", fontSize:12, cursor:"pointer", color:T.ink,
                }}>
                  <span>{emoji}</span>
                  <span style={{fontSize:11,color:T.mist}}>{counts[type]}</span>
                </button>
              ))}
              {/* Add / open picker */}
              {!pickerOpen ? (
                <button onClick={()=>setPickerOpen(true)} style={{
                  background:"transparent", border:`1px solid ${T.sand}`,
                  borderRadius:20, padding:"2px 8px", fontSize:11, cursor:"pointer", color:T.mist,
                }}>＋</button>
              ) : (
                <>
                  {FLAGS.map(([type, emoji]) => (
                    <button key={type} onClick={()=>{ onFlag(activity.id, type); setPickerOpen(false); }} style={{
                      background: flag===type ? (type==="love"?"#FFF0F0":type==="skip"?"#F0F4FF":"#F0FFF4") : T.chalk,
                      border: `1px solid ${flag===type ? (type==="love"?"#FFAAAA":type==="skip"?"#AAAAEE":"#AADDBB") : T.sand}`,
                      borderRadius:20, padding:"2px 9px", fontSize:13, cursor:"pointer",
                    }}>{emoji}</button>
                  ))}
                  <button onClick={()=>setPickerOpen(false)} style={{
                    background:"transparent", border:`1px solid ${T.sand}`,
                    borderRadius:20, padding:"2px 8px", fontSize:11, cursor:"pointer", color:T.mist,
                  }}>✕</button>
                </>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

/* ─── ARRIVAL TIMELINE ───────────────────────────────────────────────── */
const TRANSPORT_ICONS = ["✈️","🚂","⛵","🚗","🛺","🚢","🚁","🛸","🚤","🚀","🚲","🛵"];
function TransportCarousel() {
  const [idx, setIdx] = useState(0);
  const [key, setKey] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      setIdx(i => (i + 1) % TRANSPORT_ICONS.length);
      setKey(k => k + 1);
    }, 1800);
    return () => clearInterval(t);
  }, []);
  return (
    <div style={{width:80,height:80,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
      <span key={key} style={{fontSize:56,animation:"slideIn 1.8s ease forwards",display:"inline-block"}}>
        {TRANSPORT_ICONS[idx]}
      </span>
    </div>
  );
}

function DepartureTimeline({ departureTime, departureMode, onEdit }) {
  const hhmm = departureTime ? departureTime.split("T")[1]?.substring(0, 5) : null;
  if (!hhmm) return null;

  const [h, m]      = hhmm.split(":").map(Number);
  const leaveTotal  = h * 60 + m - 90; // ~90 min to airport/station before departure
  const leaveCapped = Math.max(0, Math.round(leaveTotal / 30) * 30);
  const leaveHH     = String(Math.floor(leaveCapped / 60) % 24).padStart(2, "0");
  const leaveMM     = String(leaveCapped % 60).padStart(2, "0");
  const modeIcon    = departureMode === "train" ? "🚂" : departureMode === "road" ? "🚗" : departureMode === "bus" ? "🚌" : "✈️";
  const modeLabel   = departureMode === "train" ? "Train" : departureMode === "road" ? "Drive out" : departureMode === "bus" ? "Bus" : "Flight";

  return (
    <div style={{padding:"12px 20px 0"}}>
      <div style={{background:"#EBF5FF",borderRadius:10,padding:"10px 14px",border:"1px solid #C5DEFF"}}>
        <div style={{fontSize:12,fontFamily:"Georgia,serif",color:T.ink,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
          <span style={{fontWeight:600,color:T.moss}}>Leave ~{leaveHH}:{leaveMM}</span>
          <span style={{color:T.mist,fontSize:10}}>›</span>
          <span style={{color:T.mist}}>~90 min to {departureMode === "road" ? "departure" : "terminal"}</span>
          <span style={{color:T.mist,fontSize:10}}>›</span>
          <span
            onClick={onEdit}
            style={onEdit ? {cursor:"pointer",textDecoration:"underline dotted",textUnderlineOffset:3} : {}}
          >{modeIcon} {modeLabel} {hhmm}</span>
        </div>
      </div>
    </div>
  );
}

function ArrivalTimeline({ arrivalTime, arrivalMode, onEditFlight }) {
  const arrivalHHMM = arrivalTime ? arrivalTime.split("T")[1]?.substring(0, 5) : null;
  if (!arrivalHHMM) return null;

  const [h, m]     = arrivalHHMM.split(":").map(Number);
  const rawReady   = h * 60 + m + 90;
  const readyTotal = Math.round(rawReady / 30) * 30;
  const readyHH    = String(Math.floor(readyTotal / 60) % 24).padStart(2, "0");
  const readyMM    = String(readyTotal % 60).padStart(2, "0");
  const icon  = arrivalMode === "train" ? "🚂" : arrivalMode === "road" ? "🚗" : arrivalMode === "bus" ? "🚌" : "✈️";
  const verb  = arrivalMode === "train" ? "Arrive" : arrivalMode === "road" ? "Drive in" : arrivalMode === "bus" ? "Arrive" : "Land";

  return (
    <div style={{padding:"0 20px 12px"}}>
      <div style={{background:"#EBF5FF",borderRadius:10,padding:"10px 14px",border:"1px solid #C5DEFF"}}>
        <div style={{fontSize:12,fontFamily:"Georgia,serif",color:T.ink,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
          <span
            onClick={onEditFlight}
            style={onEditFlight ? {cursor:"pointer",textDecoration:"underline dotted",textUnderlineOffset:3} : {}}
          >{icon} {verb} {arrivalHHMM}</span>
          <span style={{color:T.mist,fontSize:10}}>›</span>
          <span style={{color:T.mist}}>~90 min to settle in</span>
          <span style={{color:T.mist,fontSize:10}}>›</span>
          <span style={{fontWeight:600,color:T.moss}}>Ready ~{readyHH}:{readyMM}</span>
        </div>
      </div>
    </div>
  );
}

/* ─── DAY SECTION ────────────────────────────────────────────────────── */
function WishlistSection({ items, city }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{margin:"8px 20px 0"}}>
      <button onClick={()=>setOpen(o=>!o)} style={{
        width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",
        background:open?"#FFF8F0":"#FDF6EE",border:`1.5px solid ${T.sand}`,
        borderRadius:open?"14px 14px 0 0":14,padding:"10px 14px",cursor:"pointer",
      }}>
        <span style={{fontFamily:"Georgia,serif",fontSize:13,color:T.terra,fontWeight:600}}>✨ Local gems on the way</span>
        <span style={{fontSize:11,color:T.mist}}>{open ? "▲" : `${items.length} spots  ▼`}</span>
      </button>
      {open && (
        <div style={{background:"#FDF6EE",border:`1.5px solid ${T.sand}`,borderTop:"none",borderRadius:"0 0 14px 14px",padding:"4px 0 8px"}}>
          {items.map((item, i) => {
            const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${item.geocode || item.title} ${city}`)}`;
            return (
              <a key={i} href={mapsUrl} target="_blank" rel="noopener noreferrer" style={{
                display:"flex",alignItems:"flex-start",gap:10,padding:"8px 14px",
                textDecoration:"none",borderBottom: i < items.length-1 ? `1px solid ${T.sand}` : "none",
              }}>
                <span style={{fontSize:20,flexShrink:0,marginTop:1}}>{item.icon}</span>
                <div>
                  <div style={{fontSize:13,fontWeight:600,color:T.ink,fontFamily:"Georgia,serif"}}>{item.title}</div>
                  <div style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif",marginTop:2}}>{item.note}</div>
                </div>
                <img src="/google-maps-icon.png" alt="Maps" style={{width:14,height:14,objectFit:"contain",flexShrink:0,alignSelf:"center",marginLeft:"auto"}} />
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DaySection({ day, dayIndex = 0, onEditActivity, arrivalTime = null, arrivalMode = null, arrivalCity = null, onEditFlight, departureTime = null, departureMode = null, departureCity = null, onEditDeparture, hotelActivity = null, hotelCity = null, endHotelActivity = null, displayCity = null, flags = {}, flagCounts = {}, onFlag }) {
  const total = day.activities.length;
  const [showDesc, setShowDesc] = useState(false);

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
          <div style={{fontFamily:"'DM Serif Display',serif",fontSize:20,color:T.ink,lineHeight:1}}>{displayCity || day.city}</div>
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
        <ArrivalTimeline arrivalTime={arrivalTime} arrivalMode={arrivalMode} onEditFlight={onEditFlight} />
      )}

      {/* Arrival point → first activity transition */}
      {arrivalTime && arrivalCity && day.activities.length > 0 && (
        <TransitionRow
          from={{ title: arrivalCity, geocode: arrivalCity }}
          to={day.activities[0]}
          city={day.city}
          label="from arrival"
          delay={0}
          forceDrive
        />
      )}

      {/* Hotel → first activity transition (Day 2+ when staying at hotel) */}
      {hotelActivity && day.activities.length > 0 && !day.activities[0]?.package && !(hotelActivity.package && hotelActivity.package === day.activities[0]?.package) && (
        <TransitionRow
          from={hotelActivity}
          to={day.activities[0]}
          city={hotelCity || day.city}
          label="from hotel"
          delay={dayIndex * 400}
        />
      )}

      {/* Activities */}
      {(() => {
        const seenPkgs = new Set();
        return day.activities.map((act, i) => {
        const lastAct = i === day.activities.length - 1;
        if (act.package) seenPkgs.add(act.package);
        const nextAct = day.activities[i + 1];
        const samePackageAsNext = (act.package && act.package === nextAct?.package) || (act.type === "hotel" && nextAct?.package);
        const samePackageAsHotel = act.package && act.package === endHotelActivity?.package;
        return (
          <div key={act.id}>
            <ActivityCard activity={act} city={day.city} onEdit={(updated)=>onEditActivity(day.id, updated)} flag={flags[act.id] ?? null} counts={flagCounts[act.id] ?? null} onFlag={onFlag}/>
            {!lastAct && !samePackageAsNext && (
              <TransitionRow
                from={act.type === "transit" && act.geocode_end ? { ...act, geocode: act.geocode_end } : act}
                to={day.activities[i + 1]}
                city={day.city}
                delay={dayIndex * 400}
                initialCommute={act.transition_mins ? { mins: act.transition_mins, mode: act.transition_mode } : null}
                onResolved={(mins, mode) => {
                  if (act.id) supabase.from("activities").update({ transition_mins: mins, transition_mode: mode }).eq("id", act.id);
                }}
              />
            )}
            {/* Last activity → hotel */}
            {lastAct && endHotelActivity && act.type !== "hotel" && !samePackageAsHotel && (
              <TransitionRow
                from={act.type === "transit" && act.geocode_end ? { ...act, geocode: act.geocode_end } : act}
                to={endHotelActivity}
                city={day.city}
                label="to hotel"
                delay={dayIndex * 400}
                initialCommute={act.transition_mins ? { mins: act.transition_mins, mode: act.transition_mode } : null}
                onResolved={(mins, mode) => {
                  if (act.id) supabase.from("activities").update({ transition_mins: mins, transition_mode: mode }).eq("id", act.id);
                }}
              />
            )}
          </div>
        );
      });
      })()}

      {/* Wishlist */}
      {day.wishlist?.length > 0 && <WishlistSection items={day.wishlist} city={day.city} />}

      {/* Last activity / hotel → departure point */}
      {departureTime && departureCity && day.activities.length > 0 && (
        <TransitionRow
          from={endHotelActivity || day.activities[day.activities.length - 1]}
          to={{ title: departureCity, geocode: departureCity }}
          city={day.city}
          label="to departure"
          delay={dayIndex * 400}
          forceDrive
        />
      )}

      {/* Departure timeline (last day only) */}
      {departureTime && (
        <DepartureTimeline departureTime={departureTime} departureMode={departureMode} onEdit={onEditDeparture} />
      )}
    </div>
  );
}

/* ─── SETUP FORM ─────────────────────────────────────────────────────── */

function SetupForm({ onGenerate, initialTrip }) {
  const [step, setStep]           = useState(0);
  const [generating, setGen]      = useState(false);
  const prefill = initialTrip ? {
    destinations: initialTrip.destination ? initialTrip.destination.split(" → ") : [],
    startDate:    initialTrip.start_date || "",
    endDate:      initialTrip.end_date || "",
    arrivalTime:  initialTrip.arrival_time   ? initialTrip.arrival_time.slice(11,16)   : "",
    departureTime:initialTrip.departure_time ? initialTrip.departure_time.slice(11,16) : "",
    notes:        initialTrip.notes || "",
  } : {};
  const _today = new Date();
  const _defaultStart = new Date(_today); _defaultStart.setDate(_today.getDate() + 15);
  const _defaultEnd   = new Date(_today); _defaultEnd.setDate(_today.getDate() + 20);
  const _fmt = (d) => d.toISOString().slice(0, 10);
  const [form, setForm]           = useState({ destinations:[], destinationCountryCodes:[], startDate:_fmt(_defaultStart), endDate:_fmt(_defaultEnd), travelers:"2", styles:[], budget:"mid", pace:"active", morningStart:"early", notes:"", ...prefill });
  const [destInput, setDestInput] = useState("");
  const [destError, setDestError] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [showSugg, setShowSugg]   = useState(false);
  const inputRef  = useRef(null);
  const destTimer = useRef(null);
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const handleDestChange = (val) => {
    setDestInput(val);
    setDestError("");
    if (val.trim().length < 2) { setSuggestions([]); setShowSugg(false); return; }
    clearTimeout(destTimer.current);
    destTimer.current = setTimeout(async () => {
      try {
        const res  = await fetch(`${PLACES_PROXY}?action=autocomplete`, {
          method: "POST", headers: PLACES_HEADERS,
          body: JSON.stringify({ q: val }),
        });
        const data = await res.json();
        const suggestions = (data.suggestions || []).slice(0, 8);
        setSuggestions(suggestions);
        setShowSugg(suggestions.length > 0);
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

  const pickSuggestion = (suggestion) => {
    const text = suggestion.placePrediction?.text?.text || suggestion.placePrediction?.structuredFormat?.mainText?.text || "";
    if (text) addDestination(text);
    inputRef.current?.focus();
  };


  const styles  = ["Cultural & Heritage","Adventure & Outdoors","Food & Culinary","Relaxation & Wellness","City Break","Road Trip","Beach & Coast","Shopping","I'll wing it 🎲"];
  const budgets = [{key:"budget",label:"Budget 🏕️",sub:"Hostels, street food"},{key:"mid",label:"Mid-range 🏨",sub:"3★ hotels, restaurants"},{key:"luxury",label:"Luxury 🏰",sub:"5★ & fine dining"}];

  const handleGenerate = async () => {
    setGen(true);
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
            {suggestions.map((s,i) => {
              const main = s.placePrediction?.structuredFormat?.mainText?.text || s.placePrediction?.text?.text || "";
              const secondary = s.placePrediction?.structuredFormat?.secondaryText?.text || "";
              return (
                <div key={i} onMouseDown={()=>pickSuggestion(s)}
                  style={{padding:"10px 16px",cursor:"pointer",borderBottom:`1px solid ${T.sand}`}}
                  onMouseEnter={e=>e.currentTarget.style.background=T.sand}
                  onMouseLeave={e=>e.currentTarget.style.background=T.chalk}>
                  <div style={{fontFamily:"Georgia,serif",fontSize:14,color:T.ink,fontWeight:600}}>🌍 {main}</div>
                  {secondary && <div style={{fontFamily:"Georgia,serif",fontSize:11,color:T.mist,marginTop:2}}>{secondary}</div>}
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
          <input type="date" value={form.startDate} onChange={e=>{ set("startDate",e.target.value); if(form.endDate && e.target.value && form.endDate < e.target.value) set("endDate",""); }}
            style={{width:"100%",padding:"12px 14px",borderRadius:12,border:`2px solid ${form.startDate?T.ocean:T.sand}`,
              fontFamily:"Georgia,serif",fontSize:14,color:T.ink,background:T.chalk,outline:"none",boxSizing:"border-box"}}/>
        </div>
        <div style={{flex:1}}>
          <div style={{fontFamily:"Georgia,serif",fontSize:13,color:T.mist,marginBottom:6}}>End date</div>
          <input type="date" value={form.endDate} min={form.startDate || undefined} onChange={e=>{ if(!form.startDate || e.target.value >= form.startDate) set("endDate",e.target.value); }}
            style={{width:"100%",padding:"12px 14px",borderRadius:12,border:`2px solid ${form.endDate?T.ocean:T.sand}`,
              fontFamily:"Georgia,serif",fontSize:14,color:T.ink,background:T.chalk,outline:"none",boxSizing:"border-box",opacity:form.startDate?1:0.5,cursor:form.startDate?"auto":"not-allowed"}}/>
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
      <div style={{fontSize:13,color:T.mist,textAlign:"center",marginBottom:18,fontFamily:"Georgia,serif"}}>Pick up to 3</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:24}}>
        {styles.map(s=>{
          const sel = form.styles.includes(s);
          const maxed = !sel && form.styles.length >= 3;
          return (
            <button key={s} onClick={()=>{ if (maxed) return; set("styles", sel ? form.styles.filter(x=>x!==s) : [...form.styles, s]); }} style={{
              padding:"11px 12px",borderRadius:12,cursor:maxed?"default":"pointer",textAlign:"left",
              border:`2px solid ${sel?T.ocean:T.sand}`,
              background:sel?"#EBF3FD":T.chalk,
              color:sel?T.ocean:maxed?T.mist:T.ink,
              fontFamily:"Georgia,serif",fontSize:13,transition:"all 0.2s",
              fontWeight:sel?700:400,
              display:"flex",alignItems:"center",justifyContent:"space-between",
              opacity:maxed?0.45:1,
            }}>
              {s}
              {sel && <span style={{fontSize:13,color:T.ocean}}>✓</span>}
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

      {/* Anything else */}
      <div style={{marginTop:20}}>
        <div style={{fontFamily:"'DM Serif Display',serif",fontSize:16,color:T.ink,marginBottom:4}}>Anything else we should know?</div>
        <div style={{fontSize:12,color:T.mist,fontFamily:"Georgia,serif",marginBottom:10}}>e.g. travelling with a toddler, vegetarian only, avoid crowded places, celebrating an anniversary</div>
        <textarea value={form.notes} onChange={e=>set("notes",e.target.value)}
          placeholder="Optional — the more context you give, the better the itinerary"
          rows={3}
          style={{width:"100%",padding:"10px 12px",borderRadius:12,border:`1.5px solid ${form.notes?T.ocean:T.sand}`,fontFamily:"Georgia,serif",fontSize:13,color:T.ink,outline:"none",resize:"none",boxSizing:"border-box",background:T.chalk}}/>
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
      <button onClick={handleGenerate} disabled={generating} style={{
        width:"100%",padding:16,borderRadius:16,border:"none",
        cursor:generating?"default":"pointer",
        background:generating?T.sand:`linear-gradient(135deg,${T.ocean},${T.dusk})`,
        color:generating?T.mist:"white",
        fontFamily:"'DM Serif Display',serif",fontSize:18,
        boxShadow:generating?"none":"0 6px 22px rgba(37,99,168,0.4)",
        transition:"all 0.3s",marginTop:8,
      }}>{generating?"✨ Generating your itinerary…":"Generate Itinerary ✨"}</button>
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
      {destError && <div style={{color:"#e53e3e",fontSize:13,fontFamily:"Georgia,serif",marginTop:8,textAlign:"center"}}>{destError}</div>}
      <div style={{display:"flex",gap:10,marginTop:12}}>
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
            if (step === 1) {
              if (!form.startDate || !form.endDate) { setDestError("Please select both start and end dates."); return; }
              if (new Date(form.endDate) < new Date(form.startDate)) { setDestError("End date cannot be before start date."); return; }
            }
            setDestError("");
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
    { key:"flights", icon:"✈️", title:"Add flights", desc:"Optimise Day 1 and last day" },
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

/* ─── MODE PILLS ─────────────────────────────────────────────────────── */
const TRAVEL_MODES = [
  { id:"flight", label:"✈️ Flight" },
  { id:"train",  label:"🚂 Train"  },
  { id:"bus",    label:"🚌 Bus"    },
  { id:"road",   label:"🚗 Road"   },
];
function ModePills({ value, onChange }) {
  return (
    <div style={{display:"flex",gap:6,marginBottom:8}}>
      {TRAVEL_MODES.map(m => (
        <button key={m.id} onClick={()=>onChange(m.id)} style={{
          flex:1, padding:"6px 2px", borderRadius:8,
          border:`1.5px solid ${value===m.id?T.ocean:T.sand}`,
          background:value===m.id?T.ocean:"transparent",
          color:value===m.id?"white":T.mist,
          fontFamily:"Georgia,serif", fontSize:11, cursor:"pointer", transition:"all 0.2s",
        }}>{m.label}</button>
      ))}
    </div>
  );
}

/* ─── CITY INPUT ─────────────────────────────────────────────────────── */
function CityInput({ value, onChange, placeholder, inputStyle, airportOnly = false }) {
  const [suggs, setSuggs] = useState([]);
  const [show, setShow]   = useState(false);
  const timer = useRef(null);

  const handleChange = (val) => {
    onChange(val);
    if (val.trim().length < 3) { setSuggs([]); setShow(false); return; }
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const res  = await fetch(`${PLACES_PROXY}?action=autocomplete`, {
          method: "POST",
          headers: PLACES_HEADERS,
          body: JSON.stringify(airportOnly ? { q: val, types: "airport" } : { q: val }),
        });
        const data = await res.json();
        const items = (data.suggestions || []).slice(0, 6);
        setSuggs(items);
        setShow(items.length > 0);
      } catch { setSuggs([]); }
    }, 300);
  };

  const pick = (s) => {
    const fmt = s.placePrediction?.structuredFormat;
    onChange(fmt?.mainText?.text || s.placePrediction?.text?.text || "");
    setSuggs([]);
    setShow(false);
  };

  return (
    <div style={{position:"relative"}}>
      <input
        value={value}
        onChange={e => handleChange(e.target.value)}
        onBlur={() => setTimeout(() => setShow(false), 150)}
        placeholder={placeholder}
        style={inputStyle}
      />
      {show && suggs.length > 0 && (
        <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,background:T.chalk,border:`1.5px solid ${T.sand}`,borderRadius:10,zIndex:200,boxShadow:"0 4px 14px rgba(0,0,0,0.10)",overflow:"hidden"}}>
          {suggs.map((s,i) => {
            const fmt = s.placePrediction?.structuredFormat;
            const main = fmt?.mainText?.text || s.placePrediction?.text?.text || "";
            const sub  = fmt?.secondaryText?.text || "";
            return (
              <div key={i} onMouseDown={() => pick(s)}
                style={{padding:"9px 12px",cursor:"pointer",borderBottom:i<suggs.length-1?`1px solid ${T.sand}`:"none",fontFamily:"Georgia,serif"}}>
                <div style={{fontSize:13,color:T.ink}}>{main}</div>
                {sub && <div style={{fontSize:11,color:T.mist,marginTop:1}}>{sub}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── COLLAB TAB ─────────────────────────────────────────────────────── */
function LogisticsTab({ trip, days, onSaveFlights, onSaveHotels, onApplyHotels }) {
  const cities = [...new Set(days.map(d => d.city))];
  const [flights, setFlights] = useState({
    arrivalCity:   trip.arrival_city   || "",
    arrivalTime:   trip.arrival_time   ? trip.arrival_time.split("T")[1]?.substring(0,5)   : "",
    arrivalMode:   trip.arrival_mode   || "flight",
    departureCity: trip.departure_city || "",
    departureTime: trip.departure_time ? trip.departure_time.split("T")[1]?.substring(0,5) : "",
    departureMode: trip.departure_mode || "flight",
  });
  const [hasCar, setHasCar] = useState(trip.has_car || false);

  useEffect(() => {
    setFlights({
      arrivalCity:   trip.arrival_city   || "",
      arrivalTime:   trip.arrival_time   ? trip.arrival_time.split("T")[1]?.substring(0,5)   : "",
      arrivalMode:   trip.arrival_mode   || "flight",
      departureCity: trip.departure_city || "",
      departureTime: trip.departure_time ? trip.departure_time.split("T")[1]?.substring(0,5) : "",
      departureMode: trip.departure_mode || "flight",
    });
    setHasCar(trip.has_car || false);
  }, [trip.id]);
  const [hotels, setHotels] = useState(
    cities.map(city => ({
      city,
      name: ((trip.hotels_data || []).find(h => h.city === city) || {}).name || "",
    }))
  );
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | done

  const saved = {
    arrivalCity:   trip.arrival_city   || "",
    arrivalTime:   trip.arrival_time   ? trip.arrival_time.split("T")[1]?.substring(0,5)   : "",
    arrivalMode:   trip.arrival_mode   || "flight",
    departureCity: trip.departure_city || "",
    departureTime: trip.departure_time ? trip.departure_time.split("T")[1]?.substring(0,5) : "",
    departureMode: trip.departure_mode || "flight",
  };
  const hotelsChanged = hotels.some((h, i) => {
    const orig = ((trip.hotels_data || []).find(x => x.city === h.city) || {}).name || "";
    return h.name !== orig;
  });
  const hasChanges = saveStatus !== "saving" && (
    JSON.stringify(flights) !== JSON.stringify(saved) ||
    hasCar !== (trip.has_car || false) ||
    hotelsChanged
  );

  const handleSaveAll = async () => {
    if (!hasChanges) return;
    setSaveStatus("saving");
    await onSaveFlights({ ...flights, hasCar });
    await onSaveHotels(hotels);
    await onApplyHotels(hotels);
    setSaveStatus("done");
    setTimeout(() => setSaveStatus("idle"), 2500);
  };

  const inputStyle = (filled) => ({
    width:"100%", padding:"10px 12px", borderRadius:10,
    border:`1.5px solid ${filled ? T.ocean : T.sand}`,
    fontFamily:"Georgia,serif", fontSize:13, color:T.ink,
    outline:"none", boxSizing:"border-box", background:"white",
  });

  const dateLabel = (iso) => iso
    ? new Date(iso+"T12:00:00").toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"})
    : "—";


  return (
    <div style={{padding:"20px 16px 100px",display:"flex",flexDirection:"column",gap:16}}>

      {/* Travel */}
      <div style={{background:T.chalk,borderRadius:14,padding:16,border:`1.5px solid ${T.sand}`}}>
        <div style={{fontFamily:"'DM Serif Display',serif",fontSize:16,color:T.ink,marginBottom:14}}>🧭 Travel</div>

        {/* Arrival */}
        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif",marginBottom:6,textTransform:"uppercase",letterSpacing:1}}>Arriving</div>
          <ModePills value={flights.arrivalMode} onChange={v=>setFlights(f=>({...f,arrivalMode:v}))}/>
          <CityInput value={flights.arrivalCity} onChange={v=>setFlights(f=>({...f,arrivalCity:v}))}
            placeholder={flights.arrivalMode === "flight" ? "Arrival airport (e.g. Mumbai)" : "Arrival city (e.g. Mumbai)"}
            airportOnly={flights.arrivalMode === "flight"}
            inputStyle={{...inputStyle(flights.arrivalCity),marginBottom:8}}/>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <div style={{flex:1,padding:"10px 12px",borderRadius:10,border:`1.5px solid ${T.sand}`,fontFamily:"Georgia,serif",fontSize:12,color:T.mist,background:"#f7f7f7"}}>
              {dateLabel(trip.start_date)}
            </div>
            {flights.arrivalMode !== "road" && (
              <input type="time" value={flights.arrivalTime} onChange={e=>setFlights(f=>({...f,arrivalTime:e.target.value}))}
                style={{...inputStyle(flights.arrivalTime),flex:1}}/>
            )}
          </div>
        </div>

        {/* Departure */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif",marginBottom:6,textTransform:"uppercase",letterSpacing:1}}>Departing</div>
          <ModePills value={flights.departureMode} onChange={v=>setFlights(f=>({...f,departureMode:v}))}/>
          <CityInput value={flights.departureCity} onChange={v=>setFlights(f=>({...f,departureCity:v}))}
            placeholder={flights.departureMode === "flight" ? "Departure airport (e.g. Goa)" : "Departure city (e.g. Goa)"}
            airportOnly={flights.departureMode === "flight"}
            inputStyle={{...inputStyle(flights.departureCity),marginBottom:8}}/>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <div style={{flex:1,padding:"10px 12px",borderRadius:10,border:`1.5px solid ${T.sand}`,fontFamily:"Georgia,serif",fontSize:12,color:T.mist,background:"#f7f7f7"}}>
              {dateLabel(trip.end_date)}
            </div>
            {flights.departureMode !== "road" && (
              <input type="time" value={flights.departureTime} onChange={e=>setFlights(f=>({...f,departureTime:e.target.value}))}
                style={{...inputStyle(flights.departureTime),flex:1}}/>
            )}
          </div>
        </div>

        {/* Car toggle */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif",marginBottom:8,textTransform:"uppercase",letterSpacing:1}}>Getting around</div>
          <div style={{display:"flex",gap:8}}>
            {[{v:true,label:"🚗 We have a car"},{v:false,label:"🚌 Local transport"}].map(opt=>(
              <button key={String(opt.v)} onClick={()=>setHasCar(opt.v)} style={{
                flex:1, padding:"9px 6px", borderRadius:10,
                border:`1.5px solid ${hasCar===opt.v?T.ocean:T.sand}`,
                background:hasCar===opt.v?T.ocean:"transparent",
                color:hasCar===opt.v?"white":T.mist,
                fontFamily:"Georgia,serif", fontSize:12, cursor:"pointer", transition:"all 0.2s",
              }}>{opt.label}</button>
            ))}
          </div>
        </div>

      </div>

      {/* Hotels */}
      <div style={{background:T.chalk,borderRadius:14,padding:16,border:`1.5px solid ${T.sand}`}}>
        <div style={{fontFamily:"'DM Serif Display',serif",fontSize:16,color:T.ink,marginBottom:14}}>🏨 Hotels</div>
        {hotels.map((h, i) => (
          <div key={h.city} style={{marginBottom:i < hotels.length-1 ? 12 : 16}}>
            <div style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif",marginBottom:6,textTransform:"uppercase",letterSpacing:1}}>{h.city}</div>
            <input value={h.name} onChange={e=>setHotels(prev=>prev.map((x,j)=>j===i?{...x,name:e.target.value}:x))}
              placeholder={`Hotel in ${h.city}`}
              style={inputStyle(h.name)}/>
          </div>
        ))}
      </div>

      <div style={{position:"sticky",bottom:0,padding:"12px 0 8px",background:T.warm}}>
        <button onClick={handleSaveAll} disabled={!hasChanges} style={{
          width:"100%",padding:"12px 0",borderRadius:12,border:"none",
          background: saveStatus==="done" ? T.moss : !hasChanges ? T.sand : `linear-gradient(135deg,${T.ocean},${T.dusk})`,
          color: !hasChanges ? T.mist : "white",
          fontFamily:"'DM Serif Display',serif",fontSize:15,
          cursor: hasChanges ? "pointer" : "default",
          transition:"background 0.3s",
        }}>{saveStatus==="saving" ? "Saving…" : saveStatus==="done" ? "✓ Saved" : "Save and update itinerary"}</button>
      </div>
    </div>
  );
}

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
  const [debugMode] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("debug") === "1";
    if (fromUrl) localStorage.setItem("tripjam_debug", "1");
    return fromUrl || localStorage.getItem("tripjam_debug") === "1" || window.location.hostname === "localhost";
  });
  const [activeDay, setActiveDay] = useState(0);

  const [generateError, setGenerateError] = useState("");
  const [streamingDays, setStreamingDays] = useState(0);
  const [streamingTotal, setStreamingTotal] = useState(0);

  const [myFlags,    setMyFlags]    = useState({}); // { [activityId]: 'love'|'skip'|'discuss' }
  const [flagCounts, setFlagCounts] = useState({}); // { [activityId]: { love:N, skip:N, discuss:N } }

  const buildFlagState = (flagData, userId) => {
    const my = {}, counts = {};
    (flagData || []).forEach(({ activity_id, flag, user_id }) => {
      if (user_id === userId) my[activity_id] = flag;
      if (!counts[activity_id]) counts[activity_id] = { love: 0, skip: 0, discuss: 0 };
      counts[activity_id][flag] = (counts[activity_id][flag] || 0) + 1;
    });
    return { my, counts };
  };

  useEffect(() => {
    if (initialScreen === "itinerary" && initialTrip?.id) {
      supabase
        .from("days")
        .select("*, activities(*)")
        .eq("trip_id", initialTrip.id)
        .order("position")
        .then(async ({ data }) => {
          const seenPhotos = new Set();
          setDays((data || []).map(d => ({
            ...d,
            activities: (d.activities || []).sort((a, b) => a.position - b.position).map(a => {
              if (a.photo_url) {
                if (seenPhotos.has(a.photo_url)) return { ...a, photo_url: null };
                seenPhotos.add(a.photo_url);
                _usedPhotoUrls.add(a.photo_url);
              }
              return a;
            }),
          })));
          const actIds = (data || []).flatMap(d => (d.activities || []).map(a => a.id));
          if (actIds.length) {
            const { data: flagData } = await supabase
              .from("activity_flags")
              .select("activity_id, flag, user_id")
              .in("activity_id", actIds);
            const { my, counts } = buildFlagState(flagData, session.user.id);
            setMyFlags(my);
            setFlagCounts(counts);
          }

          // Load trip members + profiles
          const { data: members } = await supabase
            .from("trip_members")
            .select("trip_id, user_id, role")
            .eq("trip_id", initialTrip.id);
          if (members?.length) {
            const uids = members.map(m => m.user_id);
            const { data: profiles } = await supabase.from("profiles").select("id, username, face_icon").in("id", uids);
            const profileById = Object.fromEntries((profiles || []).map(p => [p.id, p]));
            setTrip(prev => ({ ...prev, trip_members: members.map(m => ({ ...m, profiles: profileById[m.user_id] || null })) }));
          }

          setLoading(false);
        });
    }
  }, []);

  const handleFlag = async (activityId, flagType) => {
    const current = myFlags[activityId];
    if (current === flagType) {
      // Toggle off
      setMyFlags(f => { const n = { ...f }; delete n[activityId]; return n; });
      setFlagCounts(c => {
        const n = { ...c, [activityId]: { ...c[activityId] } };
        n[activityId][flagType] = Math.max(0, (n[activityId]?.[flagType] || 1) - 1);
        return n;
      });
      await supabase.from("activity_flags").delete().eq("activity_id", activityId).eq("user_id", session.user.id);
    } else {
      // Swap or add
      setMyFlags(f => ({ ...f, [activityId]: flagType }));
      setFlagCounts(c => {
        const prev = { love: 0, skip: 0, discuss: 0, ...c[activityId] };
        if (current) prev[current] = Math.max(0, prev[current] - 1);
        prev[flagType] = (prev[flagType] || 0) + 1;
        return { ...c, [activityId]: prev };
      });
      await supabase.from("activity_flags").upsert({ activity_id: activityId, user_id: session.user.id, flag: flagType }, { onConflict: "activity_id,user_id" });
    }
  };
  const [activeBottomTab, setActiveBottomTab] = useState("itinerary");
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput,   setChatInput]   = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef(null);
  const [chatFilter, setChatFilter] = useState("all");
  const [mentionSearch, setMentionSearch] = useState(null);
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatLoading]);

  // Load persisted messages and subscribe to real-time updates
  useEffect(() => {
    if (!trip?.id) return;
    supabase
      .from("trip_messages")
      .select("id, role, content, user_id")
      .eq("trip_id", trip.id)
      .order("created_at")
      .then(({ data }) => {
        setChatMessages((data || []).map(m => ({ id: m.id, role: m.role, content: m.content, user_id: m.user_id })));
      });

    // Real-time: show messages from other users as they arrive
    const channel = supabase
      .channel(`trip-chat-${trip.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "trip_messages", filter: `trip_id=eq.${trip.id}` },
        (payload) => {
          const m = payload.new;
          if (m.user_id === session.user.id) return; // already handled locally
          setChatMessages(prev => [...prev, { id: m.id, role: m.role, content: m.content, user_id: m.user_id }]);
        })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [trip?.id]);
  const [setupModal,  setSetupModal]  = useState(null);
  const [editingTrip, setEditingTrip] = useState(null);
  const [showShare,   setShowShare]   = useState(false);
  const shareCardRef = useRef(null);
  const [flightsForm, setFlightsForm] = useState({ arrivalTime:"", departureTime:"" });
  const [inviteRole,  setInviteRole]  = useState("edit");
  const [inviteLink,  setInviteLink]  = useState("");
  const [linkCopied,  setLinkCopied]  = useState(false);

  const scrollRef     = useRef(null);
  const dayRefs       = useRef([]);
  const pillStrip     = useRef(null);
  const isJumping     = useRef(false);
  const logisticsRef  = useRef(null);

  const editActivity = (dayId, updated) => {
    setDays(prev=>prev.map(d=>d.id===dayId?{...d,activities:d.activities.map(a=>a.id===updated.id?updated:a)}:d));
  };


  const saveFlights = async () => {
    const arrival_time   = flightsForm.arrivalTime   ? `${trip.start_date}T${flightsForm.arrivalTime}:00`  : null;
    const departure_time = flightsForm.departureTime ? `${trip.end_date}T${flightsForm.departureTime}:00`   : null;
    await supabase.from("trips").update({
      arrival_time,
      departure_time,
    }).eq("id", trip.id);
    const updatedTrip = { ...trip, arrival_time, departure_time };
    setTrip(updatedTrip);
    setSetupModal(null);
  };

  const saveLogisticsFlights = async ({ arrivalCity, arrivalTime, arrivalMode, departureCity, departureTime, departureMode, hasCar }) => {
    const arrival_time   = arrivalTime   ? `${trip.start_date}T${arrivalTime}:00`   : null;
    const departure_time = departureTime ? `${trip.end_date}T${departureTime}:00`   : null;
    await supabase.from("trips").update({
      arrival_city: arrivalCity || null, arrival_time, arrival_mode: arrivalMode || "flight",
      departure_city: departureCity || null, departure_time, departure_mode: departureMode || "flight",
      has_car: hasCar || false,
    }).eq("id", trip.id);
    setTrip(t => ({ ...t, arrival_city: arrivalCity || null, arrival_time, arrival_mode: arrivalMode, departure_city: departureCity || null, departure_time, departure_mode: departureMode, has_car: hasCar }));
  };

  const saveLogisticsHotels = async (hotels) => {
    const data = hotels.filter(h => h.name.trim());
    await supabase.from("trips").update({ hotels_data: data.length ? data : null }).eq("id", trip.id);
    setTrip(t => ({ ...t, hotels_data: data.length ? data : null }));
  };

  const applyHotelsToItinerary = async (hotels) => {
    for (const h of hotels) {
      if (!h.name.trim()) continue;
      const cityDay = days.find(d => d.city === h.city);
      if (!cityDay) continue;
      const hotelAct = cityDay.activities.find(a => a.type === "hotel");
      if (!hotelAct) continue;
      const newTitle = `Check in at ${h.name}`;
      await supabase.from("activities").update({ title: newTitle }).eq("id", hotelAct.id);
      try {
        const res = await fetch(`${PLACES_PROXY}?action=photo`, {
          method: "POST", headers: PLACES_HEADERS,
          body: JSON.stringify({ q: h.name, city: h.city }),
        });
        const { url } = await res.json();
        if (url) await supabase.from("activities").update({ photo_url: url }).eq("id", hotelAct.id);
        editActivity(cityDay.id, { ...hotelAct, title: newTitle, photo_url: url || hotelAct.photo_url });
      } catch {
        editActivity(cityDay.id, { ...hotelAct, title: newTitle });
      }
    }
  };



  const handleGenerate = async (form) => {
    setGenerateError("");
    setStreamingDays(0);
    setScreen("generating");
    const generatingScreenStart = Date.now();

    const numDays = Math.max(1, Math.round((new Date(form.endDate) - new Date(form.startDate)) / (1000*60*60*24)) + 1);
    setStreamingTotal(numDays);

    // Call edge function for AI generation; fall back to local data if unavailable
    let itinerary;
    let accumulated = ""; // declared here so catch block can log it
    const generationStartedAt = new Date().toISOString();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000); // 90s timeout
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-itinerary`,
        {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ destinations: form.destinations, numDays, travelers: form.travelers, styles: form.styles, budget: form.budget, pace: form.pace, morningStart: form.morningStart, notes: form.notes || null, startDate: form.startDate || null }),
        }
      );
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Read SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let lineBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") continue;
          try {
            accumulated += JSON.parse(raw);
            const daysPlanned = (accumulated.match(/"label"\s*:/g) || []).length;
            if (daysPlanned > 0) setStreamingDays(daysPlanned);
          } catch { /* skip malformed chunk */ }
        }
      }

      // Parse accumulated JSON (same cleanup logic as before)
      const cleaned = accumulated.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error("Stream accumulated:", accumulated.slice(0, 500));
        throw new Error("No JSON found in stream");
      }
      let parsed;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        // Step 1: standard cleanup
        let fixed = jsonMatch[0]
          .replace(/,\s*([}\]])/g, "$1")
          .replace(/"((?:[^"\\]|\\.)*)"/g, (_m, inner) => `"${inner.replace(/[\n\r\t]/g, " ")}"`);
        try {
          parsed = JSON.parse(fixed);
        } catch {
          // Step 2: truncation repair — walk char-by-char tracking strings and brackets
          const stack = [];
          let inStr = false, esc = false, strStart = -1;
          for (let i = 0; i < fixed.length; i++) {
            const c = fixed[i];
            if (esc) { esc = false; continue; }
            if (c === "\\" && inStr) { esc = true; continue; }
            if (c === '"') {
              inStr = !inStr;
              if (inStr) strStart = i; else strStart = -1;
              continue;
            }
            if (inStr) continue;
            if (c === "{" || c === "[") stack.push(c);
            else if (c === "}" || c === "]") stack.pop();
          }
          // If truncated mid-string, back up to before that string's opening quote
          let repaired = inStr && strStart !== -1 ? fixed.slice(0, strStart) : fixed;
          // Strip trailing incomplete tokens (dangling comma, colon, whitespace)
          repaired = repaired.replace(/[,:\s]+$/, "");
          // Close all open containers in reverse order
          for (let i = stack.length - 1; i >= 0; i--)
            repaired += stack[i] === "{" ? "}" : "]";
          parsed = JSON.parse(repaired);
        }
      }
      itinerary = parsed;

    } catch (e) {
      console.error("AI generation failed:", e.message);
      console.error("Accumulated length:", accumulated.length);
      console.error("Accumulated tail:", accumulated.slice(-300));
      setGenerateError(`Generation failed: ${e.message}. Please try again.`);
      setScreen("setup");
      return;
    }
    // Validate dining activities — replace with alternatives if primary unverifiable
    try {
      const allFoodActs = itinerary.days.flatMap((day, di) =>
        day.activities.flatMap((act, ai) => {
          if (act.type !== "food") return [];
          const candidates = [act, ...(act.alternatives || [])].map(c => ({ title: c.geocode || c.title, city: day.city }));
          return candidates.map((c, ci) => ({ di, ai, ci, ...c }));
        })
      );
      if (allFoodActs.length) {
        const res = await fetch(`${PLACES_PROXY}?action=validate`, {
          method: "POST", headers: PLACES_HEADERS,
          body: JSON.stringify({ activities: allFoodActs.map(({ title, city }) => ({ title, city })) }),
        });
        const { results } = await res.json();
        // Map results back by [di][ai] → array of exists booleans per candidate
        const resultMap = {};
        allFoodActs.forEach(({ di, ai, ci }, idx) => {
          if (!resultMap[di]) resultMap[di] = {};
          if (!resultMap[di][ai]) resultMap[di][ai] = [];
          resultMap[di][ai][ci] = results[idx]?.exists ?? false;
        });
        itinerary.days.forEach((day, di) => {
          day.activities = day.activities.map((act, ai) => {
            if (act.type !== "food") return act;
            const exists = resultMap[di]?.[ai] || [];
            if (exists[0]) return { ...act, alternatives: undefined }; // primary verified
            const alts = act.alternatives || [];
            for (let ci = 0; ci < alts.length; ci++) {
              if (exists[ci + 1]) return { ...act, ...alts[ci], alternatives: undefined }; // swap in alt
            }
            return { ...act, alternatives: undefined }; // all failed — keep primary as-is
          });
        });
      }
    } catch (e) { console.warn("Dining validation failed, proceeding without:", e.message); }

    const generationCompletedAt = new Date().toISOString();

    // 1. Insert trip — generate ID client-side to avoid .select() RLS issues
    const tripId = crypto.randomUUID();
    const igRequest = { destinations: form.destinations, numDays, travelers: form.travelers, styles: form.styles, budget: form.budget, pace: form.pace, morningStart: form.morningStart, notes: form.notes || null, startDate: form.startDate || null };
    const tripPayload = {
      id: tripId,
      name: `${itinerary.name} · ${new Date().toLocaleDateString("en-GB",{day:"numeric",month:"short"})} ${Math.random().toString(36).slice(2,5).toUpperCase()}`,
      destination: form.destinations.join(" → "),
      start_date: form.startDate,
      end_date: form.endDate,
      created_by: session.user.id,
      generation_started_at: generationStartedAt,
      generation_completed_at: generationCompletedAt,
      ig_request: igRequest,
      ig_response: itinerary,
      ...(itinerary.summary  && { summary: itinerary.summary }),
      ...(form.notes         && { notes: form.notes }),
    };
    const { error: tripErr } = await supabase.from("trips").insert(tripPayload);

    const abort = (msg, err) => {
      console.error(msg, err);
      setGenerateError(`${msg}${err?.message ? `: ${err.message}` : ""}`);
      setScreen("setup");
    };

    if (tripErr) { abort("Failed to save trip", tripErr); return; }
    const tripData = tripPayload;

    // 2. Add creator as organizer
    const { error: memberErr } = await supabase.from("trip_members").insert({
      trip_id: tripData.id,
      user_id: session.user.id,
      role: "edit",
    });
    if (memberErr) { abort("Failed to add you as trip member", memberErr); return; }

    // 3. Insert days + activities (all days in parallel)
    const start = new Date(form.startDate);
    const savedDays = (await Promise.all(
      itinerary.days.map(async (day, i) => {
        const dayDate = new Date(start);
        dayDate.setDate(start.getDate() + i);
        const isoDate = dayDate.toISOString().split("T")[0];

        const { data: dayData, error: dayErr } = await supabase
          .from("days")
          .insert({ trip_id: tripData.id, label: day.label, date: isoDate, city: day.city, position: i, description: day.description || null, wishlist: day.wishlist?.length ? day.wishlist : null })
          .select()
          .single();

        if (dayErr || !dayData) { abort(`Failed to save ${day.label}`, dayErr); return null; }

        const activities = await Promise.all(
          day.activities.map((act, j) =>
            supabase.from("activities").insert({
              day_id: dayData.id,
              time: act.time, title: act.title, geocode: act.geocode || null, geocode_end: act.geocodeEnd || null, type: act.type,
              duration: act.duration, note: act.note,
              confirmed: act.confirmed, icon: act.icon, package: act.package || null,
              position: j, added_by: session.user.id,
            }).select().single().then(r => r.data)
          )
        );

        return { ...dayData, activities: activities.filter(Boolean) };
      })
    )).filter(Boolean);

    const fmt = (d) => new Date(d).toLocaleDateString("en-US", { month:"short", day:"numeric" });
    setTrip({
      ...tripData,
      dates: `${fmt(form.startDate)} – ${fmt(form.endDate)}, ${new Date(form.endDate).getFullYear()}`,
      travelers: parseInt(form.travelers),
      trip_members: [{ user_id: session.user.id, role: "edit", profiles: null }],
    });
    setDays(savedDays);
    setActiveDay(0);
    // Ensure generating screen shows for at least 4s so carousel/counter are visible
    const elapsed = Date.now() - generatingScreenStart;
    if (elapsed < 4000) await new Promise(r => setTimeout(r, 4000 - elapsed));
    playDoneChime();
    setScreen("itinerary");

    // Fetch and persist photos in background — staggered to avoid Wikimedia rate limits
    (async () => {
      const toFetch = savedDays.flatMap(day =>
        day.activities.filter(a => a.type !== "transit").map(act => ({ act, city: day.city }))
      );
      for (const { act, city } of toFetch) {
        const url = await _fetchPhoto(act.geocode || act.title, city, act.type);
        if (url) {
          // Update in-memory state immediately so PhotoStrip stops shimming without waiting for DB
          setDays(prev => prev.map(day => ({
            ...day,
            activities: day.activities.map(a => a.id === act.id ? { ...a, photo_url: url } : a),
          })));
          await supabase.from("activities").update({ photo_url: url }).eq("id", act.id);
        }
        await new Promise(r => setTimeout(r, 500)); // Wikimedia rate limit buffer
      }
    })();
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

  // Extract the message string progressively from partial JSON as it streams in
  const extractPartialMessage = (text) => {
    // Try complete match first
    const full = text.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (full) return full[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
    // Partial match (closing quote not yet received)
    const partial = text.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)/);
    if (partial) return partial[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
    return null;
  };

  const callChatTrip = async (message, currentTrip, currentDays, history = [], onChunk) => {
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat-trip`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ trip: currentTrip, days: currentDays, message, history }),
      }
    );

    // Read SSE stream and accumulate full JSON text
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = "";
    let lineBuffer = "";
    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") break outer;
        try {
          accumulated += JSON.parse(raw);
          onChunk?.(accumulated);
        } catch { }
      }
    }

    // Parse accumulated JSON
    const stripped = accumulated.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    let data;
    try {
      data = JSON.parse(stripped.slice(start, end + 1));
      if (!data.message) data.message = "Done.";
    } catch { data = { message: accumulated }; }
    const incoming = data.updatedDays ?? data.days ?? [];
    if (incoming.length) {
      // Persist each updated day to Supabase: delete existing activities, insert new ones
      for (const updatedDay of incoming) {
        const existingDay = currentDays.find(d => d.label?.trim().toLowerCase() === updatedDay.label?.trim().toLowerCase());
        if (!existingDay?.id) continue;
        const dayId = existingDay.id;

        // Delete all existing activities for this day
        const { error: deleteError } = await supabase.from("activities").delete().eq("day_id", dayId);
        if (deleteError) {
          console.error("[TMT] delete failed for day", dayId, deleteError);
          continue; // don't insert if delete failed — avoids duplicates
        }

        // Insert new activities
        const newActivities = (updatedDay.activities || []).map((act, j) => ({
          day_id: dayId,
          time: act.time, title: act.title, geocode: act.geocode || null, geocode_end: act.geocodeEnd || null,
          type: act.type, duration: act.duration, note: act.note,
          confirmed: act.confirmed ?? false, icon: act.icon, package: act.package || null,
          position: j, added_by: session.user.id,
        }));
        const { data: insertedActs, error: insertError } = await supabase.from("activities").insert(newActivities).select();
        if (insertError) { console.error("[TMT] insert failed for day", dayId, insertError); continue; }

        // Update wishlist on the day row if LLM returned one
        if (updatedDay.wishlist) {
          await supabase.from("days").update({ wishlist: updatedDay.wishlist }).eq("id", dayId);
        }

        // Update in-memory state with real DB ids
        setDays(prev => prev.map(day => {
          if (day.id !== dayId) return day;
          return {
            ...day,
            city: updatedDay.city ?? day.city,
            wishlist: updatedDay.wishlist ?? day.wishlist,
            activities: (insertedActs || []).map((act, i) => ({ ...act, ...updatedDay.activities[i] })),
          };
        }));
      }
    }
    return data;
  };

  const getMemberName = (userId) => {
    const m = (trip.trip_members || []).find(mem => mem.user_id === userId);
    return m?.profiles?.username || "Traveler";
  };

  const renderMentions = (text) => {
    if (!text) return "";
    const parts = text.split(/(\*\*[^*]+\*\*|_[^_]+_|\*[^*]+\*|@\w+)/g);
    if (parts.length === 1) return text;
    return parts.map((part, i) => {
      if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i}>{part.slice(2,-2)}</strong>;
      if (/^(_[^_]+_|\*[^*]+\*)$/.test(part)) return <em key={i}>{part.slice(1,-1)}</em>;
      if (/^@\w+/.test(part)) return <span key={i} style={{fontWeight:600,background:"rgba(37,99,168,0.12)",borderRadius:4,padding:"0 2px",color:T.ocean}}>{part}</span>;
      return part;
    });
  };

  const chatMembers = (trip.trip_members || [])
    .filter(m => m.user_id !== session.user.id && m.profiles?.username)
    .map(m => ({ name: m.profiles.username, icon: m.profiles.face_icon || "👤" }));

  const mentionOptions = [
    { name: "all", icon: "👥" },
    ...chatMembers,
  ].filter(opt => opt.name.toLowerCase().startsWith(mentionSearch || ""));

  const selectMention = (name) => {
    setChatInput(prev => prev.replace(/@\w*$/, `@${name} `));
    setMentionSearch(null);
  };

  const filteredMessages = chatMessages.filter(m => {
    if (chatFilter === "group") return m.role === "user";
    if (chatFilter === "ai") return m.role === "assistant";
    return true;
  });

  const sendChatMessage = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = { role: "user", content: chatInput.trim(), user_id: session.user.id };
    const history = chatMessages;
    setChatMessages(prev => [...prev, userMsg, { role: "assistant", content: "", streaming: true }]);
    setChatInput("");
    setChatLoading(true);

    // Persist user message
    supabase.from("trip_messages").insert({ trip_id: trip.id, user_id: session.user.id, role: "user", content: userMsg.content });

    let finalContent = "Sorry, something went wrong. Try again.";
    try {
      const data = await callChatTrip(userMsg.content, trip, days, history, (accumulated) => {
        const partial = extractPartialMessage(accumulated);
        if (partial !== null) {
          setChatMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: "assistant", content: partial, streaming: true };
            return updated;
          });
        }
      });
      finalContent = data.message || "Done.";
    } catch { /* use default error message */ }

    setChatMessages(prev => {
      const updated = [...prev];
      updated[updated.length - 1] = { role: "assistant", content: finalContent };
      return updated;
    });
    // Persist assistant message
    supabase.from("trip_messages").insert({ trip_id: trip.id, user_id: session.user.id, role: "assistant", content: finalContent });
    setChatLoading(false);
  };

  return (
    <div style={{fontFamily:"Georgia,serif",background:T.warm,maxWidth:430,margin:"0 auto",position:"relative",display:"flex",flexDirection:"column",height:"100dvh",overflow:"hidden"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:4px;}
        ::-webkit-scrollbar-thumb{background:${T.sand};border-radius:4px;}
        @keyframes fadeUp{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}
        @keyframes pulse{0%,100%{opacity:0.3;transform:scale(0.8);}50%{opacity:1;transform:scale(1);}}
        @keyframes shimmer{0%,100%{opacity:0.45;}50%{opacity:0.75;}}
        @keyframes blink{0%,100%{opacity:1;}50%{opacity:0;}}
        @keyframes slideIn{0%{opacity:0;transform:translateX(40px) scale(0.7);}20%{opacity:1;transform:translateX(0) scale(1);}80%{opacity:1;transform:translateX(0) scale(1);}100%{opacity:0;transform:translateX(-40px) scale(0.7);}}
        .no-scrollbar::-webkit-scrollbar{display:none;}
        .no-scrollbar{-ms-overflow-style:none;scrollbar-width:none;}
      `}</style>

      {/* ── GENERATING ── */}
      {screen==="generating" && (
        <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:20,padding:40}}>
          <TransportCarousel />
          <div style={{fontFamily:"'DM Serif Display',serif",fontSize:22,color:T.ink,textAlign:"center"}}>Building your itinerary…</div>
          {generateError
            ? <div style={{padding:"12px 16px",borderRadius:12,background:"#FFF0F0",border:"1.5px solid #e53e3e",fontSize:13,color:"#c53030",fontFamily:"Georgia,serif",textAlign:"center",maxWidth:300}}>
                ⚠️ {generateError}
              </div>
            : streamingDays > 0 && streamingTotal > 0 && streamingDays >= streamingTotal
            ? <div style={{fontSize:13,color:T.terra,fontFamily:"Georgia,serif",textAlign:"center",fontStyle:"italic"}}>Hold your breath…</div>
            : streamingDays > 0
            ? <div style={{fontSize:13,color:T.moss,fontFamily:"Georgia,serif",textAlign:"center",fontWeight:600}}>Day {streamingDays}{streamingTotal > 0 ? ` of ${streamingTotal}` : ""} planned ✓</div>
            : <div style={{fontSize:13,color:T.mist,fontFamily:"Georgia,serif",textAlign:"center"}}>Claude is planning real activities for your trip</div>
          }
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
            <SetupForm onGenerate={handleGenerate} initialTrip={editingTrip || (initialScreen==="setup" && initialTrip?.destination ? initialTrip : null)}/>
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
        <DebugContext.Provider value={debugMode}><>
          {/* Scrollable body — only visible in itinerary tab */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            style={{flex:1,overflowY:"auto",paddingBottom:80,display:activeBottomTab==="itinerary"?"block":"none"}}
          >
            {/* Header — scrolls away */}
            <div style={{background:`linear-gradient(160deg,${T.dusk},${T.ocean})`,padding:"28px 20px 20px",color:"white",position:"relative",overflow:"hidden"}}>
              <div style={{position:"absolute",top:-30,right:-30,width:130,height:130,borderRadius:"50%",background:"rgba(255,255,255,0.04)",pointerEvents:"none"}}/>
              <div style={{position:"relative",display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                <div style={{display:"flex",gap:8}}>
                  {onHome && <button onClick={onHome} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:20,padding:"4px 13px",color:"white",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>← Trips</button>}
                  <button onClick={()=>{ setEditingTrip(trip); setScreen("setup"); }} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:20,padding:"4px 13px",color:"white",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>Edit trip</button>
                </div>
                <button onClick={()=>setShowShare(true)} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:20,padding:"4px 13px",color:"white",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>📤 Share</button>
              </div>
              <div style={{fontFamily:"'DM Serif Display',serif",fontSize:24,lineHeight:1.2,marginBottom:4}}>{trip.name}</div>
              <div style={{fontSize:13,opacity:0.75,fontFamily:"Georgia,serif"}}>📅 {trip.dates || (trip.start_date && trip.end_date ? `${new Date(trip.start_date).toLocaleDateString("en-US",{month:"short",day:"numeric"})} – ${new Date(trip.end_date).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}` : "")}</div>
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

            {/* City-pill strip — based on hotel location, carried forward for non-hotel days */}
            {(() => {
              // Derive hotel city per day: use the day's city when it has a hotel activity,
              // carry forward the last known hotel city for day-trip / non-hotel days
              let lastHotelCity = days[0]?.city || "";
              const hotelCity = days.map(day => {
                if (day.activities.some(a => a.type === "hotel")) lastHotelCity = day.city;
                return lastHotelCity;
              });
              const allSameCity = hotelCity.every(c => c === hotelCity[0]);
              if (allSameCity) return null;
              const cityGroups = [];
              for (const [i, city] of hotelCity.entries()) {
                const last = cityGroups[cityGroups.length - 1];
                if (last && last.city === city) { last.lastIndex = i; }
                else cityGroups.push({ city, firstIndex: i, lastIndex: i });
              }
              return (
                <div style={{position:"sticky",top:0,zIndex:10,background:T.warm,borderBottom:`1px solid ${T.sand}`,padding:"8px 16px"}}>
                  <div ref={pillStrip} className="no-scrollbar" style={{display:"flex",gap:6,overflowX:"auto"}}>
                    {cityGroups.map((g, gi) => {
                      const active = activeDay >= g.firstIndex && activeDay <= g.lastIndex;
                      const dayRange = g.firstIndex === g.lastIndex
                        ? `Day ${g.firstIndex + 1}`
                        : `Day ${g.firstIndex + 1}–${g.lastIndex + 1}`;
                      return (
                        <button key={gi} onClick={()=>scrollToDay(g.firstIndex)} style={{
                          flexShrink:0,
                          display:"flex", alignItems:"center", gap:5,
                          padding:"5px 13px",
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
                          <span style={{fontWeight: active ? 700 : 500}}>{g.city.split(",")[0]}</span>
                          <span style={{opacity:0.75, fontSize:11}}>{dayRange}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {(() => {
              // Build hotel-per-day array: carry forward last seen hotel across days
              const hotelByCity = {};
              days.forEach(d => d.activities.forEach(a => { if (a.type === "hotel") hotelByCity[d.city] = a; }));
              // For each day, track which hotel the traveler is currently staying at
              let currentHotel = null;
              let currentHotelCity = null;
              const hotelPerDay = days.map(d => {
                const dayHotel = d.activities.find(a => a.type === "hotel");
                if (dayHotel) { currentHotel = dayHotel; currentHotelCity = d.city; }
                return { hotel: currentHotel, city: currentHotelCity };
              });

              return days.map((day, i) => {
                const firstIsHotel = day.activities[0]?.type === "hotel";
                const lastAct = day.activities[day.activities.length - 1];
                const lastIsHotel = lastAct?.type === "hotel";
                const prevDay = i > 0 ? days[i - 1] : null;
                const cityChanged = prevDay && prevDay.city !== day.city;

                // Start-of-day hotel: on city-change days use previous day's hotel
                const prevHotel = i > 0 ? hotelPerDay[i - 1] : null;
                const startHotel = cityChanged
                  ? (prevHotel?.hotel || null)
                  : (!firstIsHotel ? hotelPerDay[i]?.hotel || null : null);
                const startHotelCity = cityChanged ? prevHotel?.city : hotelPerDay[i]?.city;

                // End-of-day hotel: use current day's hotel (or carried-forward)
                const endHotel = !lastIsHotel && day.activities.length > 0
                  ? hotelPerDay[i]?.hotel || null
                  : null;

                return (
                  <div key={day.id} ref={el=>{ dayRefs.current[i]=el; }}>
                    <DaySection
                      day={day}
                      dayIndex={i}
                      onEditActivity={editActivity}
                      arrivalTime={i === 0 ? (trip.arrival_time || (trip.start_date ? `${trip.start_date}T12:00:00` : null)) : null}
                      arrivalMode={i === 0 ? (trip.arrival_mode || "flight") : null}
                      arrivalCity={i === 0 ? trip.arrival_city : null}
                      onEditFlight={i === 0 ? () => {
                        if (logisticsRef.current && scrollRef.current) {
                          scrollRef.current.scrollTop = logisticsRef.current.offsetTop;
                        }
                      } : undefined}
                      departureTime={i === days.length - 1 ? (trip.departure_time || (trip.end_date ? `${trip.end_date}T19:00:00` : null)) : null}
                      departureMode={i === days.length - 1 ? (trip.departure_mode || "flight") : null}
                      departureCity={i === days.length - 1 ? (trip.departure_city || null) : null}
                      onEditDeparture={i === days.length - 1 ? () => {
                        if (logisticsRef.current && scrollRef.current) {
                          scrollRef.current.scrollTop = logisticsRef.current.offsetTop;
                        }
                      } : undefined}
                      hotelActivity={startHotel}
                      hotelCity={startHotelCity}
                      endHotelActivity={endHotel}
                      displayCity={hotelPerDay[i]?.city || null}
                      flags={myFlags}
                      flagCounts={flagCounts}
                      onFlag={handleFlag}
                    />
                  </div>
                );
              });
            })()}
            <div ref={logisticsRef}>
              <LogisticsTab
                trip={trip}
                days={days}
                onSaveFlights={saveLogisticsFlights}
                onSaveHotels={saveLogisticsHotels}
                onApplyHotels={applyHotelsToItinerary}
              />
            </div>
            {tab==="collab" && (
              <CollabTab
                trip={trip}
                session={session}
                inviteRole={inviteRole}
                setInviteRole={setInviteRole}
                inviteLink={inviteLink}
                setInviteLink={setInviteLink}
                linkCopied={linkCopied}
                setLinkCopied={setLinkCopied}
              />
            )}
          </div>

          {/* ── BRAINSTORM TAB ── */}
          {activeBottomTab === "brainstorm" && import.meta.env.VITE_BRAINSTORM_ENABLED && (
            <BrainstormView trip={trip} session={session} />
          )}

          {/* ── CHAT TAB ── */}
          {activeBottomTab === "chat" && (
            <div style={{flex:1,display:"flex",flexDirection:"column",background:T.warm,overflow:"hidden"}}>
              {/* Chat header */}
              <div style={{background:`linear-gradient(135deg,${T.dusk},${T.ocean})`,padding:"14px 20px 12px",color:"white",flexShrink:0}}>
                <div style={{fontFamily:"'DM Serif Display',serif",fontSize:18,marginBottom:2}}>Chat</div>
                <div style={{fontSize:12,opacity:0.75,fontFamily:"Georgia,serif"}}>{trip.name}</div>
              </div>
              {/* Filter pills */}
              <div style={{display:"flex",gap:6,padding:"8px 16px",background:T.chalk,borderBottom:`1px solid ${T.sand}`,flexShrink:0}}>
                {[["all","All"],["group","Group"],["ai","AI ✨"]].map(([f,label])=>(
                  <button key={f} onClick={()=>setChatFilter(f)} style={{
                    padding:"4px 14px",borderRadius:20,border:"none",cursor:"pointer",
                    background:chatFilter===f?T.ocean:T.sand,
                    color:chatFilter===f?"white":T.mist,
                    fontSize:12,fontFamily:"Georgia,serif",transition:"background 0.15s",
                  }}>{label}</button>
                ))}
              </div>
              {/* Messages */}
              <div style={{flex:1,overflowY:"auto",padding:"16px 16px 8px",display:"flex",flexDirection:"column",gap:10}}>
                {filteredMessages.length === 0 && chatFilter !== "group" && (
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    {trip.summary && (
                      <div style={{display:"flex",justifyContent:"flex-start"}}>
                        <div style={{maxWidth:"90%",background:T.chalk,color:T.ink,borderRadius:"18px 18px 18px 4px",padding:"10px 14px",fontSize:13,fontFamily:"Georgia,serif",lineHeight:1.6,boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}>{trip.summary}</div>
                      </div>
                    )}
                    <div style={{display:"flex",flexDirection:"column",gap:8,padding:"4px 0"}}>
                      {["Make day 2 more food-focused","Add a beach day","Replace morning activities with something relaxing"].map(s=>(
                        <button key={s} onClick={()=>setChatInput(s)} style={{background:T.chalk,border:`1px solid ${T.sand}`,borderRadius:20,padding:"8px 14px",fontSize:12,fontFamily:"Georgia,serif",color:T.ink,cursor:"pointer",textAlign:"left"}}>"{s}"</button>
                      ))}
                    </div>
                  </div>
                )}
                {filteredMessages.length === 0 && chatFilter === "group" && (
                  <div style={{textAlign:"center",color:T.mist,fontFamily:"Georgia,serif",fontSize:13,paddingTop:40}}>
                    No group messages yet
                  </div>
                )}
                {filteredMessages.map((m,i)=>{
                  const isOwn = m.role==="user" && m.user_id===session.user.id;
                  const isAI = m.role==="assistant";
                  const isOther = m.role==="user" && m.user_id!==session.user.id;
                  return (
                    <div key={i} style={{display:"flex",flexDirection:"column",alignItems:isOwn?"flex-end":"flex-start"}}>
                      {isAI && (
                        <div style={{fontSize:11,color:T.ocean,fontFamily:"Georgia,serif",marginBottom:2,paddingLeft:4,fontWeight:600}}>✨ AI</div>
                      )}
                      {isOther && (
                        <div style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif",marginBottom:2,paddingLeft:4}}>{getMemberName(m.user_id)}</div>
                      )}
                      <div style={{
                        maxWidth:"80%",
                        background: isOwn ? T.ocean : isAI ? T.chalk : "#F0F4F0",
                        color: isOwn ? "white" : T.ink,
                        borderRadius: isOwn ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                        padding:"10px 14px",fontSize:13,fontFamily:"Georgia,serif",lineHeight:1.5,
                        boxShadow:"0 1px 4px rgba(0,0,0,0.06)",
                        borderLeft: isAI ? `3px solid ${T.ocean}` : "none",
                      }}>
                        {m.streaming && !m.content ? <span style={{color:T.mist,letterSpacing:2}}>···</span> : renderMentions(m.content||"")}
                        {m.streaming && m.content && <span style={{display:"inline-block",width:2,height:"1em",background:T.ink,marginLeft:2,verticalAlign:"text-bottom",animation:"blink 1s step-end infinite"}}/>}
                      </div>
                    </div>
                  );
                })}
                <div ref={chatBottomRef} />
              </div>
              {/* Mention picker */}
              {mentionSearch !== null && mentionOptions.length > 0 && (
                <div style={{background:T.chalk,border:`1px solid ${T.sand}`,borderRadius:12,margin:"0 12px 4px",overflow:"hidden",flexShrink:0,maxHeight:160,overflowY:"auto"}}>
                  {mentionOptions.map(opt=>(
                    <div key={opt.name} onMouseDown={e=>{e.preventDefault();selectMention(opt.name);}} style={{display:"flex",alignItems:"center",gap:8,padding:"9px 14px",cursor:"pointer",borderBottom:`1px solid ${T.sand}`,fontSize:13,fontFamily:"Georgia,serif",color:T.ink}}>
                      <span>{opt.icon}</span><span style={{color:T.ocean,fontWeight:600}}>@{opt.name}</span>
                    </div>
                  ))}
                </div>
              )}
              {/* Input */}
              <div style={{padding:"8px 12px",paddingBottom:"calc(8px + env(safe-area-inset-bottom, 0px))",background:T.chalk,borderTop:`1px solid ${T.sand}`,display:"flex",gap:8,flexShrink:0}}>
                <input
                  value={chatInput}
                  onChange={e=>{
                    setChatInput(e.target.value);
                    const match = e.target.value.match(/@(\w*)$/);
                    setMentionSearch(match ? match[1].toLowerCase() : null);
                  }}
                  onKeyDown={e=>{
                    if (e.key==="Escape") { setMentionSearch(null); return; }
                    if (e.key==="Enter" && mentionSearch===null) sendChatMessage();
                  }}
                  placeholder="Message… type @ to mention"
                  style={{flex:1,padding:"11px 14px",borderRadius:24,border:`1.5px solid ${T.sand}`,fontFamily:"Georgia,serif",fontSize:13,color:T.ink,outline:"none",background:T.warm}}
                />
                <button onClick={sendChatMessage} disabled={chatLoading||!chatInput.trim()} style={{width:44,height:44,borderRadius:"50%",background:chatInput.trim()?T.ocean:T.sand,color:"white",border:"none",fontSize:18,cursor:chatInput.trim()?"pointer":"default"}}>↑</button>
              </div>
            </div>
          )}

          {/* ── MAP TAB ── */}
          {activeBottomTab === "map" && (
            <MapView days={days} />
          )}

          {/* ── BOARD TAB ── */}
          {activeBottomTab === "board" && (
            <div style={{flex:1,overflowY:"auto",paddingBottom:80,display:"flex",flexDirection:"column"}}>
              <BoardView
                trip={trip}
                onSaveNotes={async (text) => {
                  setTrip(t => ({ ...t, board_notes: text }));
                  await supabase.from("trips").update({ board_notes: text }).eq("id", trip.id);
                }}
              />
            </div>
          )}

          {/* ── BOTTOM NAV ── */}
          <div style={{
            flexShrink:0,
            background:T.chalk,
            borderTop:`1px solid ${T.sand}`,
            display:"flex",
            paddingBottom:"env(safe-area-inset-bottom, 0px)",
          }}>
            {[
              ...(import.meta.env.VITE_BRAINSTORM_ENABLED ? [{ key:"brainstorm", icon:"💡", label:"Brainstorm" }] : []),
              { key:"itinerary", icon:"🗓", label:"Itinerary" },
              { key:"chat",      icon:"💬", label:"Chat" },
              { key:"map",       icon:"🗺", label:"Map" },
              { key:"board",     icon:"📋", label:"Board" },
            ].map(({ key, icon, label }) => {
              const active = activeBottomTab === key;
              return (
                <button key={key} onClick={()=>setActiveBottomTab(key)} style={{
                  flex:1,
                  display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
                  gap:3,
                  padding:"10px 0 8px",
                  border:"none",
                  background:"none",
                  cursor:"pointer",
                  color: active ? T.ocean : T.mist,
                  transition:"color 0.15s",
                  position:"relative",
                }}>
                  {active && <div style={{position:"absolute",top:0,left:"50%",transform:"translateX(-50%)",width:32,height:2.5,borderRadius:"0 0 2px 2px",background:T.ocean}}/>}
                  <span style={{fontSize:20}}>{icon}</span>
                  <span style={{fontSize:10,fontFamily:"'Inter','Segoe UI',sans-serif",fontWeight: active ? 600 : 400,letterSpacing:0.3}}>{label}</span>
                </button>
              );
            })}
          </div>

          {/* ── SHARE CARD (hidden, used for image capture) ── */}
          <div style={{position:"fixed",left:"-9999px",top:0,zIndex:-1}}>
            <div ref={shareCardRef} style={{
              width:390,background:"linear-gradient(160deg,#1E2D3D,#2563A8)",
              padding:"36px 32px 28px",fontFamily:"Georgia,serif",color:"white",
            }}>
              <div style={{fontSize:13,letterSpacing:3,opacity:0.6,textTransform:"uppercase",marginBottom:12}}>TripJam</div>
              <div style={{fontFamily:"'DM Serif Display',serif",fontSize:26,lineHeight:1.2,marginBottom:6}}>{trip.name}</div>
              <div style={{fontSize:13,opacity:0.7,marginBottom:4}}>📍 {trip.destination}</div>
              <div style={{fontSize:13,opacity:0.7,marginBottom:24}}>
                📅 {trip.start_date && trip.end_date
                  ? `${new Date(trip.start_date).toLocaleDateString("en-US",{month:"short",day:"numeric"})} – ${new Date(trip.end_date).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}`
                  : trip.dates || ""}
              </div>
              <div style={{borderTop:"1px solid rgba(255,255,255,0.2)",paddingTop:20,display:"flex",flexDirection:"column",gap:14}}>
                {days.map(day => (
                  <div key={day.id}>
                    <div style={{fontSize:11,letterSpacing:2,opacity:0.5,textTransform:"uppercase",marginBottom:5}}>{day.label} · {day.city}</div>
                    <div style={{display:"flex",flexDirection:"column",gap:3}}>
                      {day.activities.map((a,i) => (
                        <div key={i} style={{fontSize:13,opacity:0.85}}>{a.icon} {a.title}</div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{marginTop:24,borderTop:"1px solid rgba(255,255,255,0.15)",paddingTop:16,fontSize:11,opacity:0.4,textAlign:"center",letterSpacing:1}}>MADE WITH TRIPJAM</div>
            </div>
          </div>

          {/* ── SHARE SHEET ── */}
          {showShare && (
            <div onClick={()=>setShowShare(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:200,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
              <div onClick={e=>e.stopPropagation()} style={{background:T.chalk,borderRadius:"20px 20px 0 0",padding:"24px 20px 36px",width:"100%",maxWidth:430}}>
                <div style={{fontFamily:"'DM Serif Display',serif",fontSize:18,color:T.ink,marginBottom:4}}>Share trip</div>
                <div style={{fontSize:13,color:T.mist,fontFamily:"Georgia,serif",marginBottom:20}}>{trip.name}</div>
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  <button onClick={async()=>{
                    setShowShare(false);
                    await new Promise(r=>setTimeout(r,100));
                    const canvas = await html2canvas(shareCardRef.current,{scale:2,useCORS:true,backgroundColor:null});
                    canvas.toBlob(async blob=>{
                      const file = new File([blob],"tripjam.png",{type:"image/png"});
                      if(navigator.share && navigator.canShare?.({files:[file]})){
                        await navigator.share({files:[file],title:trip.name});
                      } else {
                        const a = document.createElement("a");
                        a.href = URL.createObjectURL(blob);
                        a.download = `${trip.name}.png`;
                        a.click();
                      }
                    },"image/png");
                  }} style={{display:"flex",alignItems:"center",gap:14,padding:"14px 16px",borderRadius:14,border:`1.5px solid ${T.sand}`,background:"white",cursor:"pointer",fontFamily:"Georgia,serif",fontSize:14,color:T.ink,fontWeight:600}}>
                    <span style={{fontSize:24}}>🖼</span>
                    <div style={{textAlign:"left"}}>
                      <div>Share as image</div>
                      <div style={{fontSize:11,color:T.mist,fontWeight:400}}>PNG card with your full itinerary</div>
                    </div>
                  </button>
                  <button onClick={()=>{
                    const text = [
                      `✈️ ${trip.name}`,
                      `${trip.destination}`,
                      trip.start_date && trip.end_date ? `${new Date(trip.start_date).toLocaleDateString("en-US",{month:"short",day:"numeric"})} – ${new Date(trip.end_date).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}` : "",
                      "",
                      ...days.flatMap(day=>[
                        `${day.label} · ${day.city}`,
                        ...day.activities.map(a=>`  ${a.icon} ${a.title}`),
                        "",
                      ]),
                      "Planned with TripJam",
                    ].filter(l=>l!==undefined).join("\n");
                    navigator.clipboard.writeText(text);
                    setShowShare(false);
                  }} style={{display:"flex",alignItems:"center",gap:14,padding:"14px 16px",borderRadius:14,border:`1.5px solid ${T.sand}`,background:"white",cursor:"pointer",fontFamily:"Georgia,serif",fontSize:14,color:T.ink,fontWeight:600}}>
                    <span style={{fontSize:24}}>📋</span>
                    <div style={{textAlign:"left"}}>
                      <div>Copy as text</div>
                      <div style={{fontSize:11,color:T.mist,fontWeight:400}}>Paste into WhatsApp, Notes, anywhere</div>
                    </div>
                  </button>
                  <button onClick={async()=>{
                    let token = trip.share_token;
                    if (!token) {
                      // Generate a new share token
                      const { data } = await supabase
                        .from("trips").update({ share_token: crypto.randomUUID() })
                        .eq("id", trip.id).select("share_token").single();
                      token = data?.share_token;
                      if (token) setTrip(t => ({ ...t, share_token: token }));
                    }
                    if (!token) return;
                    const url = `${window.location.origin}/trip/${token}`;
                    if (navigator.share) {
                      await navigator.share({ title: trip.name, text: `Check out our trip: ${trip.name}`, url });
                    } else {
                      await navigator.clipboard.writeText(url);
                      alert("Link copied!");
                    }
                    setShowShare(false);
                  }} style={{display:"flex",alignItems:"center",gap:14,padding:"14px 16px",borderRadius:14,border:`1.5px solid ${T.sand}`,background:"white",cursor:"pointer",fontFamily:"Georgia,serif",fontSize:14,color:T.ink,fontWeight:600}}>
                    <span style={{fontSize:24}}>🔗</span>
                    <div style={{textAlign:"left"}}>
                      <div>Share link</div>
                      <div style={{fontSize:11,color:T.mist,fontWeight:400}}>Anyone with the link can view this trip</div>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          )}

        </></DebugContext.Provider>
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
              <div style={{fontSize:13,color:T.mist,fontFamily:"Georgia,serif",marginBottom:20}}>Helps plan Day 1 and last day around your flights</div>
              <div style={{display:"flex",gap:12,marginBottom:20}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,color:T.mist,fontFamily:"Georgia,serif",marginBottom:4}}>Landing time (Day 1)</div>
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


          </div>
        </div>
      )}
    </div>
  );
}
