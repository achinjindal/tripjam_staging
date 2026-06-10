# TripJam — Launch Checklist

Manual + operational steps to verify before each environment promotion.
Pair this with `RUNBOOKS.md` (operational SQL + recovery procedures).

---

## ⚠️ Known issues / pre-launch bug backlog

Tracked here so they don't get lost between sprint commits. Categorize by
launch impact: **🔴 Blocker** (fix before launch) · **🟡 Polish** (post-launch
OK) · **🟢 Nice-to-have**.

### Reported 2026-05-27 — investigated + fixed + deployed (commit `<this>`)

- **🟢 Map "grey screen"** — root cause: `MapView` was firing
  `supabase.from("activities").update(...).eq("id", act.id)` without `.then()` /
  `await`, so supabase-js v2 (lazy builder) never sent the PATCH. Result: lat/lng
  was never persisted, every Map open re-geocoded 60–100 activities, and the
  `pins` array transiently settled to `[]` → `MapContainer` mounted at the
  fallback `center=[20,0]` (open Atlantic Ocean at zoom 13 → grey-blue tiles).
  Fix: append `.then()`, short-circuit when `act.lat/lng` already persisted, and
  render a shimmer/placeholder when `pins` is empty so Leaflet never boots at
  `[20,0]` even if all geocoding hard-fails. Verified: 21/66 activities on test
  trip now persist coords on first open; second open is instant.
- **🟢 Magazine highlight cards skeleton-only** — root cause: `_fetchPhoto`
  Tier 1/2 did an exact-title Wikipedia lookup. Activities are stored as
  `Senso-ji Temple`, `Tosho-gu Shrine`, `Hamarikyu Gardens` etc. but Wikipedia
  pages are titled without the trailing POI noun (`Sensō-ji`, `Nikkō Tōshō-gū`,
  `Hama-rikyū Gardens` is one of the rare exceptions). Tier 3 search returned
  reasonable candidates but the filename-relevance filter then rejected them.
  Fix in `photos.js`: add a small suffix-stripped retry mirroring the geocoder's
  `SUFFIX_RE`, sort Tier 3 results by `index`, and accept the top result whose
  page title matches the geocode without the filename check. Day 6 parallel
  prefetch was a contributing aggravator (more queued requests) but not the
  cause. Verified: Nikko card now shows Tosho-gu Shrine + Yomeimon Gate +
  Shinkyo Bridge photos that were previously perma-skeleton.
- **🟢 `/trip/:id/magazine` deep-link/reload showed an entirely blank screen**
  (discovered while investigating) — `parseUrl` returned `tab: "magazine"` and
  `App` stored that verbatim in `activeBottomTab`, but the Magazine view only
  renders when `activeBottomTab === "brainstorm"` (legacy internal key) and the
  inverse-translation only ran on URL writes, never on URL parses. Direct nav
  (page reload, share-back, PWA cold start) rendered nothing. Fix in
  `main.jsx`: translate URL `magazine` → internal `brainstorm` at the parse
  boundary. Verified: `/trip/:id/magazine` now renders the full Magazine view.

### Pre-existing (carried from sprint)

- 🟡 1200×630 dedicated OG image (using mascot.png 1536×1024 as fallback)
- 🟡 Per-trip dynamic OG for `/share/:token` (needs Vercel middleware or
  @vercel/og — currently all share links show the generic site OG)
- 🟡 Per-day "skeleton until photos+coords ready" progressive IG gate
- 🟢 Bundle visualizer audit (current splits look reasonable)
- 🟢 Inline magazine-tab credits hint (consolidated into Avatar dropdown)
- 🟡 Manual password reset flow (currently emailed support — see RUNBOOKS)
- 🟢 Desktop layout ≥1024px breakpoint (D21-D22) — **Phase 1 shipped 2026-05-27.**
  Trip-view (brainstorm + itinerary) renders D22 three-column shell on
  desktop: 240px left sidebar (trips link / trip name / share / explore
  plans) + center column (top-tab row + active tab content) + right column
  (persistent Leaflet map on top, persistent Trippy chat inline on bottom).
  Mobile (<1024px) is byte-identical. Phase 2 backlog: Setup wizard, Home
  trips-list-as-sidebar, TripPublicView, Auth. Dev helper: `?desktop=1`
  query param forces the desktop shell at any viewport width (useful for
  in-IDE browser testing where the inner iframe is fixed at ~760px).
- 🟢 9 Playwright RG/IG-dependent tests flaky (real Anthropic API; not a
  product bug — manual smoke A5 covers these flows)

---

---

## A. Manual smoke test (incognito, real browser, 15 min)

Run on **staging** before each prod push. Re-run on **production** post-deploy.

### Pre-flight

- [ ] Open an incognito window
- [ ] Set `qa-tester` credits to a clean state: `UPDATE profiles SET credits = 300 WHERE username='qa-tester'`
- [ ] Clear LS test orders if needed (Lemon Squeezy dashboard → Orders → archive)

### A1. Logged-out experience

- [ ] `/` shows Landing (hero, How it works, Pricing, FAQ, Footer)
- [ ] Landing header "Sign in" + "Sign up free" buttons work
- [ ] Footer links `/privacy` and `/terms` render
- [ ] OG tag check: paste prod URL into Slack/iMessage — preview shows TripJam title + mascot image (no 404)

### A2. Signup flow

