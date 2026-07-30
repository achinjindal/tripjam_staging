/* ─── PHOTO UTILITIES ───────────────────────────────────────────────── */
// Shared mutable photo state and fetch logic, used by App.jsx and Magazine components.

import { PLACES_PROXY, PLACES_HEADERS } from "./theme";
import { supabase } from "./supabase";
export { PLACES_PROXY, PLACES_HEADERS };

export const _photoCache = {};
export const _usedPhotoUrls = new Set();
export const _PHOTO_IN_FLIGHT = Symbol("photo-in-flight");

let _activeTripId = null; // set when a trip is opened, used for hotel photo rate limits
export function setActiveTripId(id) {
  _activeTripId = id;
}
export function getActiveTripId() {
  return _activeTripId;
}

// Returns true if the URL looks like a person portrait or otherwise unsuitable place photo
export function _isPortrait(url) {
  const decoded = decodeURIComponent(url);
  return /portrait|headshot|cropped\)|_photo_of|mug.?shot|flag_of|coat_of_arms|logo|emblem|map_of|locator|location_map|blankmap|relief_map|seal_of|_at_the_|_in_\d{4}|_\d{4}_\(|_speaking|_performing|_award|_ceremony|_interview|dress_uniform|uniform_|_official|campaign_poster|_signing|_visit/i.test(
    decoded,
  );
}

export function makeQueue(delayMs, concurrency = 1) {
  const q = [];
  let active = 0;
  // Cool-down for the entire queue when the upstream rate-limits us (Wikimedia 429s).
  // While in cool-down, tasks remain queued but the runner pauses — once it expires,
  // we resume at the normal pace. Saves a thundering-herd retry storm.
  let cooldownUntil = 0;
  const run = async () => {
    while (active < concurrency && q.length > 0) {
      const now = Date.now();
      if (now < cooldownUntil) {
        // Sleep just long enough for the cooldown to clear, then resume.
        setTimeout(run, cooldownUntil - now + 50);
        return;
      }
      active++;
      const task = q.shift();
      task().finally(() => {
        active--;
        run();
      });
    }
  };
  return (url) =>
    new Promise((resolve) => {
      q.push(async () => {
        try {
          const ctrl = new AbortController();
          const tid = setTimeout(() => ctrl.abort(), 6000);
          const res = await fetch(url, { signal: ctrl.signal });
          clearTimeout(tid);
          if (res.status === 429) {
            // Rate-limited. Honor Retry-After if present (in seconds), else default 30s.
            const retryAfter = parseInt(
              res.headers.get("Retry-After") || "30",
              10,
            );
            cooldownUntil = Math.max(
              cooldownUntil,
              Date.now() + Math.min(retryAfter, 60) * 1000,
            );
            resolve(null);
          } else {
            resolve(res.ok ? await res.json() : null);
          }
        } catch {
          resolve(null);
        }
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      });
      run();
    });
}

