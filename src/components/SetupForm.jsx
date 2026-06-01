import { useState, useRef, useEffect } from "react";
import {
  T,
  RADIUS,
  SHADOW,
  MOTION,
  PLACES_PROXY,
  PLACES_HEADERS,
} from "../theme";
import { CityInput } from "./BoardView.jsx";

function DateRangePicker({ startDate, endDate, onChange, isDesktop = false }) {
  const todayISO = new Date().toISOString().slice(0, 10);

  const MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const DAY_HEADERS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  const toISO = (y, m, d) =>
    `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const fmtShort = (iso) =>
    new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });

  // 12 months stacked from current month — user scrolls through them inside the container.
  const today = new Date();
  const months = Array.from({ length: 12 }, (_, i) => {
    const y = today.getFullYear() + Math.floor((today.getMonth() + i) / 12);
    const m = (today.getMonth() + i) % 12;
    return { year: y, month: m };
  });

  const buildCells = (y, m) => {
    const firstDow = new Date(y, m, 1).getDay();
    const dim = new Date(y, m + 1, 0).getDate();
    return [
      ...Array(firstDow).fill(null),
      ...Array.from({ length: dim }, (_, i) => toISO(y, m, i + 1)),
    ];
  };

  const handleDay = (iso) => {
    if (iso < todayISO) return;
    if (!startDate || (startDate && endDate)) {
      onChange(iso, "");
    } else {
      if (iso === startDate) {
        onChange("", "");
      } else if (iso > startDate) {
        onChange(startDate, iso);
      } else {
        onChange(iso, "");
      }
    }
  };

  const phase = !startDate || (startDate && endDate) ? "start" : "end";
  const numDays =
    startDate && endDate
      ? Math.round((new Date(endDate) - new Date(startDate)) / 864e5) + 1
      : null;

  // On mount, scroll so the month containing startDate (or the current month) is in view.
  const scrollRef = useRef(null);
  const monthRefs = useRef({});
  useEffect(() => {
    if (!scrollRef.current) return;
    const targetIso = startDate || todayISO;
    const key = targetIso.slice(0, 7);
    const el = monthRefs.current[key];
    if (el) el.scrollIntoView({ block: "start", behavior: "auto" });
  }, []);

  const renderMonth = ({ year, month }) => {
    const key = `${year}-${String(month + 1).padStart(2, "0")}`;
    return (
      <div
        key={key}
        ref={(el) => {
          if (el) monthRefs.current[key] = el;
        }}
        style={{ marginBottom: 12 }}
      >
        <div
          style={{
            fontFamily: "Georgia,serif",
            fontSize: 14,
            color: T.ink,
            fontWeight: 600,
            textAlign: "center",
            marginBottom: 4,
          }}
        >
          {MONTHS[month]} {year}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7,1fr)",
            marginBottom: 2,
          }}
        >
          {DAY_HEADERS.map((d) => (
            <div
              key={`${key}-${d}`}
              style={{
                textAlign: "center",
                fontFamily: "Georgia,serif",
                fontSize: 11,
                color: T.mist,
                padding: "2px 0",
              }}
            >
              {d}
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)" }}>
          {buildCells(year, month).map((iso, i) => {
            if (!iso) return <div key={i} />;
            const isStart = iso === startDate;
            const isEnd = iso === endDate;
            const inRange =
              startDate && endDate && iso > startDate && iso < endDate;
            const isToday = iso === todayISO;
            const isPast = iso < todayISO;
            const isBeforeStart =
              phase === "end" && startDate && iso < startDate;

            let bg = "transparent",
              color = isPast || isBeforeStart ? T.disabled : T.ink,
              radius = RADIUS.md;
            if (isStart || isEnd) {
              bg = T.ocean;
              color = "white";
            } else if (inRange) {
              bg = "rgba(37,99,168,0.12)";
              radius = "0";
            }

            return (
              <div
                key={iso}
                onClick={() => handleDay(iso)}
                style={{
                  textAlign: "center",
                  padding: "8px 0",
                  cursor: isPast ? "default" : "pointer",
                  fontFamily: "Georgia,serif",
                  fontSize: 13,
                  fontWeight: isToday ? 700 : 400,
                  color,
                  background: bg,
                  borderRadius: radius,
                  ...(isStart && endDate
                    ? { borderRadius: `${RADIUS.md}px 0 0 ${RADIUS.md}px` }
                    : {}),
                  ...(isEnd
                    ? { borderRadius: `0 ${RADIUS.md}px ${RADIUS.md}px 0` }
                    : {}),
                  ...(inRange ? { borderRadius: 0 } : {}),
                  userSelect: "none",
                }}
              >
                {iso.slice(8).replace(/^0/, "")}
                {isToday && !isStart && !isEnd && (
                  <div
                    style={{
                      width: 3,
                      height: 3,
                      borderRadius: "50%",
                      background: T.ocean,
                      margin: "1px auto 0",
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // On desktop use a fixed height; on mobile the calendar fills the remaining
  // flex space and is internally scrollable (the parent step div is flex-column).
  const CALENDAR_HEIGHT = 340;

  return (
    <div
      style={{
        marginBottom: 12,
        flex: isDesktop ? undefined : 1,
        display: isDesktop ? "block" : "flex",
        flexDirection: isDesktop ? undefined : "column",
        minHeight: 0,
      }}
    >
      {/* Scrollable month list — 1.5 months visible at a time */}
      <div
        ref={scrollRef}
        style={{
          height: isDesktop ? CALENDAR_HEIGHT : undefined,
          flex: isDesktop ? undefined : 1,
          minHeight: isDesktop ? undefined : 0,
          overflowY: "auto",
          border: `1px solid ${T.sand}`,
          borderRadius: RADIUS.lg,
          padding: "8px 10px 0",
          background: T.chalk,
        }}
      >
        {months.map(renderMonth)}
      </div>

      {/* Bottom: day count or hint */}
      <div style={{ textAlign: "center", marginTop: 10 }}>
        {numDays ? (
          <span
            style={{
              fontSize: 12,
              color: T.moss,
              fontWeight: 600,
              background: T.successLight,
              padding: "4px 12px",
              borderRadius: RADIUS.sm,
            }}
          >
            {fmtShort(startDate)} → {fmtShort(endDate)} · {numDays} days
          </span>
        ) : (
          <span style={{ fontSize: 12, color: T.mist }}>
            {phase === "start"
              ? "Tap your arrival date"
              : "Tap your departure date"}
          </span>
        )}
      </div>
    </div>
  );
}

/* ─── SETUP FORM ─────────────────────────────────────────────────────── */

function SetupForm({
  onGenerate,
  initialTrip,
  onStepChange,
  prefillForm = null,
  initialStep = 0,
  onDestinationsChange = null,
  isDesktop = false,
  onFormChange = null,
}) {
  const [step, setStep] = useState(initialStep);
  useEffect(() => {
    setStep(initialStep);
  }, [initialStep]);
  const [generating, setGen] = useState(false);

  // If prefillForm arrives (e.g. returning from brainstorm), merge its fields into form state.
  // Using a ref-based guard to only apply it on mount or when the object reference actually changes.
  const prefillAppliedRef = useRef(false);

  // Notify parent of step changes
  useEffect(() => {
    onStepChange?.(step);
  }, [step]);

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

  // Pre-warm places-proxy edge function so first autocomplete keystroke isn't a cold start
  useEffect(() => {
    fetch(`${PLACES_PROXY}?action=autocomplete`, {
      method: "POST",
      headers: PLACES_HEADERS,
      body: JSON.stringify({ q: "lo" }),
    }).catch(() => {});
  }, []);
  const igReq = initialTrip?.ig_request || {};
  const prefill = initialTrip
    ? {
        destinations: initialTrip.destination
          ? initialTrip.destination.split(" → ")
          : [],
        startDate: initialTrip.start_date || "",
        endDate: initialTrip.end_date || "",
        arrivalTime: initialTrip.arrival_time
          ? initialTrip.arrival_time.slice(11, 16)
          : "",
        departureTime: initialTrip.departure_time
          ? initialTrip.departure_time.slice(11, 16)
          : "",
        arrivalCity: initialTrip.arrival_city || "",
        departureCity: initialTrip.departure_city || "",
        baseLocation: initialTrip.base_location || igReq.baseLocation || "",
        notes: initialTrip.notes || "",
        ...(igReq.travelers ? { travelers: String(igReq.travelers) } : {}),
        ...(igReq.styles ? { styles: igReq.styles } : {}),
        ...(igReq.arrivalTime ? { arrivalTime: igReq.arrivalTime } : {}),
        ...(igReq.departureTime ? { departureTime: igReq.departureTime } : {}),
        ...(igReq.arrivalMode ? { arrivalMode: igReq.arrivalMode } : {}),
        ...(igReq.departureMode ? { departureMode: igReq.departureMode } : {}),
      }
    : {};
  const [form, setForm] = useState({
    destinations: [],
    destinationCountryCodes: [],
    startDate: "",
    endDate: "",
    travelers: "2",
    styles: [],
    notes: "",
    arrivalCity: "",
    departureCity: "",
    baseLocation: "",
    ...prefill,
    ...(prefillForm || {}),
  });

  // Re-apply prefillForm on any change (handles returning from brainstorm)
  useEffect(() => {
    if (prefillForm && !prefillAppliedRef.current) {
      setForm((prev) => ({ ...prev, ...prefillForm }));
      setStep(initialStep);
      prefillAppliedRef.current = true;
    }
  }, [prefillForm, initialStep]);
  const [destInput, setDestInput] = useState("");
  const [destError, setDestError] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [showSugg, setShowSugg] = useState(false);
  const [destLoading, setDestLoading] = useState(false);
  const inputRef = useRef(null);
  const destTimer = useRef(null);
  const destAbortRef = useRef(null);
  const destCacheRef = useRef(new Map());

  // Track visual viewport height (shrinks when the software keyboard opens on mobile).
  // Used to position the suggestions dropdown above the keyboard.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const onResize = () => {
      const diff = window.innerHeight - window.visualViewport.height;
      setKeyboardHeight(diff > 60 ? diff : 0); // only count meaningful keyboard presence
    };
    window.visualViewport.addEventListener("resize", onResize);
    return () => window.visualViewport.removeEventListener("resize", onResize);
  }, []);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Notify parent after form state settles — calling onFormChange inside the
  // setForm updater triggered "setState during render" warnings in React.
  useEffect(() => {
    onFormChange?.(form);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  // Notify parent whenever destinations change so the page hero can become contextual.
  useEffect(() => {
    onDestinationsChange?.(form.destinations);
  }, [form.destinations]);

  const handleDestChange = (val) => {
    setDestInput(val);
    setDestError("");
    // Require ≥2 characters — single-character queries are too broad and
    // the autocomplete API charges per call.
    if (val.trim().length < 2) {
      setSuggestions([]);
      setShowSugg(false);
      setDestLoading(false);
      destAbortRef.current?.abort();
      clearTimeout(destTimer.current);
      return;
    }
    const cacheKey = val.trim().toLowerCase();
    // In-memory cache (per component mount) — instant, no network round-trip.
    const cached = destCacheRef.current.get(cacheKey);
    if (cached) {
      setSuggestions(cached);
      setShowSugg(cached.length > 0);
      setDestLoading(false);
      return;
    }
    setShowSugg(true);
    setDestLoading(true);
    clearTimeout(destTimer.current);
    destAbortRef.current?.abort();
    // 400ms debounce — more forgiving on mobile where typing is slower and
    // edge-function cold-starts add latency.
    destTimer.current = setTimeout(async () => {
      const ctrl = new AbortController();
      destAbortRef.current = ctrl;
      // 6s client timeout: edge functions occasionally cold-start (1–3s).
      // If it takes longer than 6s, fail fast rather than hanging indefinitely.
      const timeoutId = setTimeout(() => ctrl.abort(), 6000);
      try {
        const res = await fetch(`${PLACES_PROXY}?action=autocomplete`, {
          method: "POST",
          headers: PLACES_HEADERS,
          body: JSON.stringify({ q: val }),
          signal: ctrl.signal,
        });
        clearTimeout(timeoutId);
        const data = await res.json();
        const items = (data.suggestions || []).slice(0, 8);
        // Cache the result so typing back to the same prefix is instant.
        destCacheRef.current.set(cacheKey, items);
        if (ctrl.signal.aborted) return;
        setSuggestions(items);
        setShowSugg(items.length > 0);
        setDestLoading(false);
      } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === "AbortError") {
          // Timeout or newer keystroke — don't show an error, just clear.
          if (!ctrl.signal.aborted) setDestLoading(false);
          return;
        }
        setSuggestions([]);
        setDestLoading(false);
      }
    }, 400);
  };

  const addDestination = (name, currentDests) => {
    if (!name?.trim()) return false;
    const dests = currentDests || form.destinations;
    if (!dests.includes(name)) set("destinations", [...dests, name]);
    setDestInput("");
    setSuggestions([]);
    setShowSugg(false);
    setDestLoading(false);
    // Cancel any in-flight autocomplete request + pending debounce timer.
    // Otherwise a pending 200ms fetch can resolve after this call and
    // reopen the dropdown over the Continue button (test flakiness +
    // real UX: the dropdown stays open after pressing Enter).
    clearTimeout(destTimer.current);
    destAbortRef.current?.abort();
    return name;
  };

  const removeDestination = (idx) =>
    set(
      "destinations",
      form.destinations.filter((_, i) => i !== idx),
    );

  const pickSuggestion = (suggestion) => {
    // Prefer mainText (just the city/region name e.g. "Ahmedabad") over the
    // full text string ("Ahmedabad, Gujarat, India") for cleaner display.
    const text =
      suggestion.placePrediction?.structuredFormat?.mainText?.text ||
      suggestion.placePrediction?.text?.text ||
      "";
    if (text) addDestination(text);
    inputRef.current?.focus();
  };

  const handleGenerate = async () => {
    const needsBase = form.destinations.some((d) =>
      d.toLowerCase().includes("help me decide"),
    );
    if (needsBase && !form.baseLocation?.trim()) {
      setDestError(
        "Please tell us where you're based so we can suggest the right destinations.",
      );
      return;
    }
    setGen(true);
    onGenerate(form);
  };

  // ── Full-page destination search sheet (mobile only) ──
  // Renders as a fixed overlay to escape the overflow:hidden parent. Desktop
  // uses an inline dropdown instead (plenty of screen real estate, no clip).
  const [showDestSheet, setShowDestSheet] = useState(false);

  const openDestSheet = () => {
    setDestInput("");
    setSuggestions([]);
    setShowSugg(false);
    setShowDestSheet(true);
  };

  const closeDestSheet = () => {
    setShowDestSheet(false);
    setDestInput("");
    setSuggestions([]);
    setShowSugg(false);
    setDestLoading(false);
    destAbortRef.current?.abort();
    clearTimeout(destTimer.current);
  };

  const pickSuggestionAndClose = (s) => {
    pickSuggestion(s);
    closeDestSheet();
  };

  const destSearchSheet = !isDesktop && showDestSheet && (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: T.chalk,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Sheet header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 16px",
          borderBottom: `1px solid ${T.sand}`,
          background: T.chalk,
          flexShrink: 0,
        }}
      >
        <button
          onClick={closeDestSheet}
          style={{
            background: "none",
            border: "none",
            fontSize: 22,
            color: T.mist,
            cursor: "pointer",
            lineHeight: 1,
            padding: 0,
          }}
        >
          ←
        </button>
        <input
          autoFocus
          value={destInput}
          onChange={(e) => handleDestChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && destInput.trim()) {
              addDestination(destInput.trim());
              closeDestSheet();
            }
          }}
          placeholder="Search destinations…"
          style={{
            flex: 1,
            padding: "10px 14px",
            borderRadius: RADIUS.lg,
            border: `1.5px solid ${T.sand}`,
            fontFamily: "Georgia,serif",
            fontSize: 15,
            color: T.ink,
            background: T.bgPage,
            outline: "none",
          }}
        />
        {destInput && (
          <button
            onClick={() => {
              setDestInput("");
              setSuggestions([]);
              setShowSugg(false);
            }}
            style={{
              background: "none",
              border: "none",
              fontSize: 18,
              color: T.mist,
              cursor: "pointer",
              padding: 0,
            }}
          >
            ×
          </button>
        )}
      </div>

      {/* Results — fill remaining height, fully scrollable */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {destLoading && suggestions.length === 0 && (
          <div
            style={{
              padding: "20px 16px",
              fontFamily: "Georgia,serif",
              fontSize: 14,
              color: T.mist,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 14,
                height: 14,
                borderRadius: "50%",
                border: `2px solid ${T.sand}`,
                borderTopColor: T.ocean,
                animation: "spin 0.7s linear infinite",
              }}
            />
            Searching…
          </div>
        )}
        {!destLoading && destInput.length >= 2 && suggestions.length === 0 && (
          <div
            style={{
              padding: "20px 16px",
              fontFamily: "Georgia,serif",
              fontSize: 14,
              color: T.mist,
            }}
          >
            No results for &ldquo;{destInput}&rdquo;
          </div>
        )}
        {suggestions.map((s, i) => {
          const main =
            s.placePrediction?.structuredFormat?.mainText?.text ||
            s.placePrediction?.text?.text ||
            "";
          const secondary =
            s.placePrediction?.structuredFormat?.secondaryText?.text || "";
          return (
            <button
              key={i}
              onMouseDown={() => pickSuggestionAndClose(s)}
              onClick={() => pickSuggestionAndClose(s)}
              style={{
                display: "block",
                width: "100%",
                padding: "14px 16px",
                background: "none",
                border: "none",
                borderBottom: `1px solid ${T.sand}`,
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  fontFamily: "Georgia,serif",
                  fontSize: 15,
                  color: T.ink,
                  fontWeight: 600,
                }}
              >
                {main}
              </div>
              {secondary && (
                <div
                  style={{
                    fontFamily: "Georgia,serif",
                    fontSize: 12,
                    color: T.mist,
                    marginTop: 2,
                  }}
                >
                  {secondary}
                </div>
              )}
            </button>
          );
        })}

        {/* Popular destinations in the sheet too — shown when no query */}
        {!destInput && (
          <div style={{ padding: "16px" }}>
            <div
              style={{
                fontFamily: "Georgia,serif",
                fontSize: 11,
                color: T.mist,
                letterSpacing: 0.8,
                textTransform: "uppercase",
                marginBottom: 12,
              }}
            >
              Popular destinations
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {[
                "Rajasthan 🏰",
                "Japan 🌸",
                "Amalfi 🌊",
                "Patagonia 🏔️",
                "Morocco 🕌",
                "Koh Samui 🏝️",
                "Bali 🌴",
                "Santorini ☀️",
              ].map((d) => {
                const name = d
                  .replace(
                    /\s*[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}]+$/u,
                    "",
                  )
                  .trim();
                return (
                  <button
                    key={d}
                    onClick={() => {
                      addDestination(name);
                      closeDestSheet();
                    }}
                    style={{
                      background: T.sand,
                      color: T.ink,
                      border: "none",
                      borderRadius: RADIUS.full,
                      padding: "8px 16px",
                      fontSize: 14,
                      cursor: "pointer",
                      fontFamily: "Georgia,serif",
                    }}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const stepViews = [
    /* 0 – destination */
    <div
      key={0}
      style={{
        animation: "fadeUp 0.3s ease",
      }}
    >
      {/* Desktop only: icon + heading (mobile banner carries this context) */}
      {isDesktop && (
        <>
          <div style={{ textAlign: "center", fontSize: 40, marginBottom: 8 }}>
            🌍
          </div>
          <div
            style={{
              fontFamily: "'DM Serif Display',serif",
              fontSize: 24,
              color: T.ink,
              textAlign: "center",
              marginBottom: 4,
            }}
          >
            Where to?
          </div>
          <div
            style={{
              fontSize: 13,
              color: T.mist,
              textAlign: "center",
              marginBottom: 22,
              fontFamily: "Georgia,serif",
            }}
          >
            Add one or more destinations
          </div>
        </>
      )}

      {/* Selected destination chips */}
      {form.destinations.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 12,
          }}
        >
          {form.destinations.map((d, i) => (
            <div
              key={d}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: T.ocean,
                color: "white",
                borderRadius: RADIUS.full,
                padding: "6px 12px",
                fontSize: 13,
                fontFamily: "Georgia,serif",
              }}
            >
              {i > 0 && <span style={{ opacity: 0.6, marginRight: 2 }}>→</span>}
              {d}
              <button
                onClick={() => removeDestination(i)}
                style={{
                  background: "none",
                  border: "none",
                  color: "white",
                  cursor: "pointer",
                  fontSize: 14,
                  lineHeight: 1,
                  padding: 0,
                  opacity: 0.7,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* On mobile: tap target that opens the full-page sheet.
          On desktop: inline input with dropdown (overflow is not clipped). */}
      {!isDesktop ? (
        form.destinations.length === 0 ? (
          /* No destination yet — tappable search prompt */
          <button
            onClick={openDestSheet}
            style={{
              width: "100%",
              padding: "14px 16px",
              borderRadius: RADIUS.lg,
              border: `2px solid ${T.sand}`,
              fontFamily: "Georgia,serif",
              fontSize: 15,
              color: T.mist,
              background: T.chalk,
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            e.g. Bangkok, Kyoto, Rajasthan…
          </button>
        ) : (
          /* Destination(s) chosen — explicit "Add another?" prompt */
          <button
            onClick={openDestSheet}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "none",
              border: `1.5px dashed ${T.ocean}66`,
              borderRadius: RADIUS.lg,
              padding: "11px 16px",
              color: T.ocean,
              fontFamily: "Georgia,serif",
              fontSize: 14,
              cursor: "pointer",
              width: "100%",
            }}
          >
            <span style={{ fontSize: 18 }}>+</span> Add another destination
          </button>
        )
      ) : (
        /* Desktop inline input + dropdown */
        <div style={{ position: "relative" }}>
          <input
            ref={inputRef}
            value={destInput}
            onChange={(e) => handleDestChange(e.target.value)}
            onBlur={() => setTimeout(() => setShowSugg(false), 150)}
            onFocus={() => destInput && suggestions.length && setShowSugg(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && destInput.trim())
                addDestination(destInput.trim());
            }}
            placeholder={
              form.destinations.length === 0
                ? "e.g. Bangkok, Kyoto, Rajasthan…"
                : "Add another destination…"
            }
            style={{
              width: "100%",
              padding: "14px 16px",
              borderRadius: RADIUS.lg,
              border: `2px solid ${destError ? T.error : destInput ? T.ocean : T.sand}`,
              fontFamily: "Georgia,serif",
              fontSize: 15,
              color: T.ink,
              background: T.chalk,
              outline: "none",
              transition: `border ${MOTION.normal}`,
            }}
          />
          {showSugg && (destLoading || suggestions.length > 0) && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                left: 0,
                right: 0,
                background: T.chalk,
                border: `1.5px solid ${T.sand}`,
                borderRadius: RADIUS.lg,
                overflow: "hidden",
                zIndex: 100,
                boxShadow: "0 4px 18px rgba(0,0,0,0.10)",
                maxHeight: 300,
                overflowY: "auto",
              }}
            >
              {destLoading && suggestions.length === 0 && (
                <div
                  style={{
                    padding: "12px 16px",
                    fontFamily: "Georgia,serif",
                    fontSize: 13,
                    color: T.mist,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      border: `2px solid ${T.sand}`,
                      borderTopColor: T.ocean,
                      animation: "spin 0.7s linear infinite",
                    }}
                  />
                  Searching destinations…
                </div>
              )}
              {suggestions.map((s, i) => {
                const main =
                  s.placePrediction?.structuredFormat?.mainText?.text ||
                  s.placePrediction?.text?.text ||
                  "";
                const secondary =
                  s.placePrediction?.structuredFormat?.secondaryText?.text ||
                  "";
                return (
                  <div
                    key={i}
                    onMouseDown={() => pickSuggestion(s)}
                    style={{
                      padding: "10px 16px",
                      cursor: "pointer",
                      borderBottom: `1px solid ${T.sand}`,
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = T.sand)
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = T.chalk)
                    }
                  >
                    <div
                      style={{
                        fontFamily: "Georgia,serif",
                        fontSize: 14,
                        color: T.ink,
                        fontWeight: 600,
                      }}
                    >
                      🌍 {main}
                    </div>
                    {secondary && (
                      <div
                        style={{
                          fontFamily: "Georgia,serif",
                          fontSize: 11,
                          color: T.mist,
                          marginTop: 2,
                        }}
                      >
                        {secondary}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Pre-populated popular destinations — only shown when none selected yet.
          Once the user picks one, this is replaced by the "+ Add another" prompt. */}
      {/* Pills + Help me decide — hidden once user has picked a destination */}
      {form.destinations.length === 0 && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isDesktop ? "1fr 1fr" : "1fr 1fr",
              gap: 8,
              marginTop: 14,
            }}
          >
            {[
              "Rajasthan 🏰",
              "Japan 🌸",
              "Amalfi 🌊",
              "Patagonia 🏔️",
              "Morocco 🕌",
              "Koh Samui 🏝️",
              "Bali 🌴",
              "Santorini ☀️",
            ].map((d) => {
              const name = d
                .replace(
                  /\s*[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}]+$/u,
                  "",
                )
                .trim();
              return (
                <button
                  key={d}
                  onClick={() => addDestination(name)}
                  style={{
                    background: T.sand,
                    color: T.ink,
                    border: "none",
                    borderRadius: RADIUS.full,
                    padding: "8px 14px",
                    fontSize: 13,
                    cursor: "pointer",
                    fontFamily: "Georgia,serif",
                  }}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <button
            onClick={() => {
              addDestination("Help me decide");
              setStep(1);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              width: "100%",
              marginTop: 12,
              padding: "13px 0",
              borderRadius: RADIUS.lg,
              border: `2px solid ${T.ocean}44`,
              background: `linear-gradient(135deg, ${T.ocean}08, ${T.dusk}06)`,
              color: T.ocean,
              fontFamily: "Georgia,serif",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            🌐 Help me decide
          </button>
        </>
      )}
    </div>,

    /* 1 – dates & travelers */
    <div
      key={1}
      style={{
        animation: "fadeUp 0.3s ease",
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      {/* Desktop only: show emoji + heading (mobile banner carries this context) */}
      {isDesktop && (
        <>
          <div style={{ textAlign: "center", fontSize: 32, marginBottom: 6 }}>
            📅
          </div>
          <div
            style={{
              fontFamily: "'DM Serif Display',serif",
              fontSize: 22,
              color: T.ink,
              textAlign: "center",
              marginBottom: 14,
            }}
          >
            Dates
          </div>
        </>
      )}
      {/* Travelers — placed above calendar so calendar can be a fixed-height scroll area */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 14,
          marginBottom: 14,
          padding: "8px 12px",
          borderRadius: RADIUS.lg,
          border: `1px solid ${T.sand}`,
          background: T.chalk,
        }}
      >
        <span
          style={{
            fontFamily: "Georgia,serif",
            fontSize: 13,
            color: T.ink,
            fontWeight: 600,
          }}
        >
          Travelers
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={() =>
              set("travelers", String(Math.max(1, +form.travelers - 1)))
            }
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              border: `2px solid ${T.sand}`,
              background: T.chalk,
              fontSize: 18,
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            −
          </button>
          <span
            style={{
              fontFamily: "'DM Serif Display',serif",
              fontSize: 22,
              color: T.ink,
              minWidth: 28,
              textAlign: "center",
            }}
          >
            {form.travelers}
          </span>
          <button
            onClick={() =>
              set("travelers", String(Math.min(12, +form.travelers + 1)))
            }
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              border: "none",
              background: T.ocean,
              color: "white",
              fontSize: 18,
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            +
          </button>
          <span
            style={{
              fontFamily: "Georgia,serif",
              fontSize: 12,
              color: T.mist,
              minWidth: 48,
            }}
          >
            {+form.travelers === 1 ? "solo" : "travelers"}
          </span>
        </div>
      </div>
      <DateRangePicker
        startDate={form.startDate}
        endDate={form.endDate}
        onChange={(start, end) => {
          set("startDate", start);
          set("endDate", end);
        }}
        isDesktop={isDesktop}
      />
    </div>,

    /* 2 – preferences (base city + notes + generate) */
    (() => {
      const isOpenToIdeas = form.destinations.some((d) =>
        d.toLowerCase().includes("help me decide"),
      );
      return (
        <div
          key={3}
          style={{
            animation: "fadeUp 0.3s ease",
          }}
        >
          {/* Desktop only: heading (mobile banner already has contextual context) */}
          {isDesktop && (
            <div
              style={{
                fontFamily: "'DM Serif Display',serif",
                fontSize: 20,
                color: T.ink,
                textAlign: "center",
                marginBottom: 24,
              }}
            >
              🛤 Preferences
            </div>
          )}

          {/* Base Location */}
          <div style={{ marginBottom: 18 }}>
            <div
              style={{
                fontFamily: "Georgia,serif",
                fontSize: 13,
                color: T.ink,
                marginBottom: 6,
                fontWeight: 600,
              }}
            >
              Where are you based?{" "}
              {isOpenToIdeas ? (
                <span style={{ color: T.terra, fontWeight: 600 }}>*</span>
              ) : (
                <span style={{ color: T.mist, fontWeight: 400 }}>
                  · optional
                </span>
              )}
            </div>
            <CityInput
              value={form.baseLocation}
              onChange={(v) => set("baseLocation", v)}
              placeholder="Your home city"
              openUpward={!isDesktop && keyboardHeight > 0}
              inputStyle={{
                width: "100%",
                padding: "11px 14px",
                borderRadius: RADIUS.lg,
                border: `1.5px solid ${form.baseLocation ? T.ocean : destError && isOpenToIdeas && !form.baseLocation ? T.terra : T.sand}`,
                fontFamily: "Georgia,serif",
                fontSize: 13,
                color: T.ink,
                outline: "none",
                boxSizing: "border-box",
                background: T.chalk,
              }}
            />
          </div>

          <div style={{ marginBottom: 22 }}>
            <div
              style={{
                fontFamily: "Georgia,serif",
                fontSize: 13,
                color: T.ink,
                marginBottom: 6,
                fontWeight: 600,
              }}
            >
              What kind of trip do you want?
            </div>
            <textarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="e.g. we love scuba diving, prefer boutique hotels, travelling with two kids under 10, no long drives, love trying local street food…"
              rows={6}
              style={{
                width: "100%",
                padding: "14px 16px",
                borderRadius: RADIUS.lg,
                border: `1.5px solid ${form.notes ? T.ocean : T.sand}`,
                fontFamily: "Georgia,serif",
                fontSize: 14,
                color: T.ink,
                outline: "none",
                resize: "none",
                boxSizing: "border-box",
                background: T.chalk,
                lineHeight: 1.6,
              }}
            />
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            style={{
              width: "100%",
              padding: 16,
              borderRadius: RADIUS.lg,
              border: "none",
              cursor: generating ? "not-allowed" : "pointer",
              background: generating
                ? T.sand
                : `linear-gradient(135deg,${T.ocean},${T.dusk})`,
              color: generating ? T.mist : "white",
              fontFamily: "'DM Serif Display',serif",
              fontSize: 18,
              boxShadow: generating ? "none" : "0 6px 22px rgba(37,99,168,0.4)",
              transition: `all ${MOTION.slow}`,
              marginTop: 8,
            }}
          >
            {generating ? "✨ Generating your itinerary…" : "Start Planning ✨"}
          </button>
        </div>
      );
    })(),
  ];

  // Advance to the next step with validation
  const handleContinue = () => {
    if (step === 0) {
      if (destInput.trim()) {
        const added = addDestination(destInput);
        if (!added) {
          setDestError(
            "We don't recognise this destination — try picking from the suggestions.",
          );
          return;
        }
      }
      if (form.destinations.length === 0 && !destInput.trim()) {
        setDestError("Please add at least one destination.");
        return;
      }
    }
    if (step === 1) {
      if (!form.startDate || !form.endDate) {
        setDestError("Please select both start and end dates.");
        return;
      }
      if (new Date(form.endDate) < new Date(form.startDate)) {
        setDestError("End date cannot be before start date.");
        return;
      }
    }
    setDestError("");
    setStep((s) => {
      const next = s + 1;
      window.history.pushState({ step: next }, "");
      return next;
    });
  };

  // Mobile trip-summary bar — shown on steps 1+ when dates/travelers are set
  const hasSummary =
    (form.startDate && form.endDate) || Number(form.travelers) > 1;
  const summaryText = (() => {
    const parts = [];
    if (Number(form.travelers) > 1)
      parts.push(
        `${form.travelers} traveler${Number(form.travelers) > 1 ? "s" : ""}`,
      );
    if (form.startDate && form.endDate) {
      const fmt = (iso) =>
        new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
      parts.push(`${fmt(form.startDate)} – ${fmt(form.endDate)}`);
    }
    return parts.join(" · ");
  })();

  return (
    <>
      {/* Full-page destination search sheet — rendered outside the clipping
          flex container so it can cover the full screen without being cut off */}
      {destSearchSheet}
      <div
        style={{
          padding: isDesktop ? 0 : "0 16px",
          paddingBottom: isDesktop ? 0 : 0,
          flex: isDesktop ? undefined : 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        {/* Back button + Progress dots — hidden on desktop (left panel owns step progress) */}
        {!isDesktop && (
          <div
            style={{ display: "flex", alignItems: "center", marginBottom: 16 }}
          >
            {step > 0 ? (
              <button
                onClick={() => setStep((s) => s - 1)}
                style={{
                  background: T.sand,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 18,
                  color: T.ink,
                  padding: "6px 10px",
                  lineHeight: 1,
                  borderRadius: RADIUS.md,
                  minWidth: 36,
                  minHeight: 36,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                ←
              </button>
            ) : (
              <div style={{ width: 28 }} />
            )}
            <div
              style={{
                flex: 1,
                display: "flex",
                justifyContent: "center",
                gap: 8,
              }}
            >
              {stepViews.map((_, i) => (
                <div
                  key={i}
                  style={{
                    width: i === step ? 26 : 8,
                    height: 8,
                    borderRadius: RADIUS.sm,
                    background: i <= step ? T.ocean : T.sand,
                    transition: `all ${MOTION.slow}`,
                  }}
                />
              ))}
            </div>
            <div style={{ width: 28 }} />
          </div>
        )}

        {/* Trip summary is shown in the mobile banner (App.jsx), not duplicated here */}

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            overflowY: isDesktop ? "visible" : "hidden",
          }}
        >
          {stepViews[step]}
        </div>
        {destError && (
          <div
            style={{
              color: T.error,
              fontSize: 13,
              fontFamily: "Georgia,serif",
              marginTop: 4,
              textAlign: "center",
              flexShrink: 0,
            }}
          >
            {destError}
          </div>
        )}

        {/* Navigation footer — always at the bottom of the flex column */}
        <div
          style={{
            display: "flex",
            gap: 10,
            marginTop: isDesktop ? 28 : 12,
            paddingBottom: isDesktop ? 0 : 16,
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          {/* Back button in footer — desktop only; on mobile it's in the dots row */}
          {isDesktop && step > 0 && (
            <button
              onClick={() => setStep((s) => s - 1)}
              style={{
                padding: "12px 20px",
                borderRadius: RADIUS.lg,
                border: `1.5px solid ${T.border}`,
                background: T.chalk,
                color: T.ink,
                fontFamily: "Georgia,serif",
                fontSize: 14,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              ← Back
            </button>
          )}
          {step < stepViews.length - 1 && (
            <button
              onClick={handleContinue}
              style={{
                flex: 1,
                padding: 14,
                borderRadius: RADIUS.lg,
                border: "none",
                cursor: "pointer",
                background: T.ocean,
                color: "white",
                fontFamily: "'DM Serif Display',serif",
                fontSize: 16,
                boxShadow: "0 4px 14px rgba(37,99,168,0.3)",
              }}
            >
              Continue →
            </button>
          )}
        </div>
      </div>
    </>
  );
}

export default SetupForm;
