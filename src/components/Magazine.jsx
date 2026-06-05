import { useState, useEffect, useRef } from "react";
import { T, RADIUS, SHADOW, MOTION } from "../theme";

// Open a URL in the Capacitor in-app browser on Android (Chrome Custom Tab)
// so the user can swipe back to TripJam. Falls back to a new browser tab on
// web / any environment where @capacitor/browser isn't available.
async function openUrl(url) {
  if (!url) return;
  try {
    // Dynamic import so the web bundle doesn't error when @capacitor/core
    // isn't present in the browser context.
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url, presentationStyle: "popover" });
      return;
    }
  } catch {
    // not on native — fall through
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
import {
  _fetchPhoto,
  _photoCache,
  _usedPhotoUrls,
  _isPortrait,
  _enqueueMagazineFallback,
  wikiQueuedFetch,
} from "../photos";

export function DestinationHero({ dest, isLoading, data, children }) {
  const [photoUrl, setPhotoUrl] = useState(null);
  const [photoLoaded, setPhotoLoaded] = useState(false);
  useEffect(() => {
    if (!dest) return;
    (async () => {
      try {
        const BAD =
          /\.(svg|pdf)(\.|$)|map|marker|locator|flag|coat.of.arms|emblem|logo|icon|panorama|blank|in_Indonesia|location|special_marker/i;
        // Try Wikipedia exact (queued so we share the global Wikimedia rate-limit cooldown)
        const d = await wikiQueuedFetch(
          `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(dest)}&prop=pageimages&format=json&pithumbsize=900&redirects=1&origin=*`,
        );
        const page = Object.values(d?.query?.pages || {})[0];
        const src = page?.thumbnail?.source;
        if (src && !BAD.test(src)) {
          setPhotoUrl(src);
          setPhotoLoaded(true);
          return;
        }
        // Fallback 1: search destination name
        const d2 = await wikiQueuedFetch(
          `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(dest)}&gsrlimit=3&prop=pageimages&pithumbsize=900&format=json&origin=*`,
        );
        for (const p of Object.values(d2?.query?.pages || {})) {
          const s = p?.thumbnail?.source;
          if (s && !BAD.test(s)) {
            setPhotoUrl(s);
            setPhotoLoaded(true);
            return;
          }
        }
        // Fallback 2: search "Tourism in {dest}" — country pages often have flag as main image
        const d3 = await wikiQueuedFetch(
          `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent("Tourism in " + dest)}&gsrlimit=5&prop=pageimages&pithumbsize=900&format=json&origin=*`,
        );
        for (const p of Object.values(d3?.query?.pages || {})) {
          const s = p?.thumbnail?.source;
          if (s && !BAD.test(s)) {
            setPhotoUrl(s);
            setPhotoLoaded(true);
            return;
          }
        }
      } catch {
        /* ignore */
      }
      setPhotoLoaded(true);
    })();
  }, [dest]);
  return (
    <div
      style={{
        borderRadius: RADIUS.lg,
        overflow: "hidden",
        border: `1px solid ${T.ocean}15`,
        marginBottom: 4,
      }}
    >
      {/* Hero photo */}
      {(!photoLoaded || photoUrl) && (
        <div
          style={{
            height: 160,
            background: T.sand,
            overflow: "hidden",
            position: "relative",
          }}
        >
          {!photoLoaded && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: T.sand,
                animation: "shimmer 1.5s ease-in-out infinite",
              }}
            />
          )}
          {photoUrl && (
            <>
              <img
                src={photoUrl}
                alt={dest}
                onLoad={() => setPhotoLoaded(true)}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  display: "block",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  background: "linear-gradient(transparent, rgba(0,0,0,0.5))",
                  padding: "24px 18px 12px",
                }}
              >
                <div
                  style={{
                    fontFamily: "'DM Serif Display',serif",
                    fontSize: 22,
                    color: "white",
                    textShadow: "0 1px 4px rgba(0,0,0,0.4)",
                  }}
                >
                  {dest}
                </div>
              </div>
            </>
          )}
        </div>
      )}
      <div
        style={{
          background: `linear-gradient(135deg, ${T.ocean}08, ${T.dusk}06)`,
          padding: "16px 18px",
        }}
      >
        {isLoading ? (
          <>
            {!photoUrl && (
              <div
                style={{
                  width: 120,
                  height: 18,
                  borderRadius: RADIUS.sm,
                  background: T.sand,
                  animation: "shimmer 1.5s ease-in-out infinite",
                  marginBottom: 10,
                }}
              />
            )}
            <div
              style={{
                width: "100%",
                height: 13,
                borderRadius: 4,
                background: T.sand,
                animation: "shimmer 1.5s ease-in-out infinite",
                marginBottom: 6,
              }}
            />
            <div
              style={{
                width: "80%",
                height: 13,
                borderRadius: 4,
                background: T.sand,
                animation: "shimmer 1.5s ease-in-out infinite",
              }}
            />
          </>
        ) : (
          <>
            {!photoUrl && (
              <div
                style={{
                  fontFamily: "'DM Serif Display',serif",
                  fontSize: 20,
                  color: T.ink,
                  marginBottom: 8,
                }}
              >
                {dest}
              </div>
            )}
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
    _fetchPhoto(item.name, city, "food")
      .then((url) => {
        setPhotoUrl(url);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [item.name, city]);
  return (
    <div
      style={{
        flexShrink: 0,
        width: 140,
        borderRadius: RADIUS.lg,
        overflow: "hidden",
        border: `1px solid ${T.warningBorder}`,
        background: T.warningLight,
      }}
    >
      <div
        style={{
          height: 90,
          background: T.sand,
          overflow: "hidden",
          position: "relative",
        }}
      >
        {!loaded && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: T.sand,
              animation: "shimmer 1.5s ease-in-out infinite",
            }}
          />
        )}
        {photoUrl && (
          <img
            src={photoUrl}
            alt={item.name}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        )}
        {loaded && !photoUrl && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 28,
            }}
          >
            {item.icon || "🍜"}
          </div>
        )}
      </div>
      <div style={{ padding: "8px 10px 6px" }}>
        <div
          style={{
            fontFamily: "'DM Serif Display',serif",
            fontSize: 12,
            color: T.ink,
            marginBottom: 2,
          }}
        >
          {item.icon} {item.name}
        </div>
        {item.note && (
          <div
            style={{
              fontSize: 10,
              color: T.warning,
              fontFamily: "Georgia,serif",
              lineHeight: 1.3,
            }}
          >
            {item.note}
          </div>
        )}
      </div>
    </div>
  );
}

