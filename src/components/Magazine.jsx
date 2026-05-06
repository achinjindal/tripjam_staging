import { useState, useEffect } from "react";
import { T } from "../theme";
import { _fetchPhoto, _usedPhotoUrls, _isPortrait, _enqueueMagazineFallback } from "../photos";

export function DestinationHero({ dest, isLoading, data, children }) {
  const [photoUrl, setPhotoUrl] = useState(null);
  const [photoLoaded, setPhotoLoaded] = useState(false);
  useEffect(() => {
    if (!dest) return;
    (async () => {
      try {
        const BAD = /\.(svg|pdf)(\.|$)|map|marker|locator|flag|coat.of.arms|emblem|logo|icon|panorama|blank|in_Indonesia|location|special_marker/i;
        // Try Wikipedia exact
        const res = await fetch(`https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(dest)}&prop=pageimages&format=json&pithumbsize=900&redirects=1&origin=*`);
        const d = await res.json();
        const page = Object.values(d?.query?.pages || {})[0];
        const src = page?.thumbnail?.source;
        if (src && !BAD.test(src)) { setPhotoUrl(src); setPhotoLoaded(true); return; }
        // Fallback 1: search destination name
        const res2 = await fetch(`https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(dest)}&gsrlimit=3&prop=pageimages&pithumbsize=900&format=json&origin=*`);
        const d2 = await res2.json();
        for (const p of Object.values(d2?.query?.pages || {})) {
          const s = p?.thumbnail?.source;
          if (s && !BAD.test(s)) { setPhotoUrl(s); setPhotoLoaded(true); return; }
        }
        // Fallback 2: search "Tourism in {dest}" — country pages often have flag as main image
        const res3 = await fetch(`https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent("Tourism in " + dest)}&gsrlimit=5&prop=pageimages&pithumbsize=900&format=json&origin=*`);
        const d3 = await res3.json();
        for (const p of Object.values(d3?.query?.pages || {})) {
          const s = p?.thumbnail?.source;
          if (s && !BAD.test(s)) { setPhotoUrl(s); setPhotoLoaded(true); return; }
        }
      } catch { /* ignore */ }
      setPhotoLoaded(true);
    })();
  }, [dest]);
  return (
    <div style={{borderRadius:16,overflow:"hidden",border:`1px solid ${T.ocean}15`,marginBottom:4}}>
      {/* Hero photo */}
      {(!photoLoaded || photoUrl) && (
        <div style={{ height: 160, background: T.sand, overflow: "hidden", position: "relative" }}>
          {!photoLoaded && <div style={{position:"absolute",inset:0,background:T.sand,animation:"shimmer 1.5s ease-in-out infinite"}}/>}
          {photoUrl && (
            <>
              <img src={photoUrl} alt={dest} onLoad={() => setPhotoLoaded(true)} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
              <div style={{position:"absolute",bottom:0,left:0,right:0,background:"linear-gradient(transparent, rgba(0,0,0,0.5))",padding:"24px 18px 12px"}}>
                <div style={{fontFamily:"'DM Serif Display',serif",fontSize:22,color:"white",textShadow:"0 1px 4px rgba(0,0,0,0.4)"}}>{dest}</div>
              </div>
            </>
          )}
        </div>
      )}
      <div style={{background:`linear-gradient(135deg, ${T.ocean}08, ${T.dusk}06)`,padding:"16px 18px"}}>
        {isLoading ? (
          <>
            {!photoUrl && <div style={{width:120,height:18,borderRadius:6,background:T.sand,animation:"shimmer 1.5s ease-in-out infinite",marginBottom:10}}/>}
            <div style={{width:"100%",height:13,borderRadius:4,background:T.sand,animation:"shimmer 1.5s ease-in-out infinite",marginBottom:6}}/>
            <div style={{width:"80%",height:13,borderRadius:4,background:T.sand,animation:"shimmer 1.5s ease-in-out infinite"}}/>
          </>
        ) : (
          <>
            {!photoUrl && <div style={{fontFamily:"'DM Serif Display',serif",fontSize:20,color:T.ink,marginBottom:8}}>{dest}</div>}
            {children}
          </>
        )}
      </div>
    </div>
  );
}

