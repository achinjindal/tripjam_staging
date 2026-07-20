# Itinerary "Story Mode" — Redesign Plan (backlog)

Status: **Planned, not started.** A magazine-style visual rewrite of the itinerary — full-bleed photos, text overlay, refined language. Captured from a design discussion (2026-07). Sequenced _after_ the collaboration spec so the itinerary canvas isn't redesigned twice.

## The idea

Today's itinerary is a list/timeline: day cards expanding into emoji-prefixed activity rows (time, title, note, duration, transitions, transit tips, `PhotoStrip`). It's information-rich but **dense and cumbersome to read** (flagged in the design critique as "emoji soup"). The proposal: make it feel like a travel magazine — cinematic photos in the backdrop, elegant text overlay, evocative copy.

## Decision: add a mode, don't replace the tool

**Dual-mode, not a rewrite.** An itinerary is both a _thing you dream over_ and a _tool you use on the ground_ — those pull in opposite directions, and one layout can't serve both.

- **Story mode** — full-bleed, cinematic, refined language. For pre-trip dreaming, reviewing, and sharing. The emotional/marketing surface (feeds the share-as-image growth loop).
- **Plan mode** — the existing list/timeline. For on-the-ground use (what's next, when, how far, tap-to-map) and for **all editing + collaboration UI** (tap-to-edit, undo chips, transitions, ⋯ menus, attribution, poll cards).
- **Toggle** between them, with a **smart default by trip phase**: upcoming trip → Story (dreaming); active/today → Plan (doing).

### Why not replace

- **On-the-ground utility:** density and scan-speed beat beauty when you're navigating a city on low battery/spotty data. Full-screen-photo-per-item = heavy scroll, less info/screen, legibility problems.
- **Editing is the collaboration surface:** the whole collaboration feature is about _editing_ the itinerary. Photo-backdrop-overlay fights dense inline controls. Design the canvas _after_ the collab interaction model lands, or design it twice.
- **Legibility & accessibility:** text-over-photo reintroduces the contrast problems the 2026-07 a11y pass just fixed. Needs scrim/gradient discipline.
- **Photo dependency:** the design is only as good as its worst photo, and the Wikipedia/Wikimedia pipeline is variable. A magazine layout with a missing/ugly photo looks worse than a clean list.

## Design refinements within Story mode

- **Photo-per-_day_, not per-activity.** A hero image + the day's narrative, then a still-structured (but beautiful) activity list beneath. Preserves scannability. This is essentially what `Magazine.jsx` `CityCard` already does — reuse that language.
- **Scrim/gradient discipline** for text legibility; respect the design-system contrast work.
- Reuse the existing photo pipeline (`photos.js`) and the Magazine visual vocabulary (`DestinationHero`, `CityCard`).

## Decoupled cheap wins (can ship now, independent of the visual rewrite)

1. **Refined language** — a prompt change in `supabase/functions/generate-itinerary` for more evocative day write-ups / activity descriptions. High value, low cost, no UI work.
2. **Story-mode prototype on 1–2 days** — validate the direction before committing (same "prototype before bulk UI" discipline as the SVG-icon migration).

## The empirical question that sets the default

Is the itinerary mostly consumed **pre-trip (dreaming)** or **on-the-ground (doing)?** Check PostHog session timing relative to trip dates:

- Pre-trip dominates (and people use Google Maps on the ground anyway) → lean **Story default**.
- On-the-ground use is heavy → keep **Plan default**.
  Answer this before committing the default.

## Sequencing

1. Finish the collaboration spec/build (defines the editing canvas Plan mode must host).
2. Ship refined language (prompt-only) — anytime.
3. Prototype Story mode on 1–2 days.
4. Full Story-mode build with visual checkpoints (no blind bulk-UI rewrite).

## Related

- Design critique (session 2026-07): itinerary flagged as dense/emoji-soup; SVG icon system + type-scale enforcement recommended — a Story-mode rewrite would subsume some of that.
- Magazine tab (`src/components/Magazine.jsx`) — the existing magazine visual language to reuse.
- Collaboration spec (`docs/collaboration/`) — must settle the editing model first.
