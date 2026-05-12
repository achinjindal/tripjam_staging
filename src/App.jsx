import { useState, useRef, useEffect, useCallback, createContext, useContext, Fragment, Component } from "react";
import posthog from "posthog-js";
import { supabase } from "./supabase";
import BoardView, { LogisticsTab } from "./components/BoardView.jsx";
import SetupForm from "./components/SetupForm.jsx";
import { T, RADIUS, SHADOW, MOTION, PLACES_PROXY, PLACES_HEADERS } from "./theme";
import { _photoCache, _usedPhotoUrls, _fetchPhoto, setActiveTripId, setTripDestination, extractPlace, geocodePlace, haversineMeters } from "./photos";
import { MapView, RouteMapView } from "./components/MapView.jsx";
import { DestinationHero, FoodSpotlightCard, CityCard, MagazineHighlightCard, HotelSuggestionCard } from "./components/Magazine.jsx";

// ── Error Boundary ──
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err) { console.error("ErrorBoundary caught:", err); posthog.capture("render_error", { error: err.message }); }
  render() {
    if (this.state.hasError) return (
      <div style={{padding:"40px 24px",textAlign:"center",fontFamily:"Georgia,serif"}}>
        <div style={{fontSize:36,marginBottom:12}}>😵</div>
        <div style={{fontSize:16,color:"#1A2B3C",marginBottom:8,fontFamily:"'DM Serif Display',serif"}}>Something went wrong</div>
        <div style={{fontSize:13,color:"#8BA5BB",marginBottom:16}}>Try refreshing the page</div>
        <button onClick={()=>{ this.setState({ hasError: false }); window.location.reload(); }} style={{padding:"10px 20px",borderRadius:RADIUS.lg,border:"none",background:"#2563A8",color:"white",fontFamily:"Georgia,serif",fontSize:13,cursor:"pointer"}}>Refresh</button>
      </div>
    );
    return this.props.children;
  }
}
import html2canvas from "html2canvas";

const DebugContext = createContext(false);


// _rgInFlight removed — generate() is now called imperatively, not via useEffect
let _igInFlight = false;  // same for IG // prevent same photo showing on multiple activities


function PhotoStrip({ activity, city }) {
  const debugMode = useContext(DebugContext);
  const stored = activity?.photo_url;
  // Use place name for photo search, not geocode (which may be a street address like "Akácfa utca 47")
  const geocode = extractPlace(activity?.title || "") || activity?.geocode;
  const [liveUrl, setLiveUrl] = useState(stored ? null : undefined);
  const [broken, setBroken] = useState(false);
  const [coords, setCoords] = useState(null);
  const [visible, setVisible] = useState(false);
  const ref = useRef(null);

  // Only fetch when the card scrolls into view
  useEffect(() => {
    if (stored && !broken) return;
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); obs.disconnect(); }
    }, { rootMargin: "200px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [stored, broken]);

  useEffect(() => {
    if ((stored && !broken) || !visible) return;
    if (!geocode) { setLiveUrl(null); return; }
    const isHotel = activity?.type === "hotel";
    const key = `${geocode}||${city || ""}`;
    if (_photoCache[key] !== undefined) {
      const cached = _photoCache[key];
      // Hotels bypass the dedup — same hotel can appear in suggestion + itinerary
      if (!isHotel && cached && _usedPhotoUrls.has(cached)) { setLiveUrl(null); return; }
      if (cached && !isHotel) _usedPhotoUrls.add(cached);
      setLiveUrl(cached);
      return;
    }
    let cancelled = false;
    _fetchPhoto(geocode, city, activity?.type).then(src => {
      if (cancelled) return;
      if (src) {
        if (!isHotel) _usedPhotoUrls.add(src);
        if (activity?.id && !String(activity.id).startsWith("c-")) supabase.from("activities").update({ photo_url: src }).eq("id", activity.id).then();
      }
      _photoCache[key] = src ?? null;
      setLiveUrl(src ?? null);
    });
    return () => { cancelled = true; };
  }, [stored, broken, visible, geocode, city]);

  useEffect(() => {
    if (!debugMode || !geocode) return;
    geocodePlace(geocode, city, activity?.geocode).then(c => setCoords(c));
  }, [debugMode, geocode, city]);

  const url = (!broken && stored) || liveUrl;
  if (url === undefined) return (
    <div ref={ref} style={{marginTop:10,height:130,borderRadius:RADIUS.md,background:T.sand,animation:"shimmer 1.5s ease-in-out infinite"}}/>
  );
  if (!url) {
    if (!debugMode) return null;
    return (
      <div style={{marginTop:8,padding:"4px 8px",borderRadius:RADIUS.sm,background:T.errorLight,border:`1px solid ${T.errorBorder}`,fontSize:10,color:T.error,fontFamily:"monospace"}}>
        ✗ no photo — "{activity?.geocode || activity?.title}"
      </div>
    );
  }
  return (
    <div style={{marginTop:10,borderRadius:RADIUS.md,overflow:"hidden",height:130,background:T.sand,position:"relative"}}>
      <img src={url} alt={geocode} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}} onError={() => { if (!broken) { setBroken(true); setLiveUrl(undefined); } }}/>
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

function playChime(short = false) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = short ? [523.25, 783.99] : [523.25, 659.25, 783.99, 1046.50]; // short: C5 G5, full: C5 E5 G5 C6
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
function playDoneChime() { playChime(false); }



const BRAINSTORM_CATEGORIES = ["All", "Sightseeing", "Dining", "Experiences", "Nightlife", "Nature", "Culture", "Shopping", "Day Trip"];
const BRAINSTORM_CATEGORY_ICONS = { Sightseeing:"🏛️", Dining:"🍜", Experiences:"🎭", Nightlife:"🍸", Nature:"🌿", Culture:"🎨", Shopping:"🛍️", "Day Trip":"🚌" };

function RouteCard({ item, vs, onVote, interactive, showRecommended = true, routeLabel = null, compact = false, onDismiss = null, onModify = null, onTellMore = null, onShowMap = null }) {
  const selected = interactive ? vs.mine === 1 : (item.selected === true || vs.mine === 1);
  const hasError = !!item._error;

  // Compact mode: just label, icon, title, tagline — for 2-column grid
  if (compact) {
    return (
      <div onClick={interactive ? onVote : undefined} style={{
        background: hasError ? T.errorLight : selected ? `linear-gradient(135deg, ${T.ocean}12, ${T.dusk}08)` : T.chalk,
        borderRadius: RADIUS.lg, padding: "12px 12px 10px",
        border: `2px solid ${hasError ? T.error : selected ? T.ocean : T.sand}`,
        cursor: interactive ? "pointer" : "default",
        position: "relative", flex: 1, minWidth: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {routeLabel && <span style={{background:T.dusk,color:"white",fontSize:9,fontFamily:"Georgia,serif",fontWeight:700,borderRadius:5,padding:"1px 6px",letterSpacing:0.5}}>{routeLabel}</span>}
            {item.recommended && showRecommended && <span style={{fontSize:9,fontFamily:"Georgia,serif",fontWeight:600,color:T.warning,background:T.warningLight,borderRadius:RADIUS.md,padding:"1px 5px"}}>★</span>}
          </div>
          {interactive && (
            <div style={{width:18,height:18,borderRadius:"50%",border:`2px solid ${selected?T.ocean:T.sand}`,background:selected?T.ocean:"transparent",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontSize:9,fontWeight:700,flexShrink:0}}>{selected && "✓"}</div>
          )}
        </div>
        <div style={{ fontSize: 18, marginBottom: 4 }}>{item.icon}</div>
        <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 13, color: T.ink, lineHeight: 1.2, marginBottom: 3 }}>{item.title}</div>
        {item.tagline && <div style={{ fontSize: 10, color: T.ocean, fontFamily: "Georgia,serif", lineHeight: 1.3 }}>{item.tagline}</div>}
        {item.bestFor && <div style={{ fontSize: 9, color: T.success, fontFamily: "Georgia,serif", marginTop: 4 }}>✓ {item.bestFor}</div>}
      </div>
    );
  }

  // Full mode: expanded card with all details
  return (
    <div onClick={interactive ? onVote : undefined} style={{
      background: hasError ? T.errorLight : selected ? `linear-gradient(135deg, ${T.moss}08, ${T.moss}04)` : T.chalk,
      borderRadius: RADIUS.lg, padding: "14px 16px",
      border: `2px solid ${hasError ? T.error : selected ? T.moss : T.sand}`,
      position: "relative",
      cursor: interactive ? "pointer" : "default",
    }}>
      {/* Header row — route label inline with title */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 24, flexShrink: 0, marginTop: 1 }}>{item.icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
            {routeLabel && <span style={{background:T.dusk,color:"white",fontSize:9,fontFamily:"Georgia,serif",fontWeight:600,borderRadius:4,padding:"1px 5px",letterSpacing:0.3,flexShrink:0,opacity:0.8}}>{routeLabel}</span>}
            <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 16, color: T.ink, lineHeight: 1.2 }}>{item.title}</div>
          </div>
          {item.recommended && showRecommended && (
            <div style={{ marginTop: 2 }}>
              <span style={{ fontSize: 10, fontFamily: "Georgia,serif", fontWeight: 600, color: T.warning, background: T.warningLight, borderRadius: RADIUS.full, padding: "1px 7px" }}>
                ★ Recommended
              </span>
            </div>
          )}
        </div>
        {!interactive && selected && (
          <span style={{ fontSize: 11, color: T.moss, background: T.successLight, borderRadius: RADIUS.full, padding: "2px 9px", fontFamily: "Georgia,serif", fontWeight: 600, flexShrink: 0 }}>
            ✓ Selected
          </span>
        )}
      </div>
      {/* Day-by-day outline */}
      {item.days?.length > 0 && (
        <div style={{ marginBottom: 10, paddingLeft: 4 }}>
          {item.days.map((d, i) => {
            const text = typeof d === "string" ? d : (d?.description || d?.text || d?.day || d?.title || "");
            if (!text) return null;
            return (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 4 }}>
                <div style={{ fontSize: 10, color: T.mist, fontFamily: "Georgia,serif", fontWeight: 600, minWidth: 38, marginTop: 1 }}>Day {i + 1}</div>
                <div style={{ fontSize: 12, color: T.ink, fontFamily: "Georgia,serif", lineHeight: 1.4 }}>{text.split(/\*\*(.+?)\*\*/).map((part, j) => j % 2 === 1 ? <strong key={j}>{part}</strong> : part)}</div>
              </div>
            );
          })}
        </div>
      )}
      {/* Salient points */}
      {item.points?.length > 0 && (
        <div style={{ marginBottom: 10, borderTop: `1px solid ${selected ? T.ocean + "33" : T.sand}`, paddingTop: 8 }}>
          {item.points.map((pt, i) => {
            let text = typeof pt === "string" ? pt : (typeof pt?.text === "string" ? pt.text : JSON.stringify(pt));
            text = text.replace(/^[\s]*[✓✗•\-—]+[\s]*/, "").trim();
            const good = typeof pt === "object" ? pt.good : true;
            return (
              <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start", marginBottom: 3 }}>
                <span style={{ fontSize: 10, color: good === false ? T.warning : T.ocean, marginTop: 2, flexShrink: 0 }}>
                  {good === false ? "✗" : "✓"}
                </span>
                <span style={{ fontSize: 11, color: T.ink, fontFamily: "Georgia,serif", lineHeight: 1.4 }}>{text}</span>
              </div>
            );
          })}
        </div>
      )}
      {/* Footer badges */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {item.bestFor && (
          <span style={{ fontSize: 11, color: T.success, fontFamily: "Georgia,serif", background: T.successLight, borderRadius: RADIUS.full, padding: "2px 9px" }}>
            ✓ {item.bestFor}
          </span>
        )}
        {item.warning && (
          <span style={{ fontSize: 11, color: T.warning, fontFamily: "Georgia,serif", background: T.warningLight, borderRadius: RADIUS.full, padding: "2px 9px" }}>
            ⚠ {item.warning}
          </span>
        )}
      </div>
      {/* Error banner */}
      {hasError && (
        <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: RADIUS.md, background: T.errorLight, border: `1px solid ${T.errorBorder}`, fontSize: 12, color: T.error, fontFamily: "Georgia,serif" }}>
          ⚠ {item._error} — try editing this plan again in chat
        </div>
      )}
      {/* Action buttons */}
      {interactive && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
          <button onClick={(e) => { e.stopPropagation(); onVote?.(); }} style={{
            padding: "7px 18px", borderRadius: RADIUS.md, border: "none",
            background: selected ? T.moss : T.ocean,
            color: "white", fontFamily: "Georgia,serif", fontSize: 12, fontWeight: 600,
            cursor: "pointer",
          }}>
            {selected ? "✓ Selected" : "Select"}
          </button>
          {onModify && (
            <button onClick={(e) => { e.stopPropagation(); onModify(); }} style={{
              padding: "7px 12px", borderRadius: RADIUS.md, border: "none",
              background: "none", color: T.ocean, fontFamily: "Georgia,serif", fontSize: 12,
              cursor: "pointer",
            }}>Modify</button>
          )}
          {onDismiss && (
            <button onClick={(e) => { e.stopPropagation(); onDismiss(); }} style={{
              padding: "7px 12px", borderRadius: RADIUS.md, border: "none",
              background: "none", color: T.mist, fontFamily: "Georgia,serif", fontSize: 12,
              cursor: "pointer",
            }}>
              Dismiss this plan
            </button>
          )}
        </div>
      )}
      {/* Explore buttons — always shown in full mode */}
      {!compact && (onTellMore || onShowMap) && (
        <div style={{ display: "flex", gap: 6, marginTop: interactive ? 6 : 10, paddingTop: 6, borderTop: `1px solid ${T.sand}` }}>
          {onTellMore && (
            <button onClick={(e) => { e.stopPropagation(); onTellMore(); }} style={{
              flex: 1, padding: "7px 0", borderRadius: RADIUS.md, border: `1.5px solid ${T.sand}`,
              background: "transparent", color: T.ocean, fontFamily: "Georgia,serif", fontSize: 11, fontWeight: 500,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
            }}>📖 Tell me more</button>
          )}
          {onShowMap && (
            <button onClick={(e) => { e.stopPropagation(); onShowMap(); }} style={{
              flex: 1, padding: "7px 0", borderRadius: RADIUS.md, border: `1.5px solid ${T.sand}`,
              background: "transparent", color: T.ocean, fontFamily: "Georgia,serif", fontSize: 11, fontWeight: 500,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
            }}>🗺 Show on map</button>
          )}
        </div>
      )}
    </div>
  );
}