export function FoodSpotlightCard({ item, city }) {
  const [photoUrl, setPhotoUrl] = useState(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const q = `${item.name} ${city} food`;
    _fetchPhoto(item.name, city, "food").then(url => { setPhotoUrl(url); setLoaded(true); }).catch(() => setLoaded(true));
  }, [item.name, city]);
  return (
    <div style={{ flexShrink: 0, width: 140, borderRadius: 14, overflow: "hidden", border: `1px solid #FED7AA`, background: "#FFF7ED" }}>
      <div style={{ height: 90, background: T.sand, overflow: "hidden", position: "relative" }}>
        {!loaded && <div style={{position:"absolute",inset:0,background:T.sand,animation:"shimmer 1.5s ease-in-out infinite"}}/>}
        {photoUrl && <img src={photoUrl} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}/>}
        {loaded && !photoUrl && <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28}}>{item.icon || "🍜"}</div>}
      </div>
      <div style={{ padding: "8px 10px 6px" }}>
        <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 12, color: T.ink, marginBottom: 2 }}>{item.icon} {item.name}</div>
        {item.note && <div style={{ fontSize: 10, color: "#92400E", fontFamily: "Georgia,serif", lineHeight: 1.3 }}>{item.note}</div>}
      </div>
    </div>
  );
}

