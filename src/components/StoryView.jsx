/* ─── STORY MODE — Design A: Swipe Gallery ──────────────────────────────
 * Magazine-style read-only itinerary view. Visual values ported from the
 * approved mockup (story-mode-design.html). Never imports DaySection /
 * ActivityCard / TransitionRow — Plan mode keeps all editing UI.
 */
import React, {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as Sentry from "@sentry/react";
import { T } from "../theme";
import {
  _fetchPhoto,
  _photoCache,
  _PHOTO_IN_FLIGHT,
  extractPlace,
  upgradePhotoUrl,
  commonsFilePageUrl,
} from "../photos";
import { supabase } from "../supabase";

/* Activities that can appear in the Story timeline (hotels + wishlist are
 * Plan-only per the approved design; transit renders as an interlude). */
const isStoryStop = (a) => a.type !== "transit" && a.type !== "hotel";

const STORY_CSS = `
.sv-root{container-type:inline-size;background:${T.bgPage};font-family:Georgia,serif;color:${T.ink};}
.sv-root img{max-width:100%;display:block;}

/* ── masthead ── */
.sv-masthead{max-width:640px;margin:0 auto;padding:44px 24px 34px;text-align:center;}
.sv-eyebrow{font-size:11px;letter-spacing:2.2px;text-transform:uppercase;color:${T.mist};}
.sv-masthead .sv-eyebrow::before,.sv-masthead .sv-eyebrow::after{content:" ✦ ";color:${T.gold};letter-spacing:0;}
.sv-masthead h1{font-family:'DM Serif Display',Georgia,serif;font-weight:400;font-size:clamp(38px,9cqw,56px);line-height:1.05;margin:10px 0 12px;text-wrap:balance;}
.sv-masthead .sv-route{font-size:14px;font-style:italic;color:${T.mist};line-height:1.5;}
.sv-masthead .sv-rule{width:54px;height:2px;background:${T.gold};margin:22px auto 0;}

/* ── day chapter ── */
.sv-day{margin:0 0 8px;}

/* ── hero ── */
.sv-hero{position:relative;height:68vh;min-height:420px;max-height:600px;overflow:hidden;background:${T.dusk};scroll-margin-top:64px;}
.sv-hero img{width:100%;height:100%;object-fit:cover;}
.sv-scrim{position:absolute;inset:0;z-index:3;pointer-events:none;background:linear-gradient(180deg,rgba(15,25,35,.28) 0%,rgba(15,25,35,0) 30%,rgba(15,25,35,0) 45%,rgba(15,25,35,.62) 82%,rgba(15,25,35,.78) 100%);}
.sv-hero-text{position:absolute;left:0;right:0;bottom:0;padding:0 24px 34px;z-index:4;pointer-events:none;}
.sv-hero-text .sv-eyebrow{color:rgba(255,255,255,0.85);text-shadow:0 1px 4px rgba(0,0,0,0.45);}
.sv-hero-text h2{font-family:'DM Serif Display',Georgia,serif;font-weight:400;font-size:clamp(34px,8.5cqw,52px);line-height:1.06;color:${T.chalk};margin-top:8px;text-wrap:balance;text-shadow:0 2px 10px rgba(0,0,0,0.45);max-width:14ch;}

/* ── swipe gallery ── */
.sv-gallery{position:absolute;inset:0;z-index:1;display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;}
.sv-gallery::-webkit-scrollbar{display:none;}
.sv-gallery:focus-visible{outline:2px solid ${T.sky};outline-offset:-2px;}
.sv-slide{flex:0 0 100%;scroll-snap-align:start;scroll-snap-stop:always;}
.sv-slide img{width:100%;height:100%;object-fit:cover;}

/* frosted chips (Magazine glass language) */
.sv-chip{display:inline-flex;align-items:center;gap:6px;font-family:Georgia,serif;font-size:11.5px;color:${T.ink};background:rgba(255,255,255,0.68);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:0;border-radius:9999px;padding:7px 13px;cursor:pointer;text-decoration:none;box-shadow:0 1px 4px rgba(0,0,0,0.18);}
.sv-chip-caption{position:absolute;top:16px;left:16px;z-index:5;pointer-events:none;font-variant-numeric:tabular-nums;}
/* top-right (M4's share chip will join it there) — bottom-right collides
   with the folio numeral straddling the sheet edge */
.sv-chip-info{position:absolute;right:16px;top:16px;z-index:5;width:26px;height:26px;justify-content:center;padding:0;font-size:13px;font-style:italic;font-family:'DM Serif Display',Georgia,serif;color:${T.dusk};opacity:0.85;}
.sv-arrow{position:absolute;top:50%;transform:translateY(-50%);z-index:5;width:36px;height:36px;justify-content:center;padding:0;font-size:18px;display:none;}
.sv-arrow-prev{left:14px;}
.sv-arrow-next{right:14px;}
@container (min-width: 900px){.sv-arrow{display:inline-flex;}}

/* ── paper sheet + folio ── */
.sv-sheet{position:relative;background:${T.warm};max-width:640px;margin:-26px auto 0;border-radius:18px 18px 0 0;padding:34px 26px 10px;box-shadow:0 -8px 30px rgba(15,25,35,0.10);}
.sv-folio{position:absolute;top:-44px;right:22px;font-family:'DM Serif Display',Georgia,serif;font-size:96px;line-height:1;color:${T.warm};text-shadow:0 4px 18px rgba(0,0,0,0.35);user-select:none;z-index:4;}
.sv-folio small{display:block;font-family:Georgia,serif;font-size:10px;letter-spacing:2.4px;text-transform:uppercase;text-align:right;color:rgba(255,255,255,0.8);margin-bottom:-6px;}

/* ── narrative ── */
.sv-narrative{font-size:16.5px;line-height:1.75;font-style:italic;color:${T.dusk};max-width:58ch;}
.sv-narrative::first-letter{font-family:'DM Serif Display',Georgia,serif;font-style:normal;font-size:54px;float:left;line-height:0.85;padding:6px 10px 0 0;color:${T.ocean};}
.sv-shimmer{height:13px;border-radius:6px;background:${T.sand};margin:9px 0;animation:svShimmer 1.4s ease-in-out infinite;}
@keyframes svShimmer{0%,100%{opacity:0.45;}50%{opacity:0.8;}}

/* ── contact-sheet timeline ── */
.sv-timeline{margin-top:26px;}
.sv-stop{display:grid;grid-template-columns:64px 1fr auto;gap:3px 14px;align-items:start;padding:14px 0;border-top:1px solid ${T.sand};}
.sv-thumb,.sv-thumb-f{width:64px;height:64px;border-radius:10px;grid-row:1 / span 3;grid-column:1;object-fit:cover;}
.sv-thumb-f{background:${T.sand};display:flex;align-items:center;justify-content:center;font-family:'DM Serif Display',Georgia,serif;font-size:24px;color:${T.mistOnDark};}
.sv-stop .sv-time{grid-column:2;margin-top:3px;font-size:11px;letter-spacing:1.4px;color:${T.mist};font-variant-numeric:tabular-nums;position:relative;padding-left:12px;}
.sv-stop .sv-time::before{content:"";position:absolute;left:0;top:50%;transform:translateY(-50%);width:5px;height:5px;border-radius:50%;background:${T.ocean};}
.sv-stop.sv-food .sv-time::before{background:${T.terra};}
.sv-stop .sv-title{grid-column:2 / 4;font-family:'DM Serif Display',Georgia,serif;font-size:18px;line-height:1.25;}
.sv-stop .sv-dur{grid-column:3;margin-top:3px;font-size:11px;color:${T.mistOnDark};letter-spacing:0.6px;white-space:nowrap;font-variant-numeric:tabular-nums;}
.sv-stop .sv-gloss{grid-column:2 / 4;font-size:13px;font-style:italic;color:${T.mist};line-height:1.55;max-width:52ch;}
.sv-stop[data-tappable]{cursor:pointer;}
.sv-stop[data-tappable]:hover .sv-title,.sv-stop.sv-active .sv-title{color:${T.ocean};}
.sv-stop.sv-active .sv-time::before{box-shadow:0 0 0 3px rgba(37,99,168,0.16);}

.sv-interlude{display:flex;align-items:center;gap:10px;padding:13px 0;border-top:1px solid ${T.sand};font-size:12.5px;color:${T.mist};letter-spacing:0.3px;}
.sv-interlude::before{content:"→";color:${T.gold};font-size:15px;}
.sv-interlude em{font-style:normal;color:${T.dusk};}
.sv-interlude .sv-fare{margin-left:auto;color:${T.mistOnDark};font-variant-numeric:tabular-nums;}

/* ── day footer ── */
.sv-dayfoot{display:flex;align-items:center;justify-content:space-between;border-top:1px solid ${T.sand};margin-top:4px;padding:16px 0 24px;}
.sv-dayfoot button{font-family:Georgia,serif;font-size:13px;color:${T.ocean};background:none;border:0;padding:0;cursor:pointer;}
.sv-dayfoot button:hover{text-decoration:underline;}

/* ── editorial no-photo cover ── */
.sv-hero.sv-editorial{background:radial-gradient(120% 90% at 15% 0%,rgba(74,144,217,0.14) 0%,rgba(74,144,217,0) 55%),linear-gradient(160deg,${T.dusk} 0%,${T.ink} 78%);height:52vh;min-height:360px;max-height:480px;}
.sv-ghost{position:absolute;top:50%;right:-12px;transform:translateY(-58%);font-family:'DM Serif Display',Georgia,serif;font-size:clamp(220px,55cqw,330px);line-height:1;color:transparent;-webkit-text-stroke:1.5px rgba(139,165,187,0.28);user-select:none;}
.sv-hero.sv-editorial .sv-hero-text{padding-bottom:40px;}
.sv-hero.sv-editorial .sv-eyebrow{color:${T.mistOnDark};text-shadow:none;}
.sv-hero.sv-editorial h2{color:${T.warm};text-shadow:none;}
.sv-goldrule{width:44px;height:2px;background:${T.gold};margin-top:16px;}

/* ── ending footer ── */
.sv-ending{max-width:640px;margin:0 auto;padding:44px 24px 80px;text-align:center;}
.sv-ending .sv-rule{width:54px;height:2px;background:${T.gold};margin:0 auto 20px;}
.sv-ending p{font-style:italic;color:${T.mist};font-size:14px;line-height:1.6;}
.sv-ending button{font-family:Georgia,serif;font-style:italic;font-size:14px;color:${T.ocean};background:none;border:0;padding:0;cursor:pointer;}
.sv-ending button:hover{text-decoration:underline;}

/* ── desktop-width panel (container ≥ 900px): magazine spreads ── */
@container (min-width: 900px){
  .sv-masthead{padding-top:64px;max-width:760px;}
  .sv-day{max-width:1180px;margin:0 auto 64px;padding:0 40px;}
  .sv-spread{display:grid;grid-template-columns:7fr 5fr;gap:0;background:${T.warm};border-radius:20px;overflow:hidden;box-shadow:0 8px 30px rgba(15,25,35,0.12);}
  .sv-day.sv-flip .sv-spread{grid-template-columns:5fr 7fr;}
  .sv-day.sv-flip .sv-hero{order:2;}
  .sv-day.sv-flip .sv-sheet{order:1;}
  .sv-hero{height:auto;min-height:620px;max-height:none;}
  .sv-hero-text h2{font-size:46px;}
  .sv-hero-text{padding:0 34px 38px;}
  .sv-sheet{margin:0;border-radius:0;box-shadow:none;padding:46px 44px 18px;display:flex;flex-direction:column;justify-content:center;max-width:none;}
  .sv-folio{position:static;order:-1;align-self:flex-end;font-size:64px;color:${T.sand};text-shadow:none;text-align:right;margin-bottom:14px;}
  .sv-folio small{color:${T.mistOnDark};}
  .sv-day.sv-flip .sv-folio{align-self:flex-start;text-align:left;}
  .sv-hero.sv-editorial{height:auto;min-height:560px;max-height:none;}
  .sv-hero.sv-editorial .sv-ghost{right:8px;}
  .sv-ending{padding-bottom:120px;}
}

/* ── motion ── */
@media (prefers-reduced-motion: no-preference){
  .sv-day,.sv-masthead{animation:svRise 0.6s ease both;}
  @keyframes svRise{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:none;}}
}
`;

/* "2026-06-12" → "THU 12 JUN" (rendered uppercase by the eyebrow style) */
function fmtStoryDate(iso) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d)) return null;
  const wd = d.toLocaleDateString("en-US", { weekday: "short" });
  const mo = d.toLocaleDateString("en-US", { month: "short" });
  return `${wd} ${d.getDate()} ${mo}`;
}