export function CityCard({
  city,
  writeup,
  onDeepDive,
  deepDive,
  children,
  onVisible = null,
}) {
  const rootRef = useRef(null);
  const [photoUrl, setPhotoUrl] = useState(null);
  const [photoLoaded, setPhotoLoaded] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        // Queued so we share the global Wikimedia rate-limit cooldown — direct fetches were 429ing.
        const data = await wikiQueuedFetch(
          `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(city)}&prop=pageimages&format=json&pithumbsize=800&redirects=1&origin=*`,
        );
        const page = Object.values(data?.query?.pages || {})[0];
        const src = page?.thumbnail?.source;
        const BAD =
          /\.(svg|pdf)(\.|$)|map|marker|locator|flag|coat.of.arms|emblem|logo|icon|panorama|blank|in_Indonesia|location/i;
        if (src && !BAD.test(src)) {
          setPhotoUrl(src);
          setPhotoLoaded(true);
          return;
        }
        const data2 = await wikiQueuedFetch(
          `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(city)}&gsrlimit=3&prop=pageimages&pithumbsize=800&format=json&origin=*`,
        );
        for (const p of Object.values(data2?.query?.pages || {})) {
          const s = p?.thumbnail?.source;
          if (s && !BAD.test(s)) {
            setPhotoUrl(s);
            setPhotoLoaded(true);
            return;
          }
        }
      } catch {
        /* ignore */
      }
      setPhotoLoaded(true);
    })();
  }, [city]);

  // Lazy-load deep dive when this card scrolls into view (first city is eager-loaded).
  useEffect(() => {
    if (!onVisible || !rootRef.current) return;
    const el = rootRef.current;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          onVisible();
          obs.disconnect();
        }
      },
      { rootMargin: "240px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [onVisible]);

  const dd = deepDive && typeof deepDive === "object" ? deepDive : null;

  return (
    <div ref={rootRef} style={{ background: T.chalk, overflow: "hidden" }}>
      {/* City hero photo with overlay */}
      <div
        style={{
          height: 180,
          background: T.sand,
          overflow: "hidden",
          position: "relative",
        }}
      >
        {!photoLoaded && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: T.sand,
              animation: "shimmer 1.5s ease-in-out infinite",
            }}
          />
        )}
        {photoUrl && (
          <img
            src={photoUrl}
            alt={city}
            onLoad={() => setPhotoLoaded(true)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        )}
        {/* Weather badge */}
        {dd?.weather && (
          <div
            style={{
              position: "absolute",
              bottom: 8,
              right: 8,
              background: "rgba(255,255,255,0.65)",
              backdropFilter: "blur(12px)",
              fontSize: 11,
              padding: "6px 10px",
              borderRadius: RADIUS.md,
              color: T.ink,
              fontFamily: "Georgia,serif",
              fontWeight: 600,
              maxWidth: 200,
              lineHeight: 1.4,
            }}
          >
            ☀️ {dd.weather.split(".")[0]}
          </div>
        )}
        {/* Gradient overlay at bottom */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 40,
            background: "linear-gradient(transparent, rgba(0,0,0,0.2))",
          }}
        />
      </div>

      {/* Writeup */}
      {(writeup || dd?.writeup) && (
        <div style={{ padding: "14px 18px 10px" }}>
          <div
            style={{
              fontSize: 13,
              color: T.ink,
              fontFamily: "Georgia,serif",
              lineHeight: 1.65,
            }}
          >
            {writeup || dd?.writeup}
          </div>
        </div>
      )}

      {/* Pull quote — didYouKnow */}
      {dd?.didYouKnow && (
        <div
          style={{
            margin: "0 18px 14px",
            padding: "12px 16px",
            borderLeft: `3px solid ${T.ocean}`,
            background: `linear-gradient(135deg, ${T.ocean}06, ${T.dusk}04)`,
            borderRadius: `0 ${RADIUS.lg}px ${RADIUS.lg}px 0`,
          }}
        >
          <div
            style={{
              fontSize: 13,
              lineHeight: 1.55,
              color: T.ocean,
              fontFamily: "Georgia,serif",
              fontStyle: "italic",
            }}
          >
            💡 {dd.didYouKnow}
          </div>
        </div>
      )}

      {/* Highlights (passed as children — now rendered as masonry) */}
      <div style={{ padding: "0 14px" }}>{children}</div>

      {/* Food spotlight — photo cards */}
      {dd?.foodSpecialties?.length > 0 && (
        <div style={{ padding: "0 14px", marginTop: 4, marginBottom: 14 }}>
          <div
            style={{
              fontSize: 10,
              color: T.mist,
              fontFamily: "Georgia,serif",
              textTransform: "uppercase",
              letterSpacing: 1.2,
              marginBottom: 10,
              paddingLeft: 4,
            }}
          >
            🍜 Must try
          </div>
          <div
            className="no-scrollbar"
            style={{
              display: "flex",
              gap: 10,
              overflowX: "auto",
              paddingBottom: 4,
            }}
          >
            {dd.foodSpecialties.slice(0, 5).map((f, i) => (
              <FoodSpotlightCard key={i} item={f} city={city} />
            ))}
          </div>
        </div>
      )}

      {/* Local tips */}
      {dd?.etiquette?.length > 0 && (
        <div style={{ padding: "0 18px 14px" }}>
          <div
            style={{
              fontSize: 10,
              color: T.mist,
              fontFamily: "Georgia,serif",
              textTransform: "uppercase",
              letterSpacing: 1.2,
              marginBottom: 8,
            }}
          >
            🤝 Good to know
          </div>
          {dd.etiquette.slice(0, 3).map((tip, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
                padding: "8px 0",
                borderBottom:
                  i < 2 && i < dd.etiquette.length - 1
                    ? `1px solid ${T.sand}`
                    : "none",
              }}
            >
              <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>
                {["🚇", "🏮", "🗑️", "💬", "👟"][i % 5]}
              </span>
              <div
                style={{
                  fontSize: 12,
                  fontFamily: "Georgia,serif",
                  color: T.ink,
                  lineHeight: 1.5,
                }}
              >
                {tip}
              </div>
            </div>
          ))}
        </div>
      )}

      {deepDive === "loading" && (
        <div
          style={{
            padding: "0 18px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {[0, 1].map((i) => (
            <div
              key={i}
              style={{
                width: "100%",
                height: 16,
                borderRadius: 4,
                background: T.sand,
                animation: "shimmer 1.5s ease-in-out infinite",
                animationDelay: `${i * 0.15}s`,
              }}
            />
          ))}
        </div>
      )}

      {/* CTAs — deep dive + TripAdvisor */}
      <div style={{ display: "flex", gap: 8, padding: "0 14px 14px" }}>
        {dd && (
          <button
            onClick={onDeepDive}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "9px 14px",
              borderRadius: RADIUS.md,
              background: "transparent",
              border: `1.5px solid ${T.ocean}33`,
              color: T.ocean,
              fontFamily: "Georgia,serif",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            🔍 More about {city}
          </button>
        )}
        <a
          href={`https://www.google.com/search?q=${encodeURIComponent("site:tripadvisor.com Tourism " + city)}&btnI`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            padding: "9px 14px",
            borderRadius: RADIUS.md,
            background: "transparent",
            border: `1.5px solid ${T.moss}33`,
            color: T.moss,
            fontFamily: "Georgia,serif",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            textDecoration: "none",
          }}
        >
          🗺 TripAdvisor
        </a>
      </div>
    </div>
  );
}