export function CityCard({ city, cityDays, writeup, onDeepDive, deepDive, children }) {
  const [photoUrl, setPhotoUrl] = useState(null);
  const [photoLoaded, setPhotoLoaded] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(city)}&prop=pageimages&format=json&pithumbsize=800&redirects=1&origin=*`);
        const data = await res.json();
        const page = Object.values(data?.query?.pages || {})[0];
        const src = page?.thumbnail?.source;
        const BAD = /\.(svg|pdf)(\.|$)|map|marker|locator|flag|coat.of.arms|emblem|logo|icon|panorama|blank|in_Indonesia|location/i;
        if (src && !BAD.test(src)) { setPhotoUrl(src); setPhotoLoaded(true); return; }
        const res2 = await fetch(`https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(city)}&gsrlimit=3&prop=pageimages&pithumbsize=800&format=json&origin=*`);
        const data2 = await res2.json();
        for (const p of Object.values(data2?.query?.pages || {})) {
          const s = p?.thumbnail?.source;
          if (s && !BAD.test(s)) { setPhotoUrl(s); setPhotoLoaded(true); return; }
        }
      } catch { /* ignore */ }
      setPhotoLoaded(true);
    })();
  }, [city]);

  const dd = deepDive && typeof deepDive === "object" ? deepDive : null;

  return (
    <div style={{ background: T.chalk, overflow: "hidden" }}>
      {/* City hero photo with overlay */}
      <div style={{ height: 180, background: T.sand, overflow: "hidden", position: "relative" }}>
        {!photoLoaded && <div style={{position:"absolute",inset:0,background:T.sand,animation:"shimmer 1.5s ease-in-out infinite"}}/>}
        {photoUrl && <img src={photoUrl} alt={city} onLoad={() => setPhotoLoaded(true)} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>}
        {/* City name badge */}
        <div style={{position:"absolute",top:12,left:12,background:"rgba(0,0,0,0.5)",backdropFilter:"blur(8px)",color:"white",fontFamily:"'DM Serif Display',serif",fontSize:18,padding:"4px 14px",borderRadius:10}}>
          {city}
        </div>
        {/* Weather badge */}
        {dd?.weather && (
          <div style={{position:"absolute",bottom:8,right:8,background:"rgba(255,255,255,0.65)",backdropFilter:"blur(12px)",fontSize:11,padding:"6px 10px",borderRadius:10,color:T.ink,fontFamily:"Georgia,serif",fontWeight:600,maxWidth:200,lineHeight:1.4}}>
            ☀️ {dd.weather.split(".")[0]}
          </div>
        )}
        {/* Gradient overlay at bottom */}
        <div style={{position:"absolute",bottom:0,left:0,right:0,height:40,background:"linear-gradient(transparent, rgba(0,0,0,0.2))"}}/>
      </div>

      {/* Writeup */}
      <div style={{ padding: "14px 18px 10px" }}>
        <div style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif",marginBottom:6}}>
          {cityDays.length} day{cityDays.length > 1 ? "s" : ""} · {cityDays.map(d => d.label).join(", ")}
        </div>
        {writeup && (
          <div style={{ fontSize: 13, color: T.ink, fontFamily: "Georgia,serif", lineHeight: 1.65 }}>
            {writeup}
          </div>
        )}
      </div>

      {/* Pull quote — didYouKnow */}
      {dd?.didYouKnow && (
        <div style={{margin:"0 18px 14px",padding:"12px 16px",borderLeft:`3px solid ${T.ocean}`,background:`linear-gradient(135deg, ${T.ocean}06, ${T.dusk}04)`,borderRadius:"0 12px 12px 0"}}>
          <div style={{fontSize:13,lineHeight:1.55,color:T.ocean,fontFamily:"Georgia,serif",fontStyle:"italic"}}>💡 {dd.didYouKnow}</div>
        </div>
      )}

      {/* Highlights (passed as children — now rendered as masonry) */}
      <div style={{ padding: "0 14px" }}>
        {children}
      </div>

      {/* Food spotlight — photo cards */}
      {dd?.foodSpecialties?.length > 0 && (
        <div style={{ padding: "0 14px", marginTop: 4, marginBottom: 14 }}>
          <div style={{ fontSize: 10, color: T.mist, fontFamily: "Georgia,serif", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 10, paddingLeft: 4 }}>🍜 Must try</div>
          <div className="no-scrollbar" style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
            {dd.foodSpecialties.slice(0, 5).map((f, i) => (
              <FoodSpotlightCard key={i} item={f} city={city} />
            ))}
          </div>
        </div>
      )}

      {/* Local tips */}
      {dd?.etiquette?.length > 0 && (
        <div style={{ padding: "0 18px 14px" }}>
          <div style={{ fontSize: 10, color: T.mist, fontFamily: "Georgia,serif", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8 }}>🤝 Good to know</div>
          {dd.etiquette.slice(0, 3).map((tip, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0", borderBottom: (i < 2 && i < dd.etiquette.length - 1) ? `1px solid ${T.sand}` : "none" }}>
              <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{["🚇","🏮","🗑️","💬","👟"][i % 5]}</span>
              <div style={{ fontSize: 12, fontFamily: "Georgia,serif", color: T.ink, lineHeight: 1.5 }}>{tip}</div>
            </div>
          ))}
        </div>
      )}

      {deepDive === "loading" && (
        <div style={{ padding: "0 18px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          {[0,1].map(i => (
            <div key={i} style={{ width: "100%", height: 16, borderRadius: 4, background: T.sand, animation: "shimmer 1.5s ease-in-out infinite", animationDelay: `${i*0.15}s` }} />
          ))}
        </div>
      )}

      {/* CTAs — deep dive + TripAdvisor */}
      <div style={{ display: "flex", gap: 8, padding: "0 14px 14px" }}>
        {dd && (
          <button onClick={onDeepDive} style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            padding: "9px 14px", borderRadius: 10,
              background: "transparent", border: `1.5px solid ${T.ocean}33`,
              color: T.ocean, fontFamily: "Georgia,serif", fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}>
              🔍 More about {city}
            </button>
          )}
          <a href={`https://www.google.com/search?q=${encodeURIComponent("site:tripadvisor.com Tourism " + city)}&btnI`} target="_blank" rel="noopener noreferrer" style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            padding: "9px 14px", borderRadius: 10,
            background: "transparent", border: `1.5px solid ${T.moss}33`,
            color: T.moss, fontFamily: "Georgia,serif", fontSize: 12, fontWeight: 600, cursor: "pointer",
            textDecoration: "none",
          }}>
            🗺 TripAdvisor
          </a>
        </div>
    </div>
  );
}

