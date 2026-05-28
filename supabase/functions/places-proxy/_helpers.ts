// Pure helpers for places-proxy. No I/O, no env reads — kept in a separate
// module so they're unit-testable in Deno without starting the server.

// Hotel chain regex — Photon disambiguation is unreliable for chain names
// because biased search returns "nearest thing with the right vibe" rather
// than the actual brand. Verify-place forces escalation past Photon when
// a query matches this.
export const HOTEL_CHAIN_RE =
  /\b(hilton|marriott|hyatt|sheraton|westin|holiday\s*inn|best\s*western|ibis|gracery|comfort|hampton|courtyard|renaissance|ritz[-\s]carlton|four\s*seasons|park\s*hyatt|grand\s*hyatt|hyatt\s*regency|doubletree|embassy\s*suites|mercure|novotel|pullman|sofitel|premier\s*inn|travelodge|holiday\s*inn|days\s*inn|super\s*8|granbell|hilton\s*garden|hampton\s*inn|aloft|moxy|element|edition|park\s*plaza|crown\s*plaza|intercontinental|jw\s*marriott|w\s*hotel|st\s*regis|sheraton)\b/i;

// Generic place names where Photon biased to city centroid will likely return
// some plausible-looking-but-wrong nearby POI (a consulate, a random hotel,
// the main square). These short-circuit past Tier 1 (Photon) straight to
// Tier 2 (Nominatim) and Tier 3 (Haiku) inside verify-place.
export const GENERIC_NAME_RE =
  /\b(old\s*town|old\s*city|central\s*market|main\s*square|downtown|town\s*square|beach\s*club|main\s*street|market\s*square|town\s*centre|city\s*centre|town\s*center|city\s*center)\b/i;

// Combined: "this name will probably mis-resolve via Photon biased search".
export const RISKY_NAME_RE = new RegExp(
  `(${HOTEL_CHAIN_RE.source})|(${GENERIC_NAME_RE.source})`,
  "i",
);

// Normalize a place name for similarity comparison and cache keys.
// Strips diacritics, punctuation, common stopwords ("the", "a"), and lowercases.
const STOPWORDS = new Set(["the", "a", "an", "&", "and", "of"]);
export function normalizeName(s: string): string {
  if (!s) return "";
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((tok) => tok && !STOPWORDS.has(tok))
    .join(" ");
}

// Token-set similarity in [0, 1]. Uses Jaccard over normalized tokens with a
// small bonus for matching the first significant token (chain name like
// "westin"). Empty inputs return 0.
//
// Examples (with thresholds we use):
//   nameSimilarity("The Westin Sapporo", "在札幌米国総領事館")          → 0.0  (US Consulate, reject)
//   nameSimilarity("The Westin Sapporo", "The Westin Rusutsu Resort")  → ~0.4 (chain match, borderline)
//   nameSimilarity("Hokkaido Shrine", "北海道神宮")                     → 0.0  (Japanese name, no overlap — falls to Nominatim/Haiku)
//   nameSimilarity("Hokkaido Shrine", "Hokkaido Shrine")               → 1.0
export function nameSimilarity(query: string, candidate: string): number {
  const qn = normalizeName(query);
  const cn = normalizeName(candidate);
  if (!qn || !cn) return 0;
  const qTokens = new Set(qn.split(" "));
  const cTokens = new Set(cn.split(" "));
  if (qTokens.size === 0 || cTokens.size === 0) return 0;
  let intersection = 0;
  for (const t of qTokens) if (cTokens.has(t)) intersection++;
  const union = qTokens.size + cTokens.size - intersection;
  const jaccard = intersection / union;
  // First-token bonus when the leading non-stopword token matches (catches
  // chain brand alignment like Westin↔Westin).
  const qFirst = qn.split(" ")[0];
  const cFirst = cn.split(" ")[0];
  const firstBonus = qFirst && qFirst === cFirst ? 0.15 : 0;
  return Math.min(1, jaccard + firstBonus);
}

// Haversine distance in km between two lat/lng points. Duplicated from
// index.ts so the helpers module stays self-contained (and tests don't
// pull in the server entry).
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR;
  const dLng = (lng2 - lng1) * toR;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Strict validation for a Google Places search result. Returns { ok, reason }.
// Centroid coordinates are optional; if absent the distance check is skipped.
// Type "lodging" allows a wider radius because chain hotels are often outside
// city limits (Westin Rusutsu is 84 km from Sapporo and still a valid hotel).
export function validateGoogleResult(args: {
  query: string;
  displayName?: string | null;
  businessStatus?: string | null;
  resultLat: number;
  resultLng: number;
  centroidLat?: number;
  centroidLng?: number;
  type?: string | null;
}): { ok: boolean; reason: string } {
  // Brand-word presence: if the query contains a known chain word, the
  // result's displayName must contain that same word. Catches Google
  // returning a generic "Sapporo Hotel" for "Westin Sapporo".
  const chainMatch = args.query.match(HOTEL_CHAIN_RE);
  if (chainMatch && args.displayName) {
    const chain = chainMatch[0].toLowerCase().replace(/\s+/g, "");
    const display = args.displayName.toLowerCase().replace(/\s+/g, "");
    if (!display.includes(chain)) {
      return {
        ok: false,
        reason: `displayName "${args.displayName}" missing chain "${chainMatch[0]}"`,
      };
    }
  }

  // Business must be operational. Permanently closed places shouldn't
  // appear in itineraries.
  if (args.businessStatus && args.businessStatus !== "OPERATIONAL") {
    return { ok: false, reason: `business_status=${args.businessStatus}` };
  }

  // Distance from city centroid: lodging gets a wider cap because chains
  // can be far outside city limits.
  if (args.centroidLat != null && args.centroidLng != null) {
    const dist = haversineKm(
      args.centroidLat,
      args.centroidLng,
      args.resultLat,
      args.resultLng,
    );
    const cap = args.type === "lodging" ? 300 : 100;
    if (dist > cap) {
      return {
        ok: false,
        reason: `${Math.round(dist)}km from city centroid (cap ${cap}km for type=${args.type ?? "any"})`,
      };
    }
  }

  return { ok: true, reason: "" };
}