export function MagazineHighlightCard({
  item,
  city,
  inItinerary = false,
  masonry = false,
  tall = false,
  onAskTrippy = null,
}) {
  const searchKey = item.geocode || item.title || "";
  const photoCacheKey = `${searchKey}||${city || ""}`;
  const [photoUrl, setPhotoUrl] = useState(item.photo_url || null);
  const [loaded, setLoaded] = useState(!!item.photo_url);
  // Parent may attach photo_url after deep-dive + sequential photo fetch completes.
  useEffect(() => {
    if (item.photo_url) {
      setPhotoUrl(item.photo_url);
      setLoaded(true);
    }
  }, [item.photo_url]);
  useEffect(() => {
    if (photoUrl || item.photo_url) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    // Fetch photo — for Magazine cards, also try a direct Wikipedia lookup
    // since _fetchPhoto may reject due to dedup (_usedPhotoUrls)
    _fetchPhoto(searchKey, city, item.type || "sight").then((url) => {
      if (cancelled) return;
      const resolved = url || _photoCache[photoCacheKey];
      if (resolved) {
        setPhotoUrl(resolved);
        setLoaded(true);
        return;
      }
      // Fallback: direct Wikipedia thumbnail (serialized to prevent duplicate photos)
      _enqueueMagazineFallback(async () => {
        try {
          const q = searchKey;
          // Route through wikiQueuedFetch so this respects the global Wikimedia rate-limit
          // cooldown — direct fetches here were a major contributor to the 429 storms.
          const data = await wikiQueuedFetch(
            `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q + (city ? " " + city : ""))}&gsrlimit=5&prop=pageimages|description&pithumbsize=700&format=json&origin=*`,
          );
          if (!data) {
            if (!cancelled) setLoaded(true);
            return;
          }
          const BAD =
            /\.(svg|pdf)(\.|$)|map|marker|flag|logo|icon|coat.of.arms|skyline|panorama|regulation|nintendo|game.boy|console/i;
          const PERSON =
            /\b(born|politician|actor|actress|singer|player|wrestler|athlete|writer|emperor|empress|manga|anime|artist|novelist|musician|composer|director|comedian|model|journalist|general|admiral|voice actor)\b/i;
          // Relevance: page title or description must relate to the search term
          const STOPWORDS = new Set([
            "the",
            "a",
            "an",
            "of",
            "in",
            "at",
            "on",
            "and",
            "by",
            "for",
            "to",
            "de",
            "el",
            "la",
          ]);
          const searchWords = q
            .toLowerCase()
            .split(/\s+/)
            .filter((w) => w.length > 3 && !STOPWORDS.has(w));
          const isRelevant = (page) => {
            const t = (page.title || "").toLowerCase();
            const d = (page.description || "").toLowerCase();
            const combined = t + " " + d;
            return searchWords.some((w) => combined.includes(w));
          };
          const isFilenameRelevant = (url) => {
            const filename = decodeURIComponent(
              (url || "").split("/").pop() || "",
            )
              .replace(/\.\w+$/, "")
              .toLowerCase();
            const fileWords = filename
              .split(/[\s_\-()]+/)
              .filter(
                (w) => w.length > 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w),
              );
            if (fileWords.length <= 2) return true;
            return searchWords.some((sw) =>
              fileWords.some((fw) => fw.includes(sw) || sw.includes(fw)),
            );
          };
          for (const p of Object.values(data?.query?.pages || {})) {
            if (p.description && PERSON.test(p.description)) continue;
            if (!isRelevant(p)) continue;
            const src = p?.thumbnail?.source;
            if (
              src &&
              !BAD.test(src) &&
              !_isPortrait(src) &&
              isFilenameRelevant(src) &&
              (!_usedPhotoUrls.has(src) || _photoCache[photoCacheKey] === src)
            ) {
              _usedPhotoUrls.add(src);
              if (!cancelled) {
                setPhotoUrl(src);
                setLoaded(true);
              }
              return;
            }
          }
        } catch {
          /* ignore */
        }
        if (!cancelled) setLoaded(true);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [searchKey, city, photoCacheKey]);
  const mapsQuery = encodeURIComponent(
    (item.geocode || item.title) + (city ? `, ${city}` : ""),
  );
  const photoHeight = masonry ? (tall ? 160 : 120) : 90;
  return (
    <div
      style={{
        flexShrink: masonry ? undefined : 0,
        width: masonry ? "100%" : 160,
        borderRadius: RADIUS.lg,
        overflow: "hidden",
        border: `1px solid ${inItinerary ? T.ocean + "44" : T.sand}`,
        background: "#FFFDF9",
        position: "relative",
      }}
    >
      {inItinerary && (
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            zIndex: 2,
            background: T.ocean,
            borderRadius: "50%",
            width: 20,
            height: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            color: "white",
            boxShadow: SHADOW.sm,
          }}
        >
          ✓
        </div>
      )}
      <div
        style={{
          height: photoHeight,
          background: T.sand,
          overflow: "hidden",
          position: "relative",
        }}
      >
        {!loaded && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: T.sand,
              animation: "shimmer 1.5s ease-in-out infinite",
            }}
          />
        )}
        {photoUrl && (
          <img
            src={photoUrl}
            onLoad={() => setLoaded(true)}
            onError={() => {
              setPhotoUrl(null);
              setLoaded(true);
            }}
            alt={item.title}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        )}
        {loaded && !photoUrl && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 28,
            }}
          >
            {item.icon || "📍"}
          </div>
        )}
      </div>
      <div style={{ padding: "8px 10px 6px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 4,
          }}
        >
          <div
            style={{
              fontFamily: "'DM Serif Display',serif",
              fontSize: 13,
              color: T.ink,
              lineHeight: 1.25,
              marginBottom: 3,
              flex: 1,
            }}
          >
            {item.title}
          </div>
          <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
            {onAskTrippy && (
              <button
                onClick={() => onAskTrippy(item.title)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 22,
                  height: 22,
                  borderRadius: RADIUS.sm,
                  border: `1px solid ${T.sand}`,
                  background: T.chalk,
                  cursor: "pointer",
                  fontSize: 11,
                  padding: 0,
                }}
              >
                💬
              </button>
            )}
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${mapsQuery}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 22,
                height: 22,
                borderRadius: RADIUS.sm,
                border: `1px solid ${T.sand}`,
                background: T.chalk,
                textDecoration: "none",
              }}
            >
              <img
                src="/google-maps-icon.png"
                alt="Maps"
                style={{ width: 12, height: 12, objectFit: "contain" }}
              />
            </a>
          </div>
        </div>
        {item.note && (
          <div
            style={{
              fontSize: 11,
              color: T.mist,
              fontFamily: "Georgia,serif",
              fontStyle: "italic",
              lineHeight: 1.35,
            }}
          >
            {item.note}
          </div>
        )}
        {inItinerary && (
          <div
            style={{
              display: "inline-block",
              marginTop: 5,
              fontSize: 9,
              background: T.successLight,
              color: T.success,
              padding: "1px 7px",
              borderRadius: RADIUS.md,
              fontFamily: "Georgia,serif",
              fontWeight: 600,
            }}
          >
            In your itinerary
          </div>
        )}
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
    _fetchPhoto(suggestion.geocode || suggestion.title, null, "hotel", {
      context: "chat",
    }).then((url) => {
      if (!cancelled) {
        setPhotoUrl(url);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [suggestion.geocode]);
  const priceLen = (suggestion.price || "").length;
  const priceColor =
    priceLen >= 4 ? "#7C3AED" : priceLen === 3 ? T.warning : T.moss;
  const priceBg =
    priceLen >= 4
      ? "#EDE9FE"
      : priceLen === 3
        ? T.warningLight
        : T.successLight;
  return (
    <div
      style={{
        flexShrink: 0,
        width: 186,
        borderRadius: RADIUS.lg,
        overflow: "hidden",
        border: `1px solid ${T.sand}`,
        background: T.chalk,
        boxShadow: SHADOW.sm,
      }}
    >
      {(!loaded || photoUrl) && (
        <div
          style={{
            height: 90,
            background: T.sand,
            overflow: "hidden",
            position: "relative",
          }}
        >
          {!loaded && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: T.sand,
                animation: "shimmer 1.5s ease-in-out infinite",
              }}
            />
          )}
          {photoUrl && (
            <img
              src={photoUrl}
              onLoad={() => setLoaded(true)}
              alt={suggestion.title}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
              }}
            />
          )}
          {suggestion.price && (
            <div
              style={{
                position: "absolute",
                bottom: 6,
                right: 6,
                background: priceBg,
                color: priceColor,
                fontSize: 10,
                fontFamily: "Georgia,serif",
                fontWeight: 600,
                padding: "2px 7px",
                borderRadius: RADIUS.sm,
                letterSpacing: 0.3,
              }}
            >
              {suggestion.price}
            </div>
          )}
        </div>
      )}
      {loaded && !photoUrl && suggestion.price && (
        <div style={{ padding: "6px 10px 0", textAlign: "right" }}>
          <span
            style={{
              background: priceBg,
              color: priceColor,
              fontSize: 10,
              fontFamily: "Georgia,serif",
              fontWeight: 600,
              padding: "2px 7px",
              borderRadius: RADIUS.sm,
              letterSpacing: 0.3,
            }}
          >
            {suggestion.price}
          </span>
        </div>
      )}
      <div style={{ padding: "8px 10px 4px" }}>
        <div
          style={{
            fontFamily: "'DM Serif Display',serif",
            fontSize: 12,
            color: T.ink,
            lineHeight: 1.3,
            marginBottom: 3,
          }}
        >
          {suggestion.title}
        </div>
        {suggestion.area && (
          <div
            style={{
              fontSize: 10,
              color: T.ocean,
              fontFamily: "Georgia,serif",
              marginBottom: 5,
            }}
          >
            📍 {suggestion.area}
          </div>
        )}
        {suggestion.bullets?.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 13, marginBottom: 2 }}>
            {suggestion.bullets.slice(0, 3).map((b, i) => (
              <li
                key={i}
                style={{
                  fontFamily: "Georgia,serif",
                  fontSize: 10,
                  color: T.mist,
                  lineHeight: 1.5,
                }}
              >
                {b}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div style={{ padding: "6px 8px 8px", display: "flex", gap: 5 }}>
        <button
          onClick={onSelect}
          style={{
            flex: 1,
            padding: "5px 0",
            borderRadius: RADIUS.md,
            border: `1px solid ${T.ocean}`,
            background: T.ocean,
            fontFamily: "Georgia,serif",
            fontSize: 10,
            color: "#fff",
            cursor: "pointer",
            transition: `background ${MOTION.fast}`,
          }}
        >
          Use this
        </button>
        <button
          onClick={onKnowMore}
          style={{
            flex: 1,
            padding: "5px 0",
            borderRadius: RADIUS.md,
            border: `1px solid ${T.sand}`,
            background: "transparent",
            fontFamily: "Georgia,serif",
            fontSize: 10,
            color: T.mist,
            cursor: "pointer",
            transition: `background ${MOTION.fast}`,
          }}
        >
          Know more
        </button>
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(suggestion.geocode || suggestion.title)}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 26,
            borderRadius: RADIUS.md,
            border: `1px solid ${T.sand}`,
            textDecoration: "none",
            flexShrink: 0,
          }}
        >
          <img
            src="/google-maps-icon.png"
            alt="Maps"
            style={{ width: 13, height: 13, objectFit: "contain" }}
          />
        </a>
      </div>
    </div>
  );
}

