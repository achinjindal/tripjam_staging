# TripJam — Launch Post Drafts

Templates for soft + public launch. Personalize before posting. Each section
has the platform-specific format + your fill-in-the-blank slots.

---

## 1. Personal network (DM/email)

**Subject:** Soft-launching something I've been building — would love your eyes

Hey [NAME],

I've been quietly building **TripJam** — an AI travel planner for trips
with friends, family, or partners. It's the tool I wish existed when we
were [SHARED MEMORY: trying to plan that trip to X].

Most planners are either solo-spreadsheets or generic itinerary tools.
TripJam tries to do three things really well:

1. **Generate** a day-by-day plan in 30 seconds from just a destination + dates
2. **Personalize** it with a magazine guide to every city (food, transit, etiquette, hidden spots)
3. **Collaborate** — invite people, vote on ideas, edit together

It's at https://tripjam.vercel.app — you get 300 credits free, no card needed.

I'd really value your honest take. Specifically:

- Does the landing page make it obvious what this is?
- Does the first trip you plan actually feel useful?
- Anything broken or confusing?

Reply with anything — even a "this is bad" is gold right now.

— Achin

---

## 2. Twitter/X thread (5-7 tweets)

> 🧵 1/6 — I built a travel planner. Three reasons:
>
> 1. Planning a trip with 4 friends shouldn't require 40 messages
> 2. ChatGPT itineraries are generic and you have to copy-paste them somewhere
> 3. Most planners assume you already know the city
>
> Introducing TripJam → tripjam.vercel.app

> 2/6 — Tell it where + when. 30 seconds later you have 4 route options to
> choose between — each with a few-line description, vibe, and the cities
> it covers.

[SCREENSHOT: 4 route cards]

> 3/6 — Pick one → it builds a day-by-day itinerary. Real activities at
> real places (no "explore the city" filler). Photos, maps, walking times,
> transit tips per day.

[SCREENSHOT: itinerary day card]

> 4/6 — Every destination ships with a magazine guide: food specialties,
> getting around, what locals know, hidden corners. Written by Haiku 4.5
> with anti-hallucination guards.

[SCREENSHOT: Magazine deep-dive]

> 5/6 — Invite friends with one link. Vote on ideas. Edit together. No
> account required to view the plan.

[SCREENSHOT: collaborator view + voting]

> 6/6 — Free start: 300 credits on signup, no card. Top up two ways:
> $5 → 300 more, $10 → 1000.
>
> Built solo with React + Supabase + Anthropic. Would love your feedback ↓
>
> https://tripjam.vercel.app

---

## 3. Product Hunt

**Tagline:** AI travel planner that feels personal — for trips with friends, family, or partners.

**Description:**

> TripJam plans your next trip in under a minute, then helps you and your
> travel companions agree on it together.
>
> Tell it where and when. You get four route options. Pick one and it
> builds a day-by-day itinerary — real activities at real places, photos,
> maps, transit tips. Each destination ships with a magazine guide written
> for that specific trip.
>
> Invite friends with one link. Vote on ideas. Edit together.
>
> Free to start. Built solo in 6 months.

**Topics:** Travel · AI · Productivity · No-code

**First comment (post immediately after launch):**

> 👋 Maker here. Spent the last 6 months on this — it's the planner I wish
> existed when my friends and I tried to plan a Japan trip and ended up
> with a 200-message group chat and a half-baked Google Doc.
>
> A few things that make TripJam different:
>
> 🏛 **Per-destination magazine**: every city you plan in gets a writeup
> (food, transit, etiquette, "did you know"), not a generic Lonely
> Planet copy-paste.
>
> 🗳 **Built-in voting**: invite collaborators with one link, vote on
> routes and activities, see who voted what.
>
> ⚡ **Sub-30-second plans**: claude-sonnet-4-6 streams a 5-day itinerary
> in compact form first, then fills in details progressively.
>
> 💸 **Pay-as-you-go credits**: 300 free, then $5 → 300 / $10 → 1000.
> No subscription.
>
> Honest feedback hugely welcome — especially on the first-trip experience.

---

## 4. Hacker News (Show HN)

**Title:** Show HN: TripJam – AI travel planner with collaboration, built in 6 months

**First comment:**

