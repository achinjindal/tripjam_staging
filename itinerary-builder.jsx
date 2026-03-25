import { useState, useRef, useEffect } from "react";

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
      transitions: [
        { from: 1, to: 2, mode: "drive", duration: "25 min", distance: "12 km" },
        { from: 2, to: 3, mode: "walk",  duration: "8 min",  distance: "600 m" },
        { from: 3, to: 4, mode: "drive", duration: "30 min", distance: "18 km" },
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
      transitions: [
        { from: 5, to: 6, mode: "walk",  duration: "5 min",  distance: "400 m" },
        { from: 6, to: 7, mode: "tuk",   duration: "10 min", distance: "1.2 km" },
        { from: 7, to: 8, mode: "walk",  duration: "12 min", distance: "900 m" },
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
      transitions: [
        { from: 9,  to: 10, mode: "drive", duration: "10 min", distance: "3 km" },
        { from: 10, to: 11, mode: "drive", duration: "15 min", distance: "6 km" },
        { from: 11, to: 12, mode: "walk",  duration: "20 min", distance: "1.5 km" },
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
        transitions: [
          { from: 1, to: 2, mode: "walk",  duration: "5 min",  distance: "400 m" },
          { from: 2, to: 3, mode: "tuk",   duration: "15 min", distance: "2.5 km" },
          { from: 3, to: 4, mode: "drive", duration: "20 min", distance: "4 km" },
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
        transitions: [
          { from: 5, to: 6, mode: "drive", duration: "45 min", distance: "30 km" },
          { from: 6, to: 7, mode: "metro", duration: "20 min", distance: "8 km" },
          { from: 7, to: 8, mode: "drive", duration: "25 min", distance: "10 km" },
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
        transitions: [
          { from: 9,  to: 10, mode: "walk",  duration: "5 min",  distance: "350 m" },
          { from: 10, to: 11, mode: "boat",  duration: "20 min", distance: "4 km" },
          { from: 11, to: 12, mode: "drive", duration: "25 min", distance: "9 km" },
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
        transitions: [
          { from: 13, to: 14, mode: "tuk",   duration: "15 min", distance: "3 km" },
          { from: 14, to: 15, mode: "walk",  duration: "10 min", distance: "700 m" },
          { from: 15, to: 16, mode: "tuk",   duration: "10 min", distance: "2 km" },
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
        transitions: [
          { from: 17, to: 18, mode: "drive", duration: "30 min", distance: "14 km" },
          { from: 18, to: 19, mode: "drive", duration: "40 min", distance: "18 km" },
          { from: 19, to: 20, mode: "tuk",   duration: "15 min", distance: "5 km" },
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
        transitions: [
          { from: 1, to: 2, mode: "metro", duration: "20 min", distance: "6 km" },
          { from: 2, to: 3, mode: "walk",  duration: "10 min", distance: "800 m" },
          { from: 3, to: 4, mode: "walk",  duration: "5 min",  distance: "350 m" },
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
        transitions: [
          { from: 5, to: 6, mode: "walk",  duration: "8 min",  distance: "600 m" },
          { from: 6, to: 7, mode: "walk",  duration: "12 min", distance: "900 m" },
          { from: 7, to: 8, mode: "drive", duration: "25 min", distance: "7 km" },
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
    transitions: [
      { from: i*4+1, to: i*4+2, mode:"walk",  duration:"10 min", distance:"700 m" },
      { from: i*4+2, to: i*4+3, mode:"drive", duration:"15 min", distance:"4 km" },
      { from: i*4+3, to: i*4+4, mode:"walk",  duration:"8 min",  distance:"600 m" },
    ],
  }));
}

function getItineraryForForm(form) {
  const key = form.destination.toLowerCase().trim();
  const matched = Object.keys(DESTINATION_DATA).find(k => key.includes(k) || k.includes(key));
  const numDays = parseInt(form.duration) || 3;
  if (matched) {
    const data = DESTINATION_DATA[matched];
    const baseDays = data.days.slice(0, numDays);
    // If requested days exceed stored data, pad with generic days
    if (baseDays.length < numDays) {
      const extra = generateGenericDays(key, numDays - baseDays.length).map((d, i) => ({
        ...d,
        id: baseDays.length + i + 1,
        label: `Day ${baseDays.length + i + 1}`,
        date: `Day ${baseDays.length + i + 1}`,
      }));
      return { name: data.name, days: [...baseDays, ...extra] };
    }
    return { name: data.name, days: baseDays };
  }
  return {
    name: `${form.destination.charAt(0).toUpperCase() + form.destination.slice(1)} Explorer`,
    days: generateGenericDays(form.destination, numDays),
  };
}

const typeStyle = {
  sight:   { bg: "#EBF3FD", color: T.ocean,   label: "Sightseeing" },
  food:    { bg: "#FFF4E8", color: T.terra,   label: "Dining" },
  shop:    { bg: "#FDF0E0", color: T.gold,    label: "Shopping" },
  transit: { bg: "#F0F4F0", color: T.moss,    label: "Transit" },
  hotel:   { bg: "#F5F0FA", color: "#7B5EA7", label: "Stay" },
};

const modeIcon  = { drive:"🚗", walk:"🚶", tuk:"🛺", metro:"🚇", boat:"⛵" };
const modeLabel = { drive:"Drive", walk:"Walk", tuk:"Tuk-tuk", metro:"Metro", boat:"Boat" };

/* ─── MAP SVG ────────────────────────────────────────────────────────── */
function MapView({ day }) {
  const n = day.activities.length;
  const pts = day.activities.map((_, i) => ({
    x: 55 + i * (300 / Math.max(n - 1, 1)),
    y: 110 + (i % 2 === 0 ? -35 : 35),
  }));

  return (
    <div style={{ borderRadius: 20, overflow: "hidden", height: 210, background: "#C8DEB8", position: "relative" }}>
      <svg width="100%" height="100%" viewBox="0 0 400 210" preserveAspectRatio="xMidYMid slice">
        <defs>
          <pattern id="topo" width="30" height="30" patternUnits="userSpaceOnUse">
            <path d="M0 15 Q7.5 5 15 15 Q22.5 25 30 15" fill="none" stroke="rgba(30,80,20,0.08)" strokeWidth="1"/>
          </pattern>
          <filter id="shadow"><feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.2"/></filter>
        </defs>

        {/* Terrain */}
        <rect width="400" height="210" fill="#C8DEB8"/>
        <rect width="400" height="210" fill="url(#topo)"/>
        <ellipse cx="80"  cy="180" rx="90"  ry="40" fill="#B5CCA5" opacity="0.7"/>
        <ellipse cx="340" cy="50"  rx="100" ry="50" fill="#B5CCA5" opacity="0.5"/>
        <path d="M0,160 Q60,140 120,155 Q200,170 280,145 Q340,130 400,150 L400,210 L0,210Z" fill="#A8C890" opacity="0.6"/>

        {/* Road base */}
        {pts.slice(0,-1).map((p,i) => (
          <path key={`rb${i}`}
            d={`M ${p.x},${p.y} C ${(p.x+pts[i+1].x)/2},${p.y} ${(p.x+pts[i+1].x)/2},${pts[i+1].y} ${pts[i+1].x},${pts[i+1].y}`}
            stroke="#DDD5C0" strokeWidth="6" fill="none" strokeLinecap="round"/>
        ))}
        {/* Route overlay */}
        {pts.slice(0,-1).map((p,i) => {
          const tr = day.transitions?.[i];
          const color = tr?.mode === "walk" ? T.moss : tr?.mode === "tuk" ? T.gold : T.ocean;
          return (
            <path key={`r${i}`}
              d={`M ${p.x},${p.y} C ${(p.x+pts[i+1].x)/2},${p.y} ${(p.x+pts[i+1].x)/2},${pts[i+1].y} ${pts[i+1].x},${pts[i+1].y}`}
              stroke={color} strokeWidth="3" fill="none" strokeDasharray="7,4" strokeLinecap="round" opacity="0.85"/>
          );
        })}

        {/* Pins */}
        {pts.map((p,i) => {
          const act = day.activities[i];
          const ts  = typeStyle[act.type] || typeStyle.sight;
          return (
            <g key={i} filter="url(#shadow)">
              <circle cx={p.x} cy={p.y} r="18" fill="white" stroke={ts.color} strokeWidth="2.5"/>
              <text x={p.x} y={p.y+6} textAnchor="middle" fontSize="14">{act.icon}</text>
              {/* Number badge */}
              <circle cx={p.x+13} cy={p.y-13} r="8" fill={ts.color}/>
              <text x={p.x+13} y={p.y-9} textAnchor="middle" fontSize="8" fill="white" fontWeight="bold">{i+1}</text>
            </g>
          );
        })}

        {/* Transition labels on route */}
        {pts.slice(0,-1).map((p,i) => {
          const tr = day.transitions?.[i];
          if (!tr) return null;
          const mx = (p.x + pts[i+1].x) / 2;
          const my = (p.y + pts[i+1].y) / 2 - 12;
          return (
            <g key={`tl${i}`}>
              <rect x={mx-24} y={my-9} width={48} height={16} rx={8} fill="white" opacity="0.9"/>
              <text x={mx} y={my+3} textAnchor="middle" fontSize="9" fill={T.ink} fontWeight="600">
                {modeIcon[tr.mode]} {tr.duration}
              </text>
            </g>
          );
        })}
      </svg>

      {/* City badge */}
      <div style={{
        position:"absolute", top:12, left:12,
        background:"rgba(15,25,35,0.82)", backdropFilter:"blur(8px)",
        borderRadius:12, padding:"5px 14px", color:"white",
        fontSize:13, fontFamily:"'DM Serif Display',serif", fontWeight:700,
        boxShadow:"0 4px 16px rgba(0,0,0,0.25)"
      }}>📍 {day.city}</div>

      {/* Legend */}
      <div style={{
        position:"absolute", bottom:10, right:10,
        background:"rgba(255,255,255,0.9)", borderRadius:10,
        padding:"6px 10px", fontSize:10, fontFamily:"Georgia,serif", color:T.ink,
        display:"flex", flexDirection:"column", gap:3,
      }}>
        <div style={{color:T.mist, fontWeight:700, marginBottom:1}}>ROUTE</div>
        {[{mode:"drive",c:T.ocean},{mode:"walk",c:T.moss},{mode:"tuk",c:T.gold}]
          .filter(x => day.transitions?.some(t=>t.mode===x.mode))
          .map(x=>(
          <div key={x.mode} style={{display:"flex",alignItems:"center",gap:5}}>
            <svg width="20" height="6"><path d="M0,3 L20,3" stroke={x.c} strokeWidth="2" strokeDasharray="5,3"/></svg>
            {modeLabel[x.mode]}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── TRANSITION CHIP ────────────────────────────────────────────────── */
function TransitionChip({ tr }) {
  if (!tr) return null;
  const color = tr.mode === "walk" ? T.moss : tr.mode === "tuk" ? T.gold : T.ocean;
  return (
    <div style={{ display:"flex", alignItems:"center", padding:"0 20px", height:28, gap:0 }}>
      {/* Connector line + inline label */}
      <div style={{ width:40, flexShrink:0, display:"flex", justifyContent:"center" }}>
        <div style={{ width:1, height:28, background:`linear-gradient(to bottom, ${color}30, ${color}30)`, borderLeft:`1px dashed ${color}50` }}/>
      </div>
      <span style={{ fontSize:11, color:T.mist, fontFamily:"Georgia,serif", letterSpacing:0.2, userSelect:"none" }}>
        {modeIcon[tr.mode]} <span style={{ color }}>{tr.duration}</span>
      </span>
    </div>
  );
}

/* ─── ACTIVITY CARD ──────────────────────────────────────────────────── */
function ActivityCard({ activity, onToggle }) {
  const ts = typeStyle[activity.type] || typeStyle.sight;
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
            <span style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif"}}>⏱ {activity.duration}</span>
            <button onClick={() => onToggle(activity.id)} style={{
              background: activity.confirmed ? T.moss : "transparent",
              color: activity.confirmed ? "white" : T.mist,
              border:`1.5px solid ${activity.confirmed ? T.moss : T.sand}`,
              borderRadius:20, padding:"3px 9px", fontSize:11,
              cursor:"pointer", fontFamily:"Georgia,serif", transition:"all 0.2s",
              whiteSpace:"nowrap",
            }}>{activity.confirmed ? "✓ Set" : "Confirm"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── DAY SECTION ────────────────────────────────────────────────────── */
function DaySection({ day, onToggle, onAI }) {
  const confirmed = day.activities.filter(a=>a.confirmed).length;
  const total     = day.activities.length;

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
        <div>
          <div style={{fontFamily:"'DM Serif Display',serif",fontSize:20,color:T.ink,lineHeight:1}}>{day.city}</div>
          <div style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif",marginTop:2}}>{day.date} · {confirmed}/{total} confirmed</div>
        </div>
        <button onClick={() => onAI(day.city)} style={{
          marginLeft:"auto", background:`linear-gradient(135deg,${T.ocean},${T.dusk})`,
          color:"white", border:"none", borderRadius:20, padding:"6px 14px",
          fontSize:12, cursor:"pointer", fontFamily:"Georgia,serif",
          boxShadow:"0 3px 10px rgba(37,99,168,0.35)",
        }}>✨ AI Tips</button>
      </div>

      {/* Map */}
      <div style={{padding:"0 20px 14px"}}><MapView day={day}/></div>

      {/* Progress bar */}
      <div style={{padding:"0 20px 14px"}}>
        <div style={{background:T.sand,borderRadius:10,height:4}}>
          <div style={{background:T.moss,height:4,borderRadius:10,width:`${(confirmed/total)*100}%`,transition:"width 0.4s ease"}}/>
        </div>
      </div>

      {/* Activities + transitions */}
      {day.activities.map((act, i) => {
        const tr = day.transitions?.find(t => t.from === act.id);
        return (
          <div key={act.id}>
            <ActivityCard activity={act} onToggle={onToggle}/>
            <TransitionChip tr={tr}/>
          </div>
        );
      })}

      <div style={{padding:"8px 20px 0"}}>
        <button style={{
          width:"100%", border:`2px dashed ${T.sand}`,
          background:"transparent", borderRadius:14, padding:11,
          color:T.mist, cursor:"pointer", fontFamily:"Georgia,serif", fontSize:13,
        }}>+ Add activity to {day.city}</button>
      </div>
    </div>
  );
}

/* ─── SETUP FORM ─────────────────────────────────────────────────────── */
function SetupForm({ onGenerate }) {
  const [step, setStep]       = useState(0);
  const [generating, setGen]  = useState(false);
  const [form, setForm]       = useState({ destination:"", duration:"5", travelers:"2", style:"", budget:"mid" });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const styles  = ["Cultural & Heritage","Adventure & Outdoors","Food & Culinary","Relaxation & Wellness","City Break","Road Trip","Beach & Coast"];
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
      <div style={{fontSize:13,color:T.mist,textAlign:"center",marginBottom:22,fontFamily:"Georgia,serif"}}>City, region, or country</div>
      <input value={form.destination} onChange={e=>set("destination",e.target.value)}
        placeholder="e.g. Rajasthan, Kyoto, Amalfi…"
        style={{width:"100%",padding:"14px 16px",borderRadius:14,border:`2px solid ${form.destination?T.ocean:T.sand}`,
          fontFamily:"Georgia,serif",fontSize:15,color:T.ink,background:T.chalk,outline:"none",transition:"border 0.2s"}}/>
      <div style={{display:"flex",flexWrap:"wrap",gap:8,marginTop:14}}>
        {["Rajasthan 🏯","Kyoto 🌸","Amalfi 🌊","Patagonia 🏔️","Morocco 🕌"].map(d=>(
          <button key={d} onClick={()=>set("destination",d.split(" ")[0])} style={{
            background:T.sand,border:"none",borderRadius:20,padding:"6px 14px",
            fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif",color:T.ink,
          }}>{d}</button>
        ))}
      </div>
    </div>,

    /* 1 – duration & travelers */
    <div key={1} style={{animation:"fadeUp 0.3s ease"}}>
      <div style={{textAlign:"center",fontSize:36,marginBottom:8}}>📅</div>
      <div style={{fontFamily:"'DM Serif Display',serif",fontSize:24,color:T.ink,textAlign:"center",marginBottom:20}}>Trip details</div>
      <div style={{fontFamily:"Georgia,serif",fontSize:13,color:T.mist,marginBottom:8}}>Duration</div>
      <div style={{display:"flex",gap:8,marginBottom:22,flexWrap:"wrap"}}>
        {["3","5","7","10","14"].map(d=>(
          <button key={d} onClick={()=>set("duration",d)} style={{
            flex:"1 1 52px",padding:"12px 0",borderRadius:12,cursor:"pointer",
            border:`2px solid ${form.duration===d?T.ocean:T.sand}`,
            background:form.duration===d?T.ocean:T.chalk,
            color:form.duration===d?"white":T.ink,
            fontFamily:"'DM Serif Display',serif",fontSize:20,transition:"all 0.2s",
          }}>{d}<span style={{fontSize:10,display:"block",fontFamily:"Georgia,serif",fontWeight:400}}>days</span></button>
        ))}
      </div>
      <div style={{fontFamily:"Georgia,serif",fontSize:13,color:T.mist,marginBottom:10}}>Travelers</div>
      <div style={{display:"flex",alignItems:"center",gap:18}}>
        <button onClick={()=>set("travelers",String(Math.max(1,+form.travelers-1)))} style={{width:42,height:42,borderRadius:"50%",border:`2px solid ${T.sand}`,background:T.chalk,fontSize:22,cursor:"pointer"}}>−</button>
        <span style={{fontFamily:"'DM Serif Display',serif",fontSize:32,color:T.ink,minWidth:44,textAlign:"center"}}>{form.travelers}</span>
        <button onClick={()=>set("travelers",String(Math.min(20,+form.travelers+1)))} style={{width:42,height:42,borderRadius:"50%",border:"none",background:T.ocean,color:"white",fontSize:22,cursor:"pointer"}}>+</button>
        <span style={{fontFamily:"Georgia,serif",fontSize:14,color:T.mist}}>{+form.travelers===1?"solo":"travelers"}</span>
      </div>
    </div>,

    /* 2 – style */
    <div key={2} style={{animation:"fadeUp 0.3s ease"}}>
      <div style={{textAlign:"center",fontSize:36,marginBottom:8}}>🎒</div>
      <div style={{fontFamily:"'DM Serif Display',serif",fontSize:24,color:T.ink,textAlign:"center",marginBottom:4}}>Trip style</div>
      <div style={{fontSize:13,color:T.mist,textAlign:"center",marginBottom:18,fontFamily:"Georgia,serif"}}>What matters most to you?</div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {styles.map(s=>(
          <button key={s} onClick={()=>set("style",s)} style={{
            padding:"12px 16px",borderRadius:12,cursor:"pointer",textAlign:"left",
            border:`2px solid ${form.style===s?T.ocean:T.sand}`,
            background:form.style===s?"#EBF3FD":T.chalk,
            color:form.style===s?T.ocean:T.ink,
            fontFamily:"Georgia,serif",fontSize:14,transition:"all 0.2s",
            fontWeight:form.style===s?700:400,
          }}>{s}</button>
        ))}
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
        {[["Destination",form.destination||"—"],["Duration",`${form.duration} days`],["Travelers",form.travelers],["Style",form.style||"—"],["Budget",budgets.find(b=>b.key===form.budget)?.label]].map(([k,v])=>(
          <div key={k} style={{display:"flex",justifyContent:"space-between",fontSize:13,fontFamily:"Georgia,serif",marginBottom:4}}>
            <span style={{color:T.mist}}>{k}</span>
            <span style={{color:T.ink,fontWeight:700}}>{v}</span>
          </div>
        ))}
      </div>
      <button onClick={handleGenerate} disabled={generating||!form.destination||!form.style} style={{
        width:"100%",padding:16,borderRadius:16,border:"none",
        cursor:generating?"default":"pointer",
        background:generating?T.sand:`linear-gradient(135deg,${T.ocean},${T.dusk})`,
        color:generating?T.mist:"white",
        fontFamily:"'DM Serif Display',serif",fontSize:18,
        boxShadow:generating?"none":"0 6px 22px rgba(37,99,168,0.4)",
        transition:"all 0.3s",
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
      <div style={{display:"flex",gap:10,marginTop:24}}>
        {step>0 && <button onClick={()=>setStep(s=>s-1)} style={{flex:1,padding:14,borderRadius:14,border:`2px solid ${T.sand}`,background:"transparent",color:T.mist,fontFamily:"Georgia,serif",fontSize:15,cursor:"pointer"}}>← Back</button>}
        {step<stepViews.length-1 && (
          <button onClick={()=>setStep(s=>s+1)} disabled={step===0&&!form.destination} style={{
            flex:2,padding:14,borderRadius:14,border:"none",cursor:"pointer",
            background:T.ocean,color:"white",
            fontFamily:"'DM Serif Display',serif",fontSize:16,
            opacity:(step===0&&!form.destination)?0.4:1,
            boxShadow:"0 4px 14px rgba(37,99,168,0.3)",
          }}>Continue →</button>
        )}
      </div>
    </div>
  );
}

/* ─── AI CHAT ────────────────────────────────────────────────────────── */
const CANNED = {
  "hidden":   (city) => `Here are some off-beat spots in **${city}**:\n\n🔹 **Panna Meena ka Kund** – a stepwell almost nobody visits\n🔹 **Galta Ji Monkey Temple** – pink sandstone hills, incredible views\n🔹 **Bagru village** – watch traditional block-printing artisans live\n\nWant me to slot any of these into your itinerary?`,
  "morning":  (city) => `A perfect morning in **${city}**:\n\n🌅 **6:30am** – Sunrise at Nahargarh Fort (panoramic city views)\n🥐 **8:00am** – Breakfast at Anokhi Café (great coffee)\n🏯 **9:30am** – Beat the crowds at Amber Fort\n\nShall I add this to Day 1?`,
  "food":     (city) => `Top food picks in **${city}**:\n\n🍛 **Dal Baati Churma** – essential Rajasthani staple\n🥤 **Lassiwala, M.I. Road** – legendary since 1944\n🥣 **Rawat Mishtan Bhandar** – best kachori breakfast in town\n🌙 **Suvarna Mahal** – splurge dinner at Rambagh Palace\n\nWant specific timing or reservation tips?`,
  "budget":   (city) => `Ways to trim costs in **${city}**:\n\n💡 Many forts have free/half-price on Tuesday mornings\n🛺 Negotiate tuk-tuk rates upfront (~₹200/hr flat)\n🏨 Stay in Bani Park – same vibe, half the price of the old city\n🍽️ Thali lunches at local dhabas – ₹120 and absolutely delicious\n\nAny specific area you'd like to cut costs in?`,
  "slow":     (city) => `To slow the pace in **${city}**:\n\n☕ Start mornings with tea on your haveli rooftop\n🎨 Book a 2-hr block-printing workshop instead of rushing markets\n🌄 Drop one fort visit and do a sunset camel ride instead\n\nI can rework your Day 2 to be more relaxed — want that?`,
};

function AIChatPanel({ onClose, city }) {
  const [messages, setMessages] = useState([
    { role:"ai", text:`Hi! I'm your travel assistant for **${city}**.\n\nAsk me anything — hidden gems, food recs, timing tips, budget hacks. Or try one of the suggestions below. 🗺️` }
  ]);
  const [input, setInput]     = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef             = useRef(null);

  const send = async (text) => {
    const q = text || input;
    if (!q.trim()) return;
    setMessages(m=>[...m,{role:"user",text:q}]);
    setInput("");
    setLoading(true);
    await new Promise(r=>setTimeout(r,800+Math.random()*500));
    const lower = q.toLowerCase();
    const key   = Object.keys(CANNED).find(k=>lower.includes(k));
    const reply = key ? CANNED[key](city) : `Great question about **${city}**! I'd suggest focusing on the old city in the morning (cooler, fewer crowds) and saving the markets for late afternoon when vendors are livelier. Want me to rearrange any specific day around this?`;
    setMessages(m=>[...m,{role:"ai",text:reply}]);
    setLoading(false);
  };

  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:"smooth"}); },[messages,loading]);

  const bold = (text) => text.split(/\*\*(.+?)\*\*/g).map((t,i)=>i%2===1?<strong key={i} style={{color:T.ink}}>{t}</strong>:t);

  const chips = ["Hidden gems 💎","Morning plan 🌅","Best food 🍛","Save budget 💰","Slow it down 🧘"];

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(15,25,35,0.72)",zIndex:200,display:"flex",alignItems:"flex-end",backdropFilter:"blur(6px)"}} onClick={onClose}>
      <div style={{background:T.warm,borderRadius:"24px 24px 0 0",width:"100%",maxHeight:"88vh",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div style={{padding:"18px 20px 12px",borderBottom:`1px solid ${T.sand}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontFamily:"'DM Serif Display',serif",fontSize:20,color:T.ink}}>✨ AI Travel Assistant</div>
            <div style={{fontSize:12,color:T.mist,fontFamily:"Georgia,serif"}}>Chatting about {city}</div>
          </div>
          <button onClick={onClose} style={{background:T.sand,border:"none",borderRadius:"50%",width:32,height:32,cursor:"pointer",fontSize:18,color:T.mist}}>×</button>
        </div>

        {/* Messages */}
        <div style={{flex:1,overflowY:"auto",padding:"16px 20px"}}>
          {messages.map((m,i)=>(
            <div key={i} style={{display:"flex",flexDirection:m.role==="user"?"row-reverse":"row",gap:9,marginBottom:14,animation:"fadeUp 0.25s ease"}}>
              {m.role==="ai" && <div style={{width:32,height:32,borderRadius:"50%",background:T.ocean,color:"white",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>✨</div>}
              <div style={{
                maxWidth:"80%",padding:"10px 14px",
                borderRadius:m.role==="user"?"16px 4px 16px 16px":"4px 16px 16px 16px",
                background:m.role==="user"?T.ocean:T.chalk,
                color:m.role==="user"?"white":T.ink,
                fontSize:14,fontFamily:"Georgia,serif",lineHeight:1.65,
                boxShadow:"0 2px 10px rgba(0,0,0,0.06)",whiteSpace:"pre-line",
              }}>
                {m.role==="ai" ? bold(m.text) : m.text}
              </div>
            </div>
          ))}
          {loading && (
            <div style={{display:"flex",gap:9,marginBottom:14}}>
              <div style={{width:32,height:32,borderRadius:"50%",background:T.ocean,color:"white",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>✨</div>
              <div style={{background:T.chalk,borderRadius:"4px 16px 16px 16px",padding:"12px 16px",display:"flex",gap:5,alignItems:"center"}}>
                {[0,1,2].map(i=><div key={i} style={{width:7,height:7,borderRadius:"50%",background:T.mist,animation:`pulse 1s ease ${i*0.15}s infinite`}}/>)}
              </div>
            </div>
          )}
          <div ref={bottomRef}/>
        </div>

        {/* Quick chips */}
        <div style={{padding:"0 20px 8px",display:"flex",gap:8,overflowX:"auto"}}>
          {chips.map(s=>(
            <button key={s} onClick={()=>send(s)} style={{flexShrink:0,background:T.sand,border:"none",borderRadius:20,padding:"6px 14px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif",color:T.ink}}>{s}</button>
          ))}
        </div>

        {/* Input */}
        <div style={{padding:"8px 20px 28px",display:"flex",gap:10}}>
          <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()}
            placeholder={`Ask anything about ${city}…`}
            style={{flex:1,padding:"12px 16px",borderRadius:14,border:`2px solid ${T.sand}`,fontFamily:"Georgia,serif",fontSize:15,outline:"none",background:T.chalk,color:T.ink}}/>
          <button onClick={()=>send()} disabled={!input.trim()} style={{
            width:46,height:46,borderRadius:14,border:"none",
            background:input.trim()?T.ocean:T.sand,
            color:"white",fontSize:20,cursor:input.trim()?"pointer":"default",
            transition:"all 0.2s",display:"flex",alignItems:"center",justifyContent:"center",
          }}>→</button>
        </div>
      </div>
    </div>
  );
}

/* ─── COLLAB TAB ─────────────────────────────────────────────────────── */
function CollabTab({ trip }) {
  return (
    <div style={{padding:"20px 20px 120px"}}>
      <div style={{fontFamily:"'DM Serif Display',serif",fontSize:22,color:T.ink,marginBottom:16}}>👥 Collaborators</div>
      {trip.collaborators.map((c,i)=>(
        <div key={i} style={{background:T.chalk,borderRadius:16,padding:16,marginBottom:10,display:"flex",alignItems:"center",gap:14,boxShadow:"0 2px 10px rgba(0,0,0,0.05)"}}>
          <div style={{width:44,height:44,borderRadius:"50%",background:c.color,color:"white",fontWeight:700,fontSize:18,display:"flex",alignItems:"center",justifyContent:"center"}}>{c.avatar}</div>
          <div>
            <div style={{fontFamily:"'DM Serif Display',serif",fontSize:16,color:T.ink}}>{c.name}</div>
            <div style={{fontSize:12,color:T.mist,fontFamily:"Georgia,serif"}}>{i===0?"Organizer":i===2?"You · Editor":"Editor"}</div>
          </div>
          {i!==2 && <button style={{marginLeft:"auto",background:"transparent",color:T.mist,border:`1px solid ${T.sand}`,borderRadius:20,padding:"4px 12px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>Message</button>}
        </div>
      ))}
      <div style={{background:T.sand,borderRadius:16,padding:20,marginTop:12,textAlign:"center"}}>
        <div style={{fontSize:28,marginBottom:8}}>🔗</div>
        <div style={{fontFamily:"'DM Serif Display',serif",fontSize:18,color:T.ink,marginBottom:4}}>Invite friends</div>
        <div style={{fontSize:13,color:T.mist,fontFamily:"Georgia,serif",marginBottom:16}}>Anyone with the link can view & suggest edits</div>
        <button style={{background:T.ocean,color:"white",border:"none",borderRadius:20,padding:"10px 28px",fontFamily:"Georgia,serif",fontSize:14,cursor:"pointer"}}>Copy invite link</button>
      </div>
      <div style={{marginTop:24}}>
        <div style={{fontFamily:"'DM Serif Display',serif",fontSize:18,color:T.ink,marginBottom:14}}>Recent activity</div>
        {[{who:"Priya",action:"confirmed Amber Fort",time:"2m ago",color:T.terra},{who:"Arjun",action:"added Rooftop dinner in Jodhpur",time:"1h ago",color:T.moss},{who:"Priya",action:"changed Day 3 transport to private cab",time:"3h ago",color:T.terra}].map((a,i)=>(
          <div key={i} style={{display:"flex",gap:12,marginBottom:14,alignItems:"flex-start"}}>
            <div style={{width:30,height:30,borderRadius:"50%",background:a.color,color:"white",fontSize:13,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{a.who[0]}</div>
            <div>
              <span style={{fontWeight:700,color:T.ink,fontSize:13,fontFamily:"'DM Serif Display',serif"}}>{a.who} </span>
              <span style={{color:T.mist,fontSize:13,fontFamily:"Georgia,serif"}}>{a.action}</span>
              <div style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif",marginTop:2}}>{a.time}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── ROOT ───────────────────────────────────────────────────────────── */
export default function App() {
  const [screen,    setScreen]    = useState("setup");
  const [trip,      setTrip]      = useState(SAMPLE_TRIP);
  const [days,      setDays]      = useState(SAMPLE_TRIP.days);
  const [tab,       setTab]       = useState("plan");
  const [showAI,    setShowAI]    = useState(false);
  const [aiCity,    setAICity]    = useState("Jaipur");
  const [activeDay, setActiveDay] = useState(0);

  const scrollRef = useRef(null);
  const dayRefs   = useRef([]);
  const pillStrip = useRef(null);
  const isJumping = useRef(false);

  const toggleConfirm = (actId) => {
    setDays(prev=>prev.map(d=>({...d,activities:d.activities.map(a=>a.id===actId?{...a,confirmed:!a.confirmed}:a)})));
  };

  const openAI = (city) => { setAICity(city); setShowAI(true); };

  const handleGenerate = (form) => {
    const itinerary = getItineraryForForm(form);
    setTrip({
      ...SAMPLE_TRIP,
      name: itinerary.name,
      dates: `${form.duration} days · ${form.travelers} travelers`,
      travelers: parseInt(form.travelers),
    });
    setDays(itinerary.days);
    setAICity(form.destination);
    setActiveDay(0);
    setScreen("itinerary");
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

  return (
    <div style={{fontFamily:"Georgia,serif",background:T.warm,minHeight:"100vh",maxWidth:430,margin:"0 auto",position:"relative",display:"flex",flexDirection:"column",height:"100vh",overflow:"hidden"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:4px;}
        ::-webkit-scrollbar-thumb{background:${T.sand};border-radius:4px;}
        @keyframes fadeUp{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}
        @keyframes pulse{0%,100%{opacity:0.3;transform:scale(0.8);}50%{opacity:1;transform:scale(1);}}
        .no-scrollbar::-webkit-scrollbar{display:none;}
        .no-scrollbar{-ms-overflow-style:none;scrollbar-width:none;}
      `}</style>

      {/* ── SETUP ── */}
      {screen==="setup" && (
        <div style={{flex:1,overflowY:"auto"}}>
          <div style={{background:`linear-gradient(160deg,${T.dusk},${T.ocean})`,padding:"44px 20px 36px",color:"white",position:"relative",overflow:"hidden"}}>
            <div style={{position:"absolute",top:-50,right:-50,width:200,height:200,borderRadius:"50%",background:"rgba(255,255,255,0.04)"}}/>
            <div style={{fontSize:13,letterSpacing:3,opacity:0.6,textTransform:"uppercase",marginBottom:10,fontFamily:"Georgia,serif"}}>Wayfarer</div>
            <div style={{fontFamily:"'DM Serif Display',serif",fontSize:34,lineHeight:1.2,marginBottom:10}}>Plan your next<br/>adventure ✈️</div>
            <div style={{fontSize:14,opacity:0.7,fontFamily:"Georgia,serif"}}>AI-powered itineraries, built for you</div>
          </div>
          <div style={{padding:"28px 0 0"}}><SetupForm onGenerate={handleGenerate}/></div>
        </div>
      )}

      {/* ── ITINERARY ── */}
      {screen==="itinerary" && (
        <>
          {/* Fixed header */}
          <div style={{flexShrink:0,background:`linear-gradient(160deg,${T.dusk},${T.ocean})`,padding:"28px 20px 20px",color:"white",position:"relative",overflow:"hidden"}}>
            <div style={{position:"absolute",top:-30,right:-30,width:130,height:130,borderRadius:"50%",background:"rgba(255,255,255,0.04)"}}/>
            <button onClick={()=>setScreen("setup")} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:20,padding:"4px 13px",color:"white",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif",marginBottom:12}}>← New trip</button>
            <div style={{fontFamily:"'DM Serif Display',serif",fontSize:24,lineHeight:1.2,marginBottom:4}}>{trip.name}</div>
            <div style={{fontSize:13,opacity:0.75,fontFamily:"Georgia,serif"}}>📅 {trip.dates}</div>
            <div style={{display:"flex",alignItems:"center",marginTop:12}}>
              {trip.collaborators.map((c,i)=>(
                <div key={i} style={{width:28,height:28,borderRadius:"50%",background:c.color,color:"white",fontWeight:700,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",border:"2px solid white",marginLeft:i>0?-8:0}}>{c.avatar}</div>
              ))}
              <span style={{fontSize:12,opacity:0.7,fontFamily:"Georgia,serif",marginLeft:10}}>{trip.collaborators.length} on this trip</span>
            </div>
            <div style={{display:"flex",gap:8,marginTop:16}}>
              {[["plan","🗓 Itinerary"],["collab","👥 Collab"]].map(([t,l])=>(
                <button key={t} onClick={()=>setTab(t)} style={{
                  background:tab===t?"white":"rgba(255,255,255,0.15)",
                  color:tab===t?T.ocean:"white",
                  border:"none",borderRadius:20,padding:"6px 18px",
                  fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif",
                  fontWeight:tab===t?700:400,transition:"all 0.2s",
                }}>{l}</button>
              ))}
            </div>
          </div>

          {/* Sticky day-pill strip — plan tab only */}
          {tab==="plan" && (
            <div style={{flexShrink:0,background:T.warm,borderBottom:`1px solid ${T.sand}`,padding:"8px 16px"}}>
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

          {/* Scrollable body */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            style={{flex:1,overflowY:"auto",paddingTop:4,paddingBottom:100}}
          >
            {tab==="plan"
              ? days.map((day,i)=>(
                  <div key={day.id} ref={el=>{ dayRefs.current[i]=el; }}>
                    <DaySection day={day} onToggle={toggleConfirm} onAI={openAI}/>
                  </div>
                ))
              : <CollabTab trip={trip}/>
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
            <button onClick={()=>openAI(days[activeDay]?.city || days[0].city)} style={{
              flex:1,background:`linear-gradient(135deg,${T.ocean},${T.dusk})`,
              color:"white",border:"none",borderRadius:14,padding:14,
              fontFamily:"'DM Serif Display',serif",fontSize:16,cursor:"pointer",
              boxShadow:"0 4px 18px rgba(37,99,168,0.35)",
            }}>✨ Ask AI</button>
            <button style={{background:T.sand,color:T.ink,border:"none",borderRadius:14,padding:"14px 18px",fontFamily:"Georgia,serif",fontSize:14,cursor:"pointer"}}>📤 Share</button>
          </div>
        </>
      )}

      {showAI && <AIChatPanel onClose={()=>setShowAI(false)} city={aiCity}/>}
    </div>
  );
}
