import { useEffect, useMemo, useRef, useState } from "react";
import { T, RADIUS, SHADOW, MOTION } from "../theme";
import { CityInput } from "./BoardView.jsx";
import { confirmSheet } from "../dialogs.jsx";
import { geocodePlace } from "../photos.js";
import {
  ledger,
  editSummary,
  stopsEqual,
  farFromRoute,
  MAX_STOPS,
} from "../routeStops.js";

/* ─── ROUTE EDITOR SHEET ────────────────────────────────────────────────
   "Your route" — steppers for nights (min 1), tap-to-move reorder (⌃⌄),
   add stop (region-biased CityInput, free text allowed), remove (min 1
   stop, max 8). The nights ledger (budget = trip days − 1) gates a single
   costed Rebuild. Purely presentational + local editing state: Apply hands
   the edited stops to App.jsx, which owns the whole funnel.

   readOnly: members without route-write access get the same sheet with the
   controls hidden — never an Apply that would silently no-op.            */

const sans = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

export default function RouteEditorSheet({
  open,
  stops: baseStops, // the stored route's stops (snapshot source)
  resumeStops = null, // pending edits preserved across a cancelled funnel
  tripNights,
  destinationHint = "", // trip destination — autocomplete bias + geocode context
  stopCoords = [], // [{lat,lng}] known coords for current stops (geo warning)
  readOnly = false,
  readOnlyLabel = "",
  onClose, // () => void — parent hides the sheet
  onApply, // (stops, summary) => void — enters the rebuild funnel
  onEditEvent, // (op: 'nights'|'reorder'|'add'|'remove') => void
}) {
  const [pending, setPending] = useState([]);
  const [snapshot, setSnapshot] = useState([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addText, setAddText] = useState("");
  const [warnings, setWarnings] = useState({}); // city(lower) -> km
  const sheetRef = useRef(null);
  const closingRef = useRef(false);

  // Snapshot on open; resume pending funnel edits when they exist
  useEffect(() => {
    if (!open) return;
    const snap = (baseStops || []).map((s) => ({ ...s }));
    setSnapshot(snap);
    setPending(
      (resumeStops?.length ? resumeStops : snap).map((s) => ({ ...s })),
    );
    setAddOpen(false);
    setAddText("");
    setWarnings({});
    closingRef.current = false;
    // initial focus for keyboard/screen-reader users
    setTimeout(() => sheetRef.current?.focus(), 60);
  }, [open]);

  const dirty = useMemo(
    () => !stopsEqual(pending, snapshot),
    [pending, snapshot],
  );
  const led = ledger(pending, tripNights);

  // Latest-value refs so the history/ESC effect can depend on [open] alone —
  // re-running it on dirty changes would pop our history entry mid-edit.
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty && !readOnly;
  const requestCloseRef = useRef(null);

  const requestClose = async () => {
    if (closingRef.current) return;
    if (dirtyRef.current) {
      const discard = await confirmSheet({
        title: "Discard route edits?",
        message: "Your itinerary hasn't changed.",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
        danger: true,
      });
      if (!discard) return;
    }
    closingRef.current = true;
    onClose?.();
  };
  requestCloseRef.current = requestClose;

  // ESC + Android back (one history entry per open — [open] dep ONLY)
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        requestCloseRef.current?.();
      }
    };
    const onPop = () => {
      // back press: route through the same discard guard; re-push so the
      // entry survives while the confirm is pending / kept
      requestCloseRef.current?.();
      if (!closingRef.current) window.history.pushState({ re: 1 }, "");
    };
    window.history.pushState({ re: 1 }, "");
    window.addEventListener("keydown", onKey);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
      // consume our history entry when closed by ✕/scrim/apply
      if (window.history.state?.re) window.history.back();
    };
  }, [open]);

  if (!open) return null;

  const mutate = (fn, op) => {
    if (readOnly) return;
    setPending((p) => fn(p.map((s) => ({ ...s }))));
    onEditEvent?.(op);
  };

  const move = (i, dir) =>
    mutate((p) => {
      const j = i + dir;
      if (j < 0 || j >= p.length) return p;
      [p[i], p[j]] = [p[j], p[i]];
      return p;
    }, "reorder");

  const step = (i, delta) =>
    mutate((p) => {
      p[i].nights = Math.max(1, (p[i].nights || 1) + delta);
      return p;
    }, "nights");

  const remove = (i) =>
    mutate((p) => (p.length > 1 ? p.filter((_, k) => k !== i) : p), "remove");

  const addStop = (name) => {
    const city = (name || "").trim();
    if (!city || pending.length >= MAX_STOPS) return;
    mutate((p) => [...p, { city, nights: 1, _new: true }], "add");
    setAddOpen(false);
    setAddText("");
    // Best-effort geocode → distance sanity (warn-only, never blocks)
    (async () => {
      try {
        const geo = await geocodePlace(city, destinationHint || city);
        if (!geo) return;
        setPending((p) =>
          p.map((s) =>
            s.city.toLowerCase() === city.toLowerCase() && s._new
              ? { ...s, lat: geo.lat, lng: geo.lng }
              : s,
          ),
        );
        const known = [
          ...(stopCoords || []),
          ...(pending || [])
            .filter((s) => Number.isFinite(s.lat))
            .map((s) => ({ lat: s.lat, lng: s.lng })),
        ];
        const km = farFromRoute(geo, known);
        if (km) setWarnings((w) => ({ ...w, [city.toLowerCase()]: km }));
      } catch {
        /* no geocode → no warning */
      }
    })();
  };

  const snapByCity = new Map(
    snapshot.map((s) => [s.city.toLowerCase(), s.nights]),
  );

  const applyDisabled = readOnly || !dirty || !led.balanced;
  const applyLabel = !dirty
    ? "Rebuild itinerary"
    : !led.balanced
      ? `Balance nights to rebuild (${Math.abs(led.delta)} ${
          led.delta > 0 ? "over" : "unassigned"
        })`
      : "Rebuild itinerary from this route";

  const summaryText = dirty ? editSummary(snapshot, pending) : "";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1600,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
      }}
    >
      {/* scrim */}
      <div
        onClick={requestClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(15,25,35,0.45)",
        }}
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Your route"
        tabIndex={-1}
        style={{
          position: "relative",
          maxHeight: "82vh",
          background: T.warm,
          borderRadius: `${RADIUS.lg + 4}px ${RADIUS.lg + 4}px 0 0`,
          boxShadow: "0 -10px 34px rgba(15,25,35,0.3)",
          display: "flex",
          flexDirection: "column",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          animation: "routeSheetUp 0.22s ease-out",
          outline: "none",
        }}
      >
        <style>{`@keyframes routeSheetUp { from { transform: translateY(24px); opacity: 0.6; } to { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { [role="dialog"][aria-label="Your route"] { animation: none !important; } }`}</style>
        <div
          style={{
            width: 36,
            height: 4,
            borderRadius: 2,
            background: T.sand,
            margin: "8px auto 6px",
            flexShrink: 0,
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            padding: "0 18px 2px",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontFamily: "'DM Serif Display',Georgia,serif",
              fontSize: 19,
              color: T.ink,
            }}
          >
            Your route
          </span>
          <button
            onClick={requestClose}
            aria-label="Close route editor"
            style={{
              background: "none",
              border: "none",
              fontSize: 16,
              color: T.mist,
              cursor: "pointer",
              padding: "4px 2px",
            }}
          >
            ✕
          </button>
        </div>

        {/* Nights ledger */}
        <div
          style={{
            padding: "0 18px 10px",
            fontFamily: "Georgia,serif",
            fontSize: 12.5,
            color: led.balanced ? T.moss : T.terra,
            fontWeight: led.balanced ? 400 : 700,
            flexShrink: 0,
          }}
          data-testid="nights-ledger"
        >
          {led.balanced
            ? `${led.assigned} nights · balanced ✓`
            : `${led.assigned} assigned · ${Math.abs(led.delta)} night${
                Math.abs(led.delta) === 1 ? "" : "s"
              } ${led.delta > 0 ? "over" : "unassigned"}`}
        </div>

        {/* Stop rows */}
        <div style={{ overflowY: "auto", padding: "0 14px", flex: 1 }}>
          {pending.map((s, i) => {
            const snapN = snapByCity.get(s.city.toLowerCase());
            const isNew = !!s._new || snapN === undefined;
            const edited = !isNew && snapN !== s.nights;
            const warnKm = warnings[s.city.toLowerCase()];
            return (
              <div key={`${s.city}-${i}`}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    background: isNew
                      ? "#F0FAF4"
                      : edited
                        ? "#F0F7FF"
                        : T.chalk,
                    border: `1px ${isNew || edited ? "dashed" : "solid"} ${
                      isNew ? T.moss : edited ? T.ocean : T.border
                    }`,
                    borderRadius: RADIUS.md + 1,
                    padding: "9px 11px",
                    marginBottom: 7,
                  }}
                >
                  {!readOnly && (
                    <span
                      style={{
                        display: "inline-flex",
                        flexDirection: "column",
                        gap: 2,
                        flexShrink: 0,
                      }}
                    >
                      {[
                        { d: -1, glyph: "⌃", label: `Move ${s.city} up` },
                        { d: 1, glyph: "⌄", label: `Move ${s.city} down` },
                      ].map(({ d, glyph, label }) => (
                        <button
                          key={d}
                          onClick={() => move(i, d)}
                          disabled={d < 0 ? i === 0 : i === pending.length - 1}
                          aria-label={label}
                          style={{
                            background: "none",
                            border: "none",
                            color: T.mist,
                            cursor: "pointer",
                            fontSize: 11,
                            lineHeight: "9px",
                            padding: "1px 3px",
                            opacity: (
                              d < 0 ? i === 0 : i === pending.length - 1
                            )
                              ? 0.25
                              : 1,
                          }}
                        >
                          {glyph}
                        </button>
                      ))}
                    </span>
                  )}
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontFamily: "Georgia,serif",
                      fontSize: 13.5,
                      color: T.ink,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    <b>{s.city}</b>
                    {s.why && !isNew && (
                      <span
                        style={{
                          display: "block",
                          fontSize: 11,
                          color: T.mist,
                          fontStyle: "italic",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {s.why}
                      </span>
                    )}
                    {isNew && (
                      <span
                        style={{
                          color: T.moss,
                          fontSize: 9.5,
                          fontFamily: sans,
                          fontWeight: 700,
                          marginLeft: 6,
                          letterSpacing: 0.5,
                        }}
                      >
                        NEW
                      </span>
                    )}
                  </span>
                  {readOnly ? (
                    <span
                      style={{
                        fontFamily: "Georgia,serif",
                        fontSize: 12,
                        color: T.mist,
                        flexShrink: 0,
                      }}
                    >
                      {s.nights} night{s.nights === 1 ? "" : "s"}
                    </span>
                  ) : (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        flexShrink: 0,
                      }}
                    >
                      <button
                        onClick={() => step(i, -1)}
                        disabled={s.nights <= 1}
                        aria-label={`Fewer nights in ${s.city}`}
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: RADIUS.full,
                          border: `1px solid ${T.border}`,
                          background: T.chalk,
                          color: T.ink,
                          cursor: "pointer",
                          fontSize: 13,
                          lineHeight: "18px",
                          opacity: s.nights <= 1 ? 0.3 : 1,
                        }}
                      >
                        −
                      </button>
                      <span
                        style={{
                          fontFamily: "Georgia,serif",
                          fontSize: 12,
                          color: edited || isNew ? T.ocean : T.ink,
                          minWidth: 52,
                          textAlign: "center",
                        }}
                      >
                        {s.nights} night{s.nights === 1 ? "" : "s"}
                      </span>
                      <button
                        onClick={() => step(i, 1)}
                        aria-label={`More nights in ${s.city}`}
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: RADIUS.full,
                          border: `1px solid ${T.border}`,
                          background: T.chalk,
                          color: T.ink,
                          cursor: "pointer",
                          fontSize: 13,
                          lineHeight: "18px",
                        }}
                      >
                        +
                      </button>
                      {pending.length > 1 && (
                        <button
                          onClick={() => remove(i)}
                          aria-label={`Remove ${s.city}`}
                          style={{
                            background: "none",
                            border: "none",
                            color: T.mist,
                            cursor: "pointer",
                            fontSize: 12,
                            padding: "2px 3px",
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </span>
                  )}
                </div>
                {warnKm && (
                  <div
                    style={{
                      margin: "-3px 0 7px",
                      padding: "6px 11px",
                      background: "#FEF3C7",
                      border: "1px solid #FED7AA",
                      borderRadius: RADIUS.md,
                      fontFamily: "Georgia,serif",
                      fontSize: 11.5,
                      color: "#92400E",
                    }}
                  >
                    ⚠ {s.city} is ~{warnKm} km from the rest of your route
                  </div>
                )}
              </div>
            );
          })}

          {/* Add a stop */}
          {!readOnly &&
            pending.length < MAX_STOPS &&
            (addOpen ? (
              <div
                style={{
                  border: `1px dashed ${T.mist}`,
                  borderRadius: RADIUS.md + 1,
                  padding: "9px 11px",
                  marginBottom: 7,
                  background: T.chalk,
                }}
              >
                <CityInput
                  value={addText}
                  onChange={setAddText}
                  onPick={(picked) => addStop(picked)}
                  contextHint={destinationHint}
                  openUpward
                  placeholder="City or town…"
                  inputStyle={{
                    width: "100%",
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    fontFamily: "Georgia,serif",
                    fontSize: 13.5,
                    color: T.ink,
                    boxSizing: "border-box",
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 12,
                    marginTop: 6,
                    fontFamily: "Georgia,serif",
                    fontSize: 12,
                  }}
                >
                  <button
                    onClick={() => {
                      setAddOpen(false);
                      setAddText("");
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: T.mist,
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => addStop(addText)}
                    disabled={!addText.trim()}
                    style={{
                      background: "none",
                      border: "none",
                      color: addText.trim() ? T.ocean : T.mist,
                      cursor: addText.trim() ? "pointer" : "default",
                      fontWeight: 700,
                    }}
                  >
                    Add stop
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAddOpen(true)}
                style={{
                  width: "100%",
                  border: `1px dashed ${T.mist}`,
                  borderRadius: RADIUS.md + 1,
                  padding: "10px 11px",
                  marginBottom: 7,
                  background: "transparent",
                  color: T.mist,
                  fontFamily: "Georgia,serif",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                ＋ Add a stop
              </button>
            ))}
        </div>

        {/* Footer */}
        <div style={{ padding: "8px 14px 12px", flexShrink: 0 }}>
          {dirty && !readOnly && (
            <div
              style={{
                background: T.chalk,
                border: `1px solid ${T.border}`,
                borderRadius: RADIUS.md + 1,
                padding: "7px 11px",
                marginBottom: 8,
                fontFamily: "Georgia,serif",
                fontSize: 11.5,
                color: T.mist,
              }}
              data-testid="pending-edits"
            >
              <b style={{ color: T.ink }}>
                {summaryText.split(" · ").length} edit
                {summaryText.split(" · ").length === 1 ? "" : "s"}:
              </b>{" "}
              {summaryText}
            </div>
          )}
          {readOnly ? (
            <div
              style={{
                textAlign: "center",
                fontFamily: "Georgia,serif",
                fontSize: 12.5,
                fontStyle: "italic",
                color: T.mist,
                padding: "6px 0 4px",
              }}
            >
              {readOnlyLabel ||
                "Only the trip owner can edit the route for now"}
            </div>
          ) : (
            <>
              <button
                onClick={() => {
                  if (applyDisabled) return;
                  closingRef.current = true;
                  onApply?.(
                    pending.map((s) => {
                      const clean = { ...s };
                      delete clean._new;
                      return clean;
                    }),
                    summaryText,
                  );
                }}
                disabled={applyDisabled}
                data-testid="route-apply"
                style={{
                  width: "100%",
                  padding: "12px",
                  borderRadius: RADIUS.md + 2,
                  border: "none",
                  background: applyDisabled ? T.sand : T.ocean,
                  color: applyDisabled ? T.mist : "#fff",
                  fontFamily: "'DM Serif Display',Georgia,serif",
                  fontSize: 14.5,
                  cursor: applyDisabled ? "default" : "pointer",
                  transition: `background ${MOTION.normal}`,
                }}
              >
                {applyLabel}
              </button>
              <div
                style={{
                  textAlign: "center",
                  fontFamily: "Georgia,serif",
                  fontSize: 10.5,
                  color: T.mist,
                  marginTop: 6,
                }}
              >
                {dirty
                  ? "Uses credits when you rebuild."
                  : "No changes yet — tinker freely. Uses credits when you rebuild."}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