> Hi HN, Achin here. TripJam is the trip planner I wish existed when my
> friends and I were planning a Japan trip last year and ended up with a
> 200-message group chat and three half-baked Google Docs.
>
> Stack:
>
> - React 18 + Vite (no framework router; History API for routes)
> - Supabase (Postgres + Auth + Edge Functions + RLS)
> - Anthropic claude-sonnet-4-6 for itinerary/route generation; haiku-4-5
>   for cheaper magazine and todo work
> - Lemon Squeezy as Merchant of Record for payments (Stripe is invite-only
>   in India where I'm based)
> - Leaflet + Wikipedia photos (free, throttled queue)
> - PostHog for analytics, Sentry for errors
>
> Decisions I'm second-guessing:
>
> 1. **No router library.** History API + a useEffect-based URL listener.
>    Saved ~20 KB but made deep-linking trickier than I'd hoped.
> 2. **Photos from Wikipedia/Wikimedia.** Free and surprisingly good for
>    well-known places, terrible for obscure ones. May need to bite the
>    Google Photos cost bullet eventually.
> 3. **Two-phase IG streaming**: a compact 1-line-per-day view appears in
>    ~3s while the detailed itinerary streams in over 20-30s. Users get
>    perceived speed; tradeoff is some prompt complexity.
>
> Things I'm proud of:
>
> 🏛 **Per-trip magazine**: each city gets a curated writeup (food,
> transit, etiquette) generated for THAT specific trip.
>
> 🗳 **Real collaboration**: invite link, vote on routes/activities,
> see who voted what. Per-trip RLS in Postgres.
>
> 💸 **Decimal credits**: each API call deducts cents, displayed as
> integers. NUMERIC(10,2) end-to-end.
>
> 🛡 **Pre-flight rate limit + kill switch**: 20 calls/min/user via a
> Postgres counter + an env var that disables all LLM calls in ~1min.
>
> Free to start (300 credits on signup, no card). Top-up packs are $5/300
> credits or $10/1000.
>
> Honest critique welcome. Especially: does the first generation feel
> useful, or does it feel like "yet another GPT wrapper"?
>
> https://tripjam.vercel.app

---

## 5. Reddit

**Important:** DO NOT cross-post verbatim. Each subreddit deserves a different
angle. Reddit will flag obvious copy-paste.

### r/travel — "I built a planner because group trips drove me nuts"

> Anyone else find planning trips with 3+ people exhausting? Last year
> 4 of us tried to plan a Japan trip and ended up with a 200-message
> WhatsApp thread and 3 Google Docs.
>
> Built a thing that tries to fix it: TripJam. You enter a destination,
> get 4 route options to vote on, then it builds a day-by-day itinerary
> you can edit together.
>
> Each city ships with a "magazine" — food specialties, transit tips,
> etiquette, hidden corners. Generated per-trip so it's actually tailored.
>
> Free to start (300 credits, no card). [link]
>
> Genuinely want feedback — what would make it more useful?

### r/digitalnomad — "AI planner that works for slow-travel itineraries too"

[Different angle: emphasize the pace/morning preference + multi-city support]

### r/solotravel — focus on the per-city magazine + transit tips for solo navigation

---

## 6. Email subject lines (A/B test if you have a list)

- "Soft-launching TripJam — would love your eyes"
- "Tried to plan a trip in 30 seconds. Here's what happened."
- "I built the trip planner I wish existed last year"

---

## Quick links to verify before posting

- [ ] https://tripjam.vercel.app — landing renders, sign-up works
- [ ] https://tripjam.vercel.app/privacy — renders
- [ ] https://tripjam.vercel.app/terms — renders
- [ ] OG preview in Slack/iMessage shows TripJam title + image (not a 404)
- [ ] Twitter card validator: https://cards-dev.twitter.com/validator
- [ ] LinkedIn post inspector: https://www.linkedin.com/post-inspector/
- [ ] Sentry dashboard open in another tab
- [ ] PostHog dashboard open in another tab

---

## Post-launch monitoring (Day 11+)

- Refresh Sentry every 15 min for first 2 hours
- Watch PostHog signup funnel — % completion
- Reply to comments within 1 hour during US daylight
- Have hotfix branch ready (`hotfix/launch-day`) for any blocker