/* Resolve photos for a day's story stops. Reads activity.photo_url first,
 * then the shared _photoCache, then _fetchPhoto (same contract as PhotoStrip;
 * resolved URLs are persisted back to activities.photo_url). Fetches only
 * start once `active` is true (IntersectionObserver-gated by the caller). */
function useDayPhotos(day, active) {
  const stops = useMemo(
    () => (day.activities || []).filter(isStoryStop),
    [day.activities],
  );
  const [urls, setUrls] = useState(() => {
    const init = {};
    for (const a of stops) if (a.photo_url) init[a.id] = a.photo_url;
    return init;
  });

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const timers = [];
    stops.forEach((act) => {
      if (act.photo_url) {
        setUrls((u) =>
          u[act.id] === act.photo_url ? u : { ...u, [act.id]: act.photo_url },
        );
        return;
      }
      const key = `${extractPlace(act.title) || act.geocode}||${day.city || ""}`;
      const resolve = (src) => {
        if (!alive) return;
        setUrls((u) => ({ ...u, [act.id]: src || null }));
        if (src) {
          // Persist like PhotoStrip does (must .then() — bare supabase-js
          // builders never execute).
          supabase
            .from("activities")
            .update({ photo_url: src })
            .eq("id", act.id)
            .then(() => {});
        }
      };
      const attempt = (retriesLeft) => {
        const cached = _photoCache[key];
        if (typeof cached === "string") return resolve(cached);
        if (cached === null) return resolve(null);
        if (cached === _PHOTO_IN_FLIGHT) {
          if (retriesLeft > 0)
            timers.push(setTimeout(() => attempt(retriesLeft - 1), 2500));
          else resolve(null);
          return;
        }
        _fetchPhoto(extractPlace(act.title) || act.geocode, day.city, act.type)
          .then((src) => {
            if (src) resolve(src);
            else if (retriesLeft > 0)
              timers.push(setTimeout(() => attempt(retriesLeft - 1), 2500));
            else resolve(null);
          })
          .catch(() => resolve(null));
      };
      attempt(3);
    });
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  }, [active, stops, day.city]);

  const slides = stops
    .filter((a) => urls[a.id])
    .map((a) => ({ act: a, url: urls[a.id] }));
  const pending = active && stops.some((a) => urls[a.id] === undefined);
  return { stops, slides, pending };
}

