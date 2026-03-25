# TripJam

Plan trips together, without the chaos.

TripJam is an AI-powered travel planning app built for groups. Tell it where you're going, how long, and what you're into — it builds a day-by-day itinerary with real places, real timing, and real photos. Then share it with your travel crew so everyone stays on the same page.

## Features

- **AI itinerary generation** — Claude builds a personalised day-by-day plan based on your destination, travel style, budget, pace, and hotel location
- **Flight-aware planning** — add your arrival and departure times and the itinerary adjusts automatically (no activities before you've checked in, nothing running late on departure day)
- **Activity photos** — each activity gets a photo pulled from Wikimedia
- **Live map pins** — every activity links directly to Google Maps
- **Day write-ups** — a narrative description of each day you can reveal with one tap
- **Edit anything** — tap any activity to change the time, title, note, type, or map pin
- **Collaboration** — invite travel companions with edit, comment, or read-only access
- **Hotel autocomplete** — powered by Google Places so you get the right location and area

## Tech Stack

- React + Vite
- Supabase (Postgres, Auth, Edge Functions)
- Claude API (Anthropic) for itinerary generation
- Google Places API (New) for hotel search
- Wikimedia Commons for activity photos
- Photon / OpenStreetMap for destination and airport search

## Status

Early development. Core trip generation and viewing is working. Collaboration, comments, and budgeting are coming next.
