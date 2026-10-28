# TripJam

Plan trips together, without the chaos.

TripJam is an AI-powered travel planning app built for groups. Tell it where you're going, how long, and what you're into — it builds a day-by-day itinerary with real places, real timing, and real photos. Then share it with your travel crew so everyone stays on the same page.

## Features

- **AI itinerary generation** — a personalised day-by-day plan built from your destination, travel style, budget, pace and hotel location, with real venues rather than "lunch somewhere nice"
- **Flight-aware planning** — add your arrival and departure times and the itinerary adjusts automatically (no activities before you've checked in, nothing running late on departure day)
- **Activity photos** — each activity gets a photo pulled from Wikimedia
- **Live map pins** — every activity links directly to Google Maps
- **Day write-ups** — a narrative description of each day you can reveal with one tap
- **Edit anything** — tap any activity to change the time, title, note, type, or map pin
- **Collaboration** — share a trip by link; co-travellers edit the itinerary, chat with the assistant together, vote in polls and see a live activity feed
- **Trippy, the trip assistant** — ask questions or request changes in plain language ("make day 2 less packed") and it edits the itinerary for you
- **Board** — notes, to-dos, bookmarks, expenses and travel/hotel bookings per trip
- **Magazine & Inspirations** — destination deep-dives, plus articles and videos from real individual creators
- **Forward your bookings** — email a hotel or flight confirmation and it files itself into the trip
- **Hotel autocomplete** — powered by Google Places so you get the right location and area

## Tech Stack

- React + Vite, Capacitor for the Android app
- Supabase (Postgres, Auth, Edge Functions, Realtime, RLS)
- Multi-provider AI through one adapter — Gemini for route and itinerary
  generation, GPT for destination deep-dives, Claude for the assistant and
  web-search-backed research. Each step picks its own model, so a swap is a
  config change rather than an integration.
- Brave Search for creator-sourced inspiration
- Google Places API (New) for destination and hotel search, and venue verification
- Wikimedia Commons for activity photos
- Photon / OpenStreetMap for map geocoding and airport search

## Status

In production at [tripjam.co](https://tripjam.co), with an Android app in
internal testing. Trip generation, the assistant, collaboration (shared
editing, chat, polls, activity feed), the Board and credits are all live.