/* A single hero slide with 1280px upgrade + graceful fallback to the stored
 * (usually 700px) URL if the upgraded bucket 404s. */
function HeroSlide({ url, alt, eager }) {
  const [src, setSrc] = useState(() => upgradePhotoUrl(url));
  useEffect(() => setSrc(upgradePhotoUrl(url)), [url]);
  return (
    <div className="sv-slide">
      <img
        src={src}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        crossOrigin="anonymous"
        onError={() => {
          if (src !== url) setSrc(url);
        }}
      />
    </div>
  );
}

function StoryHeroGallery({
  day,
  dayNumber,
  slides,
  pending,
  activeIdx,
  onSlideChange,
}) {
  const galRef = useRef(null);
  const rafRef = useRef(null);
  const title = day.story_title || day.label || `Day ${dayNumber}`;
  const eyebrow = [`Day ${dayNumber}`, day.city, fmtStoryDate(day.date)]
    .filter(Boolean)
    .join(" · ");

  // Row-tap sync: parent changes activeIdx → scroll the gallery there.
  useEffect(() => {
    const gal = galRef.current;
    if (!gal) return;
    const want = gal.clientWidth * activeIdx;
    if (Math.abs(gal.scrollLeft - want) > 4)
      gal.scrollTo({ left: want, behavior: "smooth" });
  }, [activeIdx]);

  if (!slides.length) {
    // Editorial cover once photos have settled at zero; dusk placeholder while
    // fetches are still pending (per the approved loading-state spec).
    return (
      <div className={`sv-hero${pending ? "" : " sv-editorial"}`}>
        {!pending && (
          <div className="sv-ghost">{String(dayNumber).padStart(2, "0")}</div>
        )}
        <div className="sv-hero-text">
          <div className="sv-eyebrow">{eyebrow}</div>
          <h2 style={{ color: T.warm, textShadow: "none" }}>{title}</h2>
          {!pending && <div className="sv-goldrule" />}
        </div>
      </div>
    );
  }

  const n = slides.length;
  const cur = slides[Math.min(activeIdx, n - 1)];
  const infoHref = commonsFilePageUrl(cur.url);
  const caption =
    n > 1
      ? `${Math.min(activeIdx, n - 1) + 1} / ${n} · ${cur.act.title}`
      : cur.act.title;

  const onScroll = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const gal = galRef.current;
      if (!gal || !gal.clientWidth) return;
      const i = Math.round(gal.scrollLeft / gal.clientWidth);
      if (i !== activeIdx) onSlideChange(Math.max(0, Math.min(n - 1, i)));
    });
  };
  const nudge = (dir) => {
    const gal = galRef.current;
    if (gal) gal.scrollBy({ left: dir * gal.clientWidth, behavior: "smooth" });
  };

  return (
    <div className="sv-hero">
      <div
        ref={galRef}
        className="sv-gallery"
        role="group"
        aria-roledescription="photo gallery"
        aria-label={`Photos for ${eyebrow}`}
        tabIndex={0}
        onScroll={onScroll}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            nudge(-1);
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            nudge(1);
          }
        }}
      >
        {slides.map((s, i) => (
          <HeroSlide
            key={s.act.id}
            url={s.url}
            alt={s.act.title}
            eager={i === 0}
          />
        ))}
      </div>
      <div className="sv-scrim" />
      <span className="sv-chip sv-chip-caption" aria-live="polite">
        {caption}
      </span>
      {n > 1 && (
        <>
          <button
            className="sv-chip sv-arrow sv-arrow-prev"
            aria-label="Previous photo"
            onClick={() => nudge(-1)}
          >
            ‹
          </button>
          <button
            className="sv-chip sv-arrow sv-arrow-next"
            aria-label="Next photo"
            onClick={() => nudge(1)}
          >
            ›
          </button>
        </>
      )}
      {infoHref && (
        <a
          className="sv-chip sv-chip-info"
          href={infoHref}
          target="_blank"
          rel="noreferrer"
          title="Photo credit — Wikimedia Commons"
        >
          i
        </a>
      )}
      <div className="sv-hero-text">
        <div className="sv-eyebrow">{eyebrow}</div>
        <h2>{title}</h2>
      </div>
    </div>
  );
}