export function MagazineHighlightCard({ item, city, inItinerary = false, masonry = false, tall = false, onAskTrippy = null }) {
  const searchKey = item.geocode || item.title || "";
  const [photoUrl, setPhotoUrl] = useState(item.photo_url || null);
  const [loaded, setLoaded] = useState(!!item.photo_url);
  useEffect(() => {
    if (photoUrl) { setLoaded(true); return; }
    let cancelled = false;
    // Fetch photo — for Magazine cards, also try a direct Wikipedia lookup
    // since _fetchPhoto may reject due to dedup (_usedPhotoUrls)
    _fetchPhoto(searchKey, city, item.type || "sight").then(url => {
      if (cancelled) return;
      if (url) { setPhotoUrl(url); setLoaded(true); return; }
      // Fallback: direct Wikipedia thumbnail (serialized to prevent duplicate photos)
      _enqueueMagazineFallback(async () => {
        try {
          const q = searchKey;
          const res = await fetch(`https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q + (city ? " " + city : ""))}&gsrlimit=5&prop=pageimages|description&pithumbsize=700&format=json&origin=*`);
          const data = await res.json();
          const BAD = /\.(svg|pdf)(\.|$)|map|marker|flag|logo|icon|coat.of.arms|skyline|panorama|regulation|nintendo|game.boy|console/i;
          const PERSON = /\b(born|politician|actor|actress|singer|player|wrestler|athlete|writer|emperor|empress|manga|anime|artist|novelist|musician|composer|director|comedian|model|journalist|general|admiral|voice actor)\b/i;
          // Relevance: page title or description must relate to the search term
          const STOPWORDS = new Set(["the","a","an","of","in","at","on","and","by","for","to","de","el","la"]);
          const searchWords = q.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !STOPWORDS.has(w));
          const isRelevant = (page) => {
            const t = (page.title || "").toLowerCase();
            const d = (page.description || "").toLowerCase();
            const combined = t + " " + d;
            return searchWords.some(w => combined.includes(w));
          };
          const isFilenameRelevant = (url) => {
            const filename = decodeURIComponent((url || "").split("/").pop() || "").replace(/\.\w+$/, "").toLowerCase();
            const fileWords = filename.split(/[\s_\-()]+/).filter(w => w.length > 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
            if (fileWords.length <= 2) return true;
            return searchWords.some(sw => fileWords.some(fw => fw.includes(sw) || sw.includes(fw)));
          };
          for (const p of Object.values(data?.query?.pages || {})) {
            if (p.description && PERSON.test(p.description)) continue;
            if (!isRelevant(p)) continue;
            const src = p?.thumbnail?.source;
            if (src && !BAD.test(src) && !_isPortrait(src) && isFilenameRelevant(src) && !_usedPhotoUrls.has(src)) { _usedPhotoUrls.add(src); if (!cancelled) { setPhotoUrl(src); setLoaded(true); } return; }
          }
        } catch { /* ignore */ }
        if (!cancelled) setLoaded(true);
      });
    });
    return () => { cancelled = true; };
  }, [searchKey, city]);
  const mapsQuery = encodeURIComponent((item.geocode || item.title) + (city ? `, ${city}` : ""));
  const photoHeight = masonry ? (tall ? 160 : 120) : 90;
  return (
    <div style={{
      flexShrink: masonry ? undefined : 0,
      width: masonry ? "100%" : 160,
      borderRadius: 14, overflow: "hidden",
      border: `1px solid ${inItinerary ? T.ocean + "44" : T.sand}`, background: "#FFFDF9",
      position: "relative",
    }}>
      {inItinerary && (
        <div style={{position:"absolute",top:8,right:8,zIndex:2,background:T.ocean,borderRadius:"50%",width:20,height:20,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"white",boxShadow:"0 1px 4px rgba(0,0,0,0.2)"}}>✓</div>
      )}
      <div style={{ height: photoHeight, background: T.sand, overflow: "hidden", position: "relative" }}>
        {!loaded && <div style={{position:"absolute",inset:0,background:T.sand,animation:"shimmer 1.5s ease-in-out infinite"}}/>}
        {photoUrl && <img src={photoUrl} onLoad={()=>setLoaded(true)} alt={item.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}/>}
        {loaded && !photoUrl && <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28}}>{item.icon || "📍"}</div>}
      </div>
      <div style={{ padding: "8px 10px 6px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 4 }}>
          <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 13, color: T.ink, lineHeight: 1.25, marginBottom: 3, flex: 1 }}>{item.title}</div>
          <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
            {onAskTrippy && (
              <button onClick={() => onAskTrippy(item.title)} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 6, border: `1px solid ${T.sand}`, background: T.chalk, cursor: "pointer", fontSize: 11, padding: 0 }}>💬</button>
            )}
            <a href={`https://www.google.com/maps/search/?api=1&query=${mapsQuery}`} target="_blank" rel="noopener noreferrer"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 6, border: `1px solid ${T.sand}`, background: T.chalk, textDecoration: "none" }}>
              <img src="/google-maps-icon.png" alt="Maps" style={{ width: 12, height: 12, objectFit: "contain" }}/>
            </a>
          </div>
        </div>
        {item.note && <div style={{ fontSize: 11, color: T.mist, fontFamily: "Georgia,serif", fontStyle: "italic", lineHeight: 1.35 }}>{item.note}</div>}
        {inItinerary && <div style={{display:"inline-block",marginTop:5,fontSize:9,background:"#DCFCE7",color:"#16A34A",padding:"1px 7px",borderRadius:10,fontFamily:"Georgia,serif",fontWeight:600}}>In your itinerary</div>}
      </div>
    </div>
  );
}

