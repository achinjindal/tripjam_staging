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
import html2canvas from "html2canvas";
import posthog from "posthog-js";
import { T } from "../theme";
import {
  _fetchPhoto,
  _photoCache,
  _PHOTO_IN_FLIGHT,
  _usedPhotoUrls,
  extractPlace,
  fetchCityVideo,
  upgradePhotoUrl,
  commonsFilePageUrl,
  fetchPhotoAttribution,
} from "../photos";
import { supabase } from "../supabase";

/* Activities that can appear in the Story timeline. Wishlist is Plan-only;
 * transit renders as an interlude. Hotels join case-by-case: only when the
 * property has an actual photo (TripAdvisor/Google found a real shot) — no
 * photo means the hotel stays Plan-only. */
const isStoryStop = (a) =>
  a.type !== "transit" && (a.type !== "hotel" || !!a.photo_url);

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
/* top-right — bottom-right collides with the folio numeral straddling the
   sheet edge. Share chip sits left of the ⓘ credit chip. */
.sv-chip-info{position:absolute;right:16px;top:16px;z-index:5;width:26px;height:26px;justify-content:center;padding:0;font-size:13px;font-style:italic;font-family:'DM Serif Display',Georgia,serif;color:${T.dusk};opacity:0.85;}
.sv-chip-share{position:absolute;right:50px;top:16px;z-index:5;}
.sv-editorial .sv-chip-share{right:16px;}
.sv-chip-loading{position:absolute;right:16px;top:16px;z-index:5;pointer-events:none;background:rgba(255,255,255,0.16);color:rgba(255,255,255,0.85);animation:svShimmer 1.6s ease-in-out infinite;}
.sv-arrow{position:absolute;top:50%;transform:translateY(-50%);z-index:5;width:36px;height:36px;justify-content:center;padding:0;font-size:18px;display:none;}
.sv-arrow-prev{left:14px;}
.sv-arrow-next{right:14px;}
/* Mouse/trackpad users can't swipe a snap gallery — show arrows whenever a
   fine pointer is present, at any width (touch users swipe instead). */
@media (hover: hover) and (pointer: fine){.sv-arrow{display:inline-flex;}}

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
.sv-stop.sv-hotel .sv-time::before{background:${T.gold};}
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

/* ── first-view curtain: shown while the opening day's photos resolve ── */
.sv-curtain{position:relative;min-height:calc(100dvh - 170px);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px 28px;background:radial-gradient(120% 90% at 15% 0%,rgba(74,144,217,0.16) 0%,rgba(74,144,217,0) 55%),linear-gradient(160deg,${T.dusk} 0%,${T.ink} 78%);}
.sv-curtain .sv-eyebrow{color:${T.mistOnDark};}
.sv-curtain .sv-eyebrow::before,.sv-curtain .sv-eyebrow::after{content:" ✦ ";color:${T.gold};letter-spacing:0;}
.sv-curtain h2{font-family:'DM Serif Display',Georgia,serif;font-weight:400;font-size:clamp(28px,7cqw,40px);line-height:1.1;color:${T.chalk};margin:12px 0 10px;text-wrap:balance;}
.sv-curtain p{font-family:Georgia,serif;font-style:italic;font-size:13.5px;line-height:1.6;color:rgba(255,255,255,0.75);max-width:40ch;}
.sv-curtain svg{width:min(320px,80%);height:56px;margin-top:26px;}
@keyframes svCurtainDash{to{stroke-dashoffset:-26;}}
@keyframes svCurtainDot{0%,100%{opacity:0.45;}50%{opacity:1;}}
@media (prefers-reduced-motion: reduce){.sv-curtain svg *{animation:none !important;}}

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