function StoryTimeline({ day, slides, activeIdx, onRowTap }) {
  const slideIndexByActId = useMemo(() => {
    const map = {};
    slides.forEach((s, i) => (map[s.act.id] = i));
    return map;
  }, [slides]);

  return (
    <div className="sv-timeline">
      {(day.activities || []).map((act) => {
        if (act.type === "hotel") return null;
        if (act.type === "transit") {
          const route = [act.from_station, act.to_station]
            .filter(Boolean)
            .join(" → ");
          return (
            <div key={act.id} className="sv-interlude">
              <span>
                <em>{act.service || act.title}</em>
                {route ? ` · ${route}` : ""}
                {act.transit_duration ? ` · ${act.transit_duration}` : ""}
              </span>
              {act.cost_estimate && (
                <span className="sv-fare">{act.cost_estimate}</span>
              )}
            </div>
          );
        }
        const slideIdx = slideIndexByActId[act.id];
        const tappable = slideIdx !== undefined;
        const active = tappable && slideIdx === activeIdx;
        const thumbSrc = tappable ? slides[slideIdx].url : null;
        return (
          <div
            key={act.id}
            className={`sv-stop${act.type === "food" ? " sv-food" : ""}${active ? " sv-active" : ""}`}
            data-tappable={tappable || undefined}
            role={tappable ? "button" : undefined}
            tabIndex={tappable ? 0 : undefined}
            onClick={tappable ? () => onRowTap(slideIdx) : undefined}
            onKeyDown={
              tappable
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onRowTap(slideIdx);
                    }
                  }
                : undefined
            }
          >
            {thumbSrc ? (
              <img className="sv-thumb" src={thumbSrc} alt="" loading="lazy" />
            ) : (
              <div className="sv-thumb-f" aria-hidden="true">
                {(act.title || "?").charAt(0)}
              </div>
            )}
            {act.time && <div className="sv-time">{act.time}</div>}
            {act.duration && <div className="sv-dur">{act.duration}</div>}
            <div className="sv-title">{act.title}</div>
            {act.gloss && <div className="sv-gloss">{act.gloss}</div>}
          </div>
        );
      })}
    </div>
  );
}

