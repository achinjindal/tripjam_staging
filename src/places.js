// Place Peek data layer — Wikipedia REST summaries for route towns.
//
// Reuses the polite Wikimedia queue from photos.js (3 concurrent / 250ms,
// shared 429 cool-down) and the food-photo path's disambiguation guard.
// Zero LLM cost. Results cached in-module and in localStorage so revisiting
// a trip shows peeks instantly and offline.

import { wikiQueuedFetch } from "./photos.js";
import { farFromRoute } from "./routeStops.js";

const _cache = {}; // name|dest → summary | null (null = known miss)
const LS_PREFIX = "tripjam_peek_";
const LS_MAX_ENTRIES = 80;

function lsGet(key) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function lsSet(key, val) {
  try {
    const mine = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX)) mine.push(k);
    }
    // Cap the namespace — evict arbitrary old entries (values are re-fetchable).
    while (mine.length >= LS_MAX_ENTRIES) {
      localStorage.removeItem(mine.pop());
    }
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(val));
  } catch {
    /* private mode / quota — cache is best-effort */
  }
}

// Same guard the food-photo path uses (photos.js) — a disambiguation page is
// never a usable place summary.
function isDisambiguation(summary) {
  return (
    !summary ||
    summary.type === "disambiguation" ||
    /may refer to/i.test(summary.extract || "")
  );
}

// Homonym guard: when Wikipedia returns coordinates AND we know where the
// route actually goes, reject articles sitting >800km from every stop
// (bare "Galle"-style titles can resolve to same-named places elsewhere).
function isGeoImplausible(summary, stopCoords) {
  const c = summary?.coordinates;
  if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lon)) return false;
  if (!Array.isArray(stopCoords) || stopCoords.length === 0) return false;
  return farFromRoute({ lat: c.lat, lng: c.lon }, stopCoords) != null;
}

// Weak-signal text check: does the summary mention any destination token
// ("Bali", "Indonesia")? Used to PREFER candidates, never to reject alone.
function mentionsDestination(summary, destTokens) {
  if (!destTokens?.length) return false;
  const hay =
    `${summary?.description || ""} ${summary?.extract || ""}`.toLowerCase();
  return destTokens.some((t) => t && hay.includes(t.toLowerCase()));
}

function shapeResult(summary) {
  return {
    title: summary.title || null,
    description: summary.description || null,
    extract: summary.extract || null,
    image: summary.originalimage?.source || summary.thumbnail?.source || null,
    url: summary.content_urls?.desktop?.page || null,
  };
}

/**
 * Fetch a Wikipedia summary for a route town.
 *
 * @param name        town name as it appears in the route ("Ella")
 * @param destination trip destination string for disambiguation context
 *                    ("Bali, Indonesia" / "Sri Lanka")
 * @param stopCoords  optional [{lat,lng}] of route stops for geo-sanity
 * @returns { title, description, extract, image, url } or null on miss.
 */
export async function fetchPlaceSummary(name, destination, stopCoords = null) {
  const clean = (name || "").trim();
  if (!clean) return null;
  const cacheKey = `${clean}|${destination || ""}`.toLowerCase();
  if (cacheKey in _cache) return _cache[cacheKey];
  const stored = lsGet(cacheKey);
  if (stored !== undefined) {
    _cache[cacheKey] = stored;
    return stored;
  }

  // Candidate titles: bare name, then "Name, <country>" (last comma segment
  // of the destination), then "Name, <first segment>". "Ella" → disambiguation
  // → "Ella, Sri Lanka" hits the real article.
  const destTokens = (destination || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const country = destTokens[destTokens.length - 1];
  const region = destTokens[0];
  const candidates = [
    ...new Set(
      [
        clean,
        country && `${clean}, ${country}`,
        region && region !== country && `${clean}, ${region}`,
      ].filter(Boolean),
    ),
  ];

  let weak = null;
  let result = null;
  for (const title of candidates) {
    const summary = await wikiQueuedFetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}?redirect=true`,
    );
    if (isDisambiguation(summary)) continue;
    if (isGeoImplausible(summary, stopCoords)) continue;
    if (!summary.extract) continue;
    if (mentionsDestination(summary, destTokens)) {
      result = shapeResult(summary); // strong hit — done
      break;
    }
    if (!weak) weak = shapeResult(summary); // plausible but unconfirmed
  }
  if (!result) result = weak; // may still be null = genuine miss

  _cache[cacheKey] = result;
  lsSet(cacheKey, result);
  return result;
}

/**
 * Find the first occurrence of `town` in `haystack`, case- and diacritic-
 * insensitive, with letter/digit boundaries on both sides (JS \b breaks on
 * non-ASCII letters). Returns [start, end] in the ORIGINAL string or null.
 */
export function findTownInText(haystack, town) {
  if (!haystack || !town) return null;
  const normChar = (ch) =>
    ch
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  let norm = "";
  const map = []; // norm index → original index
  for (let i = 0; i < haystack.length; i++) {
    const n = normChar(haystack[i]);
    for (let j = 0; j < n.length; j++) map.push(i);
    norm += n;
  }
  const needle = Array.from(town).map(normChar).join("").trim();
  if (!needle) return null;
  const isWordChar = (ch) => !!ch && /[\p{L}\p{N}]/u.test(ch);
  let idx = norm.indexOf(needle);
  while (idx !== -1) {
    const before = idx > 0 ? norm[idx - 1] : "";
    const after = norm[idx + needle.length] || "";
    if (!isWordChar(before) && !isWordChar(after)) {
      return [map[idx], map[idx + needle.length - 1] + 1];
    }
    idx = norm.indexOf(needle, idx + 1);
  }
  return null;
}