- [ ] `/signup` → fill email + username + password + tick Terms checkbox + Create Account
- [ ] Without Terms checkbox → submit blocked with red error
- [ ] Invalid email format → submit blocked with red error
- [ ] Password < 6 chars → submit blocked with red error
- [ ] Real signup → lands on Home with "Your Trips" / "No trips yet"
- [ ] Profile row exists in DB with email + username + face_icon

### A3. Sign-in flow

- [ ] `/signin` accepts email (`qa-tester@tripjam.app`) → signs in
- [ ] `/signin` also accepts legacy username (`qa-tester`) → signs in
- [ ] Invalid creds → generic "Invalid email/username or password"
- [ ] After sign-in, AddRealEmailPrompt banner shows for legacy users (`@tripjam.app`)
- [ ] ✕ dismisses banner; survives page nav within session

### A4. Avatar + dropdown (top-right)

- [ ] Avatar shows face emoji (matches profile)
- [ ] Click avatar → dropdown opens with username + Credits + Top up + Sign out
- [ ] Click outside → dropdown closes
- [ ] Admin user shows "ADMIN" badge + decimal balance tooltip
- [ ] Sign out → returns to Landing

### A5. Setup wizard → Route Generation → Itinerary

- [ ] Click "New trip" → setup at `/new/0`
- [ ] Add destination (e.g. "Tokyo") → Continue → step 1 → step 2 → Generate routes
- [ ] 4 route options appear (`/trip/:id/plans`)
- [ ] Select a route → pre-IG sheet (budget/pace/morning/transport) → Build My Itinerary
- [ ] Compact view loads in <10s; detailed days stream in
- [ ] PostHog events fire: `ig_started`, `ig_compact_complete`, `ig_detailed_complete`
- [ ] Each day's photos + maps render within ~3s of text

### A6. Credits flow (staging only — UI is currently auto-hidden on prod)

- [ ] Avatar dropdown shows balance (300.00 for qa-tester)
- [ ] `UPDATE profiles SET credits = 5 WHERE username='qa-tester'` → LowCreditsBanner appears
- [ ] Click "Top up" in banner OR avatar → PackSelectorModal opens with Small (300/$5) + Large (1000/$10)
- [ ] Click Small → redirects to Lemon Squeezy checkout
- [ ] Complete with test card `4242 4242 4242 4242` → redirects back with `?credits_success=300` + green toast
- [ ] Avatar balance now reads 305
- [ ] credit_transactions row inserted with `provider_session_id`
- [ ] Resend webhook from LS dashboard → balance unchanged (idempotent)

### A7. Hard paywall

- [ ] `UPDATE profiles SET credits = 0 WHERE username='qa-tester'`
- [ ] Try to send a chat message → 402 returns → PaywallSheet appears
- [ ] Click "Top up" → PackSelectorModal opens
- [ ] Click "Maybe later" → modal closes

### A8. Rate limit

- [ ] Hit any LLM endpoint 22× in 60s → 21st and 22nd return 429
- [ ] Wait 60s → next request goes through

### A9. Kill switch (optional, ops drill)

- [ ] `supabase secrets set LLM_KILL_SWITCH=true --project-ref ...`
- [ ] Wait ~1 min for next cold start
- [ ] Any LLM endpoint returns 503 with `code: kill_switch`
- [ ] `supabase secrets set LLM_KILL_SWITCH=false ...` → recovers

### A10. Trip sharing

- [ ] Open trip → share link → opens in incognito window
- [ ] Public view renders without requiring auth
- [ ] Trip data shows (days, activities, maps)

### A11. Multi-collaborator

- [ ] Sign in as different account
- [ ] Use invite link from trip A → join → see trip A in your list
- [ ] Both users see each other's votes on routes

---

## B. Pre-prod deploy gate

Before pushing anything to `main` (which auto-deploys to prod via Vercel):

- [ ] `npm run build` clean
- [ ] `npm run lint` clean
- [ ] All Day-2/Day-3 staging smoke (A1-A8) passes
- [ ] No `console.error` in browser devtools after a full trip flow
- [ ] No new Sentry issues in last 10 min on staging (when Sentry is enabled)
- [ ] PostHog `ig_started → ig_detailed_complete` funnel ≥80% on staging

---

## C. Soft-launch invite list (Day 9)

Aim for 10-20 friendly testers. Personal note each (NO mass email).

- [ ] Family (5-8): spouse, parents, 2-3 siblings/cousins
- [ ] Friends planning trips this quarter (5-7): personalized note referencing their trip
- [ ] Solo-founder community (2-3): IndieHackers, X DM
- [ ] Each tester gets: short personal note + landing page URL + "send screenshots/feedback to <email>"

---

## D. Public launch (Day 11+)

Post in this order, ~2h apart. Stay on Sentry + PostHog all day, reply within 1h.

1. **Personal network** — short DM/email to ~30 close contacts (8am ET)
2. **Twitter/X thread** (10am ET) — 5-7 tweets, screenshots
3. **Product Hunt** (12pm ET — peak traffic) — title, tagline, gallery, first comment
4. **Hacker News Show HN** (2pm ET) — title + first comment
5. **Reddit** (next day, staggered) — `r/travel`, `r/digitalnomad`, `r/solotravel` — different angles, NOT cross-posted verbatim

For each post: pin to top of your X/personal channels.

---

## E. Hotfix discipline

During soft + public launch, only single-commit fixes that meet ALL:

- [ ] Blocks signup, login, or payment
- [ ] Has a clear, narrow fix (<30 lines)
- [ ] Tested locally before push
- [ ] Won't conflict with concurrent UX work

Anything else: triage to a GitHub issue, ship after launch settles.
