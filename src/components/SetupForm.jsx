import { useState, useRef, useEffect } from "react";
import { T, PLACES_PROXY, PLACES_HEADERS } from "../theme";
import { CityInput } from "./BoardView.jsx";

function DateRangePicker({ startDate, endDate, onChange }) {
  const todayISO = new Date().toISOString().slice(0, 12);
  const initDate = startDate || todayISO;
  const [viewYear, setViewYear] = useState(() => parseInt(initDate.slice(0, 4)));
  const [viewMonth, setViewMonth] = useState(() => parseInt(initDate.slice(5, 7)) - 1);

  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const DAY_HEADERS = ["Su","Mo","Tu","We","Th","Fr","Sa"];

  const toISO = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const fmtShort = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => toISO(viewYear, viewMonth, i + 1))];

  const prevMonth = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); } else setViewMonth(m => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); } else setViewMonth(m => m + 1); };

  const handleDay = (iso) => {
    if (!startDate || (startDate && endDate)) {
      onChange(iso, "");
    } else {
      if (iso === startDate) { onChange("", ""); }
      else if (iso > startDate) { onChange(startDate, iso); }
      else { onChange(iso, ""); }
    }
  };

  const phase = !startDate || (startDate && endDate) ? "start" : "end";
  const numDays = startDate && endDate ? Math.round((new Date(endDate) - new Date(startDate)) / 864e5) + 1 : null;

  return (
    <div style={{ marginBottom: 18 }}>
      {/* Selected range display */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ padding: "6px 14px", borderRadius: 20, background: startDate ? T.ocean : T.sand, color: startDate ? "white" : T.mist, fontFamily: "Georgia,serif", fontSize: 13 }}>
          {startDate ? fmtShort(startDate) : "Arrival"}
        </span>
        <span style={{ color: T.mist, fontSize: 16 }}>→</span>
        <span style={{ padding: "6px 14px", borderRadius: 20, background: endDate ? T.ocean : T.sand, color: endDate ? "white" : T.mist, fontFamily: "Georgia,serif", fontSize: 13 }}>
          {endDate ? fmtShort(endDate) : "Departure"}
        </span>
        {numDays && <span style={{ fontFamily: "Georgia,serif", fontSize: 12, color: T.mist }}>{numDays} days</span>}
      </div>

      {/* Hint */}
      <div style={{ fontFamily: "Georgia,serif", fontSize: 12, color: T.mist, textAlign: "center", marginBottom: 10 }}>
        {phase === "start" ? "Tap arrival date" : "Tap departure date"}
      </div>

      {/* Month nav */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <button onClick={prevMonth} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: T.mist, padding: "4px 10px", lineHeight: 1 }}>‹</button>
        <span style={{ fontFamily: "Georgia,serif", fontSize: 15, color: T.ink, fontWeight: 600 }}>{MONTHS[viewMonth]} {viewYear}</span>
        <button onClick={nextMonth} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: T.mist, padding: "4px 10px", lineHeight: 1 }}>›</button>
      </div>

      {/* Day headers */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", marginBottom: 2 }}>
        {DAY_HEADERS.map(d => <div key={d} style={{ textAlign: "center", fontFamily: "Georgia,serif", fontSize: 11, color: T.mist, padding: "2px 0" }}>{d}</div>)}
      </div>

      {/* Calendar grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)" }}>
        {cells.map((iso, i) => {
          if (!iso) return <div key={i} />;
          const isStart = iso === startDate;
          const isEnd = iso === endDate;
          const inRange = startDate && endDate && iso > startDate && iso < endDate;
          const isToday = iso === todayISO;
          const isPast = iso < todayISO;
          const isBeforeStart = phase === "end" && startDate && iso < startDate;

          let bg = "transparent", color = (isPast || isBeforeStart) ? T.sand : T.ink, radius = "8px";
          if (isStart || isEnd) { bg = T.ocean; color = "white"; }
          else if (inRange) { bg = "rgba(37,99,168,0.12)"; radius = "0"; }

          // Extend range bg to edges for start/end
          const startEdge = isStart && endDate ? { borderRadius: "8px 0 0 8px" } : {};
          const endEdge = isEnd && startDate ? { borderRadius: "0 8px 8px 0" } : {};
          const rangeStyle = inRange ? { borderRadius: 0 } : {};

          return (
            <div key={iso} onClick={() => handleDay(iso)} style={{
              textAlign: "center", padding: "9px 0", cursor: "pointer",
              fontFamily: "Georgia,serif", fontSize: 13, fontWeight: isToday ? 700 : 400,
              color, background: bg, borderRadius: radius,
              ...(isStart && endDate ? { borderRadius: "8px 0 0 8px" } : {}),
              ...(isEnd ? { borderRadius: "0 8px 8px 0" } : {}),
              ...(inRange ? { borderRadius: 0 } : {}),
              userSelect: "none",
            }}>
              {iso.slice(8).replace(/^0/, "")}
              {isToday && !isStart && !isEnd && <div style={{ width: 3, height: 3, borderRadius: "50%", background: T.ocean, margin: "1px auto 0" }} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── SETUP FORM ─────────────────────────────────────────────────────── */

function SetupForm({ onGenerate, initialTrip, onStepChange, prefillForm = null, initialStep = 0 }) {
  const [step, setStep]           = useState(initialStep);
  useEffect(() => { setStep(initialStep); }, [initialStep]);
  const [generating, setGen]      = useState(false);

  // If prefillForm arrives (e.g. returning from brainstorm), merge its fields into form state.
  // Using a ref-based guard to only apply it on mount or when the object reference actually changes.
  const prefillAppliedRef = useRef(false);

  // Notify parent of step changes
  useEffect(() => { onStepChange?.(step); }, [step]);

  // Sync browser history with form steps so back button works.
  // When returning from brainstorm (initialStep > 0), push entries for all prior steps so
  // the user can navigate back through earlier form sections.
  useEffect(() => {
    window.history.replaceState({ step: 0 }, "");
    for (let s = 1; s <= initialStep; s++) {
      window.history.pushState({ step: s }, "");
    }
  }, []);
  useEffect(() => {
    const onPop = (e) => {
      const s = e.state?.step ?? 0;
      setStep(s);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const igReq = initialTrip?.ig_request || {};
  const prefill = initialTrip ? {
    destinations:  initialTrip.destination ? initialTrip.destination.split(" → ") : [],
    startDate:     initialTrip.start_date || "",
    endDate:       initialTrip.end_date || "",
    arrivalTime:   initialTrip.arrival_time   ? initialTrip.arrival_time.slice(11,16)   : "",
    departureTime: initialTrip.departure_time ? initialTrip.departure_time.slice(11,16) : "",
    arrivalCity:   initialTrip.arrival_city   || "",
    departureCity: initialTrip.departure_city || "",
    notes:         initialTrip.notes || "",
    ...(igReq.travelers    ? { travelers: String(igReq.travelers) } : {}),
    ...(igReq.styles       ? { styles: igReq.styles } : {}),
    ...(igReq.arrivalTime  ? { arrivalTime: igReq.arrivalTime } : {}),
    ...(igReq.departureTime? { departureTime: igReq.departureTime } : {}),
    ...(igReq.arrivalMode  ? { arrivalMode: igReq.arrivalMode } : {}),
    ...(igReq.departureMode? { departureMode: igReq.departureMode } : {}),
  } : {};
  const _today = new Date();
  const _defaultStart = new Date(_today); _defaultStart.setDate(_today.getDate() + 15);
  const _defaultEnd   = new Date(_today); _defaultEnd.setDate(_today.getDate() + 22);
  const _fmt = (d) => d.toISOString().slice(0, 10);
  const [form, setForm]           = useState({ destinations:[], destinationCountryCodes:[], startDate:_fmt(_defaultStart), endDate:_fmt(_defaultEnd), travelers:"2", styles:[], notes:"", arrivalCity:"", departureCity:"", baseLocation:"", ...prefill, ...(prefillForm || {}) });

  // Re-apply prefillForm on any change (handles returning from brainstorm)
  useEffect(() => {
    if (prefillForm && !prefillAppliedRef.current) {
      setForm(prev => ({ ...prev, ...prefillForm }));
      setStep(initialStep);
      prefillAppliedRef.current = true;
    }
  }, [prefillForm, initialStep]);
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




  const handleGenerate = async () => {
    const needsBase = form.destinations.some(d => d.toLowerCase().includes("help me decide"));
    if (needsBase && !form.baseLocation?.trim()) {
      setDestError("Please tell us where you're based so we can suggest the right destinations.");
      return;
    }
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
        {["Rajasthan 🏰","Japan 🌸","Amalfi 🌊","Patagonia 🏔️","Morocco 🕌","Koh Samui 🏝️","Bali 🌴","Santorini ☀️"].map(d=>{
          const name = d.replace(/\s*[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}]+$/u, "").trim();
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
      {form.destinations.length === 0 && (
        <button onClick={()=>{ addDestination("Help me decide"); setStep(1); }} style={{
          display:"flex",alignItems:"center",justifyContent:"center",gap:6,
          width:"100%",marginTop:12,padding:"13px 0",borderRadius:14,
          border:`2px solid ${T.ocean}44`,
          background:`linear-gradient(135deg, ${T.ocean}08, ${T.dusk}06)`,
          color:T.ocean,
          fontFamily:"Georgia,serif",fontSize:14,fontWeight:600,cursor:"pointer",
        }}>
          🌐 Help me decide
        </button>
      )}
    </div>,

    /* 1 – dates & travelers */
    <div key={1} style={{animation:"fadeUp 0.3s ease"}}>
      <div style={{textAlign:"center",fontSize:36,marginBottom:8}}>📅</div>
      <div style={{fontFamily:"'DM Serif Display',serif",fontSize:24,color:T.ink,textAlign:"center",marginBottom:20}}>Trip details</div>
      <DateRangePicker
        startDate={form.startDate}
        endDate={form.endDate}
        onChange={(start, end) => { set("startDate", start); set("endDate", end); }}
      />
      <div style={{fontFamily:"Georgia,serif",fontSize:13,color:T.mist,marginBottom:10}}>Travelers</div>
      <div style={{display:"flex",alignItems:"center",gap:18}}>
        <button onClick={()=>set("travelers",String(Math.max(1,+form.travelers-1)))} style={{width:42,height:42,borderRadius:"50%",border:`2px solid ${T.sand}`,background:T.chalk,fontSize:22,cursor:"pointer"}}>−</button>
        <span style={{fontFamily:"'DM Serif Display',serif",fontSize:32,color:T.ink,minWidth:44,textAlign:"center"}}>{form.travelers}</span>
        <button onClick={()=>set("travelers",String(Math.min(12,+form.travelers+1)))} style={{width:42,height:42,borderRadius:"50%",border:"none",background:T.ocean,color:"white",fontSize:22,cursor:"pointer"}}>+</button>
        <span style={{fontFamily:"Georgia,serif",fontSize:14,color:T.mist}}>{+form.travelers===1?"solo":"travelers"}</span>
      </div>
    </div>,

    /* 2 – style */
    /* 2 – base city + notes + generate */
    (() => { const isOpenToIdeas = form.destinations.some(d => d.toLowerCase().includes("help me decide")); return (
    <div key={3} style={{animation:"fadeUp 0.3s ease"}}>
      <div style={{fontFamily:"'DM Serif Display',serif",fontSize:20,color:T.ink,textAlign:"center",marginBottom:24}}>🛤 A few more details</div>

      {/* Base Location */}
      <div style={{marginBottom:18}}>
        <div style={{fontFamily:"Georgia,serif",fontSize:13,color:T.ink,marginBottom:6,fontWeight:600}}>
          Where are you based? {isOpenToIdeas ? <span style={{color:T.terra,fontWeight:600}}>*</span> : <span style={{color:T.mist,fontWeight:400}}>· optional</span>}
        </div>
        <CityInput value={form.baseLocation} onChange={v=>set("baseLocation",v)}
          placeholder="Your home city"
          inputStyle={{width:"100%",padding:"11px 14px",borderRadius:12,border:`1.5px solid ${form.baseLocation?T.ocean:destError&&isOpenToIdeas&&!form.baseLocation?T.terra:T.sand}`,fontFamily:"Georgia,serif",fontSize:13,color:T.ink,outline:"none",boxSizing:"border-box",background:T.chalk}}/>
      </div>

      <div style={{marginBottom:22}}>
        <div style={{fontFamily:"Georgia,serif",fontSize:13,color:T.ink,marginBottom:6,fontWeight:600}}>
          What kind of trip do you want?
        </div>
        <textarea value={form.notes} onChange={e=>set("notes",e.target.value)}
          placeholder="e.g. we love scuba diving, prefer boutique hotels, travelling with two kids under 10, no long drives, love trying local street food…"
          rows={6}
          style={{width:"100%",padding:"14px 16px",borderRadius:14,border:`1.5px solid ${form.notes?T.ocean:T.sand}`,fontFamily:"Georgia,serif",fontSize:14,color:T.ink,outline:"none",resize:"none",boxSizing:"border-box",background:T.chalk,lineHeight:1.6}}/>
      </div>
<button onClick={handleGenerate} disabled={generating} style={{
        width:"100%",padding:16,borderRadius:16,border:"none",
        cursor:generating?"not-allowed":"pointer",
        background:generating?T.sand:`linear-gradient(135deg,${T.ocean},${T.dusk})`,
        color:generating?T.mist:"white",
        fontFamily:"'DM Serif Display',serif",fontSize:18,
        boxShadow:generating?"none":"0 6px 22px rgba(37,99,168,0.4)",
        transition:"all 0.3s",marginTop:8,
      }}>{generating?"✨ Generating your itinerary…":"Start Planning ✨"}</button>
    </div>
    ); })(),
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
            if (step === 1) {
              if (!form.startDate || !form.endDate) { setDestError("Please select both start and end dates."); return; }
              if (new Date(form.endDate) < new Date(form.startDate)) { setDestError("End date cannot be before start date."); return; }
            }
            setDestError("");
            setStep(s => {
              const next = s + 1;
              window.history.pushState({ step: next }, "");
              return next;
            });
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

export default SetupForm;