/* ─── INSPIRATIONS (F1 — Magazine reading list) ─────────────────────── */
// Web-search-backed digest from the `inspiration` branch, merged 2026-05-27.
// Powered by supabase/functions/generate-destination-research.

function authorTagStyle(type) {
  switch (type) {
    case "youtuber":
      return { bg: "#FFF4E8", fg: "#C4622D", label: "YouTube" };
    case "substack":
      return { bg: "#F5F0FA", fg: "#7B5EA7", label: "Substack" };
    case "instagram":
      return { bg: "#FDECEF", fg: "#B0356C", label: "Instagram" };
    case "journalist":
      return { bg: "#EEF5EE", fg: "#3A6B3A", label: "Journalist" };
    default:
      return { bg: "#EBF3FD", fg: "#2563A8", label: "Personal blog" };
  }
}

// Extract a YouTube video id from any standard YouTube URL shape:
//   youtube.com/watch?v=XXX        | https
//   youtu.be/XXX                   | short link
//   youtube.com/embed/XXX          | already-embedded
//   youtube.com/shorts/XXX         | shorts
// Returns null when the URL isn't a YouTube video (any other host, or a
// channel/playlist page rather than a single video).
function extractYouTubeId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.replace(/^\//, "").split("/")[0];
      return /^[A-Za-z0-9_-]{6,15}$/.test(id) ? id : null;
    }
    if (
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "youtube-nocookie.com"
    ) {
      if (u.pathname === "/watch") {
        const id = u.searchParams.get("v");
        return id && /^[A-Za-z0-9_-]{6,15}$/.test(id) ? id : null;
      }
      const m = u.pathname.match(
        /^\/(?:embed|shorts|v)\/([A-Za-z0-9_-]{6,15})/,
      );
      if (m) return m[1];
    }
    return null;
  } catch {
    return null;
  }
}

