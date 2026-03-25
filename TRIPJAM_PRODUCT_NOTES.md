# TripJam — Product Notes
*Last updated: March 2026*

---

## What is TripJam?
A travel planning and collaboration app. Core problem it solves: prevent nasty surprises on group trips — transparency and alignment for all travelers before embarking. Use case: 2 couples planning a trip together, everyone stays informed on the plan.

---

## Tech Stack
- React (JSX) + Vite
- Supabase (Postgres + Auth + Realtime)
- Key files: `src/App.jsx`, `src/main.jsx`, `src/Auth.jsx`, `src/Home.jsx`, `src/supabase.js`

---

## Auth
- Initially: username + password only (no email required)
- Under the hood: Supabase auth uses `username@tripjam.app` as fake email
- On signup: choose username + password + face icon (1 of 10 emoji options): ["👦","👧","🧑","👨","👩","🧔","👱","🧓","🥸","😎"]
- Post-launch: add real email + magic link support
- Email confirmation is DISABLED in Supabase dashboard (Authentication → Providers → Email)

---

## Collaboration Roles (3 tiers)
- **Read-only** — view the itinerary (e.g. someone curious about the plan)
- **Comment-only** — view + add comments/reactions (e.g. share with someone not on the trip who might have ideas)
- **Full edit** — co-travelers and close friends, can make changes

---

## Data Model
- Multiple trips per user
- One shared canonical itinerary per trip — no hidden versions, full transparency
- Collaborators can carve out a **fork** for a specific time block — their alternative sits alongside the main plan, visible to everyone
- Comments on trip / day / activity level. Reactions supported. No threading.

---

## Pricing / Access Tiers
- **Free:** 1 trip, solo only (no collaborators)
- **Paid Basic:** Unlimited trips (hard cap: 20), unlimited collaborators per trip (hard cap: 12)
  - If a collaborator is free/unpaid: max 2 shared trips together — *PARKED, not implementing yet*
  - If a collaborator is also paid: unlimited shared trips
- Hard limits enforced server-side (not just UI)

---

## Trip Creation Flow
1. Enter destination + dates (start date + end date — actual calendar dates, not just number of days)
2. Select number of travelers (max 12)
3. Select trip style: Cultural & Heritage / Adventure & Outdoors / Food & Culinary / Relaxation & Wellness / City Break / Road Trip / Beach & Coast / **I'll wing it 🎲**
4. Select budget: Budget / Mid-range / Luxury
5. Generate itinerary (currently uses hardcoded destination data — real AI generation planned via Supabase Edge Function calling Claude API)
6. **Post-generation "Finish setting up" strip** (dismissible cards):
   - ✈️ Add flights → origin city, flight duration (hours), arrival time Day 1, departure time last day
   - 🏨 Add hotel → name, area, status (booked/tentative)
   - 👥 Invite friends → choose role (edit/comment/read), generate + copy invite link
- Rest time after long flights factored into AI generation — no fixed rules, context-aware

---

## Trip Budgeting
- Cost attached at activity level (optional field) — represents total cost for the whole group
- Budget page per trip shows: total expected cost + cost per traveler (total ÷ number of travelers)
- When a fork exists: cost is attributed separately — travelers on the fork see their own per-person cost, not the main plan's cost
- Scope: pre-trip planning only (expected costs). Actual spend tracking is out of scope for now.

---

## Features Planned
- Home screen showing all trips (owned + shared with you) ✅ DONE
- Real-time activity log / live feed (who did what)
- Invite collaborators via shareable link (link generation ✅ DONE, join flow not yet built)
- Forks for individual time blocks (visible to all)
- Comments + reactions on trip / day / activity
- Budget page per trip

---

## Database Schema (Supabase)
**Project URL:** https://viyvdqwwnbbqjuwiuzbh.supabase.co

Tables:
- `profiles` — id (= auth user id), username, face_icon (1-10), plan_type (free/paid_basic)
- `trips` — id, name, destination, start_date, end_date, created_by, origin_city, flight_duration_mins, arrival_time, departure_time, hotel_name, hotel_area, hotel_status
- `trip_members` — trip_id, user_id, role (read/comment/edit)
- `days` — id, trip_id, label, date (ISO), city, position
- `forks` — id, day_id, label, created_by
- `fork_members` — fork_id, user_id
- `activities` — id, day_id, fork_id (null = main plan), time, title, type, duration, note, confirmed, icon, cost, position, added_by
- `comments` — id, entity_type (trip/day/activity), entity_id, user_id, content, created_at
- `reactions` — id, comment_id, user_id, emoji
- `activity_log` — id, trip_id, user_id, action, entity_type, entity_id, created_at
- `invite_links` — id, trip_id, created_by, role, token, expires_at

All tables have Row Level Security (RLS) enabled. Policies exist for SELECT and INSERT on all core tables.

---

## What's Been Built (implementation progress)

### ✅ Done
- Supabase client setup (`src/supabase.js`, `.env`, `.gitignore`)
- Auth screen (`src/Auth.jsx`) — username + password + face icon signup/signin
- Home screen (`src/Home.jsx`) — lists all trips from Supabase, empty state, sign out
- Navigation shell (`src/main.jsx`) — auth check → home → create/trip
- Trip creation saves to Supabase — trips, trip_members, days, activities all written on generate
- Setup form updated: destination + actual start/end dates (not just number of days)
- Trip style option "I'll wing it 🎲" added
- Post-generation setup strip — flights, hotel, invite friends (dismissible bottom-sheet modals)
- Invite link generation saved to `invite_links` table

### 🔜 Next up (in rough priority order)
1. **Join flow** — handle `/join/{token}` URL so invited users can actually join a trip
2. **Real AI generation** — Supabase Edge Function calling Claude API for actual itinerary suggestions
3. **Real-time collab** — Supabase realtime subscriptions so changes sync live
4. **Comments + reactions** — on trip / day / activity
5. **Budget page** — per-activity costs, per-traveler breakdown
6. **Forks** — carve out a time block as a personal alternative

---

## Out of Scope (for now)
- Reveal/surprise mode
- Threaded comments
- In-app messaging (comments serve this purpose)
- Actual spend tracking during the trip
- "Max 2 trips together" free-rider enforcement (parked)
- Email confirmation on signup (disabled in Supabase)