function BrainstormView({ trip, session, pendingForm, onBuild, onBack, onEditForm = null, onOpenChat = null, onDismissRoute = null, onModifyRoute = null, undoDismissRef = null, triggerGenerateRef = null, days = [], onItemsChange, onSelectionChange, externalSelectedId, externalRoutes, editTripId = null, onTellMore = null, onShowMap = null, onAskTrippy = null }) {
  const [items, setItems] = useState(null); // null = not started, [] = empty, [...] = loaded
  const [loadingItems, setLoadingItems] = useState(false);
  const [localVotes, setLocalVotes] = useState({}); // { [tempId]: 1|-1|0 } — pre-trip mode votes
  const [generating, setGenerating] = useState(false);
  const [activeCategory, setActiveCategory] = useState("All");
  const [genError, setGenError] = useState(null);
  const [ideaCount, setIdeaCount] = useState(12);
  const [deepDiveCity, setDeepDiveCity] = useState(null); // city name when deep dive is open
  const [deepDiveCache, setDeepDiveCache] = useState({}); // { [city]: { foodSpecialties, weather, ... } | "loading" | "error" }
  const routeCardRefs = useRef({}); // { [routeId]: HTMLElement } for scroll-into-view
  const editTripIdRef = useRef(editTripId); // track latest for async generate()
  editTripIdRef.current = editTripId;

  // Fun counter: climbs from 12 to an absurd number while generating.
  // Stops once the routes are visibly present even if the stream hasn't formally closed.
  const routesReady = !generating && (items || []).filter(it => it.tier === 1 && !it.dismissed).length > 0;

  // Expose undo-dismiss function to parent via ref
  useEffect(() => {
    if (undoDismissRef) {
      undoDismissRef.current = (routeId) => {
        setItems(prev => (prev || []).map(it => it.id === routeId ? { ...it, dismissed: false } : it));
        if (routeId && !String(routeId).startsWith("temp_")) {
          supabase.from("brainstorm_items").update({ dismissed: false }).eq("id", routeId);
        }
      };
    }
  });
  useEffect(() => {
    if (!generating || routesReady) { setIdeaCount(12); return; }
    const id = setInterval(() => {
      setIdeaCount(prev => Math.round(prev * (1.08 + Math.random() * 0.10)));
    }, 600);
    return () => clearInterval(id);
  }, [generating, routesReady]);

  const isPretripMode = !trip?.id;
  const igReq = pendingForm || trip?.ig_request || {};
  const destinations = igReq.destinations?.length
    ? igReq.destinations
    : (trip?.destination || "").split(" → ").map(s => s.trim()).filter(Boolean);

  useEffect(() => {
    if (editTripId) {
      setLoadingItems(true);
      loadSavedBrainstorm(editTripId).finally(() => setLoadingItems(false));
    } else if (trip?.id) {
      setLoadingItems(true);
      loadItems().finally(() => setLoadingItems(false));
    }
  }, [trip?.id, editTripId]);

  // Expose generate() to parent via ref — parent calls it imperatively, not via useEffect
  useEffect(() => {
    if (triggerGenerateRef) {
      triggerGenerateRef.current = (opts) => { if (destinations.length) generate(opts?.addMore ?? false); };
    }
  });

  async function loadCityDeepDive(city) {
    if (!city) return;
    const existing = deepDiveCache[city];
    if (existing && existing !== "error") return; // cached or loading
    setDeepDiveCache(prev => ({ ...prev, [city]: "loading" }));
    try {
      const travelMonth = trip?.start_date ? new Date(trip.start_date).toLocaleString("en-US", { month: "long" }) : null;
      const igReq = trip?.ig_request || {};
      const tripDays = (days || []).filter(d => (d.city || "").toLowerCase() === city.toLowerCase()).length;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/city-deep-dive`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({
          city,
          country: trip?.destination || null,
          travelMonth,
          styles: igReq.styles,
          budget: igReq.budget,
          notes: igReq.notes || trip?.notes || null,
          tripDays,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDeepDiveCache(prev => ({ ...prev, [city]: data }));
    } catch (e) {
      console.warn("city-deep-dive failed:", e.message);
      setDeepDiveCache(prev => ({ ...prev, [city]: "error" }));
    }
  }

  async function loadSavedBrainstorm(tripId) {
    const { data } = await supabase
      .from("brainstorm_items")
      .select("*")
      .eq("trip_id", tripId)
      .order("position");
    const flattened = (data || []).map(row => {
      const merged = { ...row, ...(row.data || {}) };
      // Normalize days — coerce {day, description} or other object shapes back to plain strings
      if (Array.isArray(merged.days)) {
        merged.days = merged.days.map(d => typeof d === "string" ? d : (d?.description || d?.text || d?.day || "")).filter(Boolean);
      }
      // Normalize points — ensure each has {text, good}
      if (Array.isArray(merged.points)) {
        merged.points = merged.points.map(p => ({
          text: typeof p === "string" ? p : (typeof p?.text === "string" ? p.text : ""),
          good: typeof p === "object" ? p.good : true,
        })).filter(p => p.text);
      }
      return merged;
    });
    // If no saved routes, show empty state — user can click "Show me more plans"
    // Assign stable route labels if missing
    let labelCounter = 0;
    const labeled = flattened.map(it => {
      if (it.tier === 1 && !it.routeLabel) return { ...it, routeLabel: `P${++labelCounter}` };
      if (it.tier === 1 && it.routeLabel) { labelCounter = Math.max(labelCounter, parseInt(it.routeLabel.replace("R","")) || 0); }
      return it;
    });
    setItems(labeled);
    const previouslySelected = labeled.find(it => it.tier === 1 && !it.dismissed && it.selected);
    if (previouslySelected) {
      setLocalVotes({ [previouslySelected.id]: 1 });
    }
  }

  async function loadItems() {
    if (!trip?.id) return;
    const { data } = await supabase
      .from("brainstorm_items")
      .select("*")
      .eq("trip_id", trip.id)
      .order("position");
    // Flatten the jsonb data field back into the item for rendering
    const flattened = (data || []).map(row => ({ ...row, ...(row.data || {}) }));
    setItems(flattened);
  }

  const isAddingMore = useRef(false);
  const rgInFlight = useRef(false);
  async function generate(addMore = false) {
    if (!destinations.length) return;
    if (rgInFlight.current) return;
    rgInFlight.current = true;
    isAddingMore.current = addMore;
    setGenerating(true);
    setGenError(null);
    if (!addMore) { setItems([]); setLocalVotes({}); }
    try {
      const travelMonth = igReq.startDate ? new Date(igReq.startDate).toLocaleString("en-US", { month: "long" }) : null;
      const numDays = (igReq.startDate && igReq.endDate)
        ? Math.max(1, Math.round((new Date(igReq.endDate) - new Date(igReq.startDate)) / (1000*60*60*24)) + 1)
        : null;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-brainstorm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({
          destinations, styles: igReq.styles, budget: igReq.budget, travelMonth, numDays,
          arrivalCity: igReq.arrivalCity || null, departureCity: igReq.departureCity || null,
          notes: igReq.notes || null,
          existingPlans: addMore ? (items || []).filter(it => it.tier === 1).map(it => it.title) : null,
          baseLocation: igReq.baseLocation || null,
          numPlans: addMore ? Math.min(4, 12 - (items || []).filter(it => it.tier === 1 && !it.dismissed).length) : 4,
        }),
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
      let tempIdCounter = 0;

      const tryParseItem = (chunk) => {
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
                    const existingTier1 = isAddingMore.current ? (items || []).filter(it => it.tier === 1 && !it.dismissed).length : 0;
                    const streamedTier1 = streamedItems.filter(s => s.tier === 1).length;
                    const labelNum = existingTier1 + streamedTier1 + 1;
                    const itemWithId = isPretripMode ? { ...item, id: `temp_${tempIdCounter++}`, routeLabel: item.tier === 1 ? `P${labelNum}` : undefined } : item;
                    streamedItems.push(itemWithId);
                    if (isAddingMore.current) {
                      setItems(prev => {
                        // Filter by title to prevent duplicates (temp IDs won't match UUIDs)
                        const newTitles = new Set(streamedItems.map(s => s.title?.toLowerCase()).filter(Boolean));
                        const existing = (prev || []).filter(p => !newTitles.has(p.title?.toLowerCase()));
                        return [...existing, ...streamedItems];
                      });
                    } else {
                      setItems(prev => {
                        // Keep any non-tier1 items from prev (tier2 etc.) + new streamed items
                        const kept = (prev || []).filter(p => p.tier !== 1 && !streamedItems.some(s => s.id === p.id));
                        return [...kept, ...streamedItems];
                      });
                    }
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

      const targetTripId = trip?.id || editTripIdRef.current;
      if (targetTripId) {
        let startPos = 0;
        if (isAddingMore.current) {
          const { data: existingItems } = await supabase.from("brainstorm_items").select("position").eq("trip_id", targetTripId).order("position", { ascending: false }).limit(1);
          startPos = (existingItems?.[0]?.position ?? -1) + 1;
        } else {
          await supabase.from("brainstorm_items").delete().eq("trip_id", targetTripId);
        }
        const rows = streamedItems.map((item, i) => ({
          trip_id: targetTripId, title: item.title, city: item.city || null,
          category: item.category || "Route", note: item.tagline || null,
          icon: item.icon || null, geocode: item.geocode || null,
          position: startPos + i, tier: item.tier || 2,
          data: { tagline: item.tagline, days: item.days, bestFor: item.bestFor, warning: item.warning, recommended: !!item.recommended, points: item.points, routeLabel: item.routeLabel || null },
        }));
        const { data, error: insertErr } = await supabase.from("brainstorm_items").insert(rows).select();
        if (insertErr) console.warn("Failed to save brainstorm items:", insertErr);
        // Replace/merge items with DB rows (they have real UUIDs now)
        const saved = (data || []).map(row => ({ ...row, ...(row.data || {}) }));
        if (saved.length) {
          if (isAddingMore.current) {
            // Append new items — dedup by title AND id to prevent duplicates
            const savedTitles = new Set(saved.map(s => s.title?.toLowerCase()).filter(Boolean));
            setItems(prev => [...(prev || []).filter(it => !saved.some(s => s.id === it.id) && !savedTitles.has(it.title?.toLowerCase())), ...saved]);
          } else {
            setItems(saved);
          }
        }
      } else {
        // No DB — keep streamed items as-is (already set during streaming)
      }
    } catch (e) {
      console.error("Brainstorm generate error:", e);
      setGenError(e.message);
    }
    setGenerating(false);
    rgInFlight.current = false;
  }

  function castVote(itemId, value) {
    const item = (items || []).find(it => it.id === itemId);
    if (item?.tier === 1) {
      posthog.capture("route_selected", { route: item?.title });
      // Route cards: single-select — selecting one deselects all others
      setLocalVotes(prev => {
        const next = { ...prev };
        tier1Items.forEach(it => { next[it.id] = 0; });
        next[itemId] = prev[itemId] === 1 ? 0 : 1;
        return next;
      });
    } else {
      setLocalVotes(prev => ({ ...prev, [itemId]: prev[itemId] === value ? 0 : value }));
    }
  }

  const getVoteState = (itemId) => {
    const mine = localVotes[itemId] || 0;
    return { up: mine === 1 ? 1 : 0, down: mine === -1 ? 1 : 0, mine };
  };

  const handleBuild = () => {
    if (!onBuild) return;
    const voted = (items || []).map(item => ({
      ...item,
      vote: localVotes[item.id] || 0,
    }));
    onBuild(voted);
  };

  const tier1Items = (items || []).filter(it => it.tier === 1 && !it.dismissed).slice(0, 12);
  const tier2Items = (items || []).filter(it => (it.tier || 2) === 2 && !it.dismissed);
  const visibleTier2 = tier2Items.filter(it => activeCategory === "All" || it.category === activeCategory);

  // Notify parent when tier 1 routes change (for external map / chat consumers)
  useEffect(() => { onItemsChange?.(tier1Items); }, [tier1Items.length, tier1Items.map(it => it.id).join("|")]);

  // Notify parent of selected route id (derived from localVotes in pre-trip mode)
  useEffect(() => {
    if (!isPretripMode) return;
    const selected = tier1Items.find(it => (localVotes[it.id] || 0) === 1);
    onSelectionChange?.(selected?.id || null);
  }, [localVotes, tier1Items.map(it => it.id).join("|")]);
  // Scroll the selected route card into view when external selection changes (e.g. after chat mutation)
  useEffect(() => {
    if (!externalSelectedId) return;
    // Small delay so the DOM has rendered with the updated selection
    setTimeout(() => {
      const el = routeCardRefs.current[externalSelectedId];
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
  }, [externalSelectedId]);

  // Sync back: when external routes change (e.g. chat mutation), merge into items by id
  const lastExternalRoutesSigRef = useRef(null);
  useEffect(() => {
    if (!externalRoutes || externalRoutes.length === 0) return;
    const sig = externalRoutes.map(r => `${r.id}|${r.title || ""}|${r.tagline || ""}|${r.city || ""}|${r.bestFor || ""}|${r.warning || ""}|${r.recommended ? 1 : 0}|${(r.days || []).map(d => typeof d === "string" ? d : JSON.stringify(d)).join("~")}|${(r.points || []).map(p => `${p.text || ""}:${p.good}`).join("~")}`).join(",");
    if (sig === lastExternalRoutesSigRef.current) return;
    lastExternalRoutesSigRef.current = sig;
    setItems(prev => (prev || []).map(it => {
      if (it.tier !== 1) return it;
      const match = externalRoutes.find(er => er.id === it.id);
      if (!match) return it;
      return { ...it, ...match, id: it.id, tier: it.tier };
    }));
    // Clear votes for dismissed routes
    const dismissedIds = externalRoutes.filter(r => r.dismissed).map(r => r.id);
    if (dismissedIds.length) {
      setLocalVotes(prev => {
        const next = { ...prev };
        dismissedIds.forEach(id => { delete next[id]; });
        return next;
      });
    }
  }, [externalRoutes]);
  // Sync back: when external selection changes (e.g. user picks a route on the map), update localVotes.
  // IMPORTANT: only sync when external is a non-null id — never use external=null to CLEAR local,
  // because otherwise this ping-pongs with onSelectionChange during mount/load.
  useEffect(() => {
    if (!isPretripMode) return;
    if (externalSelectedId === undefined || externalSelectedId === null) return;
    const currentSelected = tier1Items.find(it => (localVotes[it.id] || 0) === 1)?.id || null;
    if (externalSelectedId === currentSelected) return;
    setLocalVotes(prev => {
      const next = { ...prev };
      tier1Items.forEach(it => { next[it.id] = 0; });
      next[externalSelectedId] = 1;
      return next;
    });
  }, [externalSelectedId, tier1Items.length]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: T.warm, position: "relative", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ background: T.chalk, borderBottom: `1px solid ${T.sand}`, flexShrink: 0 }}>
        <div style={{ padding: "20px 16px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: isPretripMode ? 0 : 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {onBack && (
                <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: T.mist, padding: "0 4px 0 0", lineHeight: 1 }}>←</button>
              )}
              <div>
                <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 18, color: T.ink }}>
                  {isPretripMode ? (() => {
                    if (destinations.length <= 2) return destinations.join(" → ");
                    const parts = destinations.map(d => d.split(/,\s*/));
                    if (parts.every(p => p.length >= 2)) {
                      const suffix = parts[0].slice(1).join(", ");
                      if (parts.every(p => p.slice(1).join(", ").toLowerCase() === suffix.toLowerCase())) {
                        return `${parts.map(p => p[0]).join(" → ")}`;
                      }
                    }
                    return destinations.join(" → ");
                  })() : "Magazine"}
                </div>
                {isPretripMode && (
                  <div style={{ fontSize: 11, color: T.mist, fontFamily: "Georgia,serif", marginTop: 2 }}>
                    {generating
                      ? `Shortlisting from ${ideaCount.toLocaleString("en-US")} ideas…${ideaCount >= 10000 ? " :O" : ""}`
                      : items?.length ? "Pick your route, then build your itinerary" : "Generating ideas…"}
                  </div>
                )}
              </div>
            </div>
            {onEditForm && (
              <button onClick={onEditForm} style={{ background: T.sand, border: "none", borderRadius: RADIUS.full, padding: "5px 11px", color: T.ink, fontSize: 12, cursor: "pointer", fontFamily: "Georgia,serif", fontWeight: 600 }}>
                ✏️ Edit details
              </button>
            )}
          </div>

          {!isPretripMode && (
            <div style={{ fontSize: 12, color: T.mist, fontFamily: "Georgia,serif", marginTop: 4 }}>
              Your destination guide — highlights, local tips, and what makes each place special
            </div>
          )}
        </div>

      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", paddingBottom: isPretripMode ? 160 : 24 }}>

        {/* ── PRE-TRIP: route cards ── */}
        {isPretripMode && (<>
          {genError && (
            <div style={{ margin: "12px 0", padding: "12px 16px", borderRadius: RADIUS.lg, background: T.errorLight, border: `1.5px solid ${T.errorBorder}`, fontSize: 13, color: T.error, fontFamily: "Georgia,serif", lineHeight: 1.5 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Couldn't load ideas</div>
              <div style={{ fontSize: 11, color: T.error, fontFamily: "monospace", wordBreak: "break-all", marginBottom: 10 }}>{genError}</div>
              <button onClick={generate} style={{ background: T.ocean, color: "white", border: "none", borderRadius: RADIUS.md, padding: "7px 14px", fontFamily: "Georgia,serif", fontSize: 12, cursor: "pointer" }}>Try again</button>
            </div>
          )}
          {items?.length === 0 && !generating && !loadingItems && !genError && (
            <div style={{ textAlign: "center", padding: "60px 20px" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🗺️</div>
              <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 18, color: T.ink, marginBottom: 8 }}>Nothing came back</div>
              <div style={{ fontFamily: "Georgia,serif", fontSize: 13, color: T.mist }}>Try again.</div>
            </div>
          )}
          {/* Full spinner only before first route arrives — centered vertically */}
          {(generating || loadingItems || items === null) && tier1Items.length === 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, minHeight: "50vh" }}>
              <div style={{ width: 36, height: 36, border: `3px solid ${T.sand}`, borderTopColor: T.ocean, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {tier1Items.map((item, idx) => (
              <div key={item.id} ref={el => { if (el) routeCardRefs.current[item.id] = el; }}>
                <RouteCard item={item} vs={getVoteState(item.id)} onVote={() => castVote(item.id, 1)} interactive={true} showRecommended={routesReady} routeLabel={`P${idx + 1}`}
                  onModify={() => {
                    onModifyRoute?.(`P${idx + 1}`);
                  }}
                  onDismiss={() => {
                    const label = `P${idx + 1}`;
                    setItems(prev => (prev || []).map(it => it.id === item.id ? { ...it, dismissed: true } : it));
                    setLocalVotes(prev => { const next = { ...prev }; delete next[item.id]; return next; });
                    if (item.id && !String(item.id).startsWith("temp_")) {
                      supabase.from("brainstorm_items").update({ dismissed: true }).eq("id", item.id);
                    }
                    onDismissRoute?.(label, item.id);
                  }}
                  onTellMore={onTellMore ? () => {
                    const cities = (item.city || "").split(",").map(s => s.trim()).filter(Boolean);
                    onTellMore(cities, item.id);
                  } : null}
                  onShowMap={onShowMap ? () => onShowMap(item.id) : null}
                />
              </div>
            ))}
            {/* Skeleton cards while routes are streaming */}
            {generating && tier1Items.length > 0 && (
              [...Array(Math.min(4, 12 - tier1Items.length))].map((_, i) => (
                <div key={`skel-${i}`} style={{ borderRadius: RADIUS.lg, padding: "14px 16px", border: `2px solid ${T.sand}`, background: T.chalk }}>
                  <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                    <div style={{ width: 24, height: 24, borderRadius: RADIUS.sm, background: T.sand, animation: "shimmer 1.5s ease-in-out infinite" }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ width: "60%", height: 14, borderRadius: 4, background: T.sand, animation: "shimmer 1.5s ease-in-out infinite", marginBottom: 6 }} />
                      <div style={{ width: "40%", height: 10, borderRadius: 4, background: T.sand, animation: "shimmer 1.5s ease-in-out infinite" }} />
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {[0,1,2].map(j => (
                      <div key={j} style={{ width: `${85 - j * 10}%`, height: 10, borderRadius: 4, background: T.sand, animation: "shimmer 1.5s ease-in-out infinite", animationDelay: `${j * 0.15}s` }} />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
          {/* Generate new options */}
          {!generating && tier1Items.length > 0 && (
            tier1Items.length >= 12 ? (
              <div style={{ marginTop: 14, padding: "12px 16px", borderRadius: RADIUS.lg, background: T.chalk, border: `1.5px solid ${T.sand}`, textAlign: "center" }}>
                <div style={{ fontSize: 13, color: T.ink, fontFamily: "Georgia,serif", marginBottom: 4 }}>Maximum 12 trip ideas reached</div>
                <div style={{ fontSize: 12, color: T.mist, fontFamily: "Georgia,serif" }}>Dismiss some ideas to generate new ones</div>
              </div>
            ) : (
              <button
                onClick={() => generate(true)}
                style={{
                  marginTop: 14, width: "100%",
                  padding: "11px 14px", borderRadius: RADIUS.lg,
                  background: T.chalk, border: `1.5px dashed ${T.sand}`, color: T.ocean,
                  fontFamily: "Georgia,serif", fontSize: 13, fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                ✨ Show me more plans
              </button>
            )
          )}
        </>)}

        {/* ── IN-TRIP: City Deep Dive (full-tab view) ── */}
        {!isPretripMode && deepDiveCity && (() => {
          const dd = deepDiveCache[deepDiveCity];
          const ddItinTitles = new Set((days || []).flatMap(d => (d.activities || []).map(a => (a.title || "").toLowerCase())));
          const cityDays = (days || []).filter(d => (d.city || "").toLowerCase() === deepDiveCity.toLowerCase());
          const allActs = cityDays.flatMap(d => d.activities || []);
          const cityEntry = (trip?.ig_response?.cities || []).find(c => (c.name || "").toLowerCase() === deepDiveCity.toLowerCase());
          const writeup = cityEntry?.writeup || "";
          const preferredTypes = new Set(["sight", "experience", "culture", "nature"]);
          let highlights = allActs.filter(a => preferredTypes.has(a.type));
          if (highlights.length < 3) {
            const extra = allActs.filter(a => !preferredTypes.has(a.type) && a.type !== "transit" && a.type !== "hotel").slice(0, 4);
            highlights = [...highlights, ...extra];
          }
          highlights = highlights.slice(0, 6);
          // Wishlist roll-up across all days in this city (unique by title)
          const wishlistMap = new Map();
          for (const d of cityDays) for (const w of (d.wishlist || [])) {
            if (!wishlistMap.has(w.title)) wishlistMap.set(w.title, w);
          }
          const wishlist = [...wishlistMap.values()];
          const loading = dd === "loading";
          const errored = dd === "error";
          const data = (dd && typeof dd === "object") ? dd : null;

          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Back button */}
              <button
                onClick={() => setDeepDiveCity(null)}
                style={{ alignSelf: "flex-start", background: "none", border: "none", color: T.ocean, fontFamily: "Georgia,serif", fontSize: 13, cursor: "pointer", padding: "4px 0" }}
              >
                ← Back to destinations
              </button>

              {/* Hero */}
              <div>
                <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 28, color: T.ink, lineHeight: 1.15, marginBottom: 6 }}>{deepDiveCity}</div>
                <div style={{ fontSize: 11, color: T.mist, fontFamily: "Georgia,serif", marginBottom: 12 }}>
                  {cityDays.length} day{cityDays.length > 1 ? "s" : ""} · {cityDays.map(d => d.label).join(", ")}
                </div>
                {writeup && (
                  <div style={{ fontSize: 14, color: T.ink, fontFamily: "Georgia,serif", lineHeight: 1.6 }}>{writeup}</div>
                )}
              </div>

              {/* Highlights */}
              {highlights.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, color: T.mist, fontFamily: "Georgia,serif", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Highlights</div>
                  <div className="no-scrollbar" style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4, margin: "0 -16px", padding: "0 16px 4px" }}>
                    {highlights.map((act, i) => (
                      <MagazineHighlightCard key={i} item={act} city={deepDiveCity} inItinerary={ddItinTitles.has((act.title || "").toLowerCase())} onAskTrippy={onAskTrippy} />
                    ))}
                  </div>
                </div>
              )}

              {/* If you have extra time (wishlist roll-up) */}
              {wishlist.length > 0 && (
                <div style={{ background: T.chalk, borderRadius: RADIUS.lg, padding: "14px 16px", border: `1px solid ${T.sand}` }}>
                  <div style={{ fontSize: 10, color: T.mist, fontFamily: "Georgia,serif", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>If you have extra time</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {wishlist.map((w, i) => (
                      <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{w.icon || "✨"}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 13, color: T.ink, lineHeight: 1.3 }}>{w.title}</div>
                          {w.note && <div style={{ fontSize: 11, color: T.mist, fontFamily: "Georgia,serif", fontStyle: "italic", lineHeight: 1.35 }}>{w.note}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Loading shimmer for AI sections */}
              {loading && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "8px 0" }}>
                  {[0,1,2].map(i => (
                    <div key={i} style={{ background: T.chalk, borderRadius: RADIUS.lg, padding: "14px 16px", border: `1px solid ${T.sand}` }}>
                      <div style={{width:100,height:10,borderRadius:4,background:T.sand,animation:"shimmer 1.5s ease-in-out infinite",marginBottom:10,animationDelay:`${i*0.2}s`}}/>
                      <div style={{width:"90%",height:12,borderRadius:4,background:T.sand,animation:"shimmer 1.5s ease-in-out infinite",marginBottom:6,animationDelay:`${i*0.2+0.1}s`}}/>
                      <div style={{width:"70%",height:12,borderRadius:4,background:T.sand,animation:"shimmer 1.5s ease-in-out infinite",animationDelay:`${i*0.2+0.2}s`}}/>
                    </div>
                  ))}
                </div>
              )}
              {errored && (
                <div style={{ padding: "14px 16px", textAlign: "center", color: T.error, fontFamily: "Georgia,serif", fontSize: 13, background: T.errorLight, borderRadius: 10 }}>
                  Couldn't load deep dive. <button onClick={() => loadCityDeepDive(deepDiveCity)} style={{ background: "none", border: "none", color: T.ocean, cursor: "pointer", textDecoration: "underline" }}>Retry</button>
                </div>
              )}

              {/* Food specialties */}
              {data?.foodSpecialties?.length > 0 && (
                <div style={{ background: T.chalk, borderRadius: RADIUS.lg, padding: "14px 16px", border: `1px solid ${T.sand}` }}>
                  <div style={{ fontSize: 10, color: T.mist, fontFamily: "Georgia,serif", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>🍜 Food you should try</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {data.foodSpecialties.map((f, i) => (
                      <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{f.icon || "🍽️"}</span>
                        <div>
                          <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 13, color: T.ink, lineHeight: 1.3 }}>{f.name}</div>
                          {f.note && <div style={{ fontSize: 11, color: T.mist, fontFamily: "Georgia,serif", lineHeight: 1.4 }}>{f.note}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Weather */}
              {data?.weather && (
                <div style={{ background: T.chalk, borderRadius: RADIUS.lg, padding: "14px 16px", border: `1px solid ${T.sand}` }}>
                  <div style={{ fontSize: 10, color: T.mist, fontFamily: "Georgia,serif", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>🌤 Weather & season</div>
                  <div style={{ fontSize: 13, color: T.ink, fontFamily: "Georgia,serif", lineHeight: 1.55 }}>{data.weather}</div>
                </div>
              )}

              {/* Getting around */}
              {data?.gettingAround && (
                <div style={{ background: T.chalk, borderRadius: RADIUS.lg, padding: "14px 16px", border: `1px solid ${T.sand}` }}>
                  <div style={{ fontSize: 10, color: T.mist, fontFamily: "Georgia,serif", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>🚕 Getting around</div>
                  <div style={{ fontSize: 13, color: T.ink, fontFamily: "Georgia,serif", lineHeight: 1.55 }}>{data.gettingAround}</div>
                </div>
              )}

              {/* Etiquette */}
              {data?.etiquette?.length > 0 && (
                <div style={{ background: T.chalk, borderRadius: RADIUS.lg, padding: "14px 16px", border: `1px solid ${T.sand}` }}>
                  <div style={{ fontSize: 10, color: T.mist, fontFamily: "Georgia,serif", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>🤝 Local etiquette</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {data.etiquette.map((tip, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <span style={{ fontSize: 11, color: T.ocean, flexShrink: 0, marginTop: 3 }}>●</span>
                        <div style={{ fontSize: 13, color: T.ink, fontFamily: "Georgia,serif", lineHeight: 1.5 }}>{tip}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* More to discover */}
              {data?.moreSights?.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, color: T.mist, fontFamily: "Georgia,serif", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>🧭 More to discover</div>
                  <div className="no-scrollbar" style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4, margin: "0 -16px", padding: "0 16px 4px" }}>
                    {data.moreSights.map((s, i) => (
                      <MagazineHighlightCard key={i} item={s} city={deepDiveCity} inItinerary={ddItinTitles.has((s.title || "").toLowerCase())} onAskTrippy={onAskTrippy} />
                    ))}
                  </div>
                </div>
              )}

              {/* Did you know */}
              {data?.didYouKnow && (
                <div style={{ background: `linear-gradient(135deg, ${T.ocean}08, ${T.dusk}06)`, borderRadius: RADIUS.lg, padding: "14px 16px", border: `1px solid ${T.ocean}22` }}>
                  <div style={{ fontSize: 10, color: T.ocean, fontFamily: "Georgia,serif", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8, fontWeight: 600 }}>💡 Did you know?</div>
                  <div style={{ fontSize: 13, color: T.ink, fontFamily: "Georgia,serif", lineHeight: 1.6, fontStyle: "italic" }}>{data.didYouKnow}</div>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── IN-TRIP: Destination intro ── */}
        {!isPretripMode && !deepDiveCity && (() => {
          const dest = trip?.destination;
          const dd = dest ? deepDiveCache[dest] : null;
          const data = (dd && typeof dd === "object") ? dd : null;
          const isLoading = dd === "loading";
          // Trigger load if not cached
          if (dest && !deepDiveCache[dest]) loadCityDeepDive(dest);
          if (!dest) return null;
          return (
            <DestinationHero dest={dest} isLoading={isLoading} data={data}>
              <div style={{fontSize:13,color:T.ink,fontFamily:"Georgia,serif",lineHeight:1.6}}>{data?.writeup}</div>
              {data?.didYouKnow && (
                <div style={{marginTop:10,fontSize:12,color:T.ocean,fontFamily:"Georgia,serif",fontStyle:"italic",lineHeight:1.5}}>💡 {data.didYouKnow}</div>
              )}
              <a href={`https://www.google.com/search?q=${encodeURIComponent("site:tripadvisor.com Tourism " + dest)}&btnI`} target="_blank" rel="noopener noreferrer" style={{
                display:"inline-flex",alignItems:"center",gap:5,marginTop:12,
                padding:"6px 12px",borderRadius:RADIUS.md,border:`1px solid ${T.moss}33`,
                color:T.moss,fontFamily:"Georgia,serif",fontSize:11,fontWeight:600,textDecoration:"none",
              }}>
                🗺 Explore {dest} on TripAdvisor
              </a>
            </DestinationHero>
          );
        })()}

        {/* ── IN-TRIP: Destinations cards ── */}
        {!isPretripMode && !deepDiveCity && (() => {
          // Build set of itinerary activity titles for ✓ tick matching in Magazine
          const itineraryTitles = new Set(
            (days || []).flatMap(d => (d.activities || []).map(a => (a.title || "").toLowerCase()))
          );
          // Group days by city
          const cityGroups = {};
          const cityOrder = [];
          for (const d of days) {
            const city = d.city || "Unknown";
            if (!cityGroups[city]) { cityGroups[city] = []; cityOrder.push(city); }
            cityGroups[city].push(d);
          }
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {cityOrder.map((city, ci) => {
                const cityDays = cityGroups[city];
                const allActs = cityDays.flatMap(d => d.activities || []);
                // Write-up: prefer top-level cities[].writeup from IG response; fall back to day descriptions
                const cityEntry = (trip?.ig_response?.cities || []).find(c => (c.name || "").toLowerCase() === city.toLowerCase());
                const writeup = cityEntry?.writeup || cityDays
                  .map(d => (d.description || "").trim())
                  .filter(Boolean)
                  .join(" ");
                // Highlights: all non-transit/non-hotel activities + wishlist items, deduped by title
                const seenTitles = new Set();
                const highlights = [];
                // First: itinerary activities (sights, food, experiences, etc.)
                for (const a of allActs) {
                  if (a.type === "transit" || a.type === "hotel") continue;
                  if (!a.title?.trim()) continue;
                  const key = (a.title || "").toLowerCase();
                  if (seenTitles.has(key)) continue;
                  seenTitles.add(key);
                  highlights.push(a);
                }
                // Then: wishlist items from this city's days (hidden gems the user might explore)
                for (const d of cityDays) {
                  for (const w of (d.wishlist || [])) {
                    const key = (w.title || "").toLowerCase();
                    if (seenTitles.has(key)) continue;
                    seenTitles.add(key);
                    highlights.push({ ...w, type: "wishlist" });
                  }
                }
                // Then: brainstorm tier 2 items tagged to this city
                for (const bi of (items || [])) {
                  if ((bi.tier || 2) !== 2) continue;
                  if (!(bi.city || "").toLowerCase().includes(city.toLowerCase())) continue;
                  const key = (bi.title || "").toLowerCase();
                  if (seenTitles.has(key)) continue;
                  seenTitles.add(key);
                  highlights.push({ title: bi.title, note: bi.note, icon: bi.icon, type: bi.category?.toLowerCase() || "sight" });
                }

                return (
                  <Fragment key={city}>
                  {ci > 0 && <div style={{height:8,background:"#F3EDE4"}}/>}
                  <CityCard city={city} cityDays={cityDays} writeup={writeup} deepDive={deepDiveCache[city]} onDeepDive={() => { setDeepDiveCity(city); loadCityDeepDive(city); }}>
                    {/* City header is rendered inside CityCard */}

                    {/* Highlights — masonry grid */}
                    {highlights.length > 0 && (
                      <>
                        <div style={{ fontSize: 10, color: T.mist, fontFamily: "Georgia,serif", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 10 }}>
                          Highlights
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                          {highlights.map((act, i) => (
                            <MagazineHighlightCard key={i} item={act} city={city} inItinerary={itineraryTitles.has((act.title || "").toLowerCase())} masonry={true} tall={i % 3 === 0} onAskTrippy={onAskTrippy} />
                          ))}
                        </div>
                      </>
                    )}
                  </CityCard>
                  </Fragment>
                );
              })}
            </div>
          );
        })()}

        {/* ── IN-TRIP: "Also in [country]" — cities from unselected routes ── */}
        {!isPretripMode && (() => {
          // Gather cities already on the itinerary
          const itineraryCities = new Set((days || []).map(d => (d.city || "").toLowerCase()));
          // Gather cities from unselected routes (tier 1, not selected)
          const unselectedRoutes = (items || []).filter(it => it.tier === 1 && !it.selected && !it.dismissed);
          const otherCitiesMap = new Map(); // city → { city, fromRoute }
          for (const route of unselectedRoutes) {
            const cities = (route.city || "").split(",").map(s => s.trim()).filter(Boolean);
            for (const c of cities) {
              if (!itineraryCities.has(c.toLowerCase()) && !otherCitiesMap.has(c.toLowerCase())) {
                otherCitiesMap.set(c.toLowerCase(), { city: c, fromRoute: route.title, tagline: route.tagline });
              }
            }
          }
          const otherCities = [...otherCitiesMap.values()];
          if (otherCities.length === 0) return null;

          const country = (trip?.destination || "").split("→")[0].trim();

          return (
            <div style={{ marginTop: 24 }}>
              <div style={{ fontSize: 10, color: T.mist, fontFamily: "Georgia,serif", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
                Also in {country || "the region"}
              </div>
              <div style={{ fontSize: 12, color: T.mist, fontFamily: "Georgia,serif", marginBottom: 14 }}>
                Places you didn't pick this time — worth exploring on a future visit
              </div>
              <div className="no-scrollbar" style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4, margin: "0 -16px", padding: "0 16px 4px" }}>
                {otherCities.map((item, i) => (
                  <div
                    key={i}
                    onClick={() => { setDeepDiveCity(item.city); loadCityDeepDive(item.city); }}
                    style={{
                      flexShrink: 0, width: 150, borderRadius: RADIUS.lg, overflow: "hidden",
                      border: `1px solid ${T.sand}`, background: T.chalk, cursor: "pointer",
                      boxShadow: SHADOW.sm,
                    }}
                  >
                    <div style={{ height: 70, background: `linear-gradient(135deg, ${T.ocean}15, ${T.dusk}10)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ fontSize: 28 }}>🧭</span>
                    </div>
                    <div style={{ padding: "10px 12px" }}>
                      <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 14, color: T.ink, lineHeight: 1.2, marginBottom: 4 }}>{item.city}</div>
                      <div style={{ fontSize: 10, color: T.mist, fontFamily: "Georgia,serif", lineHeight: 1.35, fontStyle: "italic" }}>
                        From: {item.fromRoute}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

      </div>

      {/* Build button removed — now in the persistent chat bar */}
    </div>
  );
}


/* ─── TRANSITION ROW ────────────────────────────────────────────────── */
function TransitionRow({ from, to, city, label = null, delay = 0, forceDrive = false, initialCommute = null, onResolved = null }) {
  // Validate stored value before trusting it. Cross-city transits (Tokyo→Kyoto) can legitimately
  // be hours; in-city pairs above ~60 min are almost certainly stale poisoned values from before
  // the 30km cap landed. Force live re-compute so the system self-heals over time — the new
  // computation either succeeds with a correct pill or falls through to "Get directions".
  const isCrossCityTransit = from?.type === "transit" || to?.type === "transit";
  const storedLooksReasonable = initialCommute && initialCommute.mins > 0 &&
    (isCrossCityTransit || initialCommute.mins <= 60);
  const seedCommute = storedLooksReasonable ? initialCommute : null;

  const [commute, setCommute] = useState(seedCommute);
  const [loading, setLoading] = useState(!seedCommute);
  const [debug, setDebug] = useState(null);
  const debugMode = useContext(DebugContext);

  useEffect(() => {
    if (storedLooksReasonable) return;
    let cancelled = false;
    async function load() {
      const placeA = from.geocode || extractPlace(from.title);
      const placeB = to.geocode   || extractPlace(to.title);
      // For transit activities, use geocodeEnd (destination) as the origin for the next leg
      const fromGeocode = from.type === "transit" && from.geocodeEnd ? from.geocodeEnd : from.geocode;
      // Retry with backoff so a cold-start timeout doesn't immediately drop us to the "Get directions"
      // fallback — that's the failure state, not a loading state. Keep the `···` showing while we retry.
      let lastReason = null;
      const MAX_ATTEMPTS = 3;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        if (attempt === 0 && delay > 0) await new Promise(r => setTimeout(r, delay));
        if (attempt > 0) await new Promise(r => setTimeout(r, 2500 * attempt));
        if (cancelled) return;
        const [coordA, coordB] = await Promise.all([
          geocodePlace(from.title, city, fromGeocode),
          geocodePlace(to.title,   city, to.geocode),
        ]);
        if (cancelled) return;
        if (!coordA && !coordB) lastReason = `no coords for "${placeA}" or "${placeB}" in ${city}`;
        else if (!coordA) lastReason = `no coords for "${placeA}" in ${city}`;
        else if (!coordB) lastReason = `no coords for "${placeB}" in ${city}`;
        else {
          const dist = haversineMeters(coordA, coordB);
          // Cross-city transit activities (Tokyo→Kyoto etc.) can legitimately be hundreds of km;
          // in-city transitions beyond ~30km are almost certainly bad geocodes ("Calle Cava Baja"
          // mis-resolving to a suburb when both activities are in central Madrid). For the latter,
          // showing "3h 40m drive" misleads — fall through to "Get directions" which links to Maps.
          const isCrossCityTransit = from.type === "transit" || to.type === "transit";
          const cap = isCrossCityTransit ? 200000 : 30000;
          if (dist >= cap) {
            lastReason = `distance ${Math.round(dist/1000)}km exceeds ${isCrossCityTransit ? "200km" : "in-city 30km"} cap — likely bad geocode`;
            break; // permanent — too far, no retry
          }
          const road = dist * 1.3;
          const walkMins  = Math.max(1, Math.round(road / 80));
          const driveMins = Math.max(1, Math.round(road / 400));
          const useWalk = !forceDrive && walkMins <= 20;
          const transit = from.transition || from.transition_data;
          const transitMode = transit?.mode;
          const result = { mode: useWalk ? "walk" : "drive", mins: useWalk ? walkMins : driveMins, dist, transitMode };
          if (!cancelled) {
            setCommute(result);
            setDebug({ placeA, placeB, reason: null });
            setLoading(false);
            onResolved?.(result.mins, result.mode);
          }
          return;
        }
      }
      // All retries exhausted — commit to the "Get directions" fallback
      if (!cancelled) {
        setDebug({ placeA, placeB, reason: lastReason });
        setLoading(false);
      }
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
    // No coords — show a "Get directions" link using activity names
    const fallbackOrigin = encodeURIComponent(from.geocode || `${extractPlace(from.title)} ${city}`);
    const fallbackDest = encodeURIComponent(to.geocode || `${extractPlace(to.title)} ${city}`);
    const transit = from.transition || from.transition_data;
    const transitMode = transit?.mode;
    const fallbackUrl = `https://www.google.com/maps/dir/?api=1&origin=${fallbackOrigin}&destination=${fallbackDest}&travelmode=${transitMode ? "transit" : "driving"}`;
    const iconMap = { metro: "🚇", bus: "🚌", ferry: "⛴️", tram: "🚊" };
    return (
      <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 20px"}}>
        <div style={{flex:1,height:1,background:T.sand}}/>
        <a href={fallbackUrl} target="_blank" rel="noopener noreferrer"
          style={{fontSize:11,fontFamily:"Georgia,serif",textDecoration:"none",whiteSpace:"nowrap",
            padding:"3px 10px",borderRadius:RADIUS.full,color:T.ocean,border:`1px solid ${T.ocean}`,background:"#EBF3FD"}}>
          {transitMode ? `${iconMap[transitMode] || "🚇"} Get directions →` : "📍 Get directions →"}
        </a>
        <div style={{flex:1,height:1,background:T.sand}}/>
        {label && <span style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif",whiteSpace:"nowrap",flexShrink:0}}>{label}</span>}
      </div>
    );
  }

  const originGeocode = from.type === "transit" && from.geocodeEnd ? from.geocodeEnd : from.geocode;
  const origin   = encodeURIComponent(originGeocode || `${extractPlace(from.title)} ${city}`);
  const dest     = encodeURIComponent(to.geocode   || `${extractPlace(to.title)} ${city}`);
  const mapsUrl  = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=${commute.mode === "walk" ? "walking" : "driving"}`;
  const transitMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=transit`;

  let pillStyle, pillContent;
  if (commute.mode === "walk") {
    pillStyle = { color: T.moss, border: `1px solid ${T.moss}`, background: "#F4FAF7" };
    pillContent = `🚶 ${fmtTime(commute.mins)} walk`;
  } else {
    pillStyle = { color: T.ocean, border: `1px solid ${T.ocean}`, background: "#EBF3FD" };
    pillContent = `🚗 ${fmtTime(commute.mins)} drive`;
  }

  const transitIcons = { metro: "\u{1F687}", bus: "\u{1F68C}", ferry: "\u26F4\uFE0F", tram: "\u{1F68A}" };
  const showTransitIcon = commute.transitMode && commute.dist >= 500 && commute.dist <= 20000
    && !(commute.mode === "walk" && commute.mins <= 12)
    && !(commute.mode === "drive" && commute.mins <= 8);

  return (
    <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 20px"}}>
      <div style={{flex:1,height:1,background:T.sand}}/>
      <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
        style={{fontSize:11,fontFamily:"Georgia,serif",textDecoration:"none",whiteSpace:"nowrap",
          padding:"3px 10px",borderRadius:RADIUS.full, ...pillStyle}}>
        {pillContent}
      </a>
      {showTransitIcon && (
        <a href={transitMapsUrl} target="_blank" rel="noopener noreferrer"
          title={`Get ${commute.transitMode} directions`}
          style={{fontSize:14,border:"none",background:"none",opacity:0.8,cursor:"pointer",textDecoration:"none",lineHeight:1}}>
          {transitIcons[commute.transitMode]}
        </a>
      )}
      <div style={{flex:1,height:1,background:T.sand}}/>
      {label && <span style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif",whiteSpace:"nowrap",flexShrink:0}}>{label}</span>}
    </div>
  );
}

/* ─── ACTIVITY CARD ──────────────────────────────────────────────────── */
function ActivityCard({ activity, city, onEdit, onRemove, onReplace, onSuggestAlternatives, onChangeHotel, transitMapsUrl, onAskTrippy }) {
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState({ ...activity });
  const ts = typeStyle[draft.type] || typeStyle.sight;
  const transitOrigin = (() => {
    if (activity.geocode && activity.geocode_end && activity.geocode !== activity.geocode_end) return activity.geocode;
    // Parse origin from title like "Drive Denpasar to Ubud via ..."
    const titleMatch = activity.title?.match(/(?:Drive|Flight|Train|Bus|Ferry|Transit)\s+(.+?)\s+(?:to|→)\s+(.+?)(?:\s+via\s+|$)/i);
    if (titleMatch) return titleMatch[1];
    return activity.geocode || city;
  })();
  const transitDest = (() => {
    if (activity.geocode_end && activity.geocode_end !== activity.geocode) return activity.geocode_end;
    const titleMatch = activity.title?.match(/(?:Drive|Flight|Train|Bus|Ferry|Transit)\s+.+?\s+(?:to|→)\s+(.+?)(?:\s+via\s+|$)/i);
    if (titleMatch) return titleMatch[1];
    return activity.geocode_end || null;
  })();
  const mapsUrl = transitMapsUrl ||
    (transitDest
      ? `https://www.google.com/maps/dir/${encodeURIComponent(transitOrigin)}/${encodeURIComponent(transitDest)}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${activity.geocode || activity.title} ${city}`)}`);


  const saveEdit = () => { onEdit(draft); setEditing(false); };
  const cancelEdit = () => { setDraft({...activity}); setEditing(false); };

  // Rich inter-city transit card
  if (activity.type === "transit" && activity.service) {
    const isFerry = /ferry|boat/i.test(activity.service);
    const borderColor = isFerry ? "#2563A8" : "#7B5EA7";
    const transitIcon = isFerry ? "\u26F4\uFE0F" : activity.icon || "\u{1F682}";
    const rome2rioUrl = activity.from_station && activity.to_station
      ? `https://www.rome2rio.com/s/${encodeURIComponent(activity.from_station)}/${encodeURIComponent(activity.to_station)}`
      : null;
    return (
      <div style={{ display:"flex", gap:0, padding:"0 20px" }}>
        <div style={{ width:40, flexShrink:0, display:"flex", flexDirection:"column", alignItems:"center" }}>
          <div style={{
            width:38, height:38, borderRadius:"50%",
            background:ts.bg, border:`2.5px solid ${ts.color}`,
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:17, flexShrink:0,
          }}>{activity.icon}</div>
        </div>
        <div style={{
          flex:1, background:T.chalk, borderRadius:RADIUS.lg,
          padding:"13px 15px", marginBottom:2, marginLeft:10,
          boxShadow:SHADOW.sm,
          border:`1px solid ${T.sand}`,
          borderLeft:`4px solid ${borderColor}`,
          position:"relative",
        }}>
          {/* Header: icon + service name | duration */}
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6}}>
            <div style={{display:"flex", alignItems:"center", gap:6}}>
              <span style={{fontSize:15}}>{transitIcon}</span>
              <span style={{fontFamily:"'DM Serif Display',serif",fontSize:14,color:T.ink,fontWeight:600}}>{activity.service}</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:5}}>
              {activity.transit_duration && <span style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif"}}>⏱ {activity.transit_duration}</span>}
              {onAskTrippy && <button onClick={()=>onAskTrippy(activity.title)} style={{background:"transparent",border:"none",cursor:"pointer",fontSize:13,padding:"0 1px",lineHeight:1,color:T.ocean,opacity:0.6}} title="Ask Trippy">💬</button>}
              <div style={{position:"relative"}}>
                <button onClick={()=>setMenuOpen(m=>!m)} style={{background:"transparent",border:"none",cursor:"pointer",fontSize:16,padding:"0 3px",color:T.mist,lineHeight:1}}>⋯</button>
                {menuOpen && (
                  <>
                    <div onClick={()=>setMenuOpen(false)} style={{position:"fixed",inset:0,zIndex:99}}/>
                    <div style={{position:"absolute",right:0,top:22,zIndex:100,background:T.chalk,borderRadius:RADIUS.lg,boxShadow:SHADOW.md,border:`1px solid ${T.sand}`,minWidth:180,overflow:"hidden"}}>
                      <button onClick={()=>{ setMenuOpen(false); onAskTrippy?.(activity.title); }} style={{display:"block",width:"100%",textAlign:"left",padding:"11px 16px",background:"none",border:"none",fontFamily:"Georgia,serif",fontSize:13,color:T.ink,cursor:"pointer"}}>💬 Ask Trippy</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
          {/* Route line */}
          {activity.from_station && activity.to_station && (
            <div style={{fontSize:12,color:T.ink,fontFamily:"Georgia,serif",marginBottom:4}}>
              {activity.from_station} → {activity.to_station}
            </div>
          )}
          {/* Booking tip */}
          {activity.booking_tip && (
            <div style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif",fontStyle:"italic",marginBottom:4}}>
              💡 {activity.booking_tip}
            </div>
          )}
          {/* Cost + Rome2Rio */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            {activity.cost_estimate && (
              <span style={{fontSize:12,color:"#2E7D32",fontFamily:"Georgia,serif",fontWeight:600}}>{activity.cost_estimate}</span>
            )}
            {rome2rioUrl && (
              <a href={rome2rioUrl} target="_blank" rel="noopener noreferrer"
                style={{fontSize:11,color:T.ocean,fontFamily:"Georgia,serif",textDecoration:"none"}}>
                Compare options on Rome2Rio →
              </a>
            )}
          </div>
          {/* Time label */}
          <div style={{fontSize:10,color:T.mist,fontFamily:"Georgia,serif",marginTop:6}}>{activity.time}</div>
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <div style={{padding:"0 20px",marginBottom:2}}>
        <div style={{background:T.chalk,borderRadius:RADIUS.lg,padding:14,border:`1.5px solid ${T.ocean}`,boxShadow:SHADOW.sm}}>
          <div style={{display:"flex",gap:8,marginBottom:8}}>
            <input value={draft.time} onChange={e=>setDraft(d=>({...d,time:e.target.value}))}
              placeholder="Time"
              style={{width:100,padding:"8px 10px",borderRadius:RADIUS.md,border:`1.5px solid ${T.sand}`,fontFamily:"Georgia,serif",fontSize:13,color:T.ink,outline:"none"}}/>
            <input value={draft.title} onChange={e=>setDraft(d=>({...d,title:e.target.value}))}
              placeholder="Activity name"
              style={{flex:1,padding:"8px 10px",borderRadius:RADIUS.md,border:`1.5px solid ${T.sand}`,fontFamily:"Georgia,serif",fontSize:13,color:T.ink,outline:"none"}}/>
          </div>
          <div style={{display:"flex",gap:8,marginBottom:8}}>
            <select value={draft.type} onChange={e=>setDraft(d=>({...d,type:e.target.value}))}
              style={{flex:1,padding:"8px 10px",borderRadius:RADIUS.md,border:`1.5px solid ${T.sand}`,fontFamily:"Georgia,serif",fontSize:13,color:T.ink,outline:"none",background:T.chalk}}>
              {Object.entries(typeStyle).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
            </select>
            <input value={draft.duration} onChange={e=>setDraft(d=>({...d,duration:e.target.value}))}
              placeholder="Duration (e.g. 2h)"
              style={{width:120,padding:"8px 10px",borderRadius:RADIUS.md,border:`1.5px solid ${T.sand}`,fontFamily:"Georgia,serif",fontSize:13,color:T.ink,outline:"none"}}/>
          </div>
          <input value={draft.note} onChange={e=>setDraft(d=>({...d,note:e.target.value}))}
            placeholder="Note (optional)"
            style={{width:"100%",padding:"8px 10px",borderRadius:RADIUS.md,border:`1.5px solid ${T.sand}`,fontFamily:"Georgia,serif",fontSize:13,color:T.ink,outline:"none",marginBottom:8}}/>
          <input value={draft.geocode || ""} onChange={e=>setDraft(d=>({...d,geocode:e.target.value}))}
            placeholder={draft.type === "transit" ? "Departure (e.g. CSMT Mumbai)" : "Map pin (e.g. Gateway of India Pier Mumbai)"}
            style={{width:"100%",padding:"8px 10px",borderRadius:RADIUS.md,border:`1.5px solid ${T.sand}`,fontFamily:"Georgia,serif",fontSize:13,color:T.ink,outline:"none",marginBottom:8}}/>
          {draft.type === "transit" && (
            <input value={draft.geocode_end || ""} onChange={e=>setDraft(d=>({...d,geocode_end:e.target.value}))}
              placeholder="Arrival (e.g. Pune Junction)"
              style={{width:"100%",padding:"8px 10px",borderRadius:RADIUS.md,border:`1.5px solid ${T.sand}`,fontFamily:"Georgia,serif",fontSize:13,color:T.ink,outline:"none",marginBottom:10}}/>
          )}
          {draft.type !== "transit" && <div style={{marginBottom:10}}/>}
          <div style={{display:"flex",gap:8}}>
            <button onClick={saveEdit} style={{flex:1,background:T.ocean,color:"white",border:"none",borderRadius:RADIUS.md,padding:"9px 0",fontFamily:"Georgia,serif",fontSize:13,cursor:"pointer"}}>Save</button>
            <button onClick={cancelEdit} style={{flex:1,background:T.sand,color:T.ink,border:"none",borderRadius:RADIUS.md,padding:"9px 0",fontFamily:"Georgia,serif",fontSize:13,cursor:"pointer"}}>Cancel</button>
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
        flex:1, background:T.chalk, borderRadius:RADIUS.lg,
        padding:"13px 15px", marginBottom:2, marginLeft:10,
        boxShadow:SHADOW.sm,
        border:`1px solid ${T.sand}`,
        position:"relative",
        borderRight: activity.confirmed ? `4px solid ${T.moss}` : `1px solid ${T.sand}`,
      }}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start"}}>
          <div style={{flex:1, paddingRight:8}}>
            <div style={{display:"flex", alignItems:"center", gap:7, marginBottom:4}}>
              <span style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif",letterSpacing:0.5}}>{activity.time}</span>
              {(() => { const ps = activity.package ? packageColor(activity.package) : ts; return (
              <span style={{background:ps.bg,color:ps.color,fontSize:10,borderRadius:RADIUS.full,padding:"1px 7px",fontFamily:"Georgia,serif",fontWeight:600}}>
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
              {onAskTrippy && <button onClick={()=>onAskTrippy(activity.title)} style={{background:"transparent",border:"none",cursor:"pointer",fontSize:13,padding:"0 1px",lineHeight:1,color:T.ocean,opacity:0.6}} title="Ask Trippy">💬</button>}
              <div style={{position:"relative"}}>
                <button onClick={()=>setMenuOpen(m=>!m)} style={{background:"transparent",border:"none",cursor:"pointer",fontSize:16,padding:"0 3px",color:T.mist,lineHeight:1}}>⋯</button>
                {menuOpen && (
                  <>
                    <div onClick={()=>setMenuOpen(false)} style={{position:"fixed",inset:0,zIndex:99}}/>
                    <div style={{position:"absolute",right:0,top:22,zIndex:100,background:T.chalk,borderRadius:RADIUS.lg,boxShadow:SHADOW.md,border:`1px solid ${T.sand}`,minWidth:180,overflow:"hidden"}}>
                      {activity.type === "hotel" ? <>
                        <button onClick={()=>{ setMenuOpen(false); onChangeHotel?.("suggest"); }} style={{display:"block",width:"100%",textAlign:"left",padding:"11px 16px",background:"none",border:"none",fontFamily:"Georgia,serif",fontSize:13,color:T.ink,cursor:"pointer",borderBottom:`1px solid ${T.sand}`}}>✨ Suggest a different hotel</button>
                        <button onClick={()=>{ setMenuOpen(false); onChangeHotel?.("own"); }} style={{display:"block",width:"100%",textAlign:"left",padding:"11px 16px",background:"none",border:"none",fontFamily:"Georgia,serif",fontSize:13,color:T.ink,cursor:"pointer"}}>🏨 Change hotel to…</button>
                      </> : <>
                        <button onClick={()=>{ setMenuOpen(false); onSuggestAlternatives?.(); }} style={{display:"block",width:"100%",textAlign:"left",padding:"11px 16px",background:"none",border:"none",fontFamily:"Georgia,serif",fontSize:13,color:T.ink,cursor:"pointer",borderBottom:`1px solid ${T.sand}`}}>✨ Suggest alternatives</button>
                        <button onClick={()=>{ setMenuOpen(false); onReplace?.(); }} style={{display:"block",width:"100%",textAlign:"left",padding:"11px 16px",background:"none",border:"none",fontFamily:"Georgia,serif",fontSize:13,color:T.ink,cursor:"pointer",borderBottom:`1px solid ${T.sand}`}}>🔄 Replace item</button>
                        <button onClick={()=>{ setMenuOpen(false); setEditing(true); }} style={{display:"block",width:"100%",textAlign:"left",padding:"11px 16px",background:"none",border:"none",fontFamily:"Georgia,serif",fontSize:13,color:T.ink,cursor:"pointer",borderBottom:`1px solid ${T.sand}`}}>✎ Edit item</button>
                        <button onClick={()=>{ setMenuOpen(false); onRemove?.(); }} style={{display:"block",width:"100%",textAlign:"left",padding:"11px 16px",background:"none",border:"none",fontFamily:"Georgia,serif",fontSize:13,color:T.error,cursor:"pointer"}}>Remove</button>
                      </>}
                    </div>
                  </>
                )}
              </div>
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

/* ─── LOADING HINT ───────────────────────────────────────────────────── */
function LoadingHint() {
  return <div style={{fontSize:13,color:T.mist,fontFamily:"Georgia,serif",textAlign:"center"}}>Getting the engine started…</div>;
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

function DepartureTimeline({ departureTime, departureMode, onEdit, airportIata, destIata, destArrivalHHMM }) {
  const hhmm = departureTime ? departureTime.split("T")[1]?.substring(0, 5) : null;
  if (!hhmm) return null;

  const [h, m]      = hhmm.split(":").map(Number);
  const leaveTotal  = h * 60 + m - 90; // ~90 min to airport/station before departure
  const leaveCapped = Math.max(0, Math.round(leaveTotal / 30) * 30);
  const leaveHH     = String(Math.floor(leaveCapped / 60) % 24).padStart(2, "0");
  const leaveMM     = String(leaveCapped % 60).padStart(2, "0");
  const modeIcon    = departureMode === "train" ? "🚂" : departureMode === "road" ? "🚗" : departureMode === "bus" ? "🚌" : "✈️";
  const modeLabel   = departureMode === "train" ? "Train" : departureMode === "road" ? "Drive out" : departureMode === "bus" ? "Bus" : "Flight";
  const showHomeLeg = !!destIata && destIata !== airportIata;

  return (
    <div style={{padding:"12px 20px 0"}}>
      <div style={{background:"#EBF5FF",borderRadius:RADIUS.md,padding:"10px 14px",border:"1px solid #C5DEFF"}}>
        <div style={{fontSize:12,fontFamily:"Georgia,serif",color:T.ink,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
          <span style={{fontWeight:600,color:T.moss}}>Leave ~{leaveHH}:{leaveMM}</span>
          <span style={{color:T.mist,fontSize:10}}>›</span>
          <span style={{color:T.mist}}>~90 min to {departureMode === "road" ? "departure" : "terminal"}</span>
          <span style={{color:T.mist,fontSize:10}}>›</span>
          <span
            onClick={onEdit}
            style={onEdit ? {cursor:"pointer",textDecoration:"underline dotted",textUnderlineOffset:3} : {}}
          >
            {modeIcon} {showHomeLeg ? `${airportIata || modeLabel} → ${destIata}` : modeLabel} {hhmm}{airportIata ? ` from ${airportIata}` : ""}
          </span>
          {showHomeLeg && destArrivalHHMM && (
            <>
              <span style={{color:T.mist,fontSize:10}}>›</span>
              <span style={{color:T.mist}}>Arrives ~{destArrivalHHMM} at {destIata}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ArrivalTimeline({ arrivalTime, arrivalMode, onEditFlight, airportIata, originIata, originDepartureHHMM }) {
  const arrivalHHMM = arrivalTime ? arrivalTime.split("T")[1]?.substring(0, 5) : null;
  if (!arrivalHHMM) return null;

  const [h, m]     = arrivalHHMM.split(":").map(Number);
  const rawReady   = h * 60 + m + 90;
  const readyTotal = Math.round(rawReady / 30) * 30;
  const readyHH    = String(Math.floor(readyTotal / 60) % 24).padStart(2, "0");
  const readyMM    = String(readyTotal % 60).padStart(2, "0");
  const icon  = arrivalMode === "train" ? "🚂" : arrivalMode === "road" ? "🚗" : arrivalMode === "bus" ? "🚌" : "✈️";
  const verb  = arrivalMode === "train" ? "Arrive" : arrivalMode === "road" ? "Drive in" : arrivalMode === "bus" ? "Arrive" : "Land";
  const showHomeLeg = !!originIata && originIata !== airportIata;

  return (
    <div style={{padding:"0 20px 12px"}}>
      <div style={{background:"#EBF5FF",borderRadius:RADIUS.md,padding:"10px 14px",border:"1px solid #C5DEFF"}}>
        <div style={{fontSize:12,fontFamily:"Georgia,serif",color:T.ink,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
          {showHomeLeg && (
            <>
              <span style={{color:T.mist}}>{icon} {originIata} → {airportIata}</span>
              {originDepartureHHMM && (
                <>
                  <span style={{color:T.mist,fontSize:10}}>›</span>
                  <span style={{color:T.mist}}>Departs ~{originDepartureHHMM}</span>
                </>
              )}
              <span style={{color:T.mist,fontSize:10}}>›</span>
            </>
          )}
          <span
            onClick={onEditFlight}
            style={onEditFlight ? {cursor:"pointer",textDecoration:"underline dotted",textUnderlineOffset:3} : {}}
          >
            {showHomeLeg ? "" : `${icon} `}{verb} {arrivalHHMM}{airportIata ? ` at ${airportIata}` : ""}
          </span>
          <span style={{color:T.mist}}>·</span>
          <span style={{fontWeight:600,color:T.moss}}>Exit by ~{readyHH}:{readyMM}</span>
        </div>
      </div>
    </div>
  );
}

/* ─── DAY SECTION ────────────────────────────────────────────────────── */
function GemCard({ gem, city, activities, onAdd, onDismiss, onAskTrippy }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [photoUrl, setPhotoUrl] = useState(null);
  const [photoLoaded, setPhotoLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    _fetchPhoto(gem.geocode || gem.title, city, "sight").then(url => {
      if (!cancelled) { setPhotoUrl(url); setPhotoLoaded(true); }
    }).catch(() => { if (!cancelled) setPhotoLoaded(true); });
    return () => { cancelled = true; };
  }, [gem.geocode, gem.title, city]);
  const nearMatches = gem.near && (activities || []).some(a => a.title === gem.near);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${gem.geocode || gem.title} ${city}`)}`;
  return (
    <div style={{display:"flex",gap:12,padding:"10px 12px",background:T.chalk,border:`1px solid ${T.sand}`,borderRadius:RADIUS.lg,position:"relative"}}>
      <a href={mapsUrl} target="_blank" rel="noopener noreferrer" style={{flexShrink:0,width:64,height:64,borderRadius:RADIUS.md,overflow:"hidden",background:T.sand,display:"flex",alignItems:"center",justifyContent:"center",textDecoration:"none"}}>
        {photoUrl ? (
          <img src={photoUrl} alt={gem.title} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
        ) : !photoLoaded ? (
          <div style={{width:"100%",height:"100%",background:T.sand,animation:"shimmer 1.5s ease-in-out infinite"}}/>
        ) : (
          <span style={{fontSize:26}}>{gem.icon || "📍"}</span>
        )}
      </a>
      <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",gap:2}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:6}}>
          <div style={{fontFamily:"'DM Serif Display',serif",fontSize:14,color:T.ink,lineHeight:1.25,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis"}}>
            {gem.icon ? `${gem.icon} ` : ""}{gem.title}
          </div>
          <div style={{position:"relative",flexShrink:0}}>
            <button onClick={()=>setMenuOpen(m=>!m)} style={{background:"transparent",border:"none",cursor:"pointer",fontSize:16,padding:"0 3px",color:T.mist,lineHeight:1}}>⋯</button>
            {menuOpen && (
              <>
                <div onClick={()=>setMenuOpen(false)} style={{position:"fixed",inset:0,zIndex:99}}/>
                <div style={{position:"absolute",right:0,top:22,zIndex:100,background:T.chalk,borderRadius:RADIUS.lg,boxShadow:SHADOW.md,border:`1px solid ${T.sand}`,minWidth:180,overflow:"hidden"}}>
                  <button onClick={()=>{ setMenuOpen(false); onAdd?.(); }} style={{display:"block",width:"100%",textAlign:"left",padding:"11px 16px",background:"none",border:"none",fontFamily:"Georgia,serif",fontSize:13,color:T.ink,cursor:"pointer",borderBottom:`1px solid ${T.sand}`}}>➕ Add to Itinerary</button>
                  <button onClick={()=>{ setMenuOpen(false); onAskTrippy?.(); }} style={{display:"block",width:"100%",textAlign:"left",padding:"11px 16px",background:"none",border:"none",fontFamily:"Georgia,serif",fontSize:13,color:T.ink,cursor:"pointer",borderBottom:`1px solid ${T.sand}`}}>💬 Ask Trippy</button>
                  <button onClick={()=>{ setMenuOpen(false); onDismiss?.(); }} style={{display:"block",width:"100%",textAlign:"left",padding:"11px 16px",background:"none",border:"none",fontFamily:"Georgia,serif",fontSize:13,color:T.error,cursor:"pointer"}}>🗑 Dismiss</button>
                </div>
              </>
            )}
          </div>
        </div>
        {gem.note && (
          <div style={{fontSize:12,color:T.mist,fontFamily:"Georgia,serif",lineHeight:1.35,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>
            {gem.note}
          </div>
        )}
        {nearMatches && (
          <div style={{fontSize:11,color:T.ocean,fontFamily:"Georgia,serif",marginTop:2}}>
            📍 Near {gem.near}
          </div>
        )}
      </div>
    </div>
  );
}

function WishlistSection({ items, city, activities, onAddToItinerary, onDismiss, onAskTrippy }) {
  const visible = (items || []).filter(it => !it.dismissed);
  if (!visible.length) return null;
  return (
    <div style={{padding:"4px 20px 8px"}}>
      <div style={{fontFamily:"'DM Serif Display',serif",fontSize:14,color:T.ink,marginBottom:8}}>
        ✨ Local gems · {visible.length} nearby
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {visible.map((gem, i) => (
          <GemCard key={gem.id || i} gem={gem} city={city} activities={activities}
            onAdd={()=>onAddToItinerary?.(gem)}
            onDismiss={()=>onDismiss?.(gem)}
            onAskTrippy={()=>onAskTrippy?.(gem.title)}/>
        ))}
      </div>
    </div>
  );
}

/* ─── COMPACT DAY VIEW ────────────────────────────────────────────── */
function DayCompact({ day, displayCity, onExpand, canExpand = true }) {
  const acts = day.activities || [];
  const hotel = acts.find(a => a.type === "hotel");
  const transit = acts.find(a => a.type === "transit");
  const meaningful = acts.filter(a => a.type !== "transit" && a.type !== "hotel");

  // Group consecutive food items, consecutive sights, etc.
  const lines = [];
  let currentGroup = [];
  let currentType = null;
  for (const act of meaningful) {
    const groupType = act.type === "food" ? "food" : "activity";
    if (groupType === currentType) {
      currentGroup.push(act);
    } else {
      if (currentGroup.length) lines.push({ type: currentType, items: currentGroup });
      currentGroup = [act];
      currentType = groupType;
    }
  }
  if (currentGroup.length) lines.push({ type: currentType, items: currentGroup });

  const mapsLink = (text, city) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${text} ${city || day.city}`)}`;

  return (
    <div style={{ marginBottom: 8, background: T.chalk, borderRadius: RADIUS.lg, border: `1px solid ${T.sand}`, padding: "12px 14px" }}>
      {/* Day header — clickable to expand if detailed data is ready */}
      <div onClick={canExpand ? onExpand : undefined} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, cursor: canExpand ? "pointer" : "default" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ background: T.ocean, color: "white", borderRadius: RADIUS.md, padding: "3px 10px", fontFamily: "'DM Serif Display',serif", fontSize: 12 }}>{day.label}</div>
          <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 16, color: T.ink }}>{displayCity || day.city}</div>
        </div>
        {canExpand ? <span style={{ fontSize: 10, color: T.mist }}>▼</span> : !canExpand && <span style={{width:8,height:8,border:`1.5px solid ${T.sand}`,borderTopColor:T.ocean,borderRadius:"50%",animation:"spin 0.8s linear infinite",display:"inline-block"}}></span>}
      </div>

      {/* Transit */}
      {transit && (
        <a href={mapsLink(transit.geocode || transit.title)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, fontFamily: "Georgia,serif", color: T.mist, marginBottom: 6, display: "flex", alignItems: "center", gap: 4, textDecoration: "none" }}>
          {transit.icon} {transit.title}
        </a>
      )}

      {/* Hotel */}
      {hotel && (
        <a href={mapsLink(hotel.geocode || hotel.title.replace(/^Check in at /i, ""))} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, fontFamily: "Georgia,serif", color: T.ink, marginBottom: 6, display: "flex", alignItems: "center", gap: 4, textDecoration: "none" }}>
          🏨 {hotel.title.replace(/^Check in at /i, "")} {hotel.note ? `· ${hotel.note}` : ""}
        </a>
      )}

      {/* Activity lines — grouped */}
      {lines.map((line, li) => (
        <div key={li} style={{ fontSize: 11, fontFamily: "Georgia,serif", color: T.ink, marginBottom: 3, lineHeight: 1.5 }}>
          {line.items.map((act, ai) => (
            <span key={ai}>
              {ai > 0 && <span style={{ color: T.mist }}> → </span>}
              <a href={mapsLink(act.geocode || act.title)} target="_blank" rel="noopener noreferrer" style={{ color: T.ink, textDecoration: "none" }}>
                {act.icon} {act.title}
              </a>
            </span>
          ))}
        </div>
      ))}

      {/* Wishlist count removed from compact view */}
      {false && day.wishlist?.length > 0 && (
        <div style={{ fontSize: 10, fontFamily: "Georgia,serif", color: T.terra, marginTop: 4 }}>
          ✨ {day.wishlist.length} local gem{day.wishlist.length > 1 ? "s" : ""} nearby
        </div>
      )}
    </div>
  );
}

function DaySection({ day, dayIndex = 0, onEditActivity, onRemoveActivity, onReplaceActivity, onSuggestAlternatives, onChangeHotel, arrivalTime = null, arrivalMode = null, arrivalCity = null, arrivalAirportIata = null, onEditFlight, departureTime = null, departureMode = null, departureCity = null, departureAirportIata = null, onEditDeparture, hotelActivity = null, hotelCity = null, endHotelActivity = null, displayCity = null, onSelectHotel, onAskTrippy, onCollapse = null, originIata = null, originDepartureHHMM = null, destIata = null, destArrivalHHMM = null, onAddGemToItinerary, onDismissGem }) {
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
        <div style={{background:T.ocean,color:"white",borderRadius:RADIUS.md,padding:"5px 13px",fontFamily:"'DM Serif Display',serif",fontSize:14}}>{day.label}</div>
        <div style={{flex:1}}>
          <div style={{fontFamily:"'DM Serif Display',serif",fontSize:20,color:T.ink,lineHeight:1}}>{displayCity || day.city}</div>
          <div style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif",marginTop:2}}>{day.date} · {total} activities</div>
        </div>
        {dayMapsUrl && (
          <a href={dayMapsUrl} target="_blank" rel="noopener noreferrer"
            style={{fontSize:12,color:T.ocean,textDecoration:"none",background:"#EBF3FD",
              borderRadius:RADIUS.full,padding:"4px 11px",fontFamily:"Georgia,serif",flexShrink:0,whiteSpace:"nowrap"}}>
            <img src="/google-maps-icon.png" alt="" style={{width:12,height:12,objectFit:"contain"}}/> Route
          </a>
        )}
        {onCollapse && (
          <span onClick={onCollapse} style={{fontSize:10,color:T.mist,cursor:"pointer",flexShrink:0}}>▲</span>
        )}
        {day.description && (
          <button onClick={()=>setShowDesc(s=>!s)} title="About this day"
            style={{background:showDesc?"#EBF3FD":"transparent",border:`1.5px solid ${showDesc?T.ocean:T.sand}`,
              borderRadius:RADIUS.full,padding:"4px 10px",cursor:"pointer",fontSize:13,color:showDesc?T.ocean:T.mist,flexShrink:0,lineHeight:1}}>
            📖
          </button>
        )}
      </div>

      {/* Transit tip */}
      {day.transit_tip && (
        <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 20px 8px",fontSize:11,color:"#7B5EA7",fontFamily:"Georgia,serif",background:"#F5F0FA",borderRadius:RADIUS.md,margin:"0 16px 8px"}}>
          🚇 {day.transit_tip}
        </div>
      )}

      {/* Day description */}
      {day.description && showDesc && (
        <div style={{margin:"0 20px 12px",padding:"12px 16px",background:"#F5F9FF",borderRadius:RADIUS.lg,border:`1px solid #D6E8FF`}}>
          <div style={{fontSize:13,color:T.dusk,fontFamily:"Georgia,serif",fontStyle:"italic",lineHeight:1.7}}>
            {day.description}
          </div>
        </div>
      )}

      {/* Arrival timeline */}
      {arrivalTime && (
        <ArrivalTimeline arrivalTime={arrivalTime} arrivalMode={arrivalMode} onEditFlight={onEditFlight} airportIata={arrivalAirportIata} originIata={originIata} originDepartureHHMM={originDepartureHHMM} />
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

      {/* Hotel carousel — shown when day has hotel_options and no hotel already selected */}
      {day.hotel_options?.length > 0 && !day.activities.some(a => a.type === "hotel") && (
        <HotelCarousel
          options={day.hotel_options}
          checkInTime={day.hotel_check_in_time}
          selectedTitle={null}
          onSelect={onSelectHotel}
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
        // For transit activities, build a hotel-to-hotel Maps URL
        const transitMapsUrl = (() => {
          if (act.type !== "transit" || !act.geocode_end) return null;
          const originGeocode = hotelActivity?.geocode || null;
          const destHotel = day.activities.slice(i + 1).find(a => a.type === "hotel");
          const destGeocode = destHotel?.geocode || null;
          if (!originGeocode && !destGeocode) return null;
          const o = encodeURIComponent(originGeocode || act.geocode || day.city);
          const d = encodeURIComponent(destGeocode || act.geocode_end);
          return `https://www.google.com/maps/dir/${o}/${d}`;
        })();
        return (
          <div key={act.id}>
            <ActivityCard activity={act} city={day.city}
              onEdit={(updated)=>onEditActivity(day.id, updated)}
              onRemove={()=>onRemoveActivity?.(day.id, act.id)}
              onReplace={()=>onReplaceActivity?.(act)}
              onSuggestAlternatives={()=>onSuggestAlternatives?.(act)}
              onChangeHotel={(mode)=>onChangeHotel?.(day.id, act, mode)}
              transitMapsUrl={transitMapsUrl}
              onAskTrippy={onAskTrippy}/>
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
      {day.wishlist?.some(w => !w.dismissed) && (
        <WishlistSection
          items={day.wishlist}
          city={day.city}
          activities={day.activities || []}
          onAddToItinerary={(gem) => onAddGemToItinerary?.(day, gem)}
          onDismiss={(gem) => onDismissGem?.(day, gem)}
          onAskTrippy={onAskTrippy}
        />
      )}

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
        <DepartureTimeline departureTime={departureTime} departureMode={departureMode} onEdit={onEditDeparture} airportIata={departureAirportIata} destIata={destIata} destArrivalHHMM={destArrivalHHMM} />
      )}
    </div>
  );
}

/* ─── SUGGESTION CARD ────────────────────────────────────────────────── */
function SuggestionCard({ suggestion, onSelect, onKnowMore }) {
  const [photoUrl, setPhotoUrl] = useState(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    _fetchPhoto(suggestion.geocode || suggestion.title, null, suggestion.type).then(url => {
      if (cancelled) return;
      setPhotoUrl(url);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [suggestion.geocode]);
  return (
    <div style={{
      flexShrink:0, width:148, borderRadius:RADIUS.lg, overflow:"hidden",
      border:`1px solid ${T.sand}`, background:T.chalk,
      boxShadow:SHADOW.sm,
    }}>
      <div onClick={onSelect} style={{cursor:"pointer"}}>
        {(!loaded || photoUrl) && (
          <div style={{height:90, background:T.sand, overflow:"hidden", position:"relative"}}>
            {!loaded && <div style={{position:"absolute",inset:0,background:T.sand,animation:"shimmer 1.5s ease-in-out infinite"}}/>}
            {photoUrl && <img src={photoUrl} onLoad={()=>setLoaded(true)} alt={suggestion.title} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>}
          </div>
        )}
        <div style={{padding:"8px 10px 6px"}}>
          <div style={{fontFamily:"'DM Serif Display',serif",fontSize:12,color:T.ink,lineHeight:1.3,marginBottom:3}}>{suggestion.title}</div>
          {suggestion.note && <div style={{fontFamily:"Georgia,serif",fontSize:10,color:T.mist,lineHeight:1.3}}>{suggestion.note}</div>}
        </div>
      </div>
      <div style={{padding:"0 8px 8px",display:"flex",gap:5}}>
        <button onClick={onKnowMore} style={{flex:1,padding:"5px 0",borderRadius:RADIUS.md,border:`1px solid ${T.sand}`,background:"transparent",fontFamily:"Georgia,serif",fontSize:10,color:T.mist,cursor:"pointer"}}>Know more</button>
        <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(suggestion.geocode || suggestion.title)}`} target="_blank" rel="noopener noreferrer"
          style={{display:"flex",alignItems:"center",justifyContent:"center",width:26,borderRadius:RADIUS.md,border:`1px solid ${T.sand}`,textDecoration:"none",flexShrink:0}}>
          <img src="/google-maps-icon.png" alt="Maps" style={{width:13,height:13,objectFit:"contain"}}/>
        </a>
      </div>
    </div>
  );
}

/* ─── HOTEL CAROUSEL ─────────────────────────────────────────────────── */
function HotelCard({ hotel, selected, onSelect }) {
  const [photoUrl, setPhotoUrl] = useState(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    _fetchPhoto(hotel.geocode || hotel.title, null, "hotel", { context: "itinerary" }).then(url => { if (!cancelled) { setPhotoUrl(url); setLoaded(true); } });
    return () => { cancelled = true; };
  }, [hotel.geocode]);
  return (
    <div onClick={onSelect} style={{
      flexShrink:0, width:150, borderRadius:RADIUS.lg, overflow:"hidden",
      border:`2px solid ${selected ? T.ocean : T.sand}`,
      background:T.chalk, cursor:"pointer",
      boxShadow: selected ? `0 0 0 3px ${T.ocean}33` : SHADOW.sm,
      transition:`all ${MOTION.normal}`,
    }}>
      {(!loaded || photoUrl) && (
        <div style={{height:95, background:T.sand, overflow:"hidden", position:"relative"}}>
          {!loaded && <div style={{position:"absolute",inset:0,background:T.sand,animation:"shimmer 1.5s ease-in-out infinite"}}/>}
          {photoUrl && <img src={photoUrl} onLoad={()=>setLoaded(true)} alt={hotel.title} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>}
          {selected && <div style={{position:"absolute",top:6,right:6,background:T.ocean,borderRadius:"50%",width:20,height:20,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:"white"}}>✓</div>}
        </div>
      )}
      {loaded && !photoUrl && selected && (
        <div style={{padding:"6px 10px 0",textAlign:"right"}}>
          <div style={{display:"inline-flex",background:T.ocean,borderRadius:"50%",width:20,height:20,alignItems:"center",justifyContent:"center",fontSize:11,color:"white"}}>✓</div>
        </div>
      )}
      <div style={{padding:"8px 10px 10px"}}>
        <div style={{fontFamily:"'DM Serif Display',serif",fontSize:12,color:T.ink,lineHeight:1.3,marginBottom:3}}>{hotel.title}</div>
        {hotel.note && <div style={{fontFamily:"Georgia,serif",fontSize:10,color:T.mist,lineHeight:1.3}}>{hotel.note}</div>}
      </div>
    </div>
  );
}

function HotelCarousel({ options, checkInTime, selectedTitle, onSelect }) {
  return (
    <div style={{padding:"12px 20px 4px"}}>
      <div style={{fontFamily:"Georgia,serif",fontSize:11,color:T.mist,marginBottom:10,letterSpacing:0.3}}>
        🏨 PICK YOUR HOTEL · check-in {checkInTime || ""}
      </div>
      <div style={{display:"flex",gap:10,overflowX:"auto",paddingBottom:4,scrollbarWidth:"none"}}>
        {options.map((h, i) => (
          <HotelCard key={i} hotel={h} selected={selectedTitle === h.title} onSelect={() => onSelect(h)} />
        ))}
      </div>
    </div>
  );
}

/* ─── SETUP FORM (extracted to components/SetupForm.jsx) ─── */
/* ─── ROOT ───────────────────────────────────────────────────────────── */
export default function App({ session, initialTrip, initialScreen = "setup", initialTab = null, initialSetupStep = 0, onHome, onUrlChange }) {
  // Draft trip (RG done, no IG yet) → go straight to routes, not setup form
  const isDraft = initialTrip && !initialTrip.ig_response;
  const [screen,    setScreen]    = useState(isDraft ? "brainstorm" : initialScreen);
  const [setupStep, setSetupStep] = useState(0);
  const [trip,      setTrip]      = useState(initialTrip || SAMPLE_TRIP);
  useEffect(() => { setActiveTripId(trip?.id || null); setTripDestination(trip?.destination || ""); }, [trip?.id, trip?.destination]);
  const [days,      setDays]      = useState([]);
  const daysRef = useRef(days);
  useEffect(() => { daysRef.current = days; }, [days]);
  // Cache days for offline viewing
  useEffect(() => {
    const tripId = trip?.id;
    if (tripId && days.length > 0) {
      try { localStorage.setItem(`tripjam_days_${tripId}`, JSON.stringify(days)); } catch {}
    }
  }, [days, trip?.id]);
  const [loading,   setLoading]   = useState(initialScreen === "itinerary");
  const [tab,         setTab]         = useState("plan");
  const [debugMode] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("debug") === "1";
    if (fromUrl) localStorage.setItem("tripjam_debug", "1");
    return fromUrl || localStorage.getItem("tripjam_debug") === "1";
  });
  const [activeDay, setActiveDay] = useState(0);

  const [generateError, setGenerateError] = useState("");
  const [streamingDays, setStreamingDays] = useState(0);
  const [streamingTotal, setStreamingTotal] = useState(0);
  const [allDaysPlanned, setAllDaysPlanned] = useState(false);
  const [generatingRoute, setGeneratingRoute] = useState(null); // selected route shown during IG generation

  useEffect(() => {
    if (initialScreen === "itinerary" && initialTrip?.id) {
      const processDays = (data) => {
        const seenPhotos = new Set();
        const allDays = (data || []).map(d => {
          // Lazy-backfill stable IDs on wishlist gems so dismiss/undo can target individual items.
          let wishlist = d.wishlist;
          if (Array.isArray(wishlist) && wishlist.some(w => !w.id)) {
            wishlist = wishlist.map(w => w.id ? w : { ...w, id: crypto.randomUUID() });
          }
          return {
            ...d,
            wishlist,
            activities: (d.activities || []).sort((a, b) => a.position - b.position).map(a => {
              if (a.photo_url) {
                if (seenPhotos.has(a.photo_url)) return { ...a, photo_url: null };
                seenPhotos.add(a.photo_url);
                _usedPhotoUrls.add(a.photo_url);
              }
              return a;
            }),
          };
        });
        const seen = new Set();
        return allDays.filter(d => { if (seen.has(d.label)) return false; seen.add(d.label); return true; });
      };
      supabase
        .from("days")
        .select("*, activities(*)")
        .eq("trip_id", initialTrip.id)
        .order("position")
        .then(async ({ data, error }) => {
          if (data?.length) {
            const deduped = processDays(data);
            setDays(deduped);
            // Persist any newly-generated gem IDs (fire-and-forget; idempotent)
            for (let i = 0; i < deduped.length; i++) {
              const orig = data[i];
              const next = deduped[i];
              const origNeedsBackfill = Array.isArray(orig?.wishlist) && orig.wishlist.some(w => !w.id);
              if (origNeedsBackfill) {
                supabase.from("days").update({ wishlist: next.wishlist }).eq("id", next.id).then(() => {});
              }
            }
            // Cache for offline viewing
            try { localStorage.setItem(`tripjam_days_${initialTrip.id}`, JSON.stringify(deduped)); } catch {}
          } else if (error || !data?.length) {
            // Offline fallback: load from localStorage
            try {
              const cached = localStorage.getItem(`tripjam_days_${initialTrip.id}`);
              if (cached) setDays(JSON.parse(cached));
            } catch {}
          }
          setLoading(false);
          // Pre-load Day 1 for existing trips
          setTimeout(() => preloadDay(0), 100);
        });
    }
  }, []);

  const [activeBottomTab, setActiveBottomTab] = useState(initialTab || "itinerary");
  const [boardInitialSection, setBoardInitialSection] = useState(null);

  // Sync URL when screen/tab changes
  useEffect(() => {
    if (!onUrlChange || !trip?.id) return;
    if (screen === "itinerary") {
      const tabPath = activeBottomTab === "itinerary" ? "" : `/${activeBottomTab === "brainstorm" ? "magazine" : activeBottomTab}`;
      onUrlChange(`/trip/${trip.id}${tabPath}`);
    } else if (screen === "brainstorm") {
      onUrlChange(`/trip/${trip.id}/plans`);
    }
  }, [screen, activeBottomTab, trip?.id]);
  const [compactView, setCompactView] = useState(true); // start in compact mode
  const [collapsedDays, setCollapsedDays] = useState(new Set()); // per-day collapse in detailed view
  const [detailedLoading, setDetailedLoading] = useState(false); // true while full IG loads in background
  const [detailedReady, setDetailedReady] = useState(initialScreen === "itinerary"); // true if opening existing trip
  const preloadedDaysRef = useRef(new Set()); // track which day indices have been pre-loaded

  // Pre-load a day's geocoding + photos (warms caches for TransitionRow + PhotoStrip)
  const preloadDay = useCallback((dayIndex) => {
    if (preloadedDaysRef.current.has(dayIndex)) return;
    const day = daysRef.current[dayIndex];
    if (!day?.activities?.length) return;
    preloadedDaysRef.current.add(dayIndex);
    const acts = day.activities;
    // Pre-geocode all activities
    for (const act of acts) {
      if (act.geocode && act.type !== "transit") {
        geocodePlace(act.title, day.city, act.geocode);
      }
    }
    // Pre-fetch photos
    for (const act of acts) {
      if (act.type !== "transit" && act.type !== "hotel" && !act.photo_url) {
        const key = act.geocode || act.title;
        if (key) _fetchPhoto(key, day.city, act.type || "sight");
      }
    }
  }, []);

  // When streamingDays increases, pre-load the first ready day (Day 1)
  useEffect(() => {
    if (streamingDays >= 1 && days.length >= 1) {
      preloadDay(0);
    }
  }, [streamingDays, days.length, preloadDay]);

  // Resolve user's home (base_location) → nearest airport IATA for rendering origin/destination flight info.
  const [baseAirportIata, setBaseAirportIata] = useState(null);
  // Estimated origin departure HH:MM (on Day 1) and destination arrival HH:MM (on last day) based on haversine + cruise speed.
  const [originDepartureHHMM, setOriginDepartureHHMM] = useState(null);
  const [destArrivalHHMM, setDestArrivalHHMM]         = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (!trip?.base_location) {
      setBaseAirportIata(null); setOriginDepartureHHMM(null); setDestArrivalHHMM(null);
      return;
    }
    (async () => {
      const { resolveAirportForCity, findAirportByIata } = await import("./airports.js");
      const { haversineMeters } = await import("./photos");
      const baseAp = await resolveAirportForCity(trip.base_location);
      if (cancelled) return;
      setBaseAirportIata(baseAp?.iata || null);
      // Compute approximate origin departure / destination arrival times if we have base + arrival/departure IATAs.
      const flightMins = (a, b) => {
        if (!a || !b) return null;
        const dKm = haversineMeters({lat:a.lat,lng:a.lng}, {lat:b.lat,lng:b.lng}) / 1000;
        return Math.round(dKm / 800 * 60 + 90); // 800 km/h cruise + 90 min buffer
      };
      const addMins = (hhmm, mins, sign) => {
        if (!hhmm || !mins) return null;
        const [h, m] = hhmm.split(":").map(Number);
        let total = h * 60 + m + sign * mins;
        total = ((total % 1440) + 1440) % 1440;
        return `${String(Math.floor(total/60)).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`;
      };
      const arrAp = trip.arrival_airport_iata ? await findAirportByIata(trip.arrival_airport_iata) : null;
      const depAp = trip.departure_airport_iata ? await findAirportByIata(trip.departure_airport_iata) : null;
      if (cancelled) return;
      const arrHHMM = trip.arrival_time ? trip.arrival_time.split("T")[1]?.substring(0,5) : null;
      const depHHMM = trip.departure_time ? trip.departure_time.split("T")[1]?.substring(0,5) : null;
      setOriginDepartureHHMM(baseAp && arrAp && arrHHMM ? addMins(arrHHMM, flightMins(baseAp, arrAp), -1) : null);
      setDestArrivalHHMM(baseAp && depAp && depHHMM ? addMins(depHHMM, flightMins(depAp, baseAp), +1) : null);
    })();
    return () => { cancelled = true; };
  }, [trip?.base_location, trip?.arrival_airport_iata, trip?.departure_airport_iata, trip?.arrival_time, trip?.departure_time]);

  const [pretripTab, setPretripTab] = useState("brainstorm"); // pre-trip bottom nav tab
  const [magazineFilterCities, setMagazineFilterCities] = useState(null); // cities to filter magazine by (from "Tell me more")
  const [pretripDeepDiveCity, setPretripDeepDiveCity] = useState(null); // city for deep dive in pre-trip magazine
  const [showPreIgSheet, setShowPreIgSheet] = useState(false); // pre-IG refinement bottom sheet
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false); // confirm before replacing existing itinerary
  const [showEditConfirm, setShowEditConfirm] = useState(null); // { changes: [...], isStructural: bool, form: {...} }
  const [preIgForm, setPreIgForm] = useState({ budget: "mid", morningStart: "early", pace: "active", igNotes: "" });
  const [magazineFilterRouteId, setMagazineFilterRouteId] = useState(null);
  const [chatOpen, setChatOpen] = useState(false); // floating chat sheet
  const [fabPos, setFabPos] = useState({ right: 0, bottom: 140 }); // draggable FAB position, flush right
  const fabDragRef = useRef({ dragging: false, startX: 0, startY: 0, startRight: 0, startBottom: 0 });
  const [pretripRoutes, setPretripRoutes] = useState([]); // tier 1 routes for pre-trip map
  const [pretripSelectedRouteId, setPretripSelectedRouteId] = useState(null);
  const [deepDiveCacheApp, setDeepDiveCacheApp] = useState({}); // App-level city deep-dive cache

  const loadCityDeepDiveApp = async (city) => {
    if (!city) return;
    const existing = deepDiveCacheApp[city];
    if (existing && existing !== "error") return;
    setDeepDiveCacheApp(prev => ({ ...prev, [city]: "loading" }));
    try {
      const travelMonth = (trip?.start_date || pendingForm?.startDate) ? new Date(trip?.start_date || pendingForm?.startDate).toLocaleString("en-US", { month: "long" }) : null;
      const igReq = trip?.ig_request || pendingForm || {};
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/city-deep-dive`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({
          city,
          country: trip?.destination || (pendingForm?.destinations || []).join(", ") || null,
          travelMonth,
          styles: igReq.styles,
          budget: igReq.budget,
          notes: igReq.notes || trip?.notes || null,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDeepDiveCacheApp(prev => ({ ...prev, [city]: data }));
      // Pre-fetch photos for moreSights so they're ready when Magazine opens
      if (data?.moreSights?.length) {
        for (const s of data.moreSights) {
          const key = s.geocode || s.title;
          if (key) _fetchPhoto(key, city, "sight");
        }
      }
    } catch (e) {
      console.warn("city-deep-dive failed:", e.message);
      setDeepDiveCacheApp(prev => ({ ...prev, [city]: "error" }));
    }
  };
  // Background-load city-deep-dive for Magazine — destination + top 2 cities only
  // Other cities are lazy-loaded when Magazine tab opens or user scrolls
  useEffect(() => {
    if (pretripRoutes.length === 0) return;
    // 1. Destination-level intro (e.g. "Japan", "Sri Lanka") — always first
    const rawDests = (pendingForm?.destinations || []).filter(d => !d.toLowerCase().includes("help me decide"));
    const destination = editingTrip?.destination || trip?.destination || (rawDests.length ? rawDests.join(", ") : null);
    if (destination && !deepDiveCacheApp[destination]) loadCityDeepDiveApp(destination);

    // 2. Find the 2 most common cities across all routes and pre-load those
    const cityCount = {};
    for (const route of pretripRoutes) {
      for (const c of (route.city || "").split(",").map(s => s.trim()).filter(Boolean)) {
        cityCount[c] = (cityCount[c] || 0) + 1;
      }
    }
    const topCities = Object.entries(cityCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([city]) => city);
    for (const city of topCities) {
      if (!deepDiveCacheApp[city]) loadCityDeepDiveApp(city);
    }
  }, [pretripRoutes.length]);

  // Lazy-load remaining city deep dives when Magazine tab opens — staggered to avoid burst
  useEffect(() => {
    if (pretripTab !== "magazine" || pretripRoutes.length === 0) return;
    const allCities = new Set();
    for (const route of pretripRoutes) {
      for (const c of (route.city || "").split(",").map(s => s.trim()).filter(Boolean)) {
        allCities.add(c);
      }
    }
    const uncached = [...allCities].filter(c => !deepDiveCacheApp[c]);
    if (uncached.length === 0) return;
    const timers = uncached.map((city, i) => setTimeout(() => loadCityDeepDiveApp(city), i * 500));
    return () => timers.forEach(clearTimeout);
  }, [pretripTab, pretripRoutes.length]);

  const [chatUnread, setChatUnread] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput,   setChatInput]   = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatAttention, setChatAttention] = useState(false);
  const chatBottomRef = useRef(null);
  const chatInputRef  = useRef(null);
  const getChatPlaceholder = () => {
    if (screen === "brainstorm") return pretripRoutes.filter(r => r.title && !r.dismissed).length >= 2 ? "Ask Trippy to tweak any plan" : "Trippy's cooking up some plans…";
    return detailedReady
      ? ["Swap a restaurant? Change the hotel? Just ask", "What would make this trip perfect?", "Trippy knows all the local secrets…"][Math.floor(Math.random() * 3)]
      : "Your itinerary is brewing…";
  };
  // chatFilter removed — no group features in phase 1
  // mention/tagging removed — phase 1 is AI-only chat
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: chatOpen ? "instant" : "smooth" });
  }, [chatMessages, chatLoading, chatOpen]);

  // Load persisted messages and subscribe to real-time updates
  useEffect(() => {
    if (!trip?.id) return;
    supabase
      .from("trip_messages")
      .select("id, role, content, user_id")
      .eq("trip_id", trip.id)
      .order("created_at")
      .then(({ data }) => {
        const loaded = (data || []).map(m => ({ id: m.id, role: m.role, content: m.content, user_id: m.user_id }));
        setChatMessages(prev => {
          // If the user already sent messages while we were loading (e.g. right after IG),
          // and the DB returned nothing, keep the local state rather than wiping it.
          if (loaded.length === 0 && prev.length > 0) return prev;
          return loaded;
        });
      });
  }, [trip?.id]);
  const [setupModal,  setSetupModal]  = useState(null);
  const [editingTrip, setEditingTrip] = useState(() => (isDraft || (initialScreen === "setup" && initialTrip?.id)) ? initialTrip : null);
  const [pendingForm, setPendingForm] = useState(() => {
    if (!isDraft) return null;
    const igReq = initialTrip.ig_request || {};
    return {
      destinations: (initialTrip.destination || "").split(" → ").map(s => s.trim()).filter(Boolean),
      startDate: initialTrip.start_date || "", endDate: initialTrip.end_date || "",
      travelers: String(igReq.travelers || "2"), styles: igReq.styles || [],
      notes: initialTrip.notes || igReq.notes || "",
      arrivalCity: initialTrip.arrival_city || "", departureCity: initialTrip.departure_city || "",
      arrivalTime: igReq.arrivalTime || "", departureTime: igReq.departureTime || "",
    };
  });
  const [formEdited, setFormEdited] = useState(false);
  const [showShare,   setShowShare]   = useState(false);
  const shareCardRef = useRef(null);
  const [flightsForm, setFlightsForm] = useState({ arrivalTime:"", departureTime:"" });
  const scrollRef     = useRef(null);
  const dayRefs       = useRef([]);
  const pillStrip     = useRef(null);
  const isJumping     = useRef(false);
  const undoDismissRef = useRef(null);
  const triggerRgRef = useRef(null); // imperative trigger for RG generation
  const igAbortRef = useRef(null); // abort controller for in-flight IG generation

  const editActivity = (dayId, updated) => {
    setDays(prev=>prev.map(d=>d.id===dayId?{...d,activities:d.activities.map(a=>a.id===updated.id?updated:a)}:d));
  };

  const selectHotel = async (dayId, hotel) => {
    const day = days.find(d => d.id === dayId);
    if (!day) return;
    const checkInTime = day.hotel_check_in_time || "14:00";
    // Remove any existing hotel activity on this day
    const existingHotel = day.activities.find(a => a.type === "hotel");
    if (existingHotel) {
      await supabase.from("activities").delete().eq("id", existingHotel.id);
    }
    // Insert new hotel activity
    const position = day.activities.filter(a => a.time <= checkInTime).length;
    const { data: newAct } = await supabase.from("activities").insert({
      day_id: dayId, time: checkInTime,
      title: `Check in at ${hotel.title}`, geocode: hotel.geocode || hotel.title,
      type: "hotel", duration: "0.5h", note: hotel.note, icon: "🏨",
      confirmed: false, position, added_by: session.user.id,
    }).select().single();
    // Clear hotel_options from day once a hotel is selected
    await supabase.from("days").update({ hotel_options: null, hotel_check_in_time: null }).eq("id", dayId);
    setDays(prev => prev.map(d => {
      if (d.id !== dayId) return d;
      const acts = d.activities.filter(a => a.type !== "hotel");
      const inserted = newAct || { id: `tmp-${Date.now()}`, time: checkInTime, title: `Check in at ${hotel.title}`, geocode: hotel.geocode, type: "hotel", duration: "0.5h", note: hotel.note, icon: "🏨", confirmed: false, position };
      acts.splice(position, 0, inserted);
      return { ...d, activities: acts, hotel_options: null, hotel_check_in_time: null };
    }));
  };

  const removeActivity = async (dayId, activityId) => {
    // Snapshot the activity before removing for undo
    const daySnap = days.find(d => d.id === dayId);
    const actSnap = daySnap?.activities.find(a => a.id === activityId);
    await supabase.from("activities").delete().eq("id", activityId);
    setDays(prev=>prev.map(d=>d.id===dayId?{...d,activities:d.activities.filter(a=>a.id!==activityId)}:d));
    if (actSnap) {
      const undoMsg = {
        role: "system-undo",
        content: `"${actSnap.title}" was removed.`,
        undoData: { dayId, actSnap },
        id: `undo-${Date.now()}`,
      };
      setChatMessages(prev => [...prev, undoMsg]);
      setChatUnread(true);
    }
  };

  const undoRemoveActivity = async (dayId, actSnap) => {
    const { data: inserted } = await supabase.from("activities").insert({
      day_id: dayId, time: actSnap.time, title: actSnap.title, geocode: actSnap.geocode || null,
      geocode_end: actSnap.geocode_end || null, type: actSnap.type, duration: actSnap.duration,
      note: actSnap.note, confirmed: actSnap.confirmed ?? false, icon: actSnap.icon,
      package: actSnap.package || null, position: actSnap.position, photo_url: actSnap.photo_url || null,
      added_by: session.user.id,
    }).select().single();
    if (inserted) {
      setDays(prev => prev.map(d => {
        if (d.id !== dayId) return d;
        const acts = [...d.activities, { ...actSnap, id: inserted.id }]
          .sort((a, b) => a.position - b.position);
        return { ...d, activities: acts };
      }));
      setChatMessages(prev => prev.filter(m => !(m.role === "system-undo" && m.undoData?.actSnap?.id === actSnap.id)));
    }
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

  const saveLogisticsFlights = async ({ arrivalCity, arrivalTime, arrivalMode, departureCity, departureTime, departureMode, hasCar, arrivalAirportIata, departureAirportIata }) => {
    const arrival_time   = arrivalTime   ? `${trip.start_date}T${arrivalTime}:00`   : null;
    const departure_time = departureTime ? `${trip.end_date}T${departureTime}:00`   : null;
    // If caller didn't pass an explicit IATA, derive from "Airport Name (XXX)" suffix; clear if no match.
    const iataFromSuffix = (s) => { const m = (s || "").match(/\(([A-Z]{3})\)\s*$/); return m ? m[1] : null; };
    const arrival_airport_iata   = arrivalAirportIata   !== undefined ? (arrivalAirportIata   || null) : iataFromSuffix(arrivalCity);
    const departure_airport_iata = departureAirportIata !== undefined ? (departureAirportIata || null) : iataFromSuffix(departureCity);
    await supabase.from("trips").update({
      arrival_city: arrivalCity || null, arrival_time, arrival_mode: arrivalMode || "flight", arrival_airport_iata,
      departure_city: departureCity || null, departure_time, departure_mode: departureMode || "flight", departure_airport_iata,
      has_car: hasCar || false,
    }).eq("id", trip.id);
    setTrip(t => ({ ...t, arrival_city: arrivalCity || null, arrival_time, arrival_mode: arrivalMode, arrival_airport_iata, departure_city: departureCity || null, departure_time, departure_mode: departureMode, departure_airport_iata, has_car: hasCar }));
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
        const res = await fetch(`${PLACES_PROXY}?action=hotel-photo`, {
          method: "POST", headers: PLACES_HEADERS,
          body: JSON.stringify({ q: h.name, city: h.city, tripId: trip.id, context: "chat" }),
        });
        const { url } = await res.json();
        if (url) await supabase.from("activities").update({ photo_url: url }).eq("id", hotelAct.id);
        editActivity(cityDay.id, { ...hotelAct, title: newTitle, photo_url: url || hotelAct.photo_url });
      } catch {
        editActivity(cityDay.id, { ...hotelAct, title: newTitle });
      }
    }
  };



  // Shorten destination list: "Osaka, Japan → Kyoto, Japan → Tokyo, Japan" → "Osaka → Kyoto → Tokyo (Japan)"
  const shortenDests = (dests) => {
    if (dests.length <= 1) return dests.join(" → ");
    const parts = dests.map(d => d.split(/,\s*/));
    if (parts.every(p => p.length >= 2)) {
      const suffix = parts[0].slice(1).join(", ");
      if (parts.every(p => p.slice(1).join(", ").toLowerCase() === suffix.toLowerCase())) {
        return `${parts.map(p => p[0]).join(" → ")} (${suffix})`;
      }
    }
    return dests.join(" → ");
  };

  const doSetupComplete = async (form, regenerate) => {
    posthog.capture("setup_complete", { destinations: form.destinations, styles: form.styles, travelers: form.travelers });
    setPendingForm(form);
    setFormEdited(true);
    setPretripTab("brainstorm");
    setScreen("brainstorm");

    if (regenerate) {
      setPretripRoutes([]);
      setPretripSelectedRouteId(null);
      // If regenerating routes and trip had an itinerary, reset it
      if (editingTrip?.ig_response) {
        setDays([]);
        setTrip(t => ({ ...t, ig_response: null }));
        if (editingTrip.id) {
          supabase.from("trips").update({ ig_response: null }).eq("id", editingTrip.id);
          // Delete existing days + activities
          const { data: existingDays } = await supabase.from("days").select("id").eq("trip_id", editingTrip.id);
          const dayIds = (existingDays || []).map(d => d.id);
          if (dayIds.length) await supabase.from("activities").delete().in("day_id", dayIds);
          await supabase.from("days").delete().eq("trip_id", editingTrip.id);
        }
      }
    }

    if (!editingTrip) {
      const draftId = crypto.randomUUID();
      const fmtD = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const dateRange = (form.startDate && form.endDate) ? ` · ${fmtD(form.startDate)}–${fmtD(form.endDate)}` : "";
      const draftName = `${shortenDests(form.destinations)}${dateRange}`;
      const igRequest = { destinations: form.destinations, numDays: form.startDate && form.endDate ? Math.max(1, Math.round((new Date(form.endDate) - new Date(form.startDate)) / 864e5) + 1) : null, travelers: form.travelers, styles: form.styles, notes: form.notes || null, startDate: form.startDate || null, endDate: form.endDate || null, arrivalCity: form.arrivalCity || null, departureCity: form.departureCity || null, arrivalTime: form.arrivalTime || null, departureTime: form.departureTime || null, arrivalMode: form.arrivalMode || null, departureMode: form.departureMode || null };
      const { error } = await supabase.from("trips").insert({
        id: draftId, name: draftName, destination: shortenDests(form.destinations),
        start_date: form.startDate, end_date: form.endDate, created_by: session.user.id, ig_request: igRequest,
        base_location: form.baseLocation || null,
        ...(form.notes && { notes: form.notes }),
        ...(form.arrivalCity && { arrival_city: form.arrivalCity }),
        ...(form.departureCity && { departure_city: form.departureCity }),
        ...(form.arrivalTime && { arrival_time: `${form.startDate}T${form.arrivalTime}:00` }),
        ...(form.departureTime && { departure_time: `${form.endDate}T${form.departureTime}:00` }),
        ...(form.arrivalMode && { arrival_mode: form.arrivalMode }),
        ...(form.departureMode && { departure_mode: form.departureMode }),
      });
      if (!error) {
        await supabase.from("trip_members").insert({ trip_id: draftId, user_id: session.user.id, role: "edit" });
        setEditingTrip({ id: draftId, name: draftName, destination: shortenDests(form.destinations), start_date: form.startDate, end_date: form.endDate, ig_request: igRequest });
        onUrlChange?.(`/trip/${draftId}/plans`);
      }
    } else {
      // Update existing trip with new form data
      const updates = { start_date: form.startDate, end_date: form.endDate, notes: form.notes || null,
        base_location: form.baseLocation || null,
        arrival_city: form.arrivalCity || null, departure_city: form.departureCity || null,
        ...(form.arrivalTime && { arrival_time: `${form.startDate}T${form.arrivalTime}:00` }),
        ...(form.departureTime && { departure_time: `${form.endDate}T${form.departureTime}:00` }),
      };
      await supabase.from("trips").update(updates).eq("id", editingTrip.id);
      setEditingTrip(t => ({ ...t, ...updates }));
      onUrlChange?.(`/trip/${editingTrip.id}/plans`);
    }

    if (regenerate) {
      setTimeout(() => { triggerRgRef.current?.(); }, 0);
    }
  };

  const handleSetupComplete = async (form) => {
    // New trip — no change detection needed
    if (!editingTrip || pretripRoutes.length === 0) {
      return doSetupComplete(form, true);
    }

    // Detect changes against previous form
    const old = pendingForm || {};
    const calcDays = (s, e) => s && e ? Math.max(1, Math.round((new Date(e) - new Date(s)) / 864e5) + 1) : null;
    const changes = [];
    const fmtD = (iso) => iso ? new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";

    const destsChanged = (form.destinations || []).join(",").toLowerCase() !== (old.destinations || []).join(",").toLowerCase();
    if (destsChanged) changes.push({ label: "Destinations", old: (old.destinations || []).join(" → "), new: form.destinations.join(" → ") });

    const oldDays = calcDays(old.startDate, old.endDate);
    const newDays = calcDays(form.startDate, form.endDate);
    const durationChanged = oldDays !== newDays;
    if (durationChanged) changes.push({ label: "Duration", old: oldDays ? `${oldDays} days` : "—", new: newDays ? `${newDays} days` : "—" });

    const datesShifted = !durationChanged && (form.startDate !== old.startDate || form.endDate !== old.endDate);
    if (datesShifted) changes.push({ label: "Dates", old: `${fmtD(old.startDate)}–${fmtD(old.endDate)}`, new: `${fmtD(form.startDate)}–${fmtD(form.endDate)}` });

    const arrivalChanged = (form.arrivalCity || "") !== (old.arrivalCity || "");
    const departureChanged = (form.departureCity || "") !== (old.departureCity || "");
    const baseChanged = (form.baseLocation || "") !== (old.baseLocation || "");

    if ((form.notes || "") !== (old.notes || "")) changes.push({ label: "Notes", old: (old.notes || "").slice(0, 30) + ((old.notes || "").length > 30 ? "…" : "") || "none", new: (form.notes || "").slice(0, 30) + ((form.notes || "").length > 30 ? "…" : "") || "none" });
    if (arrivalChanged) changes.push({ label: "Arrival city", old: old.arrivalCity || "—", new: form.arrivalCity || "—" });
    if (departureChanged) changes.push({ label: "Departure city", old: old.departureCity || "—", new: form.departureCity || "—" });
    if (baseChanged) changes.push({ label: "Base city", old: old.baseLocation || "—", new: form.baseLocation || "—" });

    // Travelers change is silent — saved in pendingForm, no dialog interrupt
    const travelersChanged = String(form.travelers) !== String(old.travelers || "2");

    // Nothing material changed — return to routes silently (also covers travelers-only changes)
    if (changes.length === 0) {
      setPendingForm(form);
      setPretripTab("brainstorm");
      setScreen("brainstorm");
      return;
    }

    // Structural changes invalidate current routes; soft changes (dates shifted, notes) are user's call
    const isStructural = destsChanged || durationChanged || arrivalChanged || departureChanged || baseChanged;

    setShowEditConfirm({ changes, isStructural, form });
  };

  const handleBuildFromBrainstorm = (votedItems, formOverride = null) => {
    const form = formOverride || pendingForm;
    if (!form) return;
    const selectedRoute = (votedItems || []).find(it => it.tier === 1 && it.vote === 1);
    posthog.capture("build_itinerary", { destination: form.destinations?.join(" → "), route: selectedRoute?.title });
    setFormEdited(false);
    if (formOverride) setPendingForm(formOverride);
    const freshenedItems = (votedItems || []).map(item => {
      if (item.tier !== 1) return item;
      const latest = pretripRoutes.find(r => r.id === item.id);
      return latest ? { ...item, ...latest, vote: item.vote } : item;
    });
    // Derive arrivalCity/departureCity from baseLocation if not set
    const finalForm = { ...form };
    if (form.baseLocation && !form.arrivalCity) finalForm.arrivalCity = form.baseLocation;
    if (form.baseLocation && !form.departureCity) finalForm.departureCity = form.baseLocation;
    handleGenerate(finalForm, freshenedItems);
  };

  const handleGenerate = async (form, votedItems = null) => {
    if (_igInFlight) return;
    _igInFlight = true;
    const capturedTripId = editingTrip?.id || null;
    let genLogId = null; // track this generation's log row
    setGenerateError("");
    setStreamingDays(0);
    preloadedDaysRef.current = new Set();
    setAllDaysPlanned(false);
    setDetailedLoading(false);
    setDetailedReady(false);
    setCompactView(true);
    const chosenRoute = (votedItems || []).find(it => it.tier === 1 && it.vote === 1) || null;
    setGeneratingRoute(chosenRoute);
    setScreen("generating");

    const numDays = Math.max(1, Math.round((new Date(form.endDate) - new Date(form.startDate)) / (1000*60*60*24)) + 1);
    setStreamingTotal(numDays);

    // Common request body for both compact and full calls
    const igDestinations = (() => {
      const cr = (votedItems || []).find(it => it.tier === 1 && it.vote === 1);
      if (cr?.city) {
        const cities = cr.city.split(",").map(c => c.trim()).filter(Boolean);
        if (cities.length) return cities;
      }
      return form.destinations;
    })();
    const igBody = {
      destinations: igDestinations,
      numDays, travelers: form.travelers, styles: form.styles, budget: form.budget, pace: form.pace, morningStart: form.morningStart, notes: form.notes || null, startDate: form.startDate || null, arrivalCity: form.arrivalCity || null, departureCity: form.departureCity || null,
      arrivalTime: form.arrivalTime || "09:00",
      departureTime: form.departureTime || "22:00",
      arrivalMode: form.arrivalMode || "flight",
      departureMode: form.departureMode || "flight",
      votedItems: votedItems || null,
    };

    // ── Single call: streams compact first, then full days ──
    let compactShown = false;
    let itinerary;
    let accumulated = "";
    const generationStartedAt = new Date().toISOString();
    try {
      const controller = new AbortController();
      igAbortRef.current = controller;
      const timeout = setTimeout(() => controller.abort(), 180000); // 3 min for long trips
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-itinerary`,
        {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
          body: JSON.stringify(igBody),
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

            // Detect compact section complete — render immediately
            if (!compactShown && /"compact"\s*:\s*\[/.test(accumulated) && /"days"\s*:\s*\[/.test(accumulated)) {
              try {
                // Extract just enough JSON to parse compact
                const compactEnd = accumulated.indexOf('"days"');
                if (compactEnd > 0) {
                  let partial = accumulated.slice(0, compactEnd).replace(/,\s*$/, "") + "}";
                  partial = partial.replace(/^```(?:json)?\s*/i, "").trim();
                  const s = partial.indexOf("{");
                  if (s >= 0) {
                    const compactData = JSON.parse(partial.slice(s));
                    if (compactData.compact?.length) {
                      compactShown = true;
                      const start = new Date(form.startDate);
                      const compactDays = compactData.compact.map((day, i) => {
                        const dayDate = new Date(start); dayDate.setDate(start.getDate() + i);
                        return {
                          id: `compact-${i}`, label: day.label || `Day ${i + 1}`, city: day.city || "",
                          date: dayDate.toISOString().split("T")[0], description: day.description || "",
                          activities: [
                            ...(day.hotel ? [{ id: `c-hotel-${i}`, type: "hotel", title: `Check in at ${day.hotel}`, icon: "🏨", time: "14:00", duration: "0.5h", note: "" }] : []),
                            ...(day.highlights || []).map((h, hi) => {
                              const title = typeof h === "string" ? h : h.title || "";
                              const llmIcon = typeof h === "object" ? h.icon : null;
                              const tl = title.toLowerCase();
                              const icon = llmIcon || (
                                /sushi|ramen|food|eat|dining|restaurant|cafe|bakery|market|street food/i.test(tl) ? "🍜"
                                : /temple|shrine|mosque|church|cathedral/i.test(tl) ? "⛩"
                                : /museum|gallery|art/i.test(tl) ? "🏛"
                                : /park|garden|nature|forest|lake|mountain|volcano|trek|hike/i.test(tl) ? "🌿"
                                : /beach|coast|island|bay|snorkel|dive/i.test(tl) ? "🏖"
                                : /shop|mall|bazaar|souk/i.test(tl) ? "🛍"
                                : /bar|club|night/i.test(tl) ? "🍸"
                                : /spa|onsen|bath|wellness/i.test(tl) ? "♨️"
                                : /walk|stroll|district|quarter|street|lane/i.test(tl) ? "🚶"
                                : /palace|castle|fort/i.test(tl) ? "🏰"
                                : "📍"
                              );
                              return { id: `c-act-${i}-${hi}`, type: "sight", title, icon, time: "", duration: "", note: "" };
                            }),
                          ],
                          wishlist: [],
                        };
                      });
                      const fmt = (d) => new Date(d).toLocaleDateString("en-US", { month:"short", day:"numeric" });
                      const compactTripName = compactData.name
                        ? `${compactData.name} · ${fmt(form.startDate)}–${fmt(form.endDate)}`
                        : editingTrip?.name || igDestinations.join(" → ");
                      const compactDates = (form.startDate && form.endDate) ? `${fmt(form.startDate)} – ${fmt(form.endDate)}, ${new Date(form.endDate).getFullYear()}` : "";
                      const originalDest = editingTrip?.destination || (form.destinations || []).join(" → ");
                      setTrip(prev => ({
                        ...prev, name: compactTripName, destination: originalDest,
                        dates: compactDates,
                        travelers: parseInt(form.travelers) || prev.travelers || null,
                        ig_response: compactData,
                      }));
                      if (capturedTripId) {
                        const compactReadyAt = new Date().toISOString();
                        supabase.from("trips").update({ name: compactTripName, destination: originalDest, ig_response: compactData, compact_ready_at: compactReadyAt, generation_started_at: generationStartedAt }).eq("id", capturedTripId);
                        supabase.from("generation_log").insert({ trip_id: capturedTripId, generation_started_at: generationStartedAt, compact_ready_at: compactReadyAt }).select("id").single().then(({ data }) => { if (data) genLogId = data.id; });
                      }
                      setDays(compactDays);
                      setActiveDay(0);
                      setScreen("itinerary");
                      setCompactView(true);
                      setDetailedLoading(true);
                    }
                  }
                }
              } catch { /* compact parse failed, continue streaming */ }
            }

            // Track day progress — count "label" for pre-compact screen, "wishlist" for detailed progress
            const daysInDaysArray = (accumulated.match(/"label"\s*:/g) || []).length;
            const compactLabels = (accumulated.match(/"compact"\s*:[\s\S]*?"label"/g) || []).length;
            const daysPlanned = Math.max(0, daysInDaysArray - (compactShown ? compactLabels : 0));
            if (daysPlanned > 0 && !compactShown) setStreamingDays(daysPlanned);
            // Detailed progress: count completed days by "wishlist" markers (appears at end of each day)
            if (compactShown) {
              const daysSection = accumulated.slice(accumulated.indexOf('"days"'));
              const detailedDays = (daysSection.match(/"wishlist"\s*:\s*\[/g) || []).length;
              setStreamingDays(detailedDays);
            }
            if (daysPlanned >= numDays && (/"summary"\s*:/.test(accumulated) || /"wishlist"\s*:\s*\[[\s\S]*?\][\s\S]{200,}/.test(accumulated))) {
              setAllDaysPlanned(true);
            }
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
      // If user navigated away (abort), silently stop — don't redirect
      if (e.name === "AbortError") {
        console.log("IG generation aborted by user navigation");
        _igInFlight = false;
        return;
      }
      console.error("AI generation failed:", e.message);
      console.error("Accumulated length:", accumulated.length);
      console.error("Accumulated tail:", accumulated.slice(-300));
      if (compactShown) {
        setDetailedLoading(false);
        setDetailedReady(true);
        _igInFlight = false;
        console.warn("Detailed IG failed, using compact itinerary as fallback");
        return;
      }
      setGenerateError(`Generation failed: ${e.message}. Please try again.`);
      setScreen("setup");
      _igInFlight = false;
      return;
    }
    const generationCompletedAt = new Date().toISOString();

    const isEditing = !!editingTrip?.id;

    const abort = (msg, err) => {
      console.error(msg, err);
      setGenerateError(`${msg}${err?.message ? `: ${err.message}` : ""}`);
      setScreen("setup");
    };

    // 1. Persist trip (update if editing, insert if new)
    const tripId = isEditing ? editingTrip.id : crypto.randomUUID();
    const igRequest = { destinations: form.destinations, numDays, travelers: form.travelers, styles: form.styles, budget: form.budget, pace: form.pace, morningStart: form.morningStart, notes: form.notes || null, startDate: form.startDate || null, endDate: form.endDate || null, arrivalCity: form.arrivalCity || null, departureCity: form.departureCity || null, arrivalTime: form.arrivalTime || null, departureTime: form.departureTime || null, arrivalMode: form.arrivalMode || null, departureMode: form.departureMode || null };
    const tripName = (() => {
      const fmtD = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const dateRange = (form.startDate && form.endDate) ? ` · ${fmtD(form.startDate)}–${fmtD(form.endDate)}` : "";
      if (isEditing && !itinerary.name) return editingTrip.name;
      return `${itinerary.name || form.destinations.join(" → ")}${dateRange}`;
    })();
    posthog.capture("itinerary_generated", { destination: igDestinations.join(" → "), days: itinerary.days?.length || 0 });
    const tripPayload = {
      id: tripId,
      name: tripName,
      destination: editingTrip?.destination || (form.destinations || []).join(" → "),
      start_date: form.startDate,
      end_date: form.endDate,
      created_by: session.user.id,
      generation_started_at: generationStartedAt,
      generation_completed_at: generationCompletedAt,
      detailed_ready_at: generationCompletedAt,
      ig_request: igRequest,
      ig_response: itinerary,
      ig_count: (editingTrip?.ig_count || 0) + 1,
      base_location: form.baseLocation || null,
      ...(itinerary.summary    && { summary: itinerary.summary }),
      ...(form.notes           && { notes: form.notes }),
      ...(form.arrivalCity     && { arrival_city: form.arrivalCity }),
      ...(form.departureCity   && { departure_city: form.departureCity }),
      ...(form.arrivalTime     && { arrival_time: `${form.startDate}T${form.arrivalTime}:00` }),
      ...(form.departureTime   && { departure_time: `${form.endDate}T${form.departureTime}:00` }),
      ...(form.arrivalMode     && { arrival_mode: form.arrivalMode }),
      ...(form.departureMode   && { departure_mode: form.departureMode }),
    };

    if (isEditing) {
      // Update trip row in place
      const { error: updateErr } = await supabase.from("trips").update(tripPayload).eq("id", tripId);
      if (updateErr) { abort("Failed to update trip", updateErr); return; }
      // Wipe existing days (activities cascade via FK). Brainstorm items also cleared.
      const { data: existingDays } = await supabase.from("days").select("id").eq("trip_id", tripId);
      const existingDayIds = (existingDays || []).map(d => d.id);
      if (existingDayIds.length) {
        const { error: delActErr } = await supabase.from("activities").delete().in("day_id", existingDayIds);
        if (delActErr) console.error("Failed to delete activities:", delActErr);
      }
      const { error: delDayErr } = await supabase.from("days").delete().eq("trip_id", tripId);
      if (delDayErr) console.error("Failed to delete days:", delDayErr);
      // Keep brainstorm_items — user can go back to "Explore Other Plans"
    } else {
      const { error: tripErr } = await supabase.from("trips").insert(tripPayload);
      if (tripErr) { abort("Failed to save trip", tripErr); return; }
      // Add creator as organizer (only for new trips)
      const { error: memberErr } = await supabase.from("trip_members").insert({
        trip_id: tripId,
        user_id: session.user.id,
        role: "edit",
      });
      if (memberErr) { abort("Failed to add you as trip member", memberErr); return; }
    }
    const tripData = tripPayload;

    // 2b. Persist pre-trip brainstorm items (route options) so the user can refer to them later
    if (votedItems && votedItems.length) {
      const rows = votedItems.map((it, i) => ({
        trip_id: tripData.id,
        title: it.title,
        city: it.city || null,
        category: it.category || "Route",
        note: it.tagline || null,
        icon: it.icon || null,
        geocode: it.geocode || null,
        position: i,
        tier: it.tier || 2,
        selected: it.vote === 1,
        data: {
          tagline: it.tagline || null,
          days: it.days || null,
          bestFor: it.bestFor || null,
          warning: it.warning || null,
          recommended: !!it.recommended,
          points: it.points || null,
        },
      }));
      const { error: brainErr } = await supabase.from("brainstorm_items").insert(rows);
      if (brainErr) console.warn("Failed to save brainstorm items:", brainErr);
    }

    // 3. Insert days + activities (all days in parallel)
    const start = new Date(form.startDate);
    const savedDays = (await Promise.all(
      itinerary.days.map(async (day, i) => {
        const dayDate = new Date(start);
        dayDate.setDate(start.getDate() + i);
        const isoDate = dayDate.toISOString().split("T")[0];

        const { data: dayData, error: dayErr } = await supabase
          .from("days")
          .insert({ trip_id: tripData.id, label: day.label, date: isoDate, city: day.city, position: i, description: day.description || null, wishlist: day.wishlist?.length ? day.wishlist : null, hotel_options: day.hotelOptions?.length ? day.hotelOptions : null, hotel_check_in_time: day.hotelCheckInTime || null, transit_tip: day.transit_tip || null })
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
              transition_data: act.transition || null,
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
    if (!compactShown) playDoneChime(); // chime only if compact didn't already play it
    setChatUnread(true);
    setEditingTrip(null);
    setPendingForm(null);
    setDetailedLoading(false);
    setDetailedReady(true);
    playDoneChime();
    // Pulse the chat mascot to draw attention
    setChatAttention(true);
    setTimeout(() => setChatAttention(false), 3000);
    _igInFlight = false;
    // Log generation timing — update by trip_id as fallback since genLogId may not be set yet
    if (genLogId) {
      supabase.from("generation_log").update({ detailed_ready_at: generationCompletedAt, ig_count: tripPayload.ig_count }).eq("id", genLogId);
    } else if (capturedTripId) {
      supabase.from("generation_log").update({ detailed_ready_at: generationCompletedAt, ig_count: tripPayload.ig_count }).eq("trip_id", capturedTripId).is("detailed_ready_at", null);
    } else if (tripData.id) {
      supabase.from("generation_log").insert({ trip_id: tripData.id, generation_started_at: generationStartedAt, detailed_ready_at: generationCompletedAt, ig_count: tripPayload.ig_count });
    }
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
    // Use offsetTop (absolute position in scroll container) — immune to current scroll position
    scrollRef.current.scrollTo({ top: el.offsetTop - 50, behavior: "smooth" });
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

  // callChatTrip removed — unified chat handles all screens

  const getMemberName = (userId) => {
    const m = (trip?.trip_members || []).find(mem => mem.user_id === userId);
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

  const filteredMessages = chatMessages;

  // Dismiss a local gem (used by both Dismiss menu item and Add-to-Itinerary auto-dismiss).
  // Soft-delete via dismissed:true flag in days.wishlist jsonb; emits a chat system-undo row.
  const dismissGemPersist = async (day, gem, reasonLabel) => {
    if (!gem?.id) return;
    const next = (day.wishlist || []).map(w => w.id === gem.id ? { ...w, dismissed: true } : w);
    setDays(prev => prev.map(d => d.id === day.id ? { ...d, wishlist: next } : d));
    await supabase.from("days").update({ wishlist: next }).eq("id", day.id);
    setChatMessages(prev => [...prev, {
      role: "system-undo",
      content: reasonLabel,
      undoData: { dismissedGemId: gem.id, dayId: day.id },
      id: `undo-gem-${Date.now()}`,
    }]);
  };

  const sendChatDirect = async (message) => {
    if (!message.trim() || chatLoading) return;
    const userMsg = { role: "user", content: message.trim(), user_id: session.user.id };
    const history = chatMessages.filter(m => m.role !== "system-undo");
    setChatMessages(prev => [...prev, userMsg, { role: "assistant", content: "", streaming: true }]);
    setChatLoading(true);
    if (trip?.id) supabase.from("trip_messages").insert({ trip_id: trip.id, user_id: session.user.id, role: "user", content: userMsg.content });
    let finalContent = "Sorry, something went wrong. Try again.";
    let suggestions = null;
    let hasChanges = false;
    let changedRouteIds = [];
    try {
      const data = await callUnifiedChat(userMsg.content, history);
      finalContent = data.message || "Done.";
      const suggestAction = (data.actions || []).find(a => a.type === "suggest");
      if (suggestAction) suggestions = suggestAction.suggestions;
      const mutationActions = (data.actions || []).filter(a => a.type !== "suggest");
      hasChanges = mutationActions.length > 0;
      changedRouteIds = mutationActions.filter(a => a.type === "update_route" && a.route?.id).map(a => a.route.id);
      if (data.actions?.length) await dispatchActions(data.actions, userMsg, history);
    } catch { /* use default error message */ }
    setChatMessages(prev => { const updated = [...prev]; updated[updated.length - 1] = { role: "assistant", content: finalContent, suggestions, hasChanges, changedRouteIds, streaming: false }; return updated; });
    setChatLoading(false);
    setChatUnread(true);
    if (trip?.id) supabase.from("trip_messages").insert({ trip_id: trip.id, user_id: session.user.id, role: "assistant", content: finalContent });
  };

  // ── Action dispatcher: executes actions returned by unified chat ──
  const dispatchActions = async (actions, userMsg, history) => {
    if (!actions?.length) return;
    for (const action of actions) {
      switch (action.type) {
        case "update_route": {
          const upd = action.route;
          if (!upd?.id) break;
          setPretripRoutes(prev => {
            const merged = prev.map(r => {
              if (r.id !== upd.id) return r;
              const result = { ...r, ...upd, id: r.id, tier: r.tier || 1 };
              const badDays = !Array.isArray(result.days) || result.days.length === 0 || result.days.some(d => typeof d !== "string" || d.trim().length < 5);
              const badTitle = !result.title || result.title.trim().length === 0;
              if (badDays || badTitle) result._error = badTitle ? "Route title is missing" : "Day descriptions are incomplete";
              else delete result._error;
              return result;
            });
            // Persist to DB
            const tripId = editingTrip?.id;
            if (tripId) {
              (async () => {
                try {
                  await supabase.from("brainstorm_items").delete().eq("trip_id", tripId);
                  const rows = merged.map((it, i) => ({
                    trip_id: tripId, title: it.title, city: it.city || null,
                    category: it.category || "Route", note: it.tagline || null,
                    icon: it.icon || null, geocode: it.geocode || null,
                    position: i, tier: it.tier || 2, selected: !!it.selected,
                    data: { tagline: it.tagline, days: it.days, bestFor: it.bestFor, warning: it.warning, recommended: !!it.recommended, points: it.points },
                  }));
                  await supabase.from("brainstorm_items").insert(rows);
                } catch (e) { console.warn("Failed to persist route edits:", e); }
              })();
            }
            return merged;
          });
          setPretripSelectedRouteId(upd.id);
          break;
        }
        case "dismiss_route": {
          // Support single routeId or array routeIds
          const ids = action.routeIds || (action.routeId ? [action.routeId] : []);
          if (ids.length === 0) break;
          setPretripRoutes(prev => prev.map(it => ids.includes(it.id) ? { ...it, dismissed: true } : it));
          for (const rid of ids) {
            if (rid && !String(rid).startsWith("temp_")) {
              supabase.from("brainstorm_items").update({ dismissed: true }).eq("id", rid);
            }
          }
          // Add undo message
          const titles = ids.map(rid => pretripRoutes.find(r => r.id === rid)?.title).filter(Boolean);
          const label = titles.length > 1 ? `${titles.length} plans` : `"${titles[0] || "Plan"}"`;
          setChatMessages(prev => [...prev, {
            role: "system-undo", content: `${label} dismissed.`,
            undoData: { dismissedRouteIds: ids }, id: `undo-route-${Date.now()}`,
          }]);
          break;
        }
        case "generate_more_plans": {
          // Trigger the "Show more plans" flow in BrainstormView
          triggerRgRef.current?.({ addMore: true });
          break;
        }
        case "update_day": {
          const updatedDay = action.day;
          if (!updatedDay?.label) break;
          const existingDay = daysRef.current.find(d => d.label?.trim().toLowerCase() === updatedDay.label?.trim().toLowerCase());
          if (!existingDay?.id) break;
          const dayId = existingDay.id;
          // Delete + re-insert activities (with RLS safety check)
          const existingCount = existingDay.activities?.length ?? 0;
          const { error: delErr, count: deletedCount } = await supabase.from("activities").delete({ count: "exact" }).eq("day_id", dayId);
          if (delErr) { console.error("update_day delete error:", delErr); break; }
          if (existingCount > 0 && (deletedCount === null || deletedCount === 0)) {
            console.warn("update_day: delete blocked by RLS, skipping insert to avoid duplicates");
            break;
          }
          const existingPhotoMap = {};
          (existingDay.activities || []).forEach(a => { if (a.geocode && a.photo_url) existingPhotoMap[a.geocode] = a.photo_url; });
          const newActivities = (updatedDay.activities || []).map((act, j) => ({
            day_id: dayId, time: act.time, title: act.title, geocode: act.geocode || null, geocode_end: act.geocodeEnd || null,
            type: act.type, duration: act.duration, note: act.note, confirmed: act.confirmed ?? false, icon: act.icon,
            package: act.package || null, position: j, added_by: session.user.id,
            photo_url: (act.geocode && existingPhotoMap[act.geocode]) || null,
            transition_data: act.transition || null,
          }));
          const { data: insertedActs } = await supabase.from("activities").insert(newActivities).select();
          if (updatedDay.wishlist) await supabase.from("days").update({ wishlist: updatedDay.wishlist }).eq("id", dayId);
          setDays(prev => prev.map(day => day.id !== dayId ? day : {
            ...day, city: updatedDay.city ?? day.city, wishlist: updatedDay.wishlist ?? day.wishlist,
            activities: (insertedActs || []).map((act, i) => ({ ...act, ...updatedDay.activities[i] })),
          }));
          // Fetch photos for new activities
          const dayCity = updatedDay.city ?? existingDay.city;
          for (const [i, act] of (updatedDay.activities || []).entries()) {
            if (act.type === "transit" || existingPhotoMap[act.geocode]) continue;
            const insertedAct = insertedActs?.[i];
            if (!insertedAct) continue;
            _fetchPhoto(act.geocode || act.title, dayCity, act.type).then(url => {
              if (!url) return;
              supabase.from("activities").update({ photo_url: url }).eq("id", insertedAct.id);
              setDays(prev => prev.map(d => d.id !== dayId ? d : { ...d, activities: d.activities.map(a => a.id === insertedAct.id ? { ...a, photo_url: url } : a) }));
            });
          }
          break;
        }
        case "suggest": {
          // Handled via suggestions in message metadata — no dispatch needed
          break;
        }
        case "pending_routes": {
          if (!action.routeIds?.length) break;
          for (const pendingId of action.routeIds) {
            try {
              const followUp = await callUnifiedChat(
                `Apply the same change to route id="${pendingId}". Return only this one route in actions.`,
                [...history, userMsg, { role: "assistant", content: "applying..." }]
              );
              if (followUp.actions?.length) dispatchActions(followUp.actions, userMsg, history);
            } catch (e) { console.warn("Pending route update failed:", pendingId, e); }
          }
          break;
        }
        case "add_todo": {
          const tripId = trip?.id || editingTrip?.id;
          if (!tripId || !action.text) break;
          const { error: todoErr } = await supabase.from("trip_todos").insert({ trip_id: tripId, text: action.text, done: false, category: action.category || null, due_date: action.due_date || null, position: 0 });
          if (todoErr) console.warn("add_todo failed:", todoErr);
          break;
        }
        case "add_expense": {
          const tripId = trip?.id || editingTrip?.id;
          if (!tripId || !action.title || !action.amount) break;
          const { error: expErr } = await supabase.from("trip_expenses").insert({ trip_id: tripId, title: action.title, amount: action.amount, currency: action.currency || "USD", category: action.category || "Other", is_planned: action.is_planned !== false, position: 0 });
          if (expErr) console.warn("add_expense failed:", expErr);
          break;
        }
        case "add_bookmark": {
          const tripId = trip?.id || editingTrip?.id;
          if (!tripId || !action.title || !action.url) break;
          const { error: bmErr } = await supabase.from("trip_bookmarks").insert({ trip_id: tripId, title: action.title, url: action.url, icon: "🔗", position: 0 });
          if (bmErr) console.warn("add_bookmark failed:", bmErr);
          break;
        }
        case "set_budget": {
          const tripId = trip?.id || editingTrip?.id;
          if (!tripId || !action.amount) break;
          const { error: budgetErr } = await supabase.from("trips").update({ budget_amount: action.amount }).eq("id", tripId);
          if (budgetErr) console.warn("set_budget failed:", budgetErr);
          break;
        }
        case "navigate": {
          if (action.tab === "magazine" || action.tab === "brainstorm") {
            if (screen === "brainstorm") setPretripTab(action.tab === "magazine" ? "magazine" : "brainstorm");
            else setActiveBottomTab("brainstorm");
          } else if (action.tab === "itinerary") setActiveBottomTab("itinerary");
          else if (action.tab === "map") {
            if (screen === "brainstorm") setPretripTab("map");
            else setActiveBottomTab("map");
          } else if (action.tab === "board") setActiveBottomTab("board");
          setChatOpen(false);
          break;
        }
      }
    }
  };

  const callUnifiedChat = async (message, history = []) => {
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({
          screen,
          trip: trip || editingTrip || null,
          routes: (pretripRoutes || []).filter(r => !r.dismissed),
          days: daysRef.current || [],
          form: pendingForm || {},
          message,
          history: history.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
        }),
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() || chatLoading) return;
    posthog.capture("chat_message_sent", { screen, message_length: chatInput.trim().length });
    const userMsg = { role: "user", content: chatInput.trim(), user_id: session.user.id };
    const history = chatMessages.filter(m => m.role !== "system-undo");
    setChatMessages(prev => [...prev, userMsg, { role: "assistant", content: "", streaming: true }]);
    setChatInput("");
    if (chatInputRef.current) { chatInputRef.current.style.height = "auto"; }
    setChatLoading(true);

    if (trip?.id) {
      supabase.from("trip_messages").insert({ trip_id: trip.id, user_id: session.user.id, role: "user", content: userMsg.content });
    }

    let finalContent = "Sorry, something went wrong. Try again.";
    let suggestions = null;
    let hasChanges = false;
    let changedRouteIds = [];
    try {
      const data = await callUnifiedChat(userMsg.content, history);
      finalContent = data.message || "Done.";

      // Extract suggestions from actions
      const suggestAction = (data.actions || []).find(a => a.type === "suggest");
      if (suggestAction) suggestions = suggestAction.suggestions;

      // Check if there are mutation actions
      const mutationActions = (data.actions || []).filter(a => a.type !== "suggest");
      hasChanges = mutationActions.length > 0;
      changedRouteIds = mutationActions.filter(a => a.type === "update_route" && a.route?.id).map(a => a.route.id);

      // Dispatch all actions
      if (data.actions?.length) {
        await dispatchActions(data.actions, userMsg, history);
      }
    } catch (err) {
      console.warn("Chat error:", err);
      finalContent = `Sorry, something went wrong. (${err?.message || "unknown error"}) Try again.`;
    }

    setChatMessages(prev => {
      const updated = [...prev];
      updated[updated.length - 1] = { role: "assistant", content: finalContent, suggestions, hasChanges, changedRouteIds };
      return updated;
    });
    if (trip?.id) {
      supabase.from("trip_messages").insert({ trip_id: trip.id, user_id: session.user.id, role: "assistant", content: finalContent });
    }
    setChatLoading(false);
  };

  return (
    <ErrorBoundary>
    <div style={{fontFamily:"Georgia,serif",background:T.warm,maxWidth:430,margin:"0 auto",position:"relative",display:"flex",flexDirection:"column",height:"100dvh",overflow:"hidden",paddingTop:"env(safe-area-inset-top, 0px)"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:4px;}
        ::-webkit-scrollbar-thumb{background:${T.sand};border-radius:4px;}
        @keyframes fadeUp{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}
        @keyframes pulse{0%,100%{opacity:0.3;transform:scale(0.8);}50%{opacity:1;transform:scale(1);}}
        @keyframes shimmer{0%,100%{opacity:0.45;}50%{opacity:0.75;}}
        @keyframes chatPulse{0%,100%{transform:scale(1);}50%{transform:scale(1.18);}}
        @keyframes blink{0%,100%{opacity:1;}50%{opacity:0;}}
        @keyframes slideIn{0%{opacity:0;transform:translateX(40px) scale(0.7);}20%{opacity:1;transform:translateX(0) scale(1);}80%{opacity:1;transform:translateX(0) scale(1);}100%{opacity:0;transform:translateX(-40px) scale(0.7);}}
        @keyframes spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
        .no-scrollbar::-webkit-scrollbar{display:none;}
        .no-scrollbar{-ms-overflow-style:none;scrollbar-width:none;}
      `}</style>

      {/* ── GENERATING ── */}
      {screen==="generating" && (
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
          {/* Route + progress — scrollable together */}
          <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column"}}>
          {generatingRoute && (
            <div style={{padding:"20px 16px 12px"}}>
              <div style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif",marginBottom:8,textTransform:"uppercase",letterSpacing:1}}>Detailing your route</div>
              <RouteCard item={generatingRoute} vs={{mine:1}} interactive={false} showRecommended={false} />
            </div>
          )}
          {/* Progress */}
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16,padding:"20px 40px 40px",flex:generatingRoute?0:1,minHeight:generatingRoute?undefined:"100%"}}>
            <TransportCarousel />
            <div style={{fontFamily:"'DM Serif Display',serif",fontSize:20,color:T.ink,textAlign:"center"}}>Building your itinerary…</div>
            {generateError
              ? <div style={{padding:"12px 16px",borderRadius:RADIUS.lg,background:T.errorLight,border:`1.5px solid ${T.error}`,fontSize:13,color:T.error,fontFamily:"Georgia,serif",textAlign:"center",maxWidth:300}}>
                  ⚠️ {generateError}
                </div>
              : allDaysPlanned
              ? <div style={{fontSize:13,color:T.terra,fontFamily:"Georgia,serif",textAlign:"center",fontStyle:"italic"}}>Hold your breath…</div>
              : streamingDays > 0
              ? <div style={{fontSize:13,color:T.moss,fontFamily:"Georgia,serif",textAlign:"center",fontWeight:600}}>Day {streamingDays}{streamingTotal > 0 ? ` of ${streamingTotal}` : ""} planned ✓</div>
              : <LoadingHint />
            }
          </div>
          </div>
        </div>
      )}

      {/* ── SETUP ── */}
      {screen==="setup" && (
        <div style={{flex:1,overflowY:"auto"}}>
          <div style={{background:`linear-gradient(160deg,${T.dusk},${T.ocean})`,padding:"44px 20px 36px",color:"white",position:"relative",overflow:"hidden"}}>
            <div style={{position:"absolute",top:-50,right:-50,width:200,height:200,borderRadius:"50%",background:"rgba(255,255,255,0.04)",pointerEvents:"none"}}/>
            <div style={{position:"relative",display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              {onHome && <button onClick={onHome} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:RADIUS.full,padding:"4px 13px",color:"white",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>← Trips</button>}
            </div>
            <div style={{fontFamily:"'DM Serif Display',serif",fontSize:34,lineHeight:1.2,marginBottom:10}}>Plan your next<br/>adventure ✈️</div>
            <div style={{fontSize:14,opacity:0.7,fontFamily:"Georgia,serif"}}>AI-powered itineraries, built for you</div>
          </div>
          <div style={{padding:"28px 0 0"}}>
            {generateError && (
              <div style={{margin:"0 20px 16px",padding:"12px 16px",borderRadius:RADIUS.lg,background:T.errorLight,border:`1.5px solid ${T.error}`,fontSize:13,color:T.error,fontFamily:"Georgia,serif"}}>
                {generateError}
              </div>
            )}
            <SetupForm
              key={pendingForm ? "resume" : "fresh"}
              onGenerate={handleSetupComplete}
              initialTrip={editingTrip || (initialScreen==="setup" && initialTrip?.destination ? initialTrip : null)}
              onStepChange={(s) => { setSetupStep(s); if (onUrlChange && !editingTrip) onUrlChange(`/new/${s}`); }}
              prefillForm={pendingForm}
              initialStep={setupStep}
            />
          </div>
        </div>
      )}

      {/* ── BRAINSTORM (pre-trip) — full layout with bottom nav ── */}
      {screen==="brainstorm" && (<>
        {/* Content area per active tab */}
        {/* BrainstormView always mounted to preserve items + selection, but hidden when not active */}
        <div style={{flex: pretripTab === "brainstorm" ? 1 : 0, display: pretripTab === "brainstorm" ? "flex" : "none", flexDirection:"column", overflow: "hidden"}}>
          <BrainstormView
            trip={null}
            session={session}
            pendingForm={pendingForm}
            triggerGenerateRef={triggerRgRef}
            editTripId={editingTrip?.id || null}
            onBuild={handleBuildFromBrainstorm}
            onBack={() => setScreen("setup")}
            onEditForm={editingTrip ? () => { setSetupStep(0); setScreen("setup"); } : null}
            onOpenChat={() => { setChatOpen(true); setChatUnread(false); }}
            undoDismissRef={undoDismissRef}
            onModifyRoute={(label) => {
              setChatOpen(true); setChatUnread(false);
              setChatInput(`Modify ${label}: `);
              setTimeout(() => chatInputRef.current?.focus(), 100);
            }}
            onDismissRoute={(label, itemId) => {
              const item = (pretripRoutes || []).find(r => r.id === itemId);
              const undoMsg = {
                role: "system-undo",
                content: `${label} "${item?.title || "route"}" was dismissed.`,
                undoData: { dismissedRouteId: itemId },
                id: `undo-route-${Date.now()}`,
              };
              setChatMessages(prev => [...prev, undoMsg]);
              setChatUnread(true);
            }}
            onItemsChange={setPretripRoutes}
            onSelectionChange={setPretripSelectedRouteId}
            externalSelectedId={pretripSelectedRouteId}
            externalRoutes={pretripRoutes}
            onTellMore={(cities, routeId) => {
              // Switch to Magazine tab, filtered for this route's cities
              setMagazineFilterCities(cities);
              setMagazineFilterRouteId(routeId);
              setPretripTab("magazine");
            }}
            onShowMap={(routeId) => {
              setPretripSelectedRouteId(routeId);
              setPretripTab("map");
            }}
          />
        </div>

        {/* RouteMapView — lazy mount so Leaflet initializes with proper container dimensions */}
        {pretripTab === "map" && (
          <div style={{flex: 1, display: "flex", flexDirection:"column", overflow:"hidden"}}>
            <RouteMapView
              routes={pretripRoutes}
              selectedId={pretripSelectedRouteId}
              onSelectRoute={setPretripSelectedRouteId}
              destination={(pendingForm?.destinations || []).join(", ") || editingTrip?.destination || ""}
            />
          </div>
        )}

        {/* Pre-IG Magazine tab */}
        {pretripTab === "magazine" && pretripDeepDiveCity && (() => {
          const ddCity = pretripDeepDiveCity;
          const dd = deepDiveCacheApp[ddCity];
          const data = (dd && typeof dd === "object") ? dd : null;
          const loading = dd === "loading";
          const errored = dd === "error";
          return (
            <div style={{flex:1,overflowY:"auto",background:T.warm,padding:"16px 16px 24px"}}>
              <button onClick={() => setPretripDeepDiveCity(null)} style={{alignSelf:"flex-start",background:"none",border:"none",color:T.ocean,fontFamily:"Georgia,serif",fontSize:13,cursor:"pointer",padding:"4px 0",marginBottom:12}}>
                ← Back to destinations
              </button>
              <div style={{fontFamily:"'DM Serif Display',serif",fontSize:28,color:T.ink,lineHeight:1.15,marginBottom:12}}>{ddCity}</div>
              {data?.writeup && <div style={{fontSize:14,color:T.ink,fontFamily:"Georgia,serif",lineHeight:1.6,marginBottom:16}}>{data.writeup}</div>}
              {data?.didYouKnow && (
                <div style={{marginBottom:16,padding:"12px 16px",borderLeft:`3px solid ${T.ocean}`,background:`linear-gradient(135deg, ${T.ocean}06, ${T.dusk}04)`,borderRadius:"0 12px 12px 0"}}>
                  <div style={{fontSize:13,lineHeight:1.55,color:T.ocean,fontFamily:"Georgia,serif",fontStyle:"italic"}}>💡 {data.didYouKnow}</div>
                </div>
              )}
              {data?.moreSights?.length > 0 && (
                <div style={{marginBottom:16}}>
                  <div style={{fontSize:10,color:T.mist,fontFamily:"Georgia,serif",textTransform:"uppercase",letterSpacing:1.2,marginBottom:10}}>🧭 More to discover</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    {data.moreSights.map((s, i) => <MagazineHighlightCard key={i} item={s} city={ddCity} masonry={true} tall={i % 3 === 0} onAskTrippy={(title) => { setChatInput(`Tell me about "${title}"`); setChatOpen(true); setChatUnread(false); setTimeout(() => chatInputRef.current?.focus(), 50); }} />)}
                  </div>
                </div>
              )}
              {data?.foodSpecialties?.length > 0 && (
                <div style={{background:T.chalk,borderRadius:RADIUS.lg,padding:"14px 16px",border:`1px solid ${T.sand}`,marginBottom:16}}>
                  <div style={{fontSize:10,color:T.mist,fontFamily:"Georgia,serif",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>🍜 Food you should try</div>
                  {data.foodSpecialties.map((f, i) => (
                    <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start",marginBottom:8}}>
                      <span style={{fontSize:18,flexShrink:0}}>{f.icon || "🍽️"}</span>
                      <div><div style={{fontFamily:"'DM Serif Display',serif",fontSize:13,color:T.ink}}>{f.name}</div>
                      {f.note && <div style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif"}}>{f.note}</div>}</div>
                    </div>
                  ))}
                </div>
              )}
              {data?.weather && (
                <div style={{background:T.chalk,borderRadius:RADIUS.lg,padding:"14px 16px",border:`1px solid ${T.sand}`,marginBottom:16}}>
                  <div style={{fontSize:10,color:T.mist,fontFamily:"Georgia,serif",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>🌤 Weather & season</div>
                  <div style={{fontSize:13,color:T.ink,fontFamily:"Georgia,serif",lineHeight:1.55}}>{data.weather}</div>
                </div>
              )}
              {data?.gettingAround && (
                <div style={{background:T.chalk,borderRadius:RADIUS.lg,padding:"14px 16px",border:`1px solid ${T.sand}`,marginBottom:16}}>
                  <div style={{fontSize:10,color:T.mist,fontFamily:"Georgia,serif",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>🚕 Getting around</div>
                  <div style={{fontSize:13,color:T.ink,fontFamily:"Georgia,serif",lineHeight:1.55}}>{data.gettingAround}</div>
                </div>
              )}
              {data?.etiquette?.length > 0 && (
                <div style={{background:T.chalk,borderRadius:RADIUS.lg,padding:"14px 16px",border:`1px solid ${T.sand}`,marginBottom:16}}>
                  <div style={{fontSize:10,color:T.mist,fontFamily:"Georgia,serif",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>🤝 Local etiquette</div>
                  {data.etiquette.map((tip, i) => (
                    <div key={i} style={{display:"flex",gap:8,alignItems:"flex-start",marginBottom:4}}>
                      <span style={{fontSize:11,color:T.ocean,flexShrink:0,marginTop:3}}>●</span>
                      <div style={{fontSize:13,color:T.ink,fontFamily:"Georgia,serif",lineHeight:1.5}}>{tip}</div>
                    </div>
                  ))}
                </div>
              )}
              {loading && (
                <div style={{display:"flex",flexDirection:"column",gap:12}}>
                  {[0,1,2].map(i => (
                    <div key={i} style={{background:T.chalk,borderRadius:RADIUS.lg,padding:"14px 16px",border:`1px solid ${T.sand}`}}>
                      <div style={{width:100,height:10,borderRadius:4,background:T.sand,animation:"shimmer 1.5s ease-in-out infinite",marginBottom:10}}/>
                      <div style={{width:"90%",height:12,borderRadius:4,background:T.sand,animation:"shimmer 1.5s ease-in-out infinite",marginBottom:6}}/>
                      <div style={{width:"70%",height:12,borderRadius:4,background:T.sand,animation:"shimmer 1.5s ease-in-out infinite"}}/>
                    </div>
                  ))}
                </div>
              )}
              {errored && (
                <div style={{padding:"14px 16px",textAlign:"center",color:T.error,fontFamily:"Georgia,serif",fontSize:13,background:T.errorLight,borderRadius:RADIUS.md}}>
                  Couldn't load details. <button onClick={() => loadCityDeepDiveApp(ddCity)} style={{background:"none",border:"none",color:T.ocean,cursor:"pointer",textDecoration:"underline"}}>Retry</button>
                </div>
              )}
            </div>
          );
        })()}
        {pretripTab === "magazine" && !pretripDeepDiveCity && (
          <div style={{flex:1,overflowY:"auto",background:T.warm}}>
            <div style={{padding:"20px 16px 12px",background:T.chalk,borderBottom:`1px solid ${T.sand}`,display:"flex",alignItems:"center",gap:10}}>
              {magazineFilterCities && (
                <button onClick={() => { setMagazineFilterCities(null); setMagazineFilterRouteId(null); setPretripTab("brainstorm"); }} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:T.ocean,padding:"0 4px",lineHeight:1}}>←</button>
              )}
              <div style={{flex:1}}>
                <div style={{fontFamily:"'DM Serif Display',serif",fontSize:20,color:T.ink}}>
                  {magazineFilterCities
                    ? (() => {
                        // Show country/region from route title (e.g. "Georgia – Caucasus Explorer" → "Georgia")
                        const route = magazineFilterRouteId ? (pretripRoutes || []).find(r => r.id === magazineFilterRouteId) : null;
                        if (route?.title) return route.title.split(/\s*[–—-]\s*/)[0].trim();
                        return magazineFilterCities.join(", ");
                      })()
                    : (editingTrip?.destination || (pendingForm?.destinations || []).filter(d => !d.toLowerCase().includes("help me decide")).join(", ") || "Magazine")}
                </div>
                <div style={{fontSize:12,color:T.mist,fontFamily:"Georgia,serif",marginTop:4}}>
                  {magazineFilterCities ? "Explore this route's destinations" : "Explore the destinations across your trip plans"}
                </div>
              </div>
              {magazineFilterCities && (
                <button onClick={() => { setMagazineFilterCities(null); setMagazineFilterRouteId(null); }} style={{
                  background:T.sand,border:"none",borderRadius:RADIUS.full,padding:"5px 11px",color:T.ink,fontSize:11,cursor:"pointer",fontFamily:"Georgia,serif"
                }}>Show all</button>
              )}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:0}}>
              {/* Destination-level intro — always shown with hero photo */}
              {(() => {
                // Derive destination: from trip, form, or route title (for "Help me decide" flows)
                const rawDest = (pendingForm?.destinations || []).filter(d => !d.toLowerCase().includes("help me decide"));
                let dest = editingTrip?.destination || (rawDest.length ? rawDest.join(", ") : null);
                // If filtered by a route, use country from route title
                if (!dest && magazineFilterRouteId) {
                  const route = (pretripRoutes || []).find(r => r.id === magazineFilterRouteId);
                  if (route?.title) dest = route.title.split(/\s*[–—-]\s*/)[0].trim();
                }
                if (!dest) return null;
                // Load deep dive if not cached
                if (!deepDiveCacheApp[dest]) loadCityDeepDiveApp(dest);
                const dd = deepDiveCacheApp[dest] || null;
                const data = (dd && typeof dd === "object") ? dd : null;
                const isLoading = dd === "loading";
                if (!dest) return null;
                return (
                  <DestinationHero dest={dest} isLoading={isLoading} data={data}>
                    <div style={{fontSize:13,color:T.ink,fontFamily:"Georgia,serif",lineHeight:1.6}}>{data?.writeup}</div>
                    {data?.didYouKnow && (
                      <div style={{marginTop:10,padding:"12px 16px",borderLeft:`3px solid ${T.ocean}`,background:`linear-gradient(135deg, ${T.ocean}06, ${T.dusk}04)`,borderRadius:"0 12px 12px 0",fontSize:13,lineHeight:1.55,color:T.ocean,fontFamily:"Georgia,serif",fontStyle:"italic"}}>💡 {data.didYouKnow}</div>
                    )}
                    <a href={`https://www.google.com/search?q=${encodeURIComponent("site:tripadvisor.com Tourism " + dest)}&btnI`} target="_blank" rel="noopener noreferrer" style={{
                      display:"inline-flex",alignItems:"center",gap:5,marginTop:12,
                      padding:"8px 14px",borderRadius:RADIUS.md,border:`1px solid ${T.moss}33`,
                      color:T.moss,fontFamily:"Georgia,serif",fontSize:12,fontWeight:600,textDecoration:"none",
                    }}>
                      🗺 Explore {dest} on TripAdvisor
                    </a>
                  </DestinationHero>
                );
              })()}
              {(() => {
                // Collect all unique cities — optionally filtered by route
                const filterSet = magazineFilterCities ? new Set(magazineFilterCities.map(c => c.toLowerCase())) : null;
                const allCities = [];
                const seen = new Set();
                for (const route of pretripRoutes) {
                  for (const c of (route.city || "").split(",").map(s => s.trim()).filter(Boolean)) {
                    if (filterSet && !filterSet.has(c.toLowerCase())) continue;
                    if (!seen.has(c.toLowerCase())) { seen.add(c.toLowerCase()); allCities.push({ city: c, fromRoute: route.title }); }
                  }
                }
                if (allCities.length === 0) {
                  return <div style={{textAlign:"center",padding:"40px 0",color:T.mist,fontFamily:"Georgia,serif",fontSize:13}}>Routes are still loading — cities will appear here shortly</div>;
                }
                return allCities.map(({ city, fromRoute }, ci) => {
                  const dd = deepDiveCacheApp[city];
                  // Build highlights from moreSights
                  const data = (dd && typeof dd === "object") ? dd : null;
                  const highlights = (data?.moreSights || []).map(s => ({ ...s, type: "sight" }));
                  return (
                    <Fragment key={city}>
                      {ci > 0 && <div style={{height:8,background:"#F3EDE4",margin:"0 -16px"}}/>}
                      <CityCard city={city} cityDays={[{ label: fromRoute }]} writeup={data?.writeup || ""} deepDive={dd} onDeepDive={() => { loadCityDeepDiveApp(city); setPretripDeepDiveCity(city); }}>
                        {highlights.length > 0 && (
                          <>
                            <div style={{fontSize:10,color:T.mist,fontFamily:"Georgia,serif",textTransform:"uppercase",letterSpacing:1.2,marginBottom:10}}>Things to see</div>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                              {highlights.map((act, i) => (
                                <MagazineHighlightCard key={i} item={act} city={city} masonry={true} tall={i % 3 === 0} onAskTrippy={(title) => { setChatInput(`Tell me about "${title}"`); setChatOpen(true); setChatUnread(false); setTimeout(() => chatInputRef.current?.focus(), 50); }} />
                              ))}
                            </div>
                          </>
                        )}
                      </CityCard>
                    </Fragment>
                  );
                });
              })()}
            </div>
          </div>
        )}

        {/* Bottom nav — pre-trip */}
        <div style={{flexShrink:0, background:T.chalk, borderTop:`1px solid ${T.sand}`, display:"flex", paddingBottom:"env(safe-area-inset-bottom, 0px)"}}>
          {[
            { key:"magazine",   icon:"📖", label:"Magazine" },
            { key:"brainstorm", icon:"🛣️", label:"Route" },
            { key:"map",        icon:"🗺", label:"Map" },
          ].map(({ key, icon, label }) => {
            const active = pretripTab === key;
            return (
              <button key={key} onClick={()=>{ setPretripTab(key); if (key !== "magazine") { setMagazineFilterCities(null); setMagazineFilterRouteId(null); } }} style={{
                flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:3,
                padding:"10px 0 8px", border:"none", background:"none", cursor:"pointer",
                color: active ? T.ocean : T.mist, transition:`color ${MOTION.normal}`, position:"relative",
              }}>
                {active && <div style={{position:"absolute",top:0,left:"50%",transform:"translateX(-50%)",width:32,height:2.5,borderRadius:"0 0 2px 2px",background:T.ocean}}/>}
                <span style={{fontSize:20}}>{icon}</span>
                <span style={{fontSize:10,fontFamily:"'Inter','Segoe UI',sans-serif",fontWeight: active ? 600 : 400,letterSpacing:0.3}}>{label}</span>
              </button>
            );
          })}
        </div>
      </>)}

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
            style={{flex:1,overflowY:"auto",paddingBottom:150,display:activeBottomTab==="itinerary"?"block":"none"}}
          >
            {/* Header — scrolls away */}
            <div style={{background:`linear-gradient(160deg,${T.dusk},${T.ocean})`,padding:"28px 20px 20px",color:"white",position:"relative",overflow:"hidden"}}>
              <div style={{position:"absolute",top:-30,right:-30,width:130,height:130,borderRadius:"50%",background:"rgba(255,255,255,0.04)",pointerEvents:"none"}}/>
              <div style={{position:"relative",display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                <div style={{display:"flex",gap:8}}>
                  {onHome && <button onClick={onHome} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:RADIUS.full,padding:"4px 13px",color:"white",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>← Trips</button>}
                  <button onClick={()=>{
                    // Abort any in-flight IG generation
                    if (igAbortRef.current) { igAbortRef.current.abort(); igAbortRef.current = null; }
                    _igInFlight = false;
                    setDetailedLoading(false);
                    setEditingTrip(trip);
                    // Prefill pendingForm from the trip so BrainstormView has context
                    const igReq = trip.ig_request || {};
                    setPendingForm({
                      destinations: igReq.destinations?.length ? igReq.destinations : (trip.destination || "").split(" → ").map(s => s.trim()).filter(Boolean),
                      startDate: trip.start_date || "",
                      endDate: trip.end_date || "",
                      travelers: String(igReq.travelers || "2"),
                      styles: igReq.styles || [],
                      budget: igReq.budget || "mid",
                      pace: igReq.pace || "active",
                      morningStart: igReq.morningStart || "early",
                      notes: trip.notes || igReq.notes || "",
                      arrivalCity: trip.arrival_city || "",
                      departureCity: trip.departure_city || "",
                      baseLocation: trip.base_location || igReq.baseLocation || "",
                    });
                    setFormEdited(false);
                    setPretripTab("brainstorm");
                    setScreen("brainstorm");
                  }} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:RADIUS.full,padding:"4px 13px",color:"white",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>Explore Other Plans</button>
                </div>
                <button onClick={()=>setShowShare(true)} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:RADIUS.full,padding:"4px 13px",color:"white",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>📤 Share</button>
              </div>
              <div style={{fontFamily:"'DM Serif Display',serif",fontSize:24,lineHeight:1.2,marginBottom:4}}>{trip.name}</div>
              <div style={{fontSize:13,opacity:0.75,fontFamily:"Georgia,serif"}}>📅 {trip.dates || (trip.start_date && trip.end_date ? `${new Date(trip.start_date).toLocaleDateString("en-US",{month:"short",day:"numeric"})} – ${new Date(trip.end_date).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}` : "")}{trip.travelers ? ` · 👤 ${trip.travelers} traveler${trip.travelers > 1 ? "s" : ""}` : ""}</div>
            </div>


            {/* Refining banner with progress — shown while detailed IG streams in background */}
            {detailedLoading && (() => {
              // 50% = compact done. 50-95% = detailed days streaming. Based on wishlist markers per day.
              const detailedPct = streamingTotal > 0 ? Math.round((streamingDays / streamingTotal) * 45) : 0;
              const pct = Math.min(95, 50 + detailedPct);
              return (
                <div style={{padding:"6px 16px 8px",background:`${T.ocean}08`,borderBottom:`1px solid ${T.ocean}15`}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <div style={{flex:1,height:3,borderRadius:2,background:T.sand,overflow:"hidden"}}>
                      <div style={{height:"100%",borderRadius:2,background:`linear-gradient(90deg, ${T.ocean}, ${T.moss})`,width:`${pct}%`,transition:"width 0.6s ease-out"}}/>
                    </div>
                    <span style={{fontSize:11,fontFamily:"Georgia,serif",color:T.ocean,flexShrink:0}}>{pct}%</span>
                  </div>
                  <div style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif",textAlign:"center",marginTop:4}}>Detailed itinerary loading — tap items below to explore meanwhile</div>
                </div>
              );
            })()}

            {/* City-pill strip — only in detailed view */}
            {!compactView && (() => {
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
                          borderRadius:RADIUS.full,
                          border:`1.5px solid ${active ? T.ocean : T.sand}`,
                          background: active ? T.ocean : T.chalk,
                          color: active ? "white" : T.mist,
                          fontSize:12, fontFamily:"Georgia,serif",
                          cursor:"pointer", transition:`all ${MOTION.normal}`,
                          fontWeight: active ? 700 : 400,
                          boxShadow: active ? "0 2px 8px rgba(37,99,168,0.28)" : "none",
                          whiteSpace:"nowrap",
                        }}>
                          <span style={{fontWeight: active ? 700 : 500}}>{g.city.split(/[,–—]/)[0].trim()}</span>
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
                // Skip on last day if user has a departure (they're leaving, no hotel needed)
                const isLastDay = i === days.length - 1;
                const hasDeparture = isLastDay && (trip.departure_time || trip.departure_city);
                const endHotel = !lastIsHotel && day.activities.length > 0 && !hasDeparture
                  ? hotelPerDay[i]?.hotel || null
                  : null;

                return (
                  <div key={day.id} ref={el=>{ dayRefs.current[i]=el; }}>
                    {compactView || collapsedDays.has(day.id) ? (
                      <DayCompact day={day} canExpand={detailedReady || i < streamingDays} displayCity={(() => {
                        const hCity = hotelPerDay[i]?.city;
                        if (!hCity) return day.city;
                        return hCity === day.city ? day.city : `${day.city} (${hCity})`;
                      })()} onExpand={() => {
                        if (compactView) {
                          setCompactView(false);
                          const allOtherIds = new Set(days.filter(d => d.id !== day.id).map(d => d.id));
                          setCollapsedDays(allOtherIds);
                        } else {
                          setCollapsedDays(prev => { const next = new Set(prev); next.delete(day.id); return next; });
                        }
                        setActiveDay(i);
                        // Pre-load current day (if not already) + next day
                        preloadDay(i);
                        if (i + 1 < days.length) preloadDay(i + 1);
                        const tryScroll = (attempts = 0) => {
                          requestAnimationFrame(() => {
                            const el = dayRefs.current[i];
                            if (el && scrollRef.current) {
                              const top = el.offsetTop;
                              if (top === 0 && i > 0 && attempts < 10) {
                                setTimeout(() => tryScroll(attempts + 1), 100);
                                return;
                              }
                              scrollRef.current.scrollTo({ top: top - 50, behavior: "smooth" });
                            }
                          });
                        };
                        setTimeout(() => tryScroll(), 150);
                      }} />
                    ) : (
                    <DaySection
                      day={day}
                      dayIndex={i}
                      onCollapse={() => setCollapsedDays(prev => new Set(prev).add(day.id))}
                      onEditActivity={editActivity}
                      onRemoveActivity={removeActivity}
                      onReplaceActivity={(act) => {
                        setChatInput(`Replace "${act.title}" with `);
                        setChatOpen(true);
                        setChatUnread(false);
                        setTimeout(() => chatInputRef.current?.focus(), 50);
                      }}
                      onSuggestAlternatives={(act) => {
                        setChatOpen(true);
                        setChatUnread(false);
                        sendChatDirect(`Suggest 2-3 alternatives to "${act.title}" for the same time slot, without making any changes yet`);
                      }}
                      onAddGemToItinerary={(d, gem) => {
                        setChatOpen(true);
                        setChatUnread(false);
                        sendChatDirect(`Please add ${gem.title} to the itinerary on ${d.label} at a suitable time.`);
                        dismissGemPersist(d, gem, `Added "${gem.title}" to itinerary.`);
                      }}
                      onDismissGem={(d, gem) => dismissGemPersist(d, gem, `"${gem.title}" dismissed.`)}
                      onChangeHotel={(dayId, act, mode) => {
                        const dayLabel = days.find(d => d.id === dayId)?.label || "this day";
                        if (mode === "own") {
                          setChatInput(`I've booked my own hotel for ${dayLabel} — please replace the "${act.title}" with`);
                          setChatOpen(true);
                          setChatUnread(false);
                          setTimeout(() => chatInputRef.current?.focus(), 50);
                        } else {
                          setChatOpen(true);
                          setChatUnread(false);
                          const dayCity = days.find(d => d.id === dayId)?.city || "";
                          sendChatDirect(`I want to consider other hotel options for ${dayLabel}. Currently at "${act.title}"${dayCity ? ` in ${dayCity}` : ""}.`);
                        }
                      }}
                      arrivalTime={i === 0 ? (trip.arrival_time || (trip.start_date ? `${trip.start_date}T09:00:00` : null)) : null}
                      arrivalMode={i === 0 ? (trip.arrival_mode || "flight") : null}
                      arrivalCity={i === 0 ? trip.arrival_city : null}
                      arrivalAirportIata={i === 0 ? (trip.arrival_airport_iata || null) : null}
                      originIata={i === 0 ? baseAirportIata : null}
                      originDepartureHHMM={i === 0 ? originDepartureHHMM : null}
                      onEditFlight={i === 0 ? () => {
                        setBoardInitialSection("logistics");
                        setActiveBottomTab("board");
                      } : undefined}
                      departureTime={i === days.length - 1 ? (trip.departure_time || (trip.end_date ? `${trip.end_date}T22:00:00` : null)) : null}
                      departureMode={i === days.length - 1 ? (trip.departure_mode || "flight") : null}
                      departureCity={i === days.length - 1 ? (trip.departure_city || null) : null}
                      departureAirportIata={i === days.length - 1 ? (trip.departure_airport_iata || null) : null}
                      destIata={i === days.length - 1 ? baseAirportIata : null}
                      destArrivalHHMM={i === days.length - 1 ? destArrivalHHMM : null}
                      onEditDeparture={i === days.length - 1 ? () => {
                        setBoardInitialSection("logistics");
                        setActiveBottomTab("board");
                      } : undefined}
                      hotelActivity={startHotel}
                      hotelCity={startHotelCity}
                      endHotelActivity={endHotel}
                      displayCity={(() => {
                        const hCity = hotelPerDay[i]?.city;
                        if (!hCity) return day.city;
                        // Hotel city matches this day's city: use it (covers day trips from base)
                        if (hCity === day.city) return hCity;
                        // Hotel city is from a prior destination (e.g. cruise carried forward): use day's city
                        const hotelCheckedInToday = day.activities.some(a => a.type === "hotel");
                        if (!hotelCheckedInToday) return day.city;
                        return hCity;
                      })()}
                      onSelectHotel={(hotel) => selectHotel(day.id, hotel)}
                      onAskTrippy={(title) => {
                        setChatInput(`Tell me about "${title}"`);
                        setChatOpen(true);
                        setChatUnread(false);
                        setTimeout(() => chatInputRef.current?.focus(), 50);
                      }}
                    />
                    )}
                  </div>
                );
              });
            })()}
          </div>

          {/* ── MAGAZINE TAB ── */}
          {activeBottomTab === "brainstorm" && (
            <BrainstormView trip={trip} session={session} days={days} onAskTrippy={(title) => {
              setChatInput(`Tell me about "${title}"`);
              setChatOpen(true); setChatUnread(false);
              setTimeout(() => chatInputRef.current?.focus(), 50);
            }} />
          )}

          {/* Chat sheet is rendered at App root */}
          {/* ── MAP TAB ── */}
          {activeBottomTab === "map" && (
            days.length > 0
              ? <MapView days={days} />
              : <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,color:T.mist,fontFamily:"Georgia,serif",fontSize:14}}><span style={{fontSize:32}}>🗺️</span>Waiting for the itinerary to build…</div>
          )}

          {/* ── BOARD TAB ── */}
          {activeBottomTab === "board" && (days.length === 0 ? (
            <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,color:T.mist,fontFamily:"Georgia,serif",fontSize:14}}><span style={{fontSize:32}}>📋</span>Waiting for the itinerary to build…</div>
          ) : (
            <div style={{flex:1,overflowY:"auto",paddingBottom:150,display:"flex",flexDirection:"column"}}>
              <BoardView
                trip={trip}
                days={days}
                initialSection={boardInitialSection}
                onInitialSectionConsumed={() => setBoardInitialSection(null)}
                onSaveFlights={saveLogisticsFlights}
                onSaveHotels={saveLogisticsHotels}
                onApplyHotels={applyHotelsToItinerary}
                onSaveNotes={async (text) => {
                  setTrip(t => ({ ...t, board_notes: text }));
                  await supabase.from("trips").update({ board_notes: text }).eq("id", trip.id);
                }}
              />
            </div>
          ))}

          {/* ── BOTTOM NAV ── */}
          <div style={{
            flexShrink:0,
            background:T.chalk,
            borderTop:`1px solid ${T.sand}`,
            display:"flex",
            paddingBottom:"env(safe-area-inset-bottom, 0px)",
          }}>
            {[
              { key:"brainstorm", icon:"📖", label:"Magazine" },
              { key:"itinerary", icon:"🗓", label:"Itinerary" },
              { key:"map",       icon:"🗺", label:"Map" },
              { key:"board",     icon:"📋", label:"Board" },
            ].map(({ key, icon, label }) => {
              const active = activeBottomTab === key;
              return (
                <button key={key} onClick={()=>{ posthog.capture("tab_switch", { tab: key }); setActiveBottomTab(key); }} style={{
                  flex:1,
                  display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
                  gap:3,
                  padding:"10px 0 8px",
                  border:"none",
                  background:"none",
                  cursor:"pointer",
                  color: active ? T.ocean : T.mist,
                  transition:`color ${MOTION.normal}`,
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
                  }} style={{display:"flex",alignItems:"center",gap:14,padding:"14px 16px",borderRadius:RADIUS.lg,border:`1.5px solid ${T.sand}`,background:"white",cursor:"pointer",fontFamily:"Georgia,serif",fontSize:14,color:T.ink,fontWeight:600}}>
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
                  }} style={{display:"flex",alignItems:"center",gap:14,padding:"14px 16px",borderRadius:RADIUS.lg,border:`1.5px solid ${T.sand}`,background:"white",cursor:"pointer",fontFamily:"Georgia,serif",fontSize:14,color:T.ink,fontWeight:600}}>
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
                    const url = `${window.location.origin}/share/${token}`;
                    if (navigator.share) {
                      await navigator.share({ title: trip.name, text: `Check out our trip: ${trip.name}`, url });
                    } else {
                      await navigator.clipboard.writeText(url);
                      alert("Link copied!");
                    }
                    setShowShare(false);
                  }} style={{display:"flex",alignItems:"center",gap:14,padding:"14px 16px",borderRadius:RADIUS.lg,border:`1.5px solid ${T.sand}`,background:"white",cursor:"pointer",fontFamily:"Georgia,serif",fontSize:14,color:T.ink,fontWeight:600}}>
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


      {/* ── PERSISTENT CHAT BAR (collapsed state — between content and bottom nav) ── */}
      {!chatOpen && (screen === "itinerary" || screen === "brainstorm") && activeBottomTab !== "board" && (
        <div style={{
          position: "absolute", bottom: "calc(58px + env(safe-area-inset-bottom, 0px))", left: 0, right: 0, zIndex: 900,
          background: T.chalk, borderTop: `1px solid ${T.sand}`,
          padding: "6px 12px 6px",
        }}>
          {/* Build CTA — brainstorm Route tab only, shown when route is selected */}
          {screen === "brainstorm" && pretripTab === "brainstorm" && pretripSelectedRouteId && (
            <button onClick={async () => {
              // Extract preferences from notes + chat history via LLM
              const defaults = { budget: "mid", morningStart: "early", pace: "active" };
              try {
                const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-preferences`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
                  body: JSON.stringify({ notes: pendingForm?.notes || "", chatHistory: chatHistory || [] }),
                });
                if (res.ok) {
                  const prefs = await res.json();
                  setPreIgForm({ budget: prefs.budget || defaults.budget, morningStart: prefs.morningStart || defaults.morningStart, pace: prefs.pace || defaults.pace, igNotes: "" });
                } else {
                  setPreIgForm({ ...defaults, igNotes: "" });
                }
              } catch {
                setPreIgForm({ ...defaults, igNotes: "" });
              }
              setShowPreIgSheet(true);
            }} style={{
              width: "100%", padding: "13px 0", borderRadius: RADIUS.lg, border: "none",
              background: `linear-gradient(135deg, ${T.ocean}, ${T.dusk})`, color: "white",
              fontFamily: "'DM Serif Display',serif", fontSize: 16, cursor: "pointer",
              boxShadow: SHADOW.lg, marginBottom: 8,
            }}>
              Build My Itinerary →
            </button>
          )}
          {/* Input row */}
          <div style={{ display: "flex", gap: 8, alignItems: screen === "brainstorm" ? "flex-end" : "center" }}>
            <div onClick={() => { setChatOpen(true); setChatUnread(false); setChatAttention(false); }} style={{ width: screen === "brainstorm" ? 40 : 28, height: screen === "brainstorm" ? 40 : 28, borderRadius: "50%", overflow: "hidden", flexShrink: 0, border: `1.5px solid ${T.ocean}33`, marginBottom: screen === "brainstorm" ? 2 : 0, cursor: "pointer", animation: chatAttention ? "chatPulse 0.6s ease-in-out 5" : "none" }}>
              <img src="/mascot.png?v=5" alt="Trippy" style={{ width: screen === "brainstorm" ? 52 : 36, height: screen === "brainstorm" ? 52 : 36, objectFit: "cover", objectPosition: "50% 35%", marginTop: screen === "brainstorm" ? -6 : -4, marginLeft: screen === "brainstorm" ? -6 : -4 }}/>
            </div>
            <div onClick={() => { setChatOpen(true); setChatUnread(false); setTimeout(() => chatInputRef.current?.focus(), 100); }}
              style={{ flex: 1, padding: screen === "brainstorm" ? "10px 14px" : "9px 14px", borderRadius: screen === "brainstorm" ? 14 : 18, border: `1.5px solid ${T.sand}`, background: T.warm, fontFamily: "Georgia,serif", fontSize: 13, color: T.mist, cursor: "text", minHeight: screen === "brainstorm" ? 44 : "auto" }}>
              {chatUnread ? "Your itinerary is ready! Want to fine-tune anything?" : (() => {
                const lastAI = [...chatMessages].reverse().find(m => m.role === "assistant" && m.content);
                if (lastAI) return `Trippy: ${lastAI.content.slice(0, 50)}${lastAI.content.length > 50 ? "…" : ""}`;
                return getChatPlaceholder();
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ── PRE-IG REFINEMENT BOTTOM SHEET ── */}
      {showPreIgSheet && (
        <div style={{position:"fixed",inset:0,zIndex:1600,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-end"}}>
          {/* Scrim */}
          <div onClick={()=>setShowPreIgSheet(false)} style={{position:"absolute",inset:0,background:"rgba(15,25,35,0.45)",animation:"fadeUp 0.2s ease"}}/>
          {/* Sheet */}
          <div style={{
            position:"relative",width:"100%",maxWidth:430,
            background:T.warm,borderRadius:"20px 20px 0 0",
            boxShadow:SHADOW.lg,
            padding:"20px 20px",paddingBottom:"calc(20px + env(safe-area-inset-bottom, 0px))",
            animation:"fadeUp 0.25s ease",
            maxHeight:"85vh",overflowY:"auto",
          }}>
            {/* Handle */}
            <div style={{width:36,height:4,borderRadius:2,background:T.sand,margin:"0 auto 16px"}}/>

            <div style={{fontFamily:"'DM Serif Display',serif",fontSize:20,color:T.ink,textAlign:"center",marginBottom:4}}>Fine-tune your itinerary</div>
            <div style={{fontSize:12,color:T.mist,fontFamily:"Georgia,serif",textAlign:"center",marginBottom:20}}>These preferences shape your day-by-day plan</div>

            {/* Budget */}
            <div style={{marginBottom:18}}>
              <div style={{fontFamily:"'DM Serif Display',serif",fontSize:15,color:T.ink,marginBottom:8}}>Budget range</div>
              <div style={{display:"flex",gap:8}}>
                {[{key:"budget",label:"Budget",icon:"🏕️"},{key:"mid",label:"Mid-range",icon:"🏨"},{key:"luxury",label:"Luxury",icon:"🏰"}].map(b=>(
                  <button key={b.key} onClick={()=>setPreIgForm(f=>({...f,budget:b.key}))} style={{
                    flex:1,padding:"10px 8px",borderRadius:RADIUS.lg,cursor:"pointer",textAlign:"center",
                    border:`2px solid ${preIgForm.budget===b.key?T.terra:T.sand}`,
                    background:preIgForm.budget===b.key?"#FFF4EE":T.chalk,
                    transition:`all ${MOTION.normal}`,
                  }}>
                    <div style={{fontSize:20,marginBottom:2}}>{b.icon}</div>
                    <div style={{fontFamily:"Georgia,serif",fontSize:12,color:T.ink,fontWeight:preIgForm.budget===b.key?700:400}}>{b.label}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Morning preference */}
            <div style={{marginBottom:18}}>
              <div style={{fontFamily:"'DM Serif Display',serif",fontSize:15,color:T.ink,marginBottom:8}}>When do you like to head out?</div>
              <div style={{display:"flex",gap:8}}>
                {[{key:"early",icon:"🌅",label:"Early bird",sub:"Out by 8–9am"},{key:"late",icon:"☕",label:"Slow starter",sub:"Out by 11am"}].map(({key,icon,label,sub})=>(
                  <button key={key} onClick={()=>setPreIgForm(f=>({...f,morningStart:key}))} style={{
                    flex:1,padding:"10px 12px",borderRadius:RADIUS.lg,cursor:"pointer",textAlign:"left",
                    border:`2px solid ${preIgForm.morningStart===key?T.ocean:T.sand}`,
                    background:preIgForm.morningStart===key?"#EBF3FD":T.chalk,
                    transition:`all ${MOTION.normal}`,
                  }}>
                    <div style={{fontFamily:"Georgia,serif",fontSize:13,color:preIgForm.morningStart===key?T.ocean:T.ink,fontWeight:preIgForm.morningStart===key?700:400}}>{icon} {label}</div>
                    <div style={{fontFamily:"Georgia,serif",fontSize:11,color:T.mist,marginTop:2}}>{sub}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Pace */}
            <div style={{marginBottom:18}}>
              <div style={{fontFamily:"'DM Serif Display',serif",fontSize:15,color:T.ink,marginBottom:8}}>How active should the trip be?</div>
              <div style={{display:"flex",gap:8}}>
                {[{key:"relaxed",icon:"🌿",label:"Relaxed",sub:"Downtime to breathe"},{key:"active",icon:"⚡",label:"Active",sub:"Cover more ground"}].map(({key,icon,label,sub})=>(
                  <button key={key} onClick={()=>setPreIgForm(f=>({...f,pace:key}))} style={{
                    flex:1,padding:"10px 12px",borderRadius:RADIUS.lg,cursor:"pointer",textAlign:"left",
                    border:`2px solid ${preIgForm.pace===key?T.ocean:T.sand}`,
                    background:preIgForm.pace===key?"#EBF3FD":T.chalk,
                    transition:`all ${MOTION.normal}`,
                  }}>
                    <div style={{fontFamily:"Georgia,serif",fontSize:13,color:preIgForm.pace===key?T.ocean:T.ink,fontWeight:preIgForm.pace===key?700:400}}>{icon} {label}</div>
                    <div style={{fontFamily:"Georgia,serif",fontSize:11,color:T.mist,marginTop:2}}>{sub}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Free text */}
            <div style={{marginBottom:20}}>
              <div style={{fontFamily:"'DM Serif Display',serif",fontSize:15,color:T.ink,marginBottom:8}}>Any additional detail?</div>
              <textarea value={preIgForm.igNotes} onChange={e=>setPreIgForm(f=>({...f,igNotes:e.target.value}))}
                placeholder="e.g. prefer boutique hotels, want a cooking class, no long drives, vegetarian food options…"
                rows={3}
                style={{width:"100%",padding:"10px 12px",borderRadius:RADIUS.lg,border:`1.5px solid ${preIgForm.igNotes?T.ocean:T.sand}`,fontFamily:"Georgia,serif",fontSize:13,color:T.ink,outline:"none",resize:"none",boxSizing:"border-box",background:T.chalk}}/>
            </div>

            {/* Generate button */}
            <button onClick={() => {
              const hasExisting = editingTrip?.ig_response;
              if (hasExisting) {
                setShowReplaceConfirm(true);
                return;
              }
              // No existing itinerary — generate directly
              setShowPreIgSheet(false);
              const mergedForm = { ...(pendingForm || {}), budget: preIgForm.budget, morningStart: preIgForm.morningStart, pace: preIgForm.pace };
              if (preIgForm.igNotes.trim()) {
                mergedForm.notes = ((pendingForm?.notes || "") + "\n" + preIgForm.igNotes.trim()).trim();
              }
              setPendingForm(mergedForm);
              const voted = (pretripRoutes || []).map(r => ({ ...r, tier: 1, vote: r.id === pretripSelectedRouteId ? 1 : 0 }));
              setTimeout(() => handleBuildFromBrainstorm(voted, mergedForm), 50);
            }} style={{
              width:"100%",padding:16,borderRadius:RADIUS.lg,border:"none",
              background:`linear-gradient(135deg,${T.ocean},${T.dusk})`,color:"white",
              fontFamily:"'DM Serif Display',serif",fontSize:18,cursor:"pointer",
              boxShadow:"0 6px 22px rgba(37,99,168,0.4)",
            }}>
              Generate Itinerary →
            </button>
          </div>
        </div>
      )}

      {/* ── EDIT DETAILS CONFIRMATION ── */}
      {showEditConfirm && (() => {
        const { changes, isStructural, form } = showEditConfirm;
        const handleDiscard = () => {
          setShowEditConfirm(null);
          setPretripTab("brainstorm");
          setScreen("brainstorm");
        };
        return (
          <div style={{position:"fixed",inset:0,zIndex:2000,display:"flex",flexDirection:"column",justifyContent:"flex-end"}}>
            <div onClick={()=>setShowEditConfirm(null)} style={{position:"absolute",inset:0,background:"rgba(15,25,35,0.5)"}}/>
            <div style={{position:"relative",background:T.chalk,borderRadius:"20px 20px 0 0",padding:"24px 20px 20px",paddingBottom:"calc(20px + env(safe-area-inset-bottom, 0px))",animation:"slideUp 0.25s ease"}}>
              <button onClick={()=>setShowEditConfirm(null)} aria-label="Close" style={{
                position:"absolute",top:12,right:12,width:28,height:28,borderRadius:RADIUS.lg,
                border:"none",background:"transparent",color:T.mist,fontSize:18,cursor:"pointer",
                display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1,
              }}>✕</button>
              <div style={{width:36,height:4,borderRadius:2,background:T.sand,margin:"0 auto 16px"}}/>
              <div style={{fontFamily:"'DM Serif Display',serif",fontSize:18,color:T.ink,textAlign:"center",marginBottom:4}}>
                {isStructural ? "These changes need new routes" : "Details updated"}
              </div>
              <div style={{fontSize:12,color:T.mist,fontFamily:"Georgia,serif",textAlign:"center",lineHeight:1.5,marginBottom:16}}>
                {isStructural
                  ? "Your current routes" + (editingTrip?.ig_response ? " and itinerary" : "") + " were built for different details. Generating new routes will replace them."
                  : "Your changes might affect route choice. Generate new routes to apply, or discard to keep the current trip as-is."}
              </div>
              {/* Changes diff */}
              <div style={{background:T.warm,borderRadius:RADIUS.lg,padding:"12px 14px",marginBottom:16,border:`1px solid ${T.sand}`}}>
                <div style={{fontSize:10,color:T.mist,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>What changed</div>
                {changes.map((c, i) => (
                  <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",fontSize:12,borderBottom:i < changes.length - 1 ? `1px solid ${T.sand}` : "none"}}>
                    <span style={{color:T.mist,minWidth:75,flexShrink:0,fontSize:11}}>{c.label}</span>
                    <span style={{color:T.error,textDecoration:"line-through",fontSize:11}}>{c.old}</span>
                    <span style={{color:T.mist,flexShrink:0}}>→</span>
                    <span style={{color:T.moss,fontWeight:600,fontSize:11}}>{c.new}</span>
                  </div>
                ))}
              </div>
              <button onClick={() => { setShowEditConfirm(null); doSetupComplete(form, true); }} style={{
                width:"100%",padding:14,borderRadius:RADIUS.lg,border:"none",
                background:`linear-gradient(135deg,${T.ocean},${T.dusk})`,color:"white",
                fontFamily:"'DM Serif Display',serif",fontSize:15,cursor:"pointer",marginBottom:8,
                boxShadow:"0 4px 16px rgba(37,99,168,0.3)",
              }}>
                Generate New Routes
              </button>
              <div style={{fontSize:10,color:T.mist,textAlign:"center",marginBottom:10}}>
                {pretripRoutes.filter(r => !r.dismissed).length} existing routes{editingTrip?.ig_response ? " & itinerary" : ""} will be replaced
              </div>
              <button onClick={handleDiscard} style={{
                width:"100%",padding:12,borderRadius:RADIUS.lg,border:`2px solid ${T.sand}`,
                background:"transparent",color:T.mist,fontFamily:"Georgia,serif",fontSize:14,cursor:"pointer",
              }}>Discard Changes</button>
              <div style={{fontSize:10,color:T.mist,textAlign:"center",marginTop:6}}>Your edits will be reverted</div>
            </div>
          </div>
        );
      })()}

      {/* ── REPLACE ITINERARY CONFIRMATION ── */}
      {showReplaceConfirm && (() => {
        const igReq = editingTrip?.ig_request || {};
        const selectedRoute = (pretripRoutes || []).find(r => r.id === pretripSelectedRouteId);
        const oldRoute = igReq.votedRoute || (editingTrip?.ig_response?.name) || null;
        const changes = [];
        if (selectedRoute?.title && oldRoute && selectedRoute.title.toLowerCase() !== oldRoute.toLowerCase()) changes.push({ label: "Route", old: oldRoute, new: selectedRoute.title });
        if (preIgForm.budget !== (igReq.budget || "mid")) changes.push({ label: "Budget", old: { budget: "Budget", mid: "Mid-range", luxury: "Luxury" }[igReq.budget || "mid"], new: { budget: "Budget", mid: "Mid-range", luxury: "Luxury" }[preIgForm.budget] });
        if (preIgForm.pace !== (igReq.pace || "active")) changes.push({ label: "Pace", old: igReq.pace === "relaxed" ? "Relaxed" : "Active", new: preIgForm.pace === "relaxed" ? "Relaxed" : "Active" });
        if (preIgForm.morningStart !== (igReq.morningStart || "early")) changes.push({ label: "Morning", old: igReq.morningStart === "late" ? "Late start" : "Early bird", new: preIgForm.morningStart === "late" ? "Late start" : "Early bird" });
        if (pendingForm?.startDate !== igReq.startDate || pendingForm?.endDate !== igReq.endDate) {
          const fmtD = (iso) => iso ? new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
          changes.push({ label: "Dates", old: `${fmtD(igReq.startDate)}–${fmtD(igReq.endDate)}`, new: `${fmtD(pendingForm?.startDate)}–${fmtD(pendingForm?.endDate)}` });
        }
        if (String(pendingForm?.travelers) !== String(igReq.travelers || "2")) changes.push({ label: "Travelers", old: String(igReq.travelers || "2"), new: String(pendingForm?.travelers) });
        const isRefresh = changes.length === 0;
        return (
          <div style={{position:"fixed",inset:0,zIndex:2000,display:"flex",flexDirection:"column",justifyContent:"flex-end"}}>
            <div onClick={()=>setShowReplaceConfirm(false)} style={{position:"absolute",inset:0,background:"rgba(15,25,35,0.5)"}}/>
            <div style={{position:"relative",background:T.chalk,borderRadius:"20px 20px 0 0",padding:"24px 20px 20px",paddingBottom:"calc(20px + env(safe-area-inset-bottom, 0px))",animation:"slideUp 0.25s ease"}}>
              <div style={{width:36,height:4,borderRadius:2,background:T.sand,margin:"0 auto 16px"}}/>
              <div style={{fontFamily:"'DM Serif Display',serif",fontSize:18,color:T.ink,textAlign:"center",marginBottom:4}}>
                {isRefresh ? "Refresh itinerary?" : "Regenerate itinerary?"}
              </div>
              <div style={{fontSize:12,color:T.mist,fontFamily:"Georgia,serif",textAlign:"center",lineHeight:1.5,marginBottom:16}}>
                {isRefresh
                  ? "Same route and preferences — a fresh version will be generated with different activities, restaurants, and hotels."
                  : "Your current itinerary will be replaced"}
              </div>
              {/* Changes diff */}
              {changes.length > 0 ? (
                <div style={{background:T.warm,borderRadius:RADIUS.lg,padding:"12px 14px",marginBottom:16,border:`1px solid ${T.sand}`}}>
                  <div style={{fontSize:10,color:T.mist,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>What's changing</div>
                  {changes.map((c, i) => (
                    <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",fontSize:12,borderBottom:i < changes.length - 1 ? `1px solid ${T.sand}` : "none"}}>
                      <span style={{color:T.mist,minWidth:65,flexShrink:0}}>{c.label}</span>
                      <span style={{color:T.error,textDecoration:"line-through"}}>{c.old}</span>
                      <span style={{color:T.mist,flexShrink:0}}>→</span>
                      <span style={{color:T.moss,fontWeight:600}}>{c.new}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{background:T.warm,borderRadius:RADIUS.lg,padding:"10px 14px",marginBottom:16,border:`1px solid ${T.sand}`,textAlign:"center"}}>
                  <span style={{fontSize:11,color:T.moss}}>✓ No changes to route or preferences</span>
                </div>
              )}
              <button onClick={() => {
                setShowReplaceConfirm(false);
                setShowPreIgSheet(false);
                const mergedForm = { ...(pendingForm || {}), budget: preIgForm.budget, morningStart: preIgForm.morningStart, pace: preIgForm.pace };
                if (preIgForm.igNotes.trim()) {
                  mergedForm.notes = ((pendingForm?.notes || "") + "\n" + preIgForm.igNotes.trim()).trim();
                }
                setPendingForm(mergedForm);
                const voted = (pretripRoutes || []).map(r => ({ ...r, tier: 1, vote: r.id === pretripSelectedRouteId ? 1 : 0 }));
                setTimeout(() => handleBuildFromBrainstorm(voted, mergedForm), 50);
              }} style={{
                width:"100%",padding:14,borderRadius:RADIUS.lg,border:"none",
                background:`linear-gradient(135deg,${T.ocean},${T.dusk})`,color:"white",
                fontFamily:"'DM Serif Display',serif",fontSize:15,cursor:"pointer",
                boxShadow:"0 4px 16px rgba(37,99,168,0.3)",marginBottom:8,
              }}>
                {isRefresh ? "Refresh Itinerary" : "Replace Itinerary"}
              </button>
              <div style={{fontSize:10,color:T.mist,textAlign:"center",marginBottom:10}}>Your current itinerary will be replaced</div>
              <button onClick={() => {
                setShowReplaceConfirm(false);
                setShowPreIgSheet(false);
                setScreen("itinerary");
                setActiveBottomTab("itinerary");
              }} style={{
                width:"100%",padding:12,borderRadius:RADIUS.lg,border:`2px solid ${T.sand}`,
                background:"transparent",color:T.mist,fontFamily:"Georgia,serif",fontSize:14,cursor:"pointer",
              }}>
                Keep Current Itinerary
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── CHAT SHEET (floating bottom sheet, rendered globally) ── */}
      {chatOpen && (screen === "itinerary" || screen === "brainstorm") && activeBottomTab !== "board" && (() => {
        const isBrainstorm = screen === "brainstorm";
        return (
        <div style={{position:"fixed",inset:0,zIndex:1500,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-end",pointerEvents:"none"}}>
          {/* Scrim — only on itinerary (full sheet), skip on brainstorm (half sheet) */}
          {!isBrainstorm && <div onClick={()=>setChatOpen(false)} style={{position:"absolute",inset:0,background:"rgba(15,25,35,0.45)",animation:"fadeUp 0.2s ease",pointerEvents:"all"}}/>}
          {/* On brainstorm: no scrim, touches pass through to routes behind */}
          {/* Sheet — half height on brainstorm, full on itinerary */}
          <div style={{position:"relative",width:"100%",maxWidth:430,height:isBrainstorm?"50dvh":"85dvh",background:T.warm,borderRadius:"18px 18px 0 0",boxShadow:SHADOW.lg,display:"flex",flexDirection:"column",overflow:"hidden",animation:"slideUp 0.25s ease",pointerEvents:"all"}}>
            {/* Drag handle */}
            <div style={{padding:"8px 0 4px",display:"flex",justifyContent:"center",flexShrink:0,background:`linear-gradient(135deg,${T.dusk},${T.ocean})`}}>
              <div style={{width:38,height:4,borderRadius:4,background:"rgba(255,255,255,0.4)"}}/>
            </div>
            {/* Chat header — compact */}
            <div style={{background:`linear-gradient(135deg,${T.dusk},${T.ocean})`,padding:"6px 16px 8px",color:"white",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{width:30,height:30,borderRadius:"50%",overflow:"hidden",border:"1.5px solid rgba(255,255,255,0.3)",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <img src="/mascot.png?v=5" alt="TripJam" style={{width:40,height:40,objectFit:"cover",objectPosition:"50% 35%",pointerEvents:"none"}}/>
                </div>
                <div style={{fontFamily:"'DM Serif Display',serif",fontSize:15}}>Travel with Trippy</div>
              </div>
              <button onClick={()=>setChatOpen(false)} style={{background:"rgba(255,255,255,0.15)",border:"none",color:"white",width:28,height:28,borderRadius:"50%",fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
            </div>
            {/* Filter pills removed — no group features in phase 1 */}
            {/* Messages */}
            <div style={{flex:1,overflowY:"auto",padding:"16px 16px 8px",display:"flex",flexDirection:"column",gap:10}}>
              {filteredMessages.filter(m => m.role !== "system-undo").length === 0 && (
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  <div style={{display:"flex",justifyContent:"flex-start"}}>
                    <div style={{maxWidth:"90%",background:T.chalk,color:T.ink,borderRadius:"18px 18px 18px 4px",padding:"10px 14px",fontSize:13,fontFamily:"Georgia,serif",lineHeight:1.6,boxShadow:SHADOW.sm,borderLeft:`3px solid ${T.ocean}`}}>
                      {screen === "brainstorm"
                        ? pretripRoutes.filter(r => r.title && !r.dismissed).length >= 2
                          ? "I've put together some trip plans for you. Ask me anything — compare plans, tweak a specific one, or tell me what matters most to you."
                          : "I'm working on your trip plans — hang tight! Once they're ready, you can compare, tweak, or ask me anything."
                        : "Hey! This is just the first draft of your itinerary! Let's tweak it together — swap activities, change the pace, or try a different hotel. Just ask."
                      }
                    </div>
                  </div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:6,padding:"4px 0"}}>
                    {(screen === "brainstorm"
                      ? [`Reduce hotel switches in P2`,`Add a beach day in P3`,`Suggest best nature spots in ${(pendingForm?.destinations?.[0] || trip?.destination?.split("→")[0]?.trim() || "this destination")}?`]
                      : (() => {
                          const d1Hotel = days[0]?.activities?.find(a => a.type === "hotel");
                          const dest = trip?.destination?.split("→")[0]?.trim() || "this destination";
                          const pills = [];
                          if (d1Hotel) pills.push(`Swap ${d1Hotel.title.replace(/^Check in at /i, "")} for something else`);
                          else pills.push("Change Day 1 hotel");
                          pills.push(`What's a must-do in ${dest}?`);
                          pills.push("Make Day 3 more relaxed");
                          return pills;
                        })()
                    ).map(s=>(
                      <button key={s} onClick={()=>{ setChatInput(s); setTimeout(() => chatInputRef.current?.focus(), 50); }} style={{
                        background:"transparent",border:`1px solid ${T.ocean}`,borderRadius:RADIUS.md,padding:"6px 14px",
                        fontSize:13,fontFamily:"Georgia,serif",fontWeight:500,color:T.ocean,cursor:"pointer",
                      }}>{s}</button>
                    ))}
                  </div>
                </div>
              )}
              {filteredMessages.map((m,i)=>{
                if (m.role === "system-undo") {
                  const handleUndo = async () => {
                    if (m.undoData?.dismissedRouteIds) {
                      // Undo bulk route dismiss
                      for (const rid of m.undoData.dismissedRouteIds) undoDismissRef.current?.(rid);
                      setChatMessages(prev => prev.filter(msg => msg.id !== m.id));
                    } else if (m.undoData?.dismissedRouteId) {
                      // Undo single route dismiss (legacy)
                      undoDismissRef.current?.(m.undoData.dismissedRouteId);
                      setChatMessages(prev => prev.filter(msg => msg.id !== m.id));
                    } else if (m.undoData?.dismissedGemId && m.undoData?.dayId) {
                      // Undo gem dismiss (also fires for Add-to-Itinerary auto-dismiss; the AI-created
                      // activity, if any, stays — user manages it through normal activity controls).
                      const dayId = m.undoData.dayId;
                      const gemId = m.undoData.dismissedGemId;
                      let nextWishlist = null;
                      setDays(prev => prev.map(d => {
                        if (d.id !== dayId) return d;
                        nextWishlist = (d.wishlist || []).map(w => w.id === gemId ? { ...w, dismissed: false } : w);
                        return { ...d, wishlist: nextWishlist };
                      }));
                      if (nextWishlist) await supabase.from("days").update({ wishlist: nextWishlist }).eq("id", dayId);
                      setChatMessages(prev => prev.filter(msg => msg.id !== m.id));
                    } else if (m.undoData?.dayId && m.undoData?.actSnap) {
                      undoRemoveActivity(m.undoData.dayId, m.undoData.actSnap);
                    }
                  };
                  return (
                    <div key={m.id || i} style={{display:"flex",justifyContent:"center",margin:"6px 0"}}>
                      <div style={{background:T.sand,borderRadius:RADIUS.lg,padding:"8px 14px",fontSize:12,fontFamily:"Georgia,serif",color:T.mist,display:"flex",alignItems:"center",gap:10}}>
                        <span>{m.content}</span>
                        <button onClick={handleUndo} style={{background:"none",border:`1px solid ${T.mist}`,borderRadius:RADIUS.md,padding:"2px 10px",fontSize:12,fontFamily:"Georgia,serif",color:T.ink,cursor:"pointer"}}>Undo</button>
                      </div>
                    </div>
                  );
                }
                const isOwn = m.role==="user" && m.user_id===session.user.id;
                const isAI = m.role==="assistant";
                const isOther = m.role==="user" && m.user_id!==session.user.id;
                return (
                  <div key={i} style={{display:"flex",flexDirection:"column",alignItems:isOwn?"flex-end":"flex-start"}}>
                    {isAI && (
                      <div style={{fontSize:11,color:T.ocean,fontFamily:"Georgia,serif",marginBottom:2,paddingLeft:4,fontWeight:600}}>✨ Trippy</div>
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
                      boxShadow:SHADOW.sm,
                      borderLeft: isAI ? `3px solid ${T.ocean}` : "none",
                    }}>
                      {m.streaming && !m.content ? <span style={{color:T.mist,letterSpacing:2}}>···</span> : renderMentions(m.content||"")}
                      {m.streaming && m.content && <span style={{display:"inline-block",width:2,height:"1em",background:T.ink,marginLeft:2,verticalAlign:"text-bottom",animation:"blink 1s step-end infinite"}}/>}
                      {/* Place link-outs for AI messages mentioning places */}
                      {isAI && !m.streaming && m.content && (() => {
                        const allPlaces = (daysRef.current || []).flatMap(d => (d.activities || []).filter(a => a.type !== "transit" && a.type !== "hotel").map(a => ({ title: a.title, geocode: a.geocode, city: d.city })));
                        const mentioned = allPlaces.filter(p => m.content.toLowerCase().includes(p.title.toLowerCase().split(",")[0].toLowerCase()));
                        if (mentioned.length === 0) return null;
                        const unique = mentioned.filter((p, i, arr) => arr.findIndex(q => q.title === p.title) === i).slice(0, 3);
                        return (
                          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8,paddingTop:6,borderTop:`1px solid ${T.sand}`}}>
                            {unique.map((p, pi) => (
                              <a key={pi} href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.geocode || p.title)}+${encodeURIComponent(p.city || "")}`} target="_blank" rel="noopener noreferrer"
                                style={{fontSize:10,color:T.ocean,textDecoration:"none",background:`${T.ocean}08`,padding:"3px 8px",borderRadius:RADIUS.sm,fontFamily:"Georgia,serif",display:"inline-flex",alignItems:"center",gap:3}}>
                                📍 {p.title}
                              </a>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                    {isAI && m.suggestions?.length > 0 && (
                      <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:4,marginTop:6,maxWidth:"90vw"}}>
                        {m.suggestions.map((s, si) => (
                          s.type === "hotel"
                            ? <HotelSuggestionCard key={si} suggestion={s}
                                onSelect={() => { setChatInput(`Use "${s.title}"`); setTimeout(() => chatInputRef.current?.focus(), 50); }}
                                onKnowMore={() => sendChatDirect(`Tell me more about ${s.title} — location, vibe, and what makes it stand out`)}
                              />
                            : <SuggestionCard key={si} suggestion={s}
                                onSelect={() => { setChatInput(`Use "${s.title}"`); setTimeout(() => chatInputRef.current?.focus(), 50); }}
                                onKnowMore={() => sendChatDirect(`Tell me more about ${s.title} — how would it fit into the itinerary, what's special about it, and what else is there to do nearby?`)}
                              />
                        ))}
                      </div>
                    )}
                    {isAI && m.hasChanges && !m.streaming && (
                      <button
                        onClick={() => {
                          setChatOpen(false);
                          if (screen === "brainstorm") {
                            setPretripTab("brainstorm");
                            // Scroll to first changed route
                            const targetId = m.changedRouteIds?.[0] || pretripSelectedRouteId;
                            if (targetId) { setPretripSelectedRouteId(null); setTimeout(() => setPretripSelectedRouteId(targetId), 100); }
                          } else {
                            setActiveBottomTab("itinerary");
                          }
                        }}
                        style={{
                          marginTop: 8, display: "flex", alignItems: "center", gap: 6,
                          background: `linear-gradient(135deg, ${T.ocean}, ${T.dusk})`,
                          color: "white", border: "none", borderRadius: RADIUS.md,
                          padding: "8px 14px", fontFamily: "Georgia,serif", fontSize: 12,
                          cursor: "pointer", fontWeight: 600,
                          boxShadow: SHADOW.md,
                        }}
                      >
                        {trip ? "🗺️ View Updated Itinerary" : "💡 View Updated Plans"}
                      </button>
                    )}
                  </div>
                );
              })}
              <div ref={chatBottomRef} />
            </div>
            {/* Input */}
            <div style={{padding:"8px 12px",paddingBottom:"calc(8px + env(safe-area-inset-bottom, 0px))",background:T.chalk,borderTop:`1px solid ${T.sand}`,display:"flex",gap:8,alignItems:"flex-end",flexShrink:0}}>
              <textarea
                ref={chatInputRef}
                value={chatInput}
                rows={1}
                onChange={e=>{
                  setChatInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
                }}
                onKeyDown={e=>{
                  if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
                }}
                placeholder={screen === "brainstorm" ? "Ask about plans…" : "Ask Trippy anything…"}
                rows={3}
                style={{flex:1,padding:"11px 14px",borderRadius:18,border:`1.5px solid ${T.sand}`,fontFamily:"Georgia,serif",fontSize:14,color:T.ink,outline:"none",background:T.warm,resize:"none",lineHeight:1.5,overflow:"hidden",display:"block",minHeight:66}}
              />
              <button onClick={sendChatMessage} disabled={chatLoading||!chatInput.trim()} style={{width:44,height:44,borderRadius:"50%",background:chatInput.trim()?T.ocean:T.sand,color:"white",border:"none",fontSize:18,cursor:chatInput.trim()?"pointer":"default",flexShrink:0}}>↑</button>
            </div>
          </div>
        </div>
        );
      })()}

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
                    style={{width:"100%",padding:"11px 14px",borderRadius:RADIUS.md,border:`1.5px solid ${T.sand}`,
                      fontFamily:"Georgia,serif",fontSize:14,color:T.ink,outline:"none",boxSizing:"border-box"}}/>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,color:T.mist,fontFamily:"Georgia,serif",marginBottom:4}}>Departure time (last day)</div>
                  <input type="time" value={flightsForm.departureTime}
                    onChange={e=>setFlightsForm(f=>({...f,departureTime:e.target.value}))}
                    style={{width:"100%",padding:"11px 14px",borderRadius:RADIUS.md,border:`1.5px solid ${T.sand}`,
                      fontFamily:"Georgia,serif",fontSize:14,color:T.ink,outline:"none",boxSizing:"border-box"}}/>
                </div>
              </div>
              <button onClick={saveFlights} style={{width:"100%",padding:14,borderRadius:RADIUS.lg,border:"none",
                background:`linear-gradient(135deg,${T.ocean},${T.dusk})`,color:"white",
                fontFamily:"'DM Serif Display',serif",fontSize:16,cursor:"pointer"}}>Save flights</button>
            </>}


          </div>
        </div>
      )}
    </div>
    </ErrorBoundary>
  );
}
