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

// ── Local verification of Supabase user access tokens ──────────────────────
//
// The proxy used to authenticate every paid call with a network round trip to
// GET /auth/v1/user. Production's database and Auth live in ap-northeast-1
// (Tokyo), but an edge function runs in the region nearest the caller
// (ap-south-1 for most users), so that hop crossed regions on every
// keystroke-driven autocomplete (measured 2026-10-28; see the commit message).
//
// Both projects sign user tokens with an asymmetric key (ES256) and publish
// the public half at /auth/v1/.well-known/jwks.json, so the signature can be
// checked in-process — Supabase's recommended path (`getClaims`). What it
// gives up: a token from a session that was signed out keeps working until it
// expires (at most 1h). The guarantee the proxy needs — a real, signed-in
// account, never the public anon key — is unchanged.
//
// Returns the user id (`sub`), or null for a token that is invalid. Returns
// undefined when the token is not one this can judge locally (legacy HS256,
// unknown kid, unexpected issuer), so the caller falls back to the network
// check instead — never a reason to call a paid upstream.

export type Jwk = JsonWebKey & { kid?: string; alg?: string };

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlJson(s: string): any {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

const ALG_PARAMS: Record<
  string,
  {
    import: EcKeyImportParams | RsaHashedImportParams;
    verify: EcdsaParams | AlgorithmIdentifier;
  }
> = {
  ES256: {
    import: { name: "ECDSA", namedCurve: "P-256" },
    verify: { name: "ECDSA", hash: "SHA-256" },
  },
  RS256: {
    import: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    verify: { name: "RSASSA-PKCS1-v1_5" },
  },
};

export async function verifyUserJwt(
  token: string,
  keys: Jwk[],
  opts: { issuer: string; nowSec?: number; leewaySec?: number },
): Promise<string | null | undefined> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header: any, claims: any;
  try {
    header = b64urlJson(parts[0]);
    claims = b64urlJson(parts[1]);
  } catch {
    return null;
  }
  const params = ALG_PARAMS[header?.alg];
  // Legacy symmetric tokens can't be checked without the project secret.
  if (!params) return undefined;
  const jwk = keys.find(
    (k) => k.kid === header.kid && (!k.alg || k.alg === header.alg),
  );
  if (!jwk) return undefined;

  let ok = false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      params.import,
      false,
      ["verify"],
    );
    ok = await crypto.subtle.verify(
      params.verify,
      key,
      b64urlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    return null;
  }
  if (!ok) return null;

  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const leeway = opts.leewaySec ?? 30;
  if (typeof claims?.exp !== "number" || claims.exp + leeway < now) return null;
  if (typeof claims.nbf === "number" && claims.nbf - leeway > now) return null;
  // Signed by this project's key but a different issuer string: the URL the
  // function sees (e.g. http://kong:8000 under `supabase start`) isn't the
  // public one. Defer to the network check rather than reject a real user.
  if (claims.iss !== opts.issuer) return undefined;
  // A real signed-in user — never the anon or service role.
  if (claims.role !== "authenticated") return null;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes("authenticated")) return null;
  if (typeof claims.sub !== "string" || !claims.sub) return null;
  return claims.sub;
}

// Unverified `sub` — ONLY for starting a read early (the per-user usage
// count) while verification runs. Never base a decision on it.
export function unverifiedSub(token: string): string | null {
  try {
    const sub = b64urlJson(token.split(".")[1] ?? "")?.sub;
    return typeof sub === "string" && sub ? sub : null;
  } catch {
    return null;
  }
}