function InspirationCard({ item }) {
  const tag = authorTagStyle(
    item.author_type || (item.type === "video" ? "youtuber" : "personal_blog"),
  );
  const isVideo = item.type === "video";
  const youTubeId = isVideo ? extractYouTubeId(item.url) : null;
  const [playing, setPlaying] = useState(false);
  const dateLabel = (() => {
    if (!item.date) return null;
    const m = String(item.date).match(/^(\d{4})-(\d{2})/);
    if (!m) return item.date;
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    return `${months[parseInt(m[2], 10) - 1]} ${m[1]}`;
  })();
  return (
    <div
      style={{ padding: "16px 0 18px", borderBottom: `1px solid ${T.sand}` }}
    >
      <div
        style={{
          fontFamily: "'DM Serif Display',serif",
          fontSize: 16,
          color: T.ink,
          lineHeight: 1.3,
          marginBottom: 2,
        }}
      >
        {isVideo ? "▶ " : "by "}
        {item.author || "Unknown"}
        <span
          style={{
            fontSize: 11,
            verticalAlign: "middle",
            background: tag.bg,
            color: tag.fg,
            padding: "2px 7px",
            borderRadius: 8,
            marginLeft: 6,
            fontFamily: "Georgia,serif",
            fontWeight: 600,
            letterSpacing: 0.3,
          }}
        >
          {tag.label}
        </span>
      </div>
      <div
        style={{
          fontFamily: "Georgia,serif",
          fontSize: 12,
          color: T.mist,
          marginBottom: 8,
        }}
      >
        {[item.outlet, dateLabel].filter(Boolean).join(" · ")}
      </div>
      {/* In-app YouTube playback (lite embed pattern). Thumbnail rendered as
          a single image by default → zero iframe / no YT JS until user clicks
          Play. On click, swap for the no-cookie autoplay iframe. */}
      {youTubeId && (
        <div
          style={{
            position: "relative",
            width: "100%",
            paddingBottom: "56.25%", // 16:9
            background: "#000",
            borderRadius: RADIUS.md,
            overflow: "hidden",
            marginBottom: 10,
            cursor: playing ? "default" : "pointer",
          }}
          onClick={() => {
            if (!playing) setPlaying(true);
          }}
        >
          {playing ? (
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${youTubeId}?autoplay=1&rel=0&modestbranding=1`}
              title={item.title || "YouTube video"}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                border: "none",
              }}
            />
          ) : (
            <>
              <img
                src={`https://i.ytimg.com/vi/${youTubeId}/hqdefault.jpg`}
                alt={item.title || "Video thumbnail"}
                loading="lazy"
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
              />
              <div
                aria-label="Play video"
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  background: "rgba(0,0,0,0.7)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  pointerEvents: "none",
                }}
              >
                <div
                  style={{
                    width: 0,
                    height: 0,
                    borderLeft: "16px solid #fff",
                    borderTop: "10px solid transparent",
                    borderBottom: "10px solid transparent",
                    marginLeft: 4,
                  }}
                />
              </div>
            </>
          )}
        </div>
      )}
      {item.title && (
        <div
          style={{
            fontFamily: "'DM Serif Display',serif",
            fontSize: 18,
            color: T.ink,
            lineHeight: 1.25,
            marginBottom: 6,
          }}
        >
          {item.title}
        </div>
      )}
      {item.blurb && (
        <div
          style={{
            fontFamily: "Georgia,serif",
            fontSize: 13,
            color: T.mist,
            lineHeight: 1.55,
            marginBottom: 10,
          }}
        >
          {item.blurb}
        </div>
      )}
      {item.url && (
        <button
          onClick={() => openUrl(item.url)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            background: "none",
            border: "none",
            padding: 0,
            fontFamily: "Georgia,serif",
            fontSize: 13,
            color: T.ocean,
            textDecoration: "none",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {isVideo ? (youTubeId ? "Open on YouTube" : "Watch") : "Read"}{" "}
          <span style={{ fontSize: 14 }}>↗</span>
        </button>
      )}
    </div>
  );
}