/* ─── HOTEL SUGGESTION CARD (chat) ──────────────────────────────────── */
export function HotelSuggestionCard({ suggestion, onSelect, onKnowMore }) {
  const [photoUrl, setPhotoUrl] = useState(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    _fetchPhoto(suggestion.geocode || suggestion.title, null, "hotel", { context: "chat" }).then(url => { if (!cancelled) { setPhotoUrl(url); setLoaded(true); } });
    return () => { cancelled = true; };
  }, [suggestion.geocode]);
  const priceLen = (suggestion.price || "").length;
  const priceColor = priceLen >= 4 ? "#7C3AED" : priceLen === 3 ? "#92400E" : "#166534";
  const priceBg   = priceLen >= 4 ? "#EDE9FE"  : priceLen === 3 ? "#FEF3C7"  : "#DCFCE7";
  return (
    <div style={{ flexShrink:0, width:186, borderRadius:12, overflow:"hidden", border:`1px solid ${T.sand}`, background:T.chalk, boxShadow:"0 2px 8px rgba(15,25,35,0.08)" }}>
      {(!loaded || photoUrl) && (
        <div style={{ height:90, background:T.sand, overflow:"hidden", position:"relative" }}>
          {!loaded && <div style={{position:"absolute",inset:0,background:T.sand,animation:"shimmer 1.5s ease-in-out infinite"}}/>}
          {photoUrl && <img src={photoUrl} onLoad={()=>setLoaded(true)} alt={suggestion.title} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>}
          {suggestion.price && (
            <div style={{position:"absolute",bottom:6,right:6,background:priceBg,color:priceColor,fontSize:10,fontFamily:"Georgia,serif",fontWeight:600,padding:"2px 7px",borderRadius:6,letterSpacing:0.3}}>
              {suggestion.price}
            </div>
          )}
        </div>
      )}
      {loaded && !photoUrl && suggestion.price && (
        <div style={{padding:"6px 10px 0",textAlign:"right"}}>
          <span style={{background:priceBg,color:priceColor,fontSize:10,fontFamily:"Georgia,serif",fontWeight:600,padding:"2px 7px",borderRadius:6,letterSpacing:0.3}}>{suggestion.price}</span>
        </div>
      )}
      <div style={{padding:"8px 10px 4px"}}>
        <div style={{fontFamily:"'DM Serif Display',serif",fontSize:12,color:T.ink,lineHeight:1.3,marginBottom:3}}>{suggestion.title}</div>
        {suggestion.area && <div style={{fontSize:10,color:T.ocean,fontFamily:"Georgia,serif",marginBottom:5}}>📍 {suggestion.area}</div>}
        {suggestion.bullets?.length > 0 && (
          <ul style={{margin:0,paddingLeft:13,marginBottom:2}}>
            {suggestion.bullets.slice(0,3).map((b, i) => (
              <li key={i} style={{fontFamily:"Georgia,serif",fontSize:10,color:T.mist,lineHeight:1.5}}>{b}</li>
            ))}
          </ul>
        )}
      </div>
      <div style={{padding:"6px 8px 8px",display:"flex",gap:5}}>
        <button onClick={onSelect} style={{flex:1,padding:"5px 0",borderRadius:8,border:`1px solid ${T.ocean}`,background:T.ocean,fontFamily:"Georgia,serif",fontSize:10,color:"#fff",cursor:"pointer"}}>Use this</button>
        <button onClick={onKnowMore} style={{flex:1,padding:"5px 0",borderRadius:8,border:`1px solid ${T.sand}`,background:"transparent",fontFamily:"Georgia,serif",fontSize:10,color:T.mist,cursor:"pointer"}}>Know more</button>
        <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(suggestion.geocode || suggestion.title)}`} target="_blank" rel="noopener noreferrer"
          style={{display:"flex",alignItems:"center",justifyContent:"center",width:26,borderRadius:8,border:`1px solid ${T.sand}`,textDecoration:"none",flexShrink:0}}>
          <img src="/google-maps-icon.png" alt="Maps" style={{width:13,height:13,objectFit:"contain"}}/>
        </a>
      </div>
    </div>
  );
}