export const wikiQueuedFetch = makeQueue(400, 2); // Wikimedia — 2 concurrent, 400ms stagger (avoid 429s)

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
  const BAD_PATTERNS =
    /\.(svg|pdf)(\.|$)|map|marker|locator|flag|coat.of.arms|emblem|logo|icon|pictogram|seal_of|coa_of|blank|skyline|panorama|aerial|regulation|commission|directive/i;
  const good = (url) =>
    url &&
    !_isPortrait(url) &&
    !_usedPhotoUrls.has(url) &&
    !BAD_PATTERNS.test(url);

  // Deduplicate: return cached result immediately if already fetched
  const cacheKey = `${geocode}||${city || ""}`;
  if (_photoCache[cacheKey] !== undefined) {
    const cached = _photoCache[cacheKey];
    if (cached === _PHOTO_IN_FLIGHT) return null;
    return cached && _usedPhotoUrls.has(cached) ? null : cached;
  }
  // Mark in-flight to prevent concurrent duplicate fetches
  _photoCache[cacheKey] = _PHOTO_IN_FLIGHT;
  // Strip leading/trailing city from geocode to avoid doubled query (e.g. "Hanoi La Siesta Classic Ma May" + city "Hanoi")
  const geocodeQ = city
    ? (() => {
        const esc = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return (
          geocode
            .replace(new RegExp(`^${esc}\\s+`, "i"), "")
            .replace(new RegExp(`\\s+${esc}\\s*$`, "i"), "")
            .trim() || geocode
        );
      })()
    : geocode;

  // Hotels: TripAdvisor primary (via server). Skip the _usedPhotoUrls dedup —
  // the same hotel legitimately appears in suggestion cards (Magazine/chat) AND
  // the itinerary check-in activity, and should show the same photo in both.
  if (type === "hotel") {
    try {
      const res = await fetch(`${PLACES_PROXY}?action=hotel-photo`, {
        method: "POST",
        headers: PLACES_HEADERS,
        body: JSON.stringify({
          q: geocodeQ,
          city,
          tripId: hotelOpts?.tripId || _activeTripId,
          context: hotelOpts?.context || "itinerary",
        }),
      });
      const { url: photoUrl } = await res.json();
      if (photoUrl && !_isPortrait(photoUrl) && !BAD_PATTERNS.test(photoUrl)) {
        _photoCache[cacheKey] = photoUrl;
        return photoUrl;
      }
    } catch {
      /* hotel-photo endpoint unavailable */
    }
    _photoCache[cacheKey] = null;
    return null;
  }

  // Food dishes: the landmark pipeline (city-scoped Wikipedia + relevance
  // filters) almost never matches a dish. Query the BARE dish name — most named
  // dishes (Tagine, Couscous, Pho, Pad Thai) have a Wikipedia article with an
  // appetising lead image. Then Commons, then a server-side stock fallback.
  // Skip the _usedPhotoUrls dedup: a dish photo isn't a unique-place photo.
  if (type === "food") {
    const foodGood = (url) =>
      url && !_isPortrait(url) && !BAD_PATTERNS.test(url);
    // Normalise: drop parentheticals and a leading protein word so
    // "Chicken Tagine (slow-cooked)" also tries "Tagine".
    const dishRaw = geocode.replace(/\([^)]*\)/g, "").trim();
    const dishHead = dishRaw
      .replace(
        /^(chicken|beef|lamb|pork|fish|prawn|shrimp|vegetable|veg)\s+/i,
        "",
      )
      .trim();
    const dishCandidates = Array.from(
      new Set([dishRaw, dishHead].filter(Boolean)),
    );

    // 1. Wikipedia REST summary by bare dish name (follows redirects, returns a
    //    lead image). No city, no landmark relevance filter.
    for (const dish of dishCandidates) {
      const summary = await wikiQueuedFetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(dish)}?redirect=true`,
      );
      const img =
        summary?.originalimage?.source || summary?.thumbnail?.source || null;
      if (
        img &&
        foodGood(img) &&
        summary?.type !== "disambiguation" &&
        !/may refer to/i.test(summary?.extract || "")
      ) {
        _photoCache[cacheKey] = img;
        return img;
      }
    }

    // 2. Wikimedia Commons file search by bare dish name.
    for (const dish of dishCandidates) {
      const data4 = await wikiQueuedFetch(
        `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(dish + " food")}&srnamespace=6&srlimit=3&format=json&origin=*`,
      );
      const results = data4?.query?.search || [];
      for (const cr of results) {
        const title = cr.title;
        if (!title || /\.svg|logo|flag|icon|map|category/i.test(title))
          continue;
        const data4b = await wikiQueuedFetch(
          `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url&iiurlwidth=700&format=json&origin=*`,
        );
        const page4 = Object.values(data4b?.query?.pages || {})[0];
        const src4 = page4?.imageinfo?.[0]?.thumburl;
        if (foodGood(src4)) {
          _photoCache[cacheKey] = src4;
          return src4;
        }
      }
    }

    // 3. Server-side stock fallback (Pexels) — keyed API, so proxied.
    try {
      const res = await fetch(`${PLACES_PROXY}?action=food-photo`, {
        method: "POST",
        headers: PLACES_HEADERS,
        body: JSON.stringify({ q: dishHead || dishRaw }),
      });
      const { url: stockUrl } = await res.json();
      if (stockUrl && foodGood(stockUrl)) {
        _photoCache[cacheKey] = stockUrl;
        return stockUrl;
      }
    } catch {
      /* food-photo endpoint unavailable */
    }

    _photoCache[cacheKey] = null;
    return null;
  }

  const STOPWORDS = new Set([
    "the",
    "a",
    "an",
    "of",
    "in",
    "at",
    "on",
    "and",
    "by",
    "for",
    "to",
    "de",
    "el",
    "la",
  ]);
  // Strip city words from geocode — city name alone shouldn't count as a relevance match
  // e.g. "Hang Dao Street Hanoi" → "Hang Dao Street" so "Hanoi Film Festival" doesn't pass
  const cityWords = new Set(
    (city || "").toLowerCase().split(/\s+/).filter(Boolean),
  );
  const geocodeWithoutCity = geocode
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => !cityWords.has(w))
    .join(" ");
  const geocodeWords = geocodeWithoutCity
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
  // Fallback: if all words are too short (e.g. "Pho Bat Dan"), use the full geocode as one token
  const relevanceTokens =
    geocodeWords.length > 0 ? geocodeWords : [geocode.toLowerCase()];
  // Check that the Wikipedia page title (after redirect) is still relevant to the geocode.
  // Prevents generic city/country article thumbnails from being returned for specific places.
  const pageRelevant = (pageTitle) => {
    const t = (pageTitle || "").toLowerCase();
    return relevanceTokens.some((w) => t.includes(w));
  };
  // Check that the photo filename itself isn't clearly unrelated to the geocode.
  // e.g. "Old_Quarter_Street_Scene_Hanoi.jpg" should not match "Hoan Kiem Lake & Ngoc Son Temple"
  const photoFilenameRelevant = (url) => {
    const filename = decodeURIComponent((url || "").split("/").pop() || "")
      .replace(/\.\w+$/, "")
      .toLowerCase();
    const fileWords = filename
      .split(/[\s_\-()]+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
    if (fileWords.length <= 2) return true; // short or numeric filenames: no strong signal, allow
    return relevanceTokens.some((rt) =>
      fileWords.some((fw) => fw.includes(rt) || rt.includes(fw)),
    );
  };

  // Strip generic POI suffixes — Wikipedia articles are usually titled "Senso-ji" not
  // "Senso-ji Temple", "Tsurugaoka Hachimangu" not "...Shrine", etc. The exact-title lookup
  // misses ~90% of highlight cards without this, leaving them perma-skeleton. Same regex
  // (and iterative strip) as the geocoder uses in places-proxy/index.ts.
  const POI_SUFFIX_RE =
    /\s+(temple|shrine|mosque|church|cathedral|market|road|street|beach|fort|palace|museum|gardens?|park|square|bridge|tower|station|castle|monument|memorial)$/i;
  const stripPoiSuffix = (s) => {
    let out = s;
    let prev;
    do {
      prev = out;
      out = out.replace(POI_SUFFIX_RE, "").trim();
    } while (out && out !== prev);
    return out;
  };
  const titleCandidates = [geocode];
  if (city) {
    const noCity = geocode
      .replace(new RegExp(`\\s+${city}\\s*$`, "i"), "")
      .trim();
    if (noCity && noCity !== geocode) titleCandidates.push(noCity);
  }
  const withoutSuffix = stripPoiSuffix(geocode);
  if (withoutSuffix && withoutSuffix !== geocode)
    titleCandidates.push(withoutSuffix);
  if (city) {
    const noCityNoSuffix = stripPoiSuffix(
      geocode.replace(new RegExp(`\\s+${city}\\s*$`, "i"), "").trim(),
    );
    if (
      noCityNoSuffix &&
      !titleCandidates.some(
        (c) => c.toLowerCase() === noCityNoSuffix.toLowerCase(),
      )
    ) {
      titleCandidates.push(noCityNoSuffix);
    }
  }

  // Tier 1 + 2: Wikipedia exact title lookup across the candidate variants in order.
  // Trust the article's hero image when the page title is relevant — exact-title matches
  // with redirects are authoritative, and the filename check would reject valid hero
  // images whose filenames don't happen to contain the geocode tokens (e.g.
  // Wat Phra Yai → Big_Buddha_Koh_Samui.jpg, Senso-ji → Sensoji_2023.jpg).
  for (const candidate of titleCandidates) {
    const data = await wikiQueuedFetch(
      `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(candidate)}&prop=pageimages&format=json&pithumbsize=700&redirects=1&origin=*`,
    );
    const page = Object.values(data?.query?.pages || {})[0];
    const src = page?.thumbnail?.source;
    if (good(src) && pageRelevant(page?.title)) {
      _usedPhotoUrls.add(src);
      _photoCache[cacheKey] = src;
      return src;
    }
  }

  // Tier 3: Wikipedia full-text search — finds the right article even when title doesn't match geocode exactly
  const searchQ = city ? `${geocode} ${city}` : geocode;
  const data3 = await wikiQueuedFetch(
    `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(searchQ)}&gsrlimit=5&prop=pageimages|description&pithumbsize=700&format=json&origin=*`,
  );
  // Sort search results by their "index" field so we evaluate in the actual search-rank
  // order (Object.values on the response is unordered — top results were being skipped).
  const results3 = Object.values(data3?.query?.pages || {}).sort(
    (a, b) => (a.index ?? 999) - (b.index ?? 999),
  );
  const PERSON_DESC =
    /\b(born|politician|actor|actress|singer|player|wrestler|athlete|writer|emperor|empress|manga|anime|artist|novelist|musician|composer|director|comedian|model|journalist|general|admiral|prince|princess|voice actor)\b/i;
  for (let ri = 0; ri < results3.length; ri++) {
    const page = results3[ri];
    // Skip person pages based on description
    if (page.description && PERSON_DESC.test(page.description)) {
      continue;
    }
    // If the page title is itself relevant to the geocode, trust it without the
    // filename check (mirrors the Tier 1/2 logic). Many valid hero images have
    // filenames that don't contain the place name (e.g. "Day2-2_(40909714314).jpg").
    const titleHit = pageRelevant(page.title);
    // Accept top 2 results without strict title relevance, but still check filename
    const relaxed = ri < 2;
    if (!relaxed && !titleHit) continue;
    const src3 = page?.thumbnail?.source;
    if (good(src3) && (titleHit || photoFilenameRelevant(src3))) {
      _usedPhotoUrls.add(src3);
      _photoCache[cacheKey] = src3;
      return src3;
    }
  }

  // Tier 4: Wikimedia Commons file search — much larger photo pool than Wikipedia articles
  const commonsSearchQ = city ? `${geocode} ${city}` : geocode;
  const data4 = await wikiQueuedFetch(
    `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(commonsSearchQ)}&srnamespace=6&srlimit=3&format=json&origin=*`,
  );
  const commonsResults = data4?.query?.search || [];
  for (const cr of commonsResults) {
    const title = cr.title;
    if (!title || /\.svg|logo|flag|icon|map|category/i.test(title)) continue;
    const data4b = await wikiQueuedFetch(
      `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url&iiurlwidth=700&format=json&origin=*`,
    );
    const page4 = Object.values(data4b?.query?.pages || {})[0];
    const src4 = page4?.imageinfo?.[0]?.thumburl;
    if (good(src4)) {
      _usedPhotoUrls.add(src4);
      _photoCache[cacheKey] = src4;
      return src4;
    }
  }

  _photoCache[cacheKey] = null;
  return null;
}

/** Split combined LLM sight names ("Bhadra Fort and Teen Darwaza") for Wikipedia lookup. */
function _splitCombinedGeocode(name) {
  if (!name) return [""];
  const parts = name
    .split(/\s+(?:and|&|·)\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [name];
}

/** Fetch Wikipedia photos for city-deep-dive moreSights sequentially (non-blocking in App). */
export async function attachPhotosToMoreSights(data, city) {
  if (!data?.moreSights?.length) return data;
  const moreSights = [];
  for (const sight of data.moreSights) {
    const searchKey = sight.geocode || sight.title || "";
    let photo_url = sight.photo_url || null;
    if (!photo_url && searchKey) {
      for (const candidate of _splitCombinedGeocode(searchKey)) {
        const url = await _fetchPhoto(candidate, city, sight.type || "sight");
        if (url) {
          photo_url = url;
          break;
        }
      }
    }
    moreSights.push(photo_url ? { ...sight, photo_url } : sight);
  }
  return { ...data, moreSights };
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
  const stripped = title
    .replace(
      /\b(walk|tour|trip|trek|hike|hiking|cycling|trail|experience|exploration|visit|cruise|ferry ride|boat ride|day trip)\b.*$/i,
      "",
    )
    .trim();
  return stripped || title.trim();
}

const _geocodeCache = new Map();

let _tripDestination = ""; // set by App.jsx — provides country/region context for geocoding
export function setTripDestination(dest) {
  _tripDestination = dest || "";
}

// Append the trip destination/country to a bare city so ambiguous place names
// don't geocode to the wrong continent — e.g. "Nara" (read as the acronym NARA
// = US National Archives) → "Nara, Japan". No-op when the city already contains
// the destination or no trip destination is set.
function enrichCity(city) {
  if (!city || !_tripDestination) return city;
  const dest = _tripDestination.split("→")[0].trim();
  const destHead = dest.split(",")[0].trim().toLowerCase();
  return destHead && city.toLowerCase().includes(destHead)
    ? city
    : `${city}, ${dest}`;
}

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
  if (extracted && extracted.toLowerCase() !== hint.toLowerCase())
    candidates.push(extracted);
  if (!candidates.length) return null;

  const stripCity = (place) =>
    city
      ? (() => {
          const esc = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          return (
            place
              .replace(new RegExp(`^${esc}\\s+`, "i"), "")
              .replace(new RegExp(`\\s+${esc}\\s*$`, "i"), "")
              .trim() || place
          );
        })()
      : place;

  // Enrich city with trip destination for better geocoding (e.g. "Kuta" → "Kuta, Bali")
  const enrichedCity =
    city &&
    _tripDestination &&
    !city
      .toLowerCase()
      .includes(
        _tripDestination.toLowerCase().split(",")[0].split("→")[0].trim(),
      )
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
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 10000);
        const res = await fetch(`${PLACES_PROXY}?action=geocode`, {
          method: "POST",
          headers: PLACES_HEADERS,
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
      } catch {
        /* timeout or network error — retry */
      }
    }
    // Both attempts failed for this candidate — move on to the next one
  }
  // Don't cache nulls — allow retry on next view (server caches misses with short TTL)
  return null;
}

export function haversineMeters(a, b) {
  const R = 6371000,
    toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR,
    dLng = (b.lng - a.lng) * toR;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/* ─── VERIFY-PLACE CLIENT (Hardened geocoding ladder) ─────────────────── */
//
// Calls places-proxy?action=verify-place and persists the result (coords +
// metadata) directly onto the activities row. Deduplicates concurrent calls
// for the same activity id so the eager-Day-1 burst and lazy-render path
// don't double-bill the user.

const _verifyInFlight = new Map(); // activityId -> Promise

// Strip "Check in at " prefix etc. so the verifier sees a real place name.
function _verifyPlaceName(activity) {
  if (!activity?.title) return "";
  return activity.title.replace(/^check[ -]?in (?:at )?/i, "").trim();
}

// Returns one of:
//   { status: "verified", coords: { lat, lng }, source, correctedFrom?, correctedTo?, repairReason? }
//   { status: "alternatives", alternatives: [{ name, hint, reason }], reason? }
//   { status: "unresolved", reason? }
//   { status: "skipped", reason }  — no auth / hotel without name / etc.
export async function verifyActivity(activity, city, session, tripId) {
  if (!activity?.id) return { status: "skipped", reason: "no activity id" };
  if (!session?.access_token)
    return { status: "skipped", reason: "no session" };

  // Dedup in-flight calls for the same activity.
  if (_verifyInFlight.has(activity.id)) {
    return _verifyInFlight.get(activity.id);
  }

  const promise = (async () => {
    const name = _verifyPlaceName(activity);
    if (!name) return { status: "skipped", reason: "no name" };

    let resolved;
    try {
      const res = await fetch(`${PLACES_PROXY}?action=verify-place`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          name,
          // Enrich with the trip country so ambiguous names (e.g. "Nara") and
          // the proximity-bias resolution don't land on the wrong continent.
          city: enrichCity(city) || null,
          hint: activity.geocode || null,
          type: activity.type === "hotel" ? "lodging" : null,
          tripId: tripId || null,
        }),
      });
      if (!res.ok) {
        // 401/402/etc — don't persist anything, just skip
        return { status: "skipped", reason: `http ${res.status}` };
      }
      resolved = await res.json();
    } catch (e) {
      return { status: "skipped", reason: `network: ${e.message}` };
    }

    // Verified case — persist coords + metadata
    if (resolved?.lat != null && resolved?.lng != null) {
      const update = {
        lat: resolved.lat,
        lng: resolved.lng,
        geocode_source: resolved.source || null,
        geocode_confidence: resolved.confidence || null,
        geocode_verified_at: new Date().toISOString(),
      };
      if (resolved.place_id) update.place_id = resolved.place_id;
      if (resolved.business_status)
        update.business_status = resolved.business_status;
      if (
        resolved.repaired &&
        resolved.corrected_from &&
        resolved.corrected_to
      ) {
        update.geocode_corrected_from = resolved.corrected_from;
        // Also update the title to the corrected canonical name (transparency
        // hint surfaced separately via geocode_corrected_from).
        // For hotels, prepend "Check in at " to keep title format.
        const newTitle =
          activity.type === "hotel"
            ? `Check in at ${resolved.corrected_to}`
            : resolved.corrected_to;
        update.title = newTitle;
        update.geocode = resolved.corrected_to;
      }
      supabase
        .from("activities")
        .update(update)
        .eq("id", activity.id)
        .then(
          () => {},
          () => {},
        );
      return {
        status: "verified",
        coords: { lat: resolved.lat, lng: resolved.lng },
        source: resolved.source,
        correctedFrom: resolved.corrected_from || null,
        correctedTo: resolved.corrected_to || null,
        repairReason: resolved.repair_reason || null,
        updateFields: update,
      };
    }

    // Alternatives case — picker UX
    if (
      resolved?.status === "needs_user_choice" &&
      Array.isArray(resolved.alternatives)
    ) {
      // Mark verified_at so we don't re-run on every render. lat stays null
      // — the UI uses (verified_at IS NOT NULL && lat IS NULL) as the
      // "tried and failed automatic verification" signal.
      const update = { geocode_verified_at: new Date().toISOString() };
      supabase
        .from("activities")
        .update(update)
        .eq("id", activity.id)
        .then(
          () => {},
          () => {},
        );
      return {
        status: "alternatives",
        alternatives: resolved.alternatives,
        reason: resolved.reason || null,
      };
    }

    // Unresolved — also mark verified_at to avoid re-spamming
    const update = { geocode_verified_at: new Date().toISOString() };
    supabase
      .from("activities")
      .update(update)
      .eq("id", activity.id)
      .then(
        () => {},
        () => {},
      );
    return { status: "unresolved", reason: resolved?.reason || null };
  })();

  _verifyInFlight.set(activity.id, promise);
  promise.finally(() => _verifyInFlight.delete(activity.id));
  return promise;
}

// Helper: does an activity need verification?
//   - No id → can't verify (skip).
//   - geocode_verified_at IS NOT NULL → already tried via the verify ladder,
//     don't retry (success or graceful failure both set this).
//   - Pure new row (no lat, no verified_at) → needs verification.
//   - Legacy backfill row (lat IS NOT NULL but geocode_verified_at AND
//     geocode_source are both NULL) → the coord came from MapView's old
//     geocodePlace path (pre verify-ladder) which had no name-similarity
//     guard and produced known-bad results (e.g. Romanian cathedral matched
//     for "Orthodox Metropolitan Cathedral, Fira, Santorini"). Re-verify and
//     overwrite once.
export function needsVerification(activity) {
  if (!activity?.id) return false;
  if (activity.geocode_verified_at) return false;
  if (activity.lat == null || activity.lng == null) return true;
  // lat + lng present without metadata = legacy backfill, suspect → re-verify
  return !activity.geocode_source;
}