export function InspirationsSection({
  digest,
  loading,
  errored,
  onLoad,
  hasLoaded,
  onLoadMore,
}) {
  // Deduplicate by author then interleave articles and videos so video content
  // is distributed throughout rather than all appearing at the end.
  const items = (() => {
    const seen = new Set();
    const deduped = (digest?.inspirations || []).filter((i) => {
      if (!i?.url) return false;
      const key = (i.author || "").toLowerCase().trim();
      if (key && seen.has(key)) return false;
      if (key) seen.add(key);
      return true;
    });
    // Separate into videos and articles, then zip them together so they alternate.
    const videos = deduped.filter((i) => i.type === "video");
    const articles = deduped.filter((i) => i.type !== "video");
    const mixed = [];
    const max = Math.max(videos.length, articles.length);
    for (let i = 0; i < max; i++) {
      if (i < videos.length) mixed.push(videos[i]);
      if (i < articles.length) mixed.push(articles[i]);
    }
    return mixed;
  })();
  const [refinementInput, setRefinementInput] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [showRefinement, setShowRefinement] = useState(false);
  const sub = loading
    ? "Looking up recent articles and vlogs…"
    : errored || items.length === 0
      ? "We couldn't find recent first-person travel content for this combo. Check back as more travellers post."
      : "Real travellers, real recent trips — to help you imagine yours.";

  return (
    <div
      style={{
        background: "#FFFBF5",
        borderRadius: RADIUS.lg,
        padding: "20px 18px",
        margin: "0 16px 16px",
        border: `1px solid ${T.sand}`,
      }}
    >
      <div
        style={{
          fontFamily: "Georgia,serif",
          fontSize: 11,
          color: T.mist,
          letterSpacing: 1.5,
          textTransform: "uppercase",
          marginBottom: 4,
        }}
      >
        ✨ &nbsp;Inspirations
      </div>
      <div
        style={{
          fontFamily: "'DM Serif Display',serif",
          fontSize: 24,
          color: T.ink,
          lineHeight: 1.15,
          marginBottom: 4,
        }}
      >
        {loading || items.length > 0 ? (
          <>
            From people who've
            <br />
            been there recently
          </>
        ) : (
          <>
            No recent stories
            <br />
            just yet
          </>
        )}
      </div>
      <div
        style={{
          fontFamily: "Georgia,serif",
          fontSize: 13,
          color: T.mist,
          fontStyle: "italic",
          marginBottom: items.length > 0 ? 18 : 14,
          lineHeight: 1.5,
        }}
      >
        {sub}
      </div>
      {/* Retry button — only when the load failed. Default state is auto-loaded
          by the parent on tab open, so no opt-in CTA. */}
      {!loading && errored && onLoad && (
        <button
          onClick={onLoad}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "10px 16px",
            borderRadius: RADIUS.md,
            border: `1px solid ${T.ocean}`,
            background: T.ocean,
            color: "white",
            fontFamily: "Georgia,serif",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          ↻ Try again
        </button>
      )}
      {loading && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            marginTop: 12,
          }}
        >
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <div
                style={{
                  height: 18,
                  background: T.sand,
                  borderRadius: 6,
                  animation: "shimmer 1.5s ease-in-out infinite",
                  marginBottom: 8,
                  animationDelay: `${i * 0.12}s`,
                }}
              />
              <div
                style={{
                  height: 14,
                  width: "75%",
                  background: T.sand,
                  borderRadius: 6,
                  animation: "shimmer 1.5s ease-in-out infinite",
                  marginBottom: 6,
                  animationDelay: `${i * 0.12 + 0.08}s`,
                }}
              />
              <div
                style={{
                  height: 14,
                  width: "90%",
                  background: T.sand,
                  borderRadius: 6,
                  animation: "shimmer 1.5s ease-in-out infinite",
                  animationDelay: `${i * 0.12 + 0.16}s`,
                }}
              />
            </div>
          ))}
        </div>
      )}
      {!loading &&
        items.map((it, i) => (
          <div key={it.url || i}>
            <InspirationCard item={it} />
          </div>
        ))}
      {!loading && items.length > 0 && (
        <div
          style={{
            fontFamily: "Georgia,serif",
            fontSize: 11,
            color: T.mist,
            fontStyle: "italic",
            marginTop: 14,
            lineHeight: 1.5,
          }}
        >
          Surfaced from the open web. Links open in a new tab.
        </div>
      )}
      {/* Load more — shown after a successful load. Default shows just the
          "Load more" button. A secondary link reveals the refinement input
          for users who want to specify a particular angle. */}
      {hasLoaded && !errored && onLoadMore && (
        <div
          style={{
            marginTop: 20,
            paddingTop: 16,
            borderTop: `1px solid ${T.sand}`,
          }}
        >
          {/* Primary action row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={() => {
                if (loadingMore || loading) return;
                setShowRefinement(false);
                setRefinementInput("");
                setLoadingMore(true);
                onLoadMore("").finally(() => setLoadingMore(false));
              }}
              disabled={loadingMore || loading}
              style={{
                padding: "9px 20px",
                borderRadius: RADIUS.full,
                border: "none",
                background: loadingMore || loading ? T.disabled : T.ocean,
                color: T.chalk,
                fontFamily: "Georgia,serif",
                fontSize: 13,
                fontWeight: 600,
                cursor: loadingMore || loading ? "not-allowed" : "pointer",
                opacity: loadingMore || loading ? 0.7 : 1,
                transition: `all ${MOTION.normal}`,
              }}
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
            {/* Toggle to reveal refinement input */}
            {!showRefinement && !loadingMore && (
              <button
                onClick={() => setShowRefinement(true)}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  fontFamily: "Georgia,serif",
                  fontSize: 12,
                  color: T.ocean,
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                Focus on a specific angle →
              </button>
            )}
          </div>
          {/* Refinement input — revealed only when user asks */}
          {showRefinement && (
            <div style={{ marginTop: 12 }}>
              <input
                type="text"
                placeholder="e.g. hiking, budget travel, solo female..."
                value={refinementInput}
                onChange={(e) => setRefinementInput(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !loadingMore && !loading) {
                    const focus = refinementInput.trim();
                    setRefinementInput("");
                    setShowRefinement(false);
                    setLoadingMore(true);
                    onLoadMore(focus).finally(() => setLoadingMore(false));
                  }
                  if (e.key === "Escape") {
                    setShowRefinement(false);
                    setRefinementInput("");
                  }
                }}
                disabled={loadingMore || loading}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "9px 12px",
                  borderRadius: RADIUS.md,
                  border: `1.5px solid ${T.ocean}`,
                  background: T.chalk,
                  color: T.ink,
                  fontSize: 13,
                  fontFamily: "Georgia,serif",
                  outline: "none",
                  marginBottom: 8,
                }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => {
                    if (loadingMore || loading) return;
                    const focus = refinementInput.trim();
                    setRefinementInput("");
                    setShowRefinement(false);
                    setLoadingMore(true);
                    onLoadMore(focus).finally(() => setLoadingMore(false));
                  }}
                  disabled={!refinementInput.trim() || loadingMore || loading}
                  style={{
                    padding: "8px 16px",
                    borderRadius: RADIUS.full,
                    border: "none",
                    background:
                      !refinementInput.trim() || loadingMore || loading
                        ? T.disabled
                        : T.ocean,
                    color: T.chalk,
                    fontFamily: "Georgia,serif",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor:
                      !refinementInput.trim() || loadingMore || loading
                        ? "not-allowed"
                        : "pointer",
                  }}
                >
                  Search
                </button>
                <button
                  onClick={() => {
                    setShowRefinement(false);
                    setRefinementInput("");
                  }}
                  style={{
                    padding: "8px 14px",
                    borderRadius: RADIUS.full,
                    border: `1px solid ${T.border}`,
                    background: T.chalk,
                    color: T.mist,
                    fontFamily: "Georgia,serif",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {/* Skeleton rows while appending — existing items stay visible */}
          {loadingMore && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                marginTop: 16,
              }}
            >
              {[0, 1, 2].map((i) => (
                <div key={i}>
                  <div
                    style={{
                      height: 14,
                      width: "50%",
                      background: T.sand,
                      borderRadius: 6,
                      animation: "shimmer 1.5s ease-in-out infinite",
                      marginBottom: 8,
                      animationDelay: `${i * 0.12}s`,
                    }}
                  />
                  <div
                    style={{
                      height: 14,
                      width: "75%",
                      background: T.sand,
                      borderRadius: 6,
                      animation: "shimmer 1.5s ease-in-out infinite",
                      marginBottom: 6,
                      animationDelay: `${i * 0.12 + 0.08}s`,
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