/* ── story frame (player frames + share card share this composition) ── */
.sv-frame{position:relative;width:100%;height:100%;overflow:hidden;background:${T.dusk};}
.sv-frame img.sv-frame-photo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}
.sv-frame .sv-frame-scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(15,25,35,.42) 0%,rgba(15,25,35,.06) 26%,rgba(15,25,35,.06) 44%,rgba(15,25,35,.66) 74%,rgba(15,25,35,.88) 100%);}
.sv-frame.sv-frame-editorial{background:radial-gradient(120% 90% at 15% 0%,rgba(74,144,217,0.16) 0%,rgba(74,144,217,0) 55%),linear-gradient(160deg,${T.dusk} 0%,${T.ink} 78%);}
.sv-frame .sv-frame-ghost{position:absolute;top:42%;right:-14px;transform:translateY(-50%);font-family:'DM Serif Display',Georgia,serif;font-size:min(56cqw,300px);line-height:1;color:transparent;-webkit-text-stroke:1.5px rgba(139,165,187,0.26);user-select:none;}
.sv-frame .sv-frame-topmark{position:absolute;top:26px;left:0;right:0;text-align:center;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.75);text-shadow:0 1px 4px rgba(0,0,0,0.4);}
.sv-frame .sv-frame-topmark::before,.sv-frame .sv-frame-topmark::after{content:" ✦ ";color:${T.gold};letter-spacing:0;}
.sv-frame .sv-frame-content{position:absolute;left:0;right:0;bottom:0;padding:0 26px 40px;}
.sv-frame.sv-frame-card .sv-frame-content{padding-bottom:70px;}
.sv-frame .sv-frame-eyebrow{font-size:11px;letter-spacing:2.4px;text-transform:uppercase;color:rgba(255,255,255,0.85);text-shadow:0 1px 4px rgba(0,0,0,0.4);}
.sv-frame h2{font-family:'DM Serif Display',Georgia,serif;font-weight:400;font-size:clamp(30px,9cqw,44px);line-height:1.06;color:${T.chalk};margin:8px 0 12px;text-wrap:balance;text-shadow:0 2px 12px rgba(0,0,0,0.45);}
.sv-frame .sv-frame-body{font-size:14.5px;font-style:italic;line-height:1.65;color:rgba(255,255,255,0.9);max-width:48ch;text-shadow:0 1px 6px rgba(0,0,0,0.5);}
.sv-frame .sv-frame-note{font-size:13px;line-height:1.6;color:rgba(255,255,255,0.72);max-width:48ch;margin-top:8px;text-shadow:0 1px 6px rgba(0,0,0,0.5);}
.sv-frame .sv-frame-time{display:inline-flex;margin-top:12px;font-size:10px;letter-spacing:1.8px;color:rgba(255,255,255,0.75);border:1px solid rgba(255,255,255,0.35);border-radius:9999px;padding:4px 12px;font-variant-numeric:tabular-nums;}
.sv-frame .sv-frame-rule{width:40px;height:2px;background:${T.gold};margin:14px 0;}
.sv-frame .sv-frame-foot{display:flex;align-items:baseline;justify-content:space-between;gap:10px;}
.sv-frame .sv-frame-wordmark{font-family:'DM Serif Display',Georgia,serif;font-size:17px;color:${T.chalk};letter-spacing:0.3px;}
.sv-frame .sv-frame-wordmark span{color:${T.sky};}
.sv-frame .sv-frame-credit{font-size:8.5px;letter-spacing:0.4px;color:rgba(255,255,255,0.55);text-align:right;line-height:1.5;}

