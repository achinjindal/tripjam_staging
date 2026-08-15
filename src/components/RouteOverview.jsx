import { useEffect, useRef, useState } from "react";
import { T, RADIUS, SHADOW, MOTION } from "../theme";
import { chainArrow } from "../routeStops.js";

/* ─── ROUTE OVERVIEW ─────────────────────────────────────────────────────
   The itinerary's table of contents: the chosen route as a segment bar
   (width ∝ nights), with per-stop day ranges derived from the actual
   generated days. Purely presentational — all data and persistence live
   in App.jsx.

   Collapse mechanics:
   - Normal flow: the full block scrolls away; a 44px strip (rendered inside
     a 0-height sticky wrapper, so it never affects layout) pins to the top
     of the scroll container once the block is out of view. Tapping the
     strip scrolls back to the top, re-revealing the block.
   - Active-trip window (initialCollapsed): only the strip renders, static,
     and tapping it expands the full block for the session.               */

export default function RouteOverview({
  pLabel,
  title,
  stops,
  ranges, // [{first, last}] 1-based day ranges, same length as stops
  initialCollapsed = false,
  scrollRootRef, // ref to the itinerary scroll container
  onSegTap, // (firstDayIdx0) => void
  onEdit,
  onExplore,
  editDisabled = false,
  editDisabledLabel = "",
  notice = null, // { text, actionLabel, onAction } — e.g. failed-rebuild retry
}) {
  const blockRef = useRef(null);
  const [stuck, setStuck] = useState(false);
  const [expandedOverride, setExpandedOverride] = useState(false);
  const collapsed = initialCollapsed && !expandedOverride;

  useEffect(() => {
    if (collapsed) return undefined;
    const el = blockRef.current;
    const root = scrollRootRef?.current || null;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting),
      { root, threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [collapsed, scrollRootRef]);

  const totalNights = (stops || []).reduce((a, s) => a + (s.nights || 0), 0);

  const strip = (interactive) => (
    <div
      role="button"
      tabIndex={0}
      aria-label="Route overview — tap to expand"
      onClick={interactive}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          interactive();
        }
      }}
      style={{
        height: 44,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 14px",
        background: T.dusk,
        color: T.warm,
        cursor: "pointer",
        boxShadow: SHADOW.md,
        fontFamily: "Georgia,serif",
        fontSize: 12.5,
        overflow: "hidden",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          background: T.gold,
          color: T.ink,
          borderRadius: RADIUS.sm,
          fontSize: 10,
          fontWeight: 700,
          padding: "1px 7px",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          flexShrink: 0,
        }}
      >
        {pLabel}
      </span>
      <span
        style={{ overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}
      >
        {chainArrow(stops)}
      </span>
    </div>
  );

  // NOTE: no wrapping div — the sticky strip must be a direct child of the
  // (tall) scroll content, or it would stop sticking at its parent's bounds.
  if (collapsed)
    return (
      <div data-testid="route-overview">
        {strip(() => setExpandedOverride(true))}
      </div>
    );
  return (
    <>
      <div
        ref={blockRef}
        data-testid="route-overview"
        style={{
          background: T.dusk,
          color: T.warm,
          padding: "12px 14px 12px",
          boxShadow: SHADOW.md,
          borderRadius: `0 0 ${RADIUS.lg}px ${RADIUS.lg}px`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "'DM Serif Display',Georgia,serif",
            fontSize: 15,
          }}
        >
          <span
            style={{
              background: T.gold,
              color: T.ink,
              borderRadius: RADIUS.sm,
              fontSize: 10,
              fontWeight: 700,
              padding: "1px 7px",
              fontFamily:
                "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            }}
          >
            {pLabel}
          </span>
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            {title}
          </span>
        </div>

        {/* Segment bar — hidden for single-stop routes (a one-segment
                table of contents is noise) */}
        {(stops || []).length > 1 && (
          <div
            style={{
              display: "flex",
              gap: 4,
              marginTop: 8,
              overflowX: "auto",
              WebkitOverflowScrolling: "touch",
            }}
          >
            {stops.map((s, i) => {
              const r = ranges?.[i];
              const dLabel = r
                ? r.first === r.last
                  ? `D${r.first}`
                  : `D${r.first}–${r.last}`
                : "";
              return (
                <button
                  key={`${s.city}-${i}`}
                  onClick={() => r && onSegTap?.(r.first - 1)}
                  aria-label={`Go to ${s.city}, day ${r?.first || ""}`}
                  style={{
                    flex: `${Math.max(1, s.nights)} 1 0`,
                    minWidth: 56,
                    background: "rgba(250,246,240,0.12)",
                    border: "none",
                    borderRadius: RADIUS.sm + 1,
                    padding: "5px 7px",
                    color: T.warm,
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "Georgia,serif",
                    transition: `background ${MOTION.normal}`,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {s.city}
                  </div>
                  <div style={{ fontSize: 9.5, color: "#8BA5BB" }}>
                    {dLabel} · {s.nights}N
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {notice && (
          <div
            style={{
              marginTop: 8,
              fontSize: 11.5,
              fontFamily: "Georgia,serif",
              color: T.gold,
            }}
          >
            {notice.text}{" "}
            {notice.actionLabel && (
              <button
                onClick={notice.onAction}
                style={{
                  background: "none",
                  border: "none",
                  color: T.warm,
                  textDecoration: "underline",
                  cursor: "pointer",
                  fontFamily: "Georgia,serif",
                  fontSize: 11.5,
                  padding: 0,
                }}
              >
                {notice.actionLabel}
              </button>
            )}
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 9,
            fontSize: 11,
            fontFamily: "Georgia,serif",
            color: "#8BA5BB",
          }}
        >
          <button
            onClick={editDisabled ? undefined : onEdit}
            disabled={editDisabled}
            aria-disabled={editDisabled}
            style={{
              background: "none",
              border: "none",
              color: editDisabled ? "#5A6E80" : T.warm,
              cursor: editDisabled ? "default" : "pointer",
              fontFamily: "Georgia,serif",
              fontSize: 11.5,
              padding: 0,
            }}
          >
            {editDisabled && editDisabledLabel
              ? editDisabledLabel
              : "✎ Edit route"}
          </button>
          <span style={{ fontSize: 10.5 }}>{totalNights} nights</span>
          <button
            onClick={onExplore}
            style={{
              background: "none",
              border: "none",
              color: "#8BA5BB",
              cursor: "pointer",
              fontFamily: "Georgia,serif",
              fontSize: 11.5,
              padding: 0,
            }}
          >
            Explore other plans →
          </button>
        </div>
      </div>

      {/* 0-height sticky wrapper — pins the collapsed strip to the top of
              the scroll container once the block above is out of view */}
      <div
        style={{
          position: "sticky",
          top: 0,
          height: 0,
          overflow: "visible",
          zIndex: 11,
        }}
      >
        <div
          style={{
            opacity: stuck ? 1 : 0,
            // visibility (not just opacity) so the inert strip is truly
            // hidden from a11y trees and hit-testing
            visibility: stuck ? "visible" : "hidden",
            pointerEvents: stuck ? "auto" : "none",
            transition: `opacity ${MOTION.normal}`,
          }}
        >
          {strip(() => {
            scrollRootRef?.current?.scrollTo({
              top: 0,
              behavior: "smooth",
            });
          })}
        </div>
      </div>
    </>
  );
}
