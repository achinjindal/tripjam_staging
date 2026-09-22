// Place Peek — in-context "what is this place?" for route towns (RG stage).
// Bottom sheet on mobile, centered modal on desktop (house style — see
// dialogs.jsx / CreditsOverlay.jsx; no popover pattern exists in the app).
//
// Opens instantly with the town name + trip-context rows (computed locally by
// the caller); the Wikipedia summary + lead image stream in via places.js.
// Never opens empty, never dead-ends: the miss state promotes Trippy/Magazine.

import { useEffect, useState } from "react";
import posthog from "posthog-js";
import { T, RADIUS } from "./theme.js";
import { useIsDesktop } from "./hooks/useViewport.js";
import { fetchPlaceSummary } from "./places.js";

export default function PlacePeek({
  peek, // { place, kind: "base"|"day_trip", nights, context: [{label,text}], routeId }
  destination, // trip destination string for wiki disambiguation
  stopCoords = null, // [{lat,lng}] for geo-sanity
  onClose,
  onAskTrippy = null,
  onOpenMagazine = null,
}) {
  const isDesktop = useIsDesktop();
  const [summary, setSummary] = useState(undefined); // undefined=loading, null=miss

  const place = peek?.place;
  useEffect(() => {
    if (!place) return;
    let alive = true;
    setSummary(undefined);
    fetchPlaceSummary(place, destination, stopCoords).then((res) => {
      if (!alive) return;
      setSummary(res);
      posthog.capture("place_peek_result", {
        place,
        wiki_hit: !!res,
      });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!peek) return null;

  const loading = summary === undefined;
  const miss = summary === null;
  const title = (!loading && summary?.title) || place;

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onClose?.();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 3000,
        display: "flex",
        alignItems: isDesktop ? "center" : "flex-end",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`About ${place}`}
        style={{
          background: T.chalk,
          borderRadius: isDesktop ? RADIUS.lg : "20px 20px 0 0",
          padding: isDesktop
            ? "20px 22px 22px"
            : "10px 20px calc(24px + env(safe-area-inset-bottom, 0px))",
          width: "100%",
          maxWidth: 430,
          maxHeight: isDesktop ? "80vh" : "82vh",
          overflowY: "auto",
          position: "relative",
          animation: isDesktop ? undefined : "dlgSheetUp 0.2s ease",
        }}
      >
        {!isDesktop && (
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: T.border,
              margin: "0 auto 10px",
            }}
          />
        )}
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute",
            top: isDesktop ? 12 : 14,
            right: 14,
            width: 28,
            height: 28,
            borderRadius: "50%",
            border: "none",
            background: T.bgPage,
            color: T.mist,
            fontSize: 14,
            cursor: "pointer",
            lineHeight: 1,
            zIndex: 2,
          }}
        >
          ✕
        </button>

        {/* Hero — image when Wikipedia has one, shimmer while loading */}
        {loading && (
          <div
            style={{
              height: 120,
              borderRadius: RADIUS.md,
              marginBottom: 12,
              background: T.sand,
              animation: "shimmer 1.5s ease-in-out infinite",
            }}
          />
        )}
        {!loading && summary?.image && (
          <div
            style={{
              height: 128,
              borderRadius: RADIUS.md,
              marginBottom: 12,
              overflow: "hidden",
              background: T.sand,
            }}
          >
            <img
              src={summary.image}
              alt={title}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              onError={(e) => {
                e.target.parentElement.style.display = "none";
              }}
            />
          </div>
        )}

        <div
          style={{
            fontFamily: "'DM Serif Display',serif",
            fontSize: 20,
            color: T.ink,
            marginBottom: 2,
            paddingRight: 30,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 11,
            color: T.mist,
            fontFamily: "Georgia,serif",
            marginBottom: 10,
          }}
        >
          {(!loading && summary?.description) ||
            (peek.kind === "base"
              ? `Overnight base${peek.nights ? ` · ${peek.nights} night${peek.nights > 1 ? "s" : ""}` : ""}`
              : "On your route")}
        </div>

        {loading && (
          <div style={{ marginBottom: 12 }}>
            {[92, 96, 60].map((w, i) => (
              <div
                key={i}
                style={{
                  height: 11,
                  width: `${w}%`,
                  background: T.sand,
                  borderRadius: 4,
                  marginBottom: 7,
                  animation: "shimmer 1.5s ease-in-out infinite",
                }}
              />
            ))}
          </div>
        )}
        {!loading && !miss && summary.extract && (
          <>
            <div
              style={{
                fontSize: 13,
                color: T.ink,
                fontFamily: "Georgia,serif",
                lineHeight: 1.6,
                marginBottom: 6,
              }}
            >
              {summary.extract}
            </div>
            <div
              style={{
                fontSize: 10,
                color: T.mist,
                fontFamily: "Georgia,serif",
                marginBottom: 12,
              }}
            >
              From{" "}
              {summary.url ? (
                <a
                  href={summary.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: T.ocean }}
                >
                  Wikipedia
                </a>
              ) : (
                "Wikipedia"
              )}{" "}
              · CC BY-SA
            </div>
          </>
        )}
        {!loading && miss && (
          <div
            style={{
              fontSize: 13,
              color: T.mist,
              fontFamily: "Georgia,serif",
              fontStyle: "italic",
              lineHeight: 1.6,
              marginBottom: 12,
            }}
          >
            This little place keeps a low profile — no encyclopedia entry.
            Trippy and the Magazine know it, though.
          </div>
        )}

        {/* Trip context — instant, computed from the routes, no network */}
        {peek.context?.length > 0 && (
          <div
            style={{
              background: T.bgPage,
              border: `1px solid ${T.border}`,
              borderRadius: RADIUS.md,
              padding: "9px 12px",
              marginBottom: 14,
            }}
          >
            <div
              style={{
                fontSize: 9.5,
                letterSpacing: 0.6,
                color: T.mist,
                fontFamily: "Georgia,serif",
                marginBottom: 4,
              }}
            >
              ON YOUR ROUTES
            </div>
            {peek.context.map((row, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 7,
                  alignItems: "baseline",
                  marginBottom: 2,
                  fontSize: 12,
                  fontFamily: "Georgia,serif",
                  color: T.ink,
                }}
              >
                <span
                  style={{
                    background: T.dusk,
                    color: "white",
                    fontSize: 9,
                    fontWeight: 600,
                    borderRadius: 4,
                    padding: "1px 5px",
                    opacity: 0.8,
                    flexShrink: 0,
                  }}
                >
                  {row.label}
                </span>
                <span>{row.text}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          {onAskTrippy && (
            <button
              onClick={() => {
                posthog.capture("place_peek_cta", { place, cta: "trippy" });
                onClose?.();
                onAskTrippy(place);
              }}
              style={{
                flex: 1,
                background: miss ? T.ocean : "transparent",
                color: miss ? "white" : T.ocean,
                border: miss ? "none" : `1.5px solid ${T.skyBorder}`,
                borderRadius: RADIUS.md,
                padding: "10px 8px",
                fontFamily: "Georgia,serif",
                fontSize: 12.5,
                cursor: "pointer",
              }}
            >
              💬 Ask Trippy
            </button>
          )}
          {onOpenMagazine && (
            <button
              onClick={() => {
                posthog.capture("place_peek_cta", { place, cta: "magazine" });
                onClose?.();
                onOpenMagazine(place, peek.routeId);
              }}
              style={{
                flex: 1,
                background: miss ? "transparent" : T.ocean,
                color: miss ? T.ocean : "white",
                border: miss ? `1.5px solid ${T.skyBorder}` : "none",
                borderRadius: RADIUS.md,
                padding: "10px 8px",
                fontFamily: "Georgia,serif",
                fontSize: 12.5,
                cursor: "pointer",
              }}
            >
              📖 More in Magazine
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