/* ── full-screen player ── */
.sv-player{position:fixed;inset:0;z-index:1000;background:${T.ink};container-type:size;touch-action:none;}
.sv-player:focus{outline:none;}
.sv-player .sv-progress{position:absolute;top:calc(10px + env(safe-area-inset-top,0px));left:14px;right:14px;display:flex;gap:4px;z-index:6;}
.sv-player .sv-seg{flex:1;height:2.5px;border-radius:2px;background:rgba(255,255,255,0.3);overflow:hidden;}
.sv-player .sv-seg.sv-done{background:rgba(255,255,255,0.9);}
.sv-player .sv-seg .sv-seg-fill{display:block;height:100%;width:0;background:#fff;border-radius:2px;}
.sv-player .sv-seg.sv-on .sv-seg-fill{animation:svSegFill linear both;animation-duration:var(--dur);}
.sv-player.sv-paused .sv-seg .sv-seg-fill{animation-play-state:paused;}
@keyframes svSegFill{from{width:0;}to{width:100%;}}
@media (prefers-reduced-motion: reduce){.sv-player .sv-seg.sv-on .sv-seg-fill{animation:none;width:40%;}}
.sv-player .sv-player-chips{position:absolute;top:calc(24px + env(safe-area-inset-top,0px));right:14px;z-index:6;display:flex;gap:8px;}
.sv-player .sv-chip{font-size:11.5px;}

/* ── offscreen share card stage (1080×1920 at 2x) ── */
.sv-share-stage{position:fixed;left:-10000px;top:0;width:540px;height:960px;z-index:-1;pointer-events:none;}

.sv-play-chip{display:inline-flex;align-items:center;gap:7px;margin-top:22px;font-family:Georgia,serif;font-size:12px;letter-spacing:0.8px;color:${T.warm};background:${T.ink};border:0;border-radius:9999px;padding:9px 20px;cursor:pointer;box-shadow:0 2px 8px rgba(15,25,35,0.25);}
.sv-play-chip:hover{background:${T.dusk};}

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

/* Trip title + route line, shared by the masthead and the player cover frame.
 * Trip names carry a " · Jun 10–Jun 17"-style date suffix — the eyebrow
 * already shows dates, so strip it from the headline. */
function deriveMasthead(trip, days) {
  const cities = [];
  for (const d of days)
    if (d.city && !cities.includes(d.city)) cities.push(d.city);
  const title =
    (trip?.name || "").replace(/\s*·\s*[A-Z][a-z]{2}\s?\d.*$/, "").trim() ||
    trip?.name ||
    "Your trip";
  const shownCities = cities.length > 4 ? [...cities.slice(0, 3), "…"] : cities;
  const route = [
    shownCities.join(" · "),
    `${days.length} day${days.length === 1 ? "" : "s"}${
      cities.length > 1 && cities.length <= 4 ? `, ${cities.length} cities` : ""
    }`,
  ]
    .filter(Boolean)
    .join(" — ");
  return { title, route };
}

/* Share-card only: cut at the last complete sentence within `max` chars.
 * The full-screen player never truncates. */
function truncAtSentence(text, max = 180) {
  if (!text || text.length <= max) return text || "";
  const head = text.slice(0, max);
  const lastEnd = Math.max(
    head.lastIndexOf(". "),
    head.lastIndexOf("! "),
    head.lastIndexOf("? "),
  );
  if (lastEnd > 40) return head.slice(0, lastEnd + 1);
  return `${head.slice(0, head.lastIndexOf(" "))}…`;
}

/* First photo for a day's cover frame — mirrors the hero's slide-1 rule
 * (a destination shot leads; the hotel photo only if nothing else). */
function dayCoverPhoto(day) {
  const stops = (day.activities || []).filter(isStoryStop);
  const nonHotel = stops.find((a) => a.type !== "hotel" && a.photo_url);
  return (nonHotel || stops.find((a) => a.photo_url))?.photo_url || null;
}

/* The player's frame list: trip cover → per day: day cover + one frame per
 * story stop → ending. Photo-less stops still get a frame (editorial dusk
 * background with title + gloss + note) — the play-through covers every
 * moment of the plan, not just the photogenic ones. Hotels keep their
 * photo-only rule: a hotel without a photo stays Plan-only entirely. */
function buildFrames(trip, days) {
  const frames = [{ type: "cover", key: "cover" }];
  days.forEach((day, i) => {
    frames.push({
      type: "day",
      key: `day-${day.id}`,
      day,
      dayNumber: i + 1,
      photoUrl: dayCoverPhoto(day),
    });
    for (const act of (day.activities || []).filter(isStoryStop)) {
      frames.push({
        type: "activity",
        key: `act-${act.id}`,
        day,
        dayNumber: i + 1,
        act,
        photoUrl: act.photo_url || null,
      });
    }
  });
  frames.push({ type: "end", key: "end" });
  return frames;
}

/* Auto-advance time scales with how much there is to read (~200wpm + base). */
function frameDuration(frame) {
  const text =
    frame.type === "day"
      ? frame.day.narrative || frame.day.description || ""
      : frame.type === "activity"
        ? `${frame.act.gloss || ""} ${frame.act.note || ""}`
        : "";
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.min(15000, 4000 + words * 280);
}

/* Staged-fallback story image: 1280px upgrade (CORS) -> stored URL (CORS)
 * -> stored URL without crossOrigin (TripAdvisor CDN sends no ACAO header,
 * so CORS-mode loads hard-fail even when the image is fine; share-card
 * export skips tainted canvases) -> null, never a broken-image glyph. */
function StoryImg({ className, url, alt = "", eager = false, onDead }) {
  const [stage, setStage] = useState(0);
  useEffect(() => setStage(0), [url]);
  if (!url) return null;
  const upgraded = upgradePhotoUrl(url);
  if (stage >= 3) return null;
  const srcNow = stage === 0 ? upgraded : url;
  const noCors = stage >= 2;
  return (
    <img
      key={`${noCors ? "nc" : "c"}:${srcNow}`}
      className={className}
      src={srcNow}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      {...(noCors ? {} : { crossOrigin: "anonymous" })}
      onError={() =>
        setStage((s) => {
          const next = s === 0 && upgraded === url ? 2 : s + 1;
          if (next >= 3) onDead?.();
          return next;
        })
      }
    />
  );
}

/* One story frame. `variant`: "player" (full info, no credit) or "card"
 * (share export: truncated narrative, wordmark + Commons credit). */
function StoryFrameContent({ frame, trip, days, variant, credit }) {
  const isCard = variant === "card";
  const src = frame.photoUrl ? upgradePhotoUrl(frame.photoUrl) : null;
  const editorial = !src;
  const foot = isCard && (
    <div className="sv-frame-foot">
      <div className="sv-frame-wordmark">
        Trip<span>Jam</span>
      </div>
      {credit && (
        <div className="sv-frame-credit">
          {credit}
          <br />
          via Wikimedia Commons
        </div>
      )}
    </div>
  );
  let body;
  if (frame.type === "cover") {
    const { title, route } = deriveMasthead(trip, days);
    body = (
      <>
        <div className="sv-frame-eyebrow">
          {trip?.dates ? `The Story · ${trip.dates}` : "The Story"}
        </div>
        <h2>{title}</h2>
        <div className="sv-frame-body">{route}</div>
        <div className="sv-frame-rule" />
        {foot}
      </>
    );
  } else if (frame.type === "day") {
    const { day, dayNumber } = frame;
    const eyebrow = [`Day ${dayNumber}`, day.city, fmtStoryDate(day.date)]
      .filter(Boolean)
      .join(" · ");
    const narrative = day.narrative || day.description || "";
    body = (
      <>
        <div className="sv-frame-eyebrow">{eyebrow}</div>
        <h2>{day.story_title || day.label || `Day ${dayNumber}`}</h2>
        {narrative && (
          <div className="sv-frame-body">
            {isCard ? truncAtSentence(narrative) : narrative}
          </div>
        )}
        <div className="sv-frame-rule" />
        {foot}
      </>
    );
  } else if (frame.type === "activity") {
    const { act, day, dayNumber } = frame;
    body = (
      <>
        <div className="sv-frame-eyebrow">
          {[`Day ${dayNumber}`, day.city].filter(Boolean).join(" · ")}
        </div>
        <h2>{act.title}</h2>
        {act.gloss && <div className="sv-frame-body">{act.gloss}</div>}
        {!isCard && act.note && <div className="sv-frame-note">{act.note}</div>}
        {!isCard && (act.time || act.duration) && (
          <div className="sv-frame-time">
            {[act.time, act.duration].filter(Boolean).join(" · ")}
          </div>
        )}
        {isCard && <div className="sv-frame-rule" />}
        {foot}
      </>
    );
  } else {
    const { title } = deriveMasthead(trip, days);
    body = (
      <>
        <div className="sv-frame-eyebrow">The end — for now</div>
        <h2>{title}</h2>
        <div className="sv-frame-body">
          Planned with TripJam — swipe down to keep browsing the story.
        </div>
        <div className="sv-frame-rule" />
        {foot}
      </>
    );
  }
  return (
    <div
      className={`sv-frame${editorial ? " sv-frame-editorial" : ""}${isCard ? " sv-frame-card" : ""}`}
    >
      {src && <StoryImg className="sv-frame-photo" url={frame.photoUrl} />}
      <div className="sv-frame-scrim" />
      {editorial && frame.type === "day" && (
        <div className="sv-frame-ghost">
          {String(frame.dayNumber).padStart(2, "0")}
        </div>
      )}
      <div className="sv-frame-topmark">The Story</div>
      <div className="sv-frame-content">{body}</div>
    </div>
  );
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Full-screen story player. IG mechanics: tap right/left = next/back, hold to
 * pause, swipe down / Esc / ✕ to exit, segmented progress per day chapter,
 * auto-advance scaled to reading time (off under reduced motion). */
function StoryPlayer({ trip, days, startIndex = 0, onClose, onShareFrame }) {
  const frames = useMemo(() => buildFrames(trip, days), [trip, days]);
  const [idx, setIdx] = useState(Math.min(startIndex, frames.length - 1));
  const [paused, setPaused] = useState(prefersReducedMotion());
  const rootRef = useRef(null);
  const holdRef = useRef({ timer: null, held: false });
  const touchRef = useRef(null);
  const closedRef = useRef(false);
  const frame = frames[idx];

  const close = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    onClose(frames[idx]);
  }, [onClose, frames, idx]);

  const step = useCallback(
    (dir) => {
      setIdx((i) => {
        const n = i + dir;
        if (n >= frames.length) {
          close();
          return i;
        }
        return Math.max(0, n);
      });
    },
    [frames.length, close],
  );

  // Auto-advance
  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => step(1), frameDuration(frame));
    return () => clearTimeout(t);
  }, [idx, paused, frame, step]);

  // Focus, Esc/arrows, Android back (one history entry)
  useEffect(() => {
    rootRef.current?.focus();
    window.history.pushState({ svPlayer: 1 }, "");
    const onPop = () => {
      if (!closedRef.current) {
        closedRef.current = true;
        onClose(null);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (closedRef.current && window.history.state?.svPlayer)
        window.history.back();
    };
  }, []);

  // Chapter = frames sharing this frame's day (cover/end stand alone)
  const chapter = useMemo(() => {
    const sameChapter = (f) =>
      frame.type === "cover" || frame.type === "end"
        ? f.type === frame.type
        : f.day?.id === frame.day?.id;
    const members = frames.filter(sameChapter);
    return { members, pos: members.indexOf(frame) };
  }, [frames, frame]);

  const onPointerDown = () => {
    holdRef.current.held = false;
    holdRef.current.timer = setTimeout(() => {
      holdRef.current.held = true;
      setPaused(true);
    }, 260);
  };
  const onPointerUp = (e) => {
    clearTimeout(holdRef.current.timer);
    if (holdRef.current.held) {
      setPaused(prefersReducedMotion());
      return;
    }
    const rect = rootRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    step(x < 0.34 ? -1 : 1);
  };

  return (
    <div
      ref={rootRef}
      className={`sv-player${paused ? " sv-paused" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Trip story player"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
        else if (e.key === "ArrowRight") step(1);
        else if (e.key === "ArrowLeft") step(-1);
        else if (e.key === " ") {
          e.preventDefault();
          setPaused((p) => !p);
        }
      }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onTouchStart={(e) => {
        touchRef.current = e.touches[0]?.clientY ?? null;
      }}
      onTouchMove={(e) => {
        const y0 = touchRef.current;
        if (y0 != null && (e.touches[0]?.clientY ?? y0) - y0 > 80) {
          touchRef.current = null;
          close();
        }
      }}
    >
      <StoryFrameContent
        key={frame.key}
        frame={frame}
        trip={trip}
        days={days}
        variant="player"
      />
      <div className="sv-progress" aria-hidden="true">
        {chapter.members.map((f, i) => (
          <div
            key={f.key}
            className={`sv-seg${i < chapter.pos ? " sv-done" : i === chapter.pos ? " sv-on" : ""}`}
          >
            <span
              className="sv-seg-fill"
              style={
                i === chapter.pos
                  ? { "--dur": `${frameDuration(frame)}ms` }
                  : undefined
              }
            />
          </div>
        ))}
      </div>
      <div className="sv-player-chips">
        <button
          className="sv-chip"
          onClick={(e) => {
            e.stopPropagation();
            onShareFrame(frame);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        >
          ↗ Share
        </button>
        <button
          className="sv-chip"
          aria-label="Close story player"
          onClick={(e) => {
            e.stopPropagation();
            close();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        >
          ✕
        </button>
      </div>
      <span
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
        }}
        aria-live="polite"
      >
        {frame.type === "day"
          ? `Day ${frame.dayNumber}: ${frame.day.story_title || ""}`
          : frame.type === "activity"
            ? frame.act.title
            : ""}
      </span>
    </div>
  );
}

/* Resolve photos for a day's story stops. Reads activity.photo_url first,
 * then the shared _photoCache, then _fetchPhoto (same contract as PhotoStrip;
 * resolved URLs are persisted back to activities.photo_url). Fetches only
 * start once `active` is true (IntersectionObserver-gated by the caller).
 * `photoOwner` maps each stored URL to the first activity (trip-wide,
 * chronological) that carries it — later duplicates lose the slide and try to
 * fetch a distinct photo instead (which also heals the stored duplicate). */
function useDayPhotos(day, active, photoOwner, claimRef) {
  // City b-roll for the lead slide. Data discipline: skipped entirely on
  // data-saver connections and for reduced-motion users.
  const [cityVideo, setCityVideo] = useState(undefined);
  useEffect(() => {
    let alive = true;
    if (!active || !day.city) return undefined;
    const conn = navigator.connection;
    if (
      conn?.saveData ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
    ) {
      setCityVideo(null);
      return undefined;
    }
    fetchCityVideo(day.city).then((v) => {
      if (alive) setCityVideo(v || null);
    });
    return () => {
      alive = false;
    };
  }, [active, day.city]);

  const stops = useMemo(
    () => (day.activities || []).filter(isStoryStop),
    [day.activities],
  );
  const ownsStored = (a) =>
    a.photo_url && (!photoOwner || photoOwner.get(a.photo_url) === a.id);
  // A URL is off-limits when a *different* activity owns it — either stored in
  // the DB (photoOwner) or claimed during this session (claimRef). The global
  // _usedPhotoUrls set can't arbitrate here: preloadDay/PhotoStrip register
  // every URL they warm, including ones destined for this very activity.
  const claimedByOther = (url, actId) => {
    const stored = photoOwner?.get(url);
    if (stored && stored !== actId) return true;
    const session = claimRef?.current?.get(url);
    return !!session && session !== actId;
  };
  const claim = (url, actId) => {
    if (claimRef?.current && !claimRef.current.has(url))
      claimRef.current.set(url, actId);
  };
  const [urls, setUrls] = useState(() => {
    const init = {};
    for (const a of stops) if (ownsStored(a)) init[a.id] = a.photo_url;
    return init;
  });

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const timers = [];
    stops.forEach((act) => {
      if (ownsStored(act)) {
        claim(act.photo_url, act.id);
        setUrls((u) =>
          u[act.id] === act.photo_url ? u : { ...u, [act.id]: act.photo_url },
        );
        return;
      }
      // Hotels only ever use their stored photo — a duplicate hotel shot
      // (e.g. dinner at the same property already claimed it) just drops out.
      if (act.type === "hotel") {
        setUrls((u) => ({ ...u, [act.id]: null }));
        return;
      }
      const key = `${extractPlace(act.title) || act.geocode}||${day.city || ""}`;
      const resolve = (src) => {
        if (!alive) return;
        setUrls((u) => ({ ...u, [act.id]: src || null }));
        if (src) {
          _usedPhotoUrls.add(src);
          // Persist like PhotoStrip does (must .then() — bare supabase-js
          // builders never execute). Also overwrites a duplicate stored URL
          // with the freshly-found distinct one.
          supabase
            .from("activities")
            .update({ photo_url: src })
            .eq("id", act.id)
            .then(() => {});
        }
      };
      const attempt = (retriesLeft) => {
        const cached = _photoCache[key];
        if (typeof cached === "string") {
          if (claimedByOther(cached, act.id)) return resolve(null);
          claim(cached, act.id);
          return resolve(cached);
        }
        if (cached === null) return resolve(null);
        if (cached === _PHOTO_IN_FLIGHT) {
          if (retriesLeft > 0)
            timers.push(setTimeout(() => attempt(retriesLeft - 1), 2500));
          else resolve(null);
          return;
        }
        _fetchPhoto(
          extractPlace(act.title) || act.geocode,
          day.city,
          act.type,
          undefined,
          { lat: act.lat, lng: act.lng, photoQuery: act.photo_query },
        )
          .then((src) => {
            if (src && !claimedByOther(src, act.id)) {
              claim(src, act.id);
              resolve(src);
            } else if (retriesLeft > 0)
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
  }, [active, stops, day.city, photoOwner]);

  let slides = stops
    .filter((a) => urls[a.id])
    .map((a) => ({ act: a, url: urls[a.id] }));
  // A hotel never opens the day — the hero must be a destination shot. With
  // alternatives it demotes to slide 2; alone (hotel photos load instantly
  // from TripAdvisor while wiki photos trickle in) it's held out of the
  // gallery entirely, and the timeline keeps its thumbnail.
  if (slides.length > 1 && slides[0].act.type === "hotel") {
    const [hotel] = slides.splice(0, 1);
    slides.splice(1, 0, hotel);
  } else if (slides.length === 1 && slides[0].act.type === "hotel") {
    slides = [];
  }
  // The day opens on motion when we have it — muted looping b-roll of the
  // base city, with the photo gallery behind it.
  if (cityVideo?.videoUrl) {
    slides = [
      {
        video: true,
        url: cityVideo.videoUrl,
        poster: cityVideo.posterUrl,
        act: { id: `__video_${day.id}`, title: day.city, type: "video" },
      },
      ...slides,
    ];
  }
  const pending = active && stops.some((a) => urls[a.id] === undefined);
  return { stops, slides, pending };
}

/* A single hero slide with 1280px upgrade + graceful fallback to the stored
 * (usually 700px) URL if the upgraded bucket 404s. */
/* Muted looping b-roll slide. Only the visible slide plays; a load failure
 * falls back to the poster image, then to the editorial gradient. */
function VideoSlide({ url, poster, playing, eager }) {
  const ref = useRef(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (playing) v.play().catch(() => {});
    else v.pause();
  }, [playing, failed]);
  if (failed) {
    return (
      <div
        className="sv-slide"
        style={
          poster
            ? undefined
            : {
                background:
                  "linear-gradient(160deg,#1E2D3D 0%,#172331 60%,#2563A8 130%)",
              }
        }
      >
        {poster && <StoryImg url={poster} alt="" eager={eager} />}
      </div>
    );
  }
  return (
    <div className="sv-slide">
      <video
        ref={ref}
        src={url}
        poster={poster || undefined}
        muted
        loop
        playsInline
        autoPlay={eager}
        preload={eager ? "auto" : "metadata"}
        onError={() => setFailed(true)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
        }}
      />
    </div>
  );
}

function HeroSlide({ url, alt, eager }) {
  const [dead, setDead] = useState(false);
  useEffect(() => setDead(false), [url]);
  return (
    <div
      className="sv-slide"
      style={
        dead
          ? {
              background:
                "linear-gradient(160deg,#1E2D3D 0%,#172331 60%,#2563A8 130%)",
            }
          : undefined
      }
    >
      {!dead && (
        <StoryImg
          url={url}
          alt={alt}
          eager={eager}
          onDead={() => setDead(true)}
        />
      )}
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
  onShare,
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
      <div className="sv-hero sv-editorial">
        <div className="sv-ghost">{String(dayNumber).padStart(2, "0")}</div>
        {pending ? (
          <span className="sv-chip sv-chip-loading" aria-hidden="true">
            ✦&nbsp;finding photos…
          </span>
        ) : null}
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
        {slides.map((s, i) =>
          s.video ? (
            <VideoSlide
              key={s.act.id}
              url={s.url}
              poster={s.poster}
              playing={i === activeIdx}
              eager={i === 0}
            />
          ) : (
            <HeroSlide
              key={s.act.id}
              url={s.url}
              alt={s.act.title}
              eager={i === 0}
            />
          ),
        )}
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
        // Hotels appear when the property has a real photo — as a tappable
        // row when it earned a gallery slide, thumbnail-only otherwise (e.g.
        // the hotel is the day's lone photo and is held out of the hero).
        if (act.type === "hotel" && !act.photo_url) return null;
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
        const thumbSrc = tappable
          ? slides[slideIdx].url
          : act.type === "hotel"
            ? act.photo_url
            : null;
        return (
          <div
            key={act.id}
            className={`sv-stop${act.type === "food" ? " sv-food" : ""}${act.type === "hotel" ? " sv-hotel" : ""}${active ? " sv-active" : ""}`}
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
              <img
                className="sv-thumb"
                src={thumbSrc}
                alt=""
                loading="lazy"
                onError={(e) => {
                  e.target.style.visibility = "hidden";
                }}
              />
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
  onShareDay,
  preloadDay,
  onPhotoSwiped,
  photoOwner,
  claimRef,
  onFirstDaySettled,
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

  const { slides, pending } = useDayPhotos(day, near, photoOwner, claimRef);
  const clampedIdx = Math.max(
    0,
    Math.min(activeIdx, Math.max(slides.length - 1, 0)),
  );

  // First-view curtain: tell the parent when the opening day's photos have
  // settled (every stop resolved to a URL or a definitive miss)
  useEffect(() => {
    if (index === 0 && near && !pending && onFirstDaySettled)
      onFirstDaySettled();
  }, [index, near, pending, onFirstDaySettled]);

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
            onShare={(slide) => onShareDay(day, dayNumber, slide)}
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

function StoryMasthead({ trip, days, onPlay }) {
  const { title, route } = deriveMasthead(trip, days);
  return (
    <section className="sv-masthead">
      <div className="sv-eyebrow">
        {trip?.dates ? `The Story · ${trip.dates}` : "The Story"}
      </div>
      <h1>{title}</h1>
      <div className="sv-route">{route}</div>
      <div className="sv-rule" />
      <button className="sv-play-chip" onClick={onPlay}>
        ▶&nbsp; Play the story
      </button>
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
  // First activity (trip-wide, chronological) owns each stored photo URL —
  // duplicates further down lose their slide and re-fetch a distinct photo.
  const photoOwner = useMemo(() => {
    const owner = new Map();
    for (const d of days)
      for (const a of d.activities || [])
        if (a.photo_url && !owner.has(a.photo_url))
          owner.set(a.photo_url, a.id);
    return owner;
  }, [days]);
  // Session-level claims for freshly fetched URLs (url → activity id)
  const claimRef = useRef(new Map());

  const [playerOpen, setPlayerOpen] = useState(false);
  // {frame, credit, editorialFallback} while a share render is in flight
  const [shareJob, setShareJob] = useState(null);
  const shareStageRef = useRef(null);

  // First-view curtain: the opening view must be impressive, so when the
  // first day still lacks photos we hold the reveal behind an editorial
  // loading panel until its fetches settle (hard cap below — never hang).
  // Trips whose day 1 is already photographed skip the curtain entirely.
  const [curtain, setCurtain] = useState(() => {
    const d0 = days[0];
    return (d0?.activities || []).some(
      (a) => isStoryStop(a) && a.type !== "hotel" && !a.photo_url,
    );
  });
  useEffect(() => {
    if (!curtain) return;
    const t = setTimeout(() => setCurtain(false), 8000);
    return () => clearTimeout(t);
  }, [curtain]);
  const onFirstDaySettled = useCallback(() => setCurtain(false), []);

  const openPlayer = () => {
    setPlayerOpen(true);
    posthog.capture("story_player_opened", {
      trip_id: trip?.id,
      num_days: days.length,
    });
  };

  // M4: share a frame — rasterize the offscreen 540×960 stage at 2× to a
  // 1080×1920 PNG, then native share sheet (or download on desktop).
  const shareFrame = async (frame) => {
    if (shareJob) return;
    let credit = null;
    if (frame.photoUrl) {
      try {
        credit = await fetchPhotoAttribution(frame.photoUrl);
      } catch {}
    }
    setShareJob({ frame, credit });
  };
  const shareDay = (day, dayNumber, slide) =>
    shareFrame({
      type: "day",
      key: `share-${day.id}`,
      day,
      dayNumber,
      photoUrl: slide?.url || dayCoverPhoto(day),
    });

  useEffect(() => {
    if (!shareJob) return;
    let cancelled = false;
    (async () => {
      const node = shareStageRef.current;
      if (!node) return setShareJob(null);
      // Let the frame paint, then wait for its images.
      await new Promise((r) => setTimeout(r, 150));
      const imgs = [...node.querySelectorAll("img")];
      await Promise.all(
        imgs.map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise((r) => {
                img.onload = r;
                img.onerror = r;
              }),
        ),
      );
      try {
        const canvas = await html2canvas(node, {
          scale: 2,
          useCORS: true,
          backgroundColor: null,
        });
        const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
        if (!blob) throw new Error("rasterize produced no blob");
        if (cancelled) return;
        const file = new File(
          [blob],
          `tripjam-day-${shareJob.frame.dayNumber || "story"}.png`,
          { type: "image/png" },
        );
        let shared = false;
        if (
          typeof navigator.canShare === "function" &&
          navigator.canShare({ files: [file] })
        ) {
          try {
            await navigator.share({ files: [file] });
            shared = true;
          } catch (e) {
            if (e?.name === "AbortError") shared = true; // user closed sheet
          }
        }
        if (!shared) {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = file.name;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        }
        posthog.capture("story_day_shared", {
          trip_id: trip?.id,
          frame_type: shareJob.frame.type,
          editorial: !shareJob.frame.photoUrl,
        });
        setShareJob(null);
      } catch (err) {
        console.warn("share-card rasterize failed:", err?.message);
        if (!cancelled) {
          if (shareJob.frame.photoUrl && !shareJob.editorialFallback) {
            // Retry once as the guaranteed editorial (gradient-only) card
            setShareJob({
              frame: { ...shareJob.frame, photoUrl: null },
              credit: null,
              editorialFallback: true,
            });
          } else {
            setShareJob(null);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shareJob]);

  const { title: curtainTitle } = deriveMasthead(trip, days);
  return (
    <StoryErrorBoundary onError={onError}>
      <div className="sv-root">
        <style>{STORY_CSS}</style>
        {curtain && (
          <div className="sv-curtain" role="status" aria-live="polite">
            <div className="sv-eyebrow">The Story</div>
            <h2>Setting the scene…</h2>
            <p>
              Gathering the photographs for {curtainTitle} — just a few seconds.
            </p>
            <svg viewBox="0 0 320 64" aria-hidden="true">
              <path
                d="M 26 46 C 60 16, 90 42, 124 20 S 190 58, 216 50 S 275 20, 294 26"
                fill="none"
                stroke={T.gold}
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeDasharray="7 6"
                style={{ animation: "svCurtainDash 1.1s linear infinite" }}
              />
              {[26, 124, 216, 294].map((x, i) => (
                <circle
                  key={x}
                  cx={x}
                  cy={[46, 20, 50, 26][i]}
                  r="3.5"
                  fill={T.chalk}
                  style={{
                    animation: `svCurtainDot 2.2s ease-in-out ${i * 0.4}s infinite`,
                  }}
                />
              ))}
            </svg>
          </div>
        )}
        <div style={curtain ? { display: "none" } : undefined}>
          <StoryMasthead trip={trip} days={days} onPlay={openPlayer} />
          {days.map((day, i) => (
            <StoryDayCard
              key={day.id}
              day={day}
              index={i}
              narrativesPending={narrativesPending}
              onOpenPlan={onOpenPlan}
              onShareDay={shareDay}
              preloadDay={preloadDay}
              onPhotoSwiped={onPhotoSwiped}
              photoOwner={photoOwner}
              claimRef={claimRef}
              onFirstDaySettled={onFirstDaySettled}
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
        {playerOpen && (
          <StoryPlayer
            trip={trip}
            days={days}
            onClose={() => setPlayerOpen(false)}
            onShareFrame={shareFrame}
          />
        )}
        {shareJob && (
          <div
            className="sv-share-stage"
            ref={shareStageRef}
            aria-hidden="true"
          >
            <StoryFrameContent
              frame={shareJob.frame}
              trip={trip}
              days={days}
              variant="card"
              credit={shareJob.credit}
            />
          </div>
        )}
      </div>
    </StoryErrorBoundary>
  );
}
