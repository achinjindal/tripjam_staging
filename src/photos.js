/* ─── PHOTO UTILITIES ───────────────────────────────────────────────── */
// Shared mutable photo state and fetch logic, used by App.jsx and Magazine components.

import { PLACES_PROXY, PLACES_HEADERS } from "./theme";
export { PLACES_PROXY, PLACES_HEADERS };

export const _photoCache = {};
export const _usedPhotoUrls = new Set();
export const _magazineFallbackQueue = []; // serialize fallback fetches to prevent duplicate photos
export let _magazineFallbackRunning = false;
export function _enqueueMagazineFallback(fn) {
  return new Promise(resolve => {
    _magazineFallbackQueue.push(async () => { resolve(await fn()); });
    if (!_magazineFallbackRunning) {
      _magazineFallbackRunning = true;
      (async () => { while (_magazineFallbackQueue.length) { await _magazineFallbackQueue.shift()(); } _magazineFallbackRunning = false; })();
    }
  });
}

let _activeTripId = null; // set when a trip is opened, used for hotel photo rate limits
export function setActiveTripId(id) { _activeTripId = id; }
export function getActiveTripId() { return _activeTripId; }

// Returns true if the URL looks like a person portrait or otherwise unsuitable place photo
export function _isPortrait(url) {
  const decoded = decodeURIComponent(url);
  return /portrait|headshot|cropped\)|_photo_of|mug.?shot|flag_of|coat_of_arms|logo|emblem|map_of|locator|location_map|blankmap|relief_map|seal_of|_at_the_|_in_\d{4}|_\d{4}_\(|_speaking|_performing|_award|_ceremony|_interview|dress_uniform|uniform_|_official|campaign_poster|_signing|_visit/i.test(decoded);
}

export function makeQueue(delayMs, concurrency = 1) {
  const q = [];
  let active = 0;
  const run = () => {
    while (active < concurrency && q.length > 0) {
      active++;
      const task = q.shift();
      task().finally(() => { active--; run(); });
    }
  };
  return (url) => new Promise(resolve => {
    q.push(async () => {
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(tid);
        resolve(res.ok ? await res.json() : null);
      } catch { resolve(null); }
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    });
    run();
  });
}

export const wikiQueuedFetch = makeQueue(300, 3); // Wikimedia — 3 concurrent, 300ms stagger (avoid 429s)

/**
 * Fetch a representative photo for an activity/place using free Wikipedia/Commons sources.
 *
 * Hotels take a different path: TripAdvisor/Google via the places-proxy edge function.
 * Everything else flows through 4 tiers, returning the first acceptable photo:
 *
 *   Tier 1 — Wikipedia article matching `geocode` exactly (with redirects). Returns the
 *            article's hero image (`prop=pageimages`) if the page title is relevant. No
 *            filename check — exact-title matches with redirects are authoritative, and
 *            many valid hero images have filenames that don't repeat the place name
 *            (e.g. "Wat Phra Yai" article uses "Big_Buddha_Koh_Samui.jpg").
 *   Tier 2 — Same as Tier 1 with the city stripped from the geocode tail (geocodes often
 *            arrive as "<place> <city>"). Same relaxed filename rule.
 *   Tier 3 — Wikipedia full-text search across `<geocode> <city>`. Top 5 results, person
 *            pages filtered out via description regex. Top 2 results bypass page-title
 *            relevance but still require filename relevance — riskier than exact match,
 *            so the filename check stays.
 *   Tier 4 — Wikimedia Commons file search (much larger pool than article hero images).
 *            Filters obvious non-photos by title (svg/logo/flag/icon/map/category).
 *
 * Filtering:
 *   - `good()` rejects portraits, already-used URLs, and bad asset types (svg/pdf, maps,
 *     flags, logos, skyline/panorama/aerial, etc.) via BAD_PATTERNS.
 *   - `pageRelevant()` requires the article title to share a non-stopword token with the
 *     geocode (with city words excluded to prevent "<city> X" articles passing on city alone).
 *   - `photoFilenameRelevant()` requires the photo filename to share a token with the geocode
 *     when the filename has more than 2 meaningful words. Used in Tier 3 only.
 *
 * Concurrency & dedup:
 *   - `_photoCache` is keyed by `geocode||city` and short-circuits repeat lookups in the
 *     same session. Set to `null` on entry to mark in-flight (prevents racing duplicates).
 *   - `_usedPhotoUrls` tracks photos already shown so we don't repeat them across activities.
 *   - `wikiQueuedFetch` serializes Wikipedia/Commons requests through a small queue to
 *     stay within polite-use limits.
 *
 * Returns the photo URL or `null` if no acceptable photo was found.
 */
