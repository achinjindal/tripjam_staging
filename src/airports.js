// Airport lookup utility. The dataset is lazy-loaded — initial bundle pays no cost.
// Source: OurAirports CSV filtered to medium/large + IATA + scheduled_service.

import { geocodePlace, haversineMeters } from "./photos";

let _airports = null;
let _iataMap = null;

async function loadAirports() {
  if (_airports) return _airports;
  const mod = await import("./airports-data.json");
  _airports = mod.default || mod;
  return _airports;
}

export async function findNearestAirport({ lat, lng }, { maxKm = 250 } = {}) {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  const airports = await loadAirports();
  let best = null;
  let bestDist = Infinity;
  const target = { lat, lng };
  const maxMeters = maxKm * 1000;
  for (const ap of airports) {
    const d = haversineMeters(target, { lat: ap.lat, lng: ap.lng });
    if (d < bestDist) { best = ap; bestDist = d; }
  }
  if (!best || bestDist > maxMeters) return null;
  return { ...best, distanceKm: bestDist / 1000 };
}

export async function findAirportByIata(code) {
  if (!code) return null;
  const airports = await loadAirports();
  if (!_iataMap) {
    _iataMap = new Map();
    for (const ap of airports) _iataMap.set(ap.iata, ap);
  }
  return _iataMap.get(code.toUpperCase()) || null;
}

export async function resolveAirportForCity(cityName, opts = {}) {
  if (!cityName) return null;
  const geo = await geocodePlace(cityName, cityName);
  if (!geo) return null;
  return findNearestAirport(geo, opts);
}