function StoryDayCard({
  day,
  index,
  narrativesPending,
  onOpenPlan,
  preloadDay,
  onPhotoSwiped,
}) {
  const dayNumber = index + 1;
  const rootRef = useRef(null);
  const [near, setNear] = useState(index < 2);
  const [activeIdx, setActiveIdx] = useState(0);
  const heroWrapRef = useRef(null);

  // Photo fetches + preloadDay warm-up start when the card approaches the
  // viewport (400px margin, same rhythm as DayCompact preloading).
  useEffect(() => {
    if (near) return;
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  useEffect(() => {
    if (near && preloadDay) preloadDay(index);
  }, [near, index, preloadDay]);

  const { slides, pending } = useDayPhotos(day, near);
  const clampedIdx = Math.max(
    0,
    Math.min(activeIdx, Math.max(slides.length - 1, 0)),
  );

  const onSlideChange = useCallback(
    (i) => {
      setActiveIdx(i);
      if (onPhotoSwiped) onPhotoSwiped();
    },
    [onPhotoSwiped],
  );

  const onRowTap = useCallback((i) => {
    setActiveIdx(i);
    heroWrapRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, []);

  const narrative = day.narrative || day.description || null;

  return (
    <article
      ref={rootRef}
      className={`sv-day${index % 2 === 1 ? " sv-flip" : ""}`}
    >
      <div className="sv-spread">
        <div ref={heroWrapRef}>
          <StoryHeroGallery
            day={day}
            dayNumber={dayNumber}
            slides={slides}
            pending={pending}
            activeIdx={clampedIdx}
            onSlideChange={onSlideChange}
          />
        </div>
        <div className="sv-sheet">
          <div className="sv-folio">
            <small>Day</small>
            {String(dayNumber).padStart(2, "0")}
          </div>
          {narrative ? (
            <p className="sv-narrative">{narrative}</p>
          ) : narrativesPending ? (
            <div aria-hidden="true">
              <div className="sv-shimmer" style={{ width: "92%" }} />
              <div className="sv-shimmer" style={{ width: "84%" }} />
              <div className="sv-shimmer" style={{ width: "58%" }} />
            </div>
          ) : null}
          <StoryTimeline
            day={day}
            slides={slides}
            activeIdx={clampedIdx}
            onRowTap={onRowTap}
          />
          <div className="sv-dayfoot">
            <button onClick={() => onOpenPlan(index)}>
              Open this day in Plan →
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function StoryMasthead({ trip, days }) {
  const cities = useMemo(() => {
    const seen = [];
    for (const d of days) {
      if (d.city && !seen.includes(d.city)) seen.push(d.city);
    }
    return seen;
  }, [days]);
  // Trip names carry a " · Jun 10–Jun 17"-style date suffix — the eyebrow
  // already shows dates, so strip it from the headline.
  const title =
    (trip?.name || "").replace(/\s*·\s*[A-Z][a-z]{2}\s?\d.*$/, "").trim() ||
    trip?.name ||
    "Your trip";
  // Long trips have per-neighbourhood day.city values — cap the list and skip
  // the "N cities" claim when it would count neighbourhoods.
  const shownCities = cities.length > 4 ? [...cities.slice(0, 3), "…"] : cities;
  const route = [
    shownCities.join(" · "),
    `${days.length} day${days.length === 1 ? "" : "s"}${
      cities.length > 1 && cities.length <= 4 ? `, ${cities.length} cities` : ""
    }`,
  ]
    .filter(Boolean)
    .join(" — ");
  return (
    <section className="sv-masthead">
      <div className="sv-eyebrow">
        {trip?.dates ? `The Story · ${trip.dates}` : "The Story"}
      </div>
      <h1>{title}</h1>
      <div className="sv-route">{route}</div>
      <div className="sv-rule" />
    </section>
  );
}

class StoryErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    try {
      Sentry.captureException(error, { tags: { surface: "story-mode" } });
    } catch {}
    if (this.props.onError) this.props.onError(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/* Public component. Props:
 * - trip, days: current trip + full day list (detailed itinerary loaded)
 * - onOpenPlan(dayIndex|null): flip to Plan mode (and scroll to that day)
 * - onError(): Story crashed — parent falls back to Plan
 * - preloadDay(i): App's geocode/photo warm-up
 * - narrativesPending: backfill call in flight (shimmer instead of blank)
 * - onPhotoSwiped(): analytics hook
 */
export default function StoryView({
  trip,
  days,
  onOpenPlan,
  onError,
  preloadDay,
  narrativesPending,
  onPhotoSwiped,
}) {
  return (
    <StoryErrorBoundary onError={onError}>
      <div className="sv-root">
        <style>{STORY_CSS}</style>
        <StoryMasthead trip={trip} days={days} />
        {days.map((day, i) => (
          <StoryDayCard
            key={day.id}
            day={day}
            index={i}
            narrativesPending={narrativesPending}
            onOpenPlan={onOpenPlan}
            preloadDay={preloadDay}
            onPhotoSwiped={onPhotoSwiped}
          />
        ))}
        <div className="sv-ending">
          <div className="sv-rule" />
          <p>
            The end — for now.{" "}
            <button onClick={() => onOpenPlan(null)}>
              Switch to Plan anytime
            </button>{" "}
            to edit times, notes and bookings.
          </p>
        </div>
      </div>
    </StoryErrorBoundary>
  );
}