export async function _fetchPhoto(geocode, city, type, hotelOpts) {
  const BAD_PATTERNS = /\.(svg|pdf)(\.|$)|map|marker|locator|flag|coat.of.arms|emblem|logo|icon|pictogram|seal_of|coa_of|blank|skyline|panorama|aerial|regulation|commission|directive/i;
  const good = (url) => url && !_isPortrait(url) && !_usedPhotoUrls.has(url) && !BAD_PATTERNS.test(url);

  // Deduplicate: return cached result immediately if already fetched
  const cacheKey = `${geocode}||${city || ""}`;
  if (_photoCache[cacheKey] !== undefined) {
    const cached = _photoCache[cacheKey];
    return (cached && _usedPhotoUrls.has(cached)) ? null : cached;
  }
  // Mark in-flight to prevent concurrent duplicate fetches
  _photoCache[cacheKey] = null;
  // Strip leading/trailing city from geocode to avoid doubled query (e.g. "Hanoi La Siesta Classic Ma May" + city "Hanoi")
  const geocodeQ = city ? (() => {
    const esc = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return geocode
      .replace(new RegExp(`^${esc}\\s+`, "i"), "")
      .replace(new RegExp(`\\s+${esc}\\s*$`, "i"), "")
      .trim() || geocode;
  })() : geocode;

  // Hotels: TripAdvisor primary (via server). Skip the _usedPhotoUrls dedup —
  // the same hotel legitimately appears in suggestion cards (Magazine/chat) AND
  // the itinerary check-in activity, and should show the same photo in both.
  if (type === "hotel") {
    try {
      const res = await fetch(`${PLACES_PROXY}?action=hotel-photo`, {
        method: "POST", headers: PLACES_HEADERS,
        body: JSON.stringify({ q: geocodeQ, city, tripId: hotelOpts?.tripId || _activeTripId, context: hotelOpts?.context || "itinerary" }),
      });
      const { url: photoUrl } = await res.json();
      if (photoUrl && !_isPortrait(photoUrl) && !BAD_PATTERNS.test(photoUrl)) {
        _photoCache[cacheKey] = photoUrl;
        return photoUrl;
      }
    } catch { /* hotel-photo endpoint unavailable */ }
    _photoCache[cacheKey] = null;
    return null;
  }

  const STOPWORDS = new Set(["the","a","an","of","in","at","on","and","by","for","to","de","el","la"]);
  // Strip city words from geocode — city name alone shouldn't count as a relevance match
  // e.g. "Hang Dao Street Hanoi" → "Hang Dao Street" so "Hanoi Film Festival" doesn't pass
  const cityWords = new Set((city || "").toLowerCase().split(/\s+/).filter(Boolean));
  const geocodeWithoutCity = geocode.toLowerCase().split(/\s+/).filter(w => !cityWords.has(w)).join(" ");
  const geocodeWords = geocodeWithoutCity.split(/\s+/).filter(w => w.length > 3 && !STOPWORDS.has(w));
  // Fallback: if all words are too short (e.g. "Pho Bat Dan"), use the full geocode as one token
  const relevanceTokens = geocodeWords.length > 0 ? geocodeWords : [geocode.toLowerCase()];
  // Check that the Wikipedia page title (after redirect) is still relevant to the geocode.
  // Prevents generic city/country article thumbnails from being returned for specific places.
  const pageRelevant = (pageTitle) => {
    const t = (pageTitle || "").toLowerCase();
    return relevanceTokens.some(w => t.includes(w));
  };
  // Check that the photo filename itself isn't clearly unrelated to the geocode.
  // e.g. "Old_Quarter_Street_Scene_Hanoi.jpg" should not match "Hoan Kiem Lake & Ngoc Son Temple"
  const photoFilenameRelevant = (url) => {
    const filename = decodeURIComponent((url || "").split("/").pop() || "")
      .replace(/\.\w+$/, "").toLowerCase();
    const fileWords = filename.split(/[\s_\-()]+/)
      .filter(w => w.length > 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
    if (fileWords.length <= 2) return true; // short or numeric filenames: no strong signal, allow
    return relevanceTokens.some(rt => fileWords.some(fw => fw.includes(rt) || rt.includes(fw)));
  };

  // Tier 1: Wikipedia exact title lookup. Trust the article's hero image when the
  // page title is relevant — exact-title matches with redirects are authoritative,
  // and the filename check would reject valid hero images whose filenames don't
  // happen to contain the geocode tokens (e.g. Wat Phra Yai → Big_Buddha_Koh_Samui.jpg).
  const data1 = await wikiQueuedFetch(
    `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(geocode)}&prop=pageimages&format=json&pithumbsize=700&redirects=1&origin=*`
  );
  const page1 = Object.values(data1?.query?.pages || {})[0];
  const src = page1?.thumbnail?.source;
  if (good(src) && pageRelevant(page1?.title)) { _usedPhotoUrls.add(src); _photoCache[cacheKey] = src; return src; }

  // Tier 2: Wikipedia exact lookup with city stripped (geocode often has city appended)
  if (city) {
    const stripped = geocode.replace(new RegExp(`\\s+${city}\\s*$`, "i"), "").trim();
    if (stripped && stripped !== geocode) {
      const data2 = await wikiQueuedFetch(
        `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(stripped)}&prop=pageimages&format=json&pithumbsize=700&redirects=1&origin=*`
      );
      const page2 = Object.values(data2?.query?.pages || {})[0];
      const src2 = page2?.thumbnail?.source;
      if (good(src2) && pageRelevant(page2?.title)) { _usedPhotoUrls.add(src2); _photoCache[cacheKey] = src2; return src2; }
    }
  }

  // Tier 3: Wikipedia full-text search — finds the right article even when title doesn't match geocode exactly
  const searchQ = city ? `${geocode} ${city}` : geocode;
  const data3 = await wikiQueuedFetch(
    `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(searchQ)}&gsrlimit=5&prop=pageimages|description&pithumbsize=700&format=json&origin=*`
  );
  const results3 = Object.values(data3?.query?.pages || {});
  const PERSON_DESC = /\b(born|politician|actor|actress|singer|player|wrestler|athlete|writer|emperor|empress|manga|anime|artist|novelist|musician|composer|director|comedian|model|journalist|general|admiral|prince|princess|voice actor)\b/i;
  for (let ri = 0; ri < results3.length; ri++) {
    const page = results3[ri];
    // Skip person pages based on description
    if (page.description && PERSON_DESC.test(page.description)) { continue; }
    // Accept top 2 results without strict title relevance, but still check filename
    const relaxed = ri < 2;
    if (!relaxed && !pageRelevant(page.title)) continue;
    const src3 = page?.thumbnail?.source;
    if (good(src3) && photoFilenameRelevant(src3)) { _usedPhotoUrls.add(src3); _photoCache[cacheKey] = src3; return src3; }
  }

  // Tier 4: Wikimedia Commons file search — much larger photo pool than Wikipedia articles
  const commonsSearchQ = city ? `${geocode} ${city}` : geocode;
  const data4 = await wikiQueuedFetch(
    `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(commonsSearchQ)}&srnamespace=6&srlimit=3&format=json&origin=*`
  );
  const commonsResults = data4?.query?.search || [];
  for (const cr of commonsResults) {
    const title = cr.title;
    if (!title || /\.svg|logo|flag|icon|map|category/i.test(title)) continue;
    const data4b = await wikiQueuedFetch(
      `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url&iiurlwidth=700&format=json&origin=*`
    );
    const page4 = Object.values(data4b?.query?.pages || {})[0];
    const src4 = page4?.imageinfo?.[0]?.thumburl;
    if (good(src4)) { _usedPhotoUrls.add(src4); _photoCache[cacheKey] = src4; return src4; }
  }

  _photoCache[cacheKey] = null;
  return null;
}

// ── Geocoding utilities (shared by Map components and commute calculations) ──

// "Star Ferry to Elephanta Island"          → "Elephanta Island"
// "Street food walk at Mohammed Ali Road"   → "Mohammed Ali Road"
// "Hiking at Aarey Milk Colony"             → "Aarey Milk Colony"
// "Gateway of India"                        → "Gateway of India"
// "Dharavi Slum tour"                       → "Dharavi Slum"
export function extractPlace(title) {
  // Try preposition FIRST — catches "walk at X", "trip to X", "experience in X"
  const prep = title.match(/\b(?:at|to|in|near|around|from)\s+(.+)$/i);
  if (prep) return prep[1].trim();
  // Fall back: strip trailing activity descriptor and return remainder
  const stripped = title.replace(/\b(walk|tour|trip|trek|hike|hiking|cycling|trail|experience|exploration|visit|cruise|ferry ride|boat ride|day trip)\b.*$/i, "").trim();
  return stripped || title.trim();
}

const _geocodeCache = new Map();

let _tripDestination = ""; // set by App.jsx — provides country/region context for geocoding
export function setTripDestination(dest) { _tripDestination = dest || ""; }

export async function geocodePlace(title, city, geocodeHint) {
  // If geocodeHint is raw coordinates "lat,lng", use directly
  if (geocodeHint) {
    const m = geocodeHint.trim().match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  }

  // Build candidate place strings to try, in order of confidence.
  // 1) The LLM-provided geocode hint — best when it's a real searchable name
  // 2) extractPlace(title) — strips activity-type words (walk/tour/crawl) from the title.
  //    Catches the case where the LLM stored a non-geocodable activity phrase like
  //    "La Latina Neighbourhood Walk" — extractPlace yields "La Latina Neighbourhood" which Photon finds.
  const hint = geocodeHint?.trim() || "";
  const extracted = extractPlace(title || "")?.trim() || "";
  const candidates = [];
  if (hint) candidates.push(hint);
  if (extracted && extracted.toLowerCase() !== hint.toLowerCase()) candidates.push(extracted);
  if (!candidates.length) return null;

  const stripCity = (place) => city ? (() => {
    const esc = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return place
      .replace(new RegExp(`^${esc}\\s+`, "i"), "")
      .replace(new RegExp(`\\s+${esc}\\s*$`, "i"), "")
      .trim() || place;
  })() : place;

  // Enrich city with trip destination for better geocoding (e.g. "Kuta" → "Kuta, Bali")
  const enrichedCity = city && _tripDestination && !city.toLowerCase().includes(_tripDestination.toLowerCase().split(",")[0].split("→")[0].trim())
    ? `${city}, ${_tripDestination.split("→")[0].trim()}`
    : city;

  for (const candidate of candidates) {
    const cacheKey = `${candidate}|${city}`;
    if (_geocodeCache.has(cacheKey)) {
      const cached = _geocodeCache.get(cacheKey);
      if (cached) return cached;
      continue; // (we don't cache nulls in-memory, but be defensive)
    }
    const placeQ = stripCity(candidate);
    // Up to 2 attempts per candidate. Retry on EXCEPTIONS (timeout / network)
    // AND on empty {lat:null} responses — a single transient miss shouldn't bail out the candidate.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt > 0) await new Promise(r => setTimeout(r, 1500));
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 10000);
        const res = await fetch(`${PLACES_PROXY}?action=geocode`, {
          method: "POST", headers: PLACES_HEADERS,
          body: JSON.stringify({ q: placeQ, city: enrichedCity }),
          signal: ctrl.signal,
        });
        clearTimeout(tid);
        const { lat, lng } = await res.json();
        if (lat && lng) {
          const result = { lat, lng };
          _geocodeCache.set(cacheKey, result);
          return result;
        }
        // null response — fall through to retry (was a `break` before)
      } catch { /* timeout or network error — retry */ }
    }
    // Both attempts failed for this candidate — move on to the next one
  }
  // Don't cache nulls — allow retry on next view (server caches misses with short TTL)
  return null;
}

export function haversineMeters(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const x = Math.sin(dLat/2)**2 + Math.cos(a.lat*toR)*Math.cos(b.lat*toR)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}
