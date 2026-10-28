// Instant destination suggestions for the setup form's search, shown while
// the places-proxy autocomplete request is in flight.
//
// A network suggestion takes one edge-function call (and, on a server cache
// miss, a Google call). Measured from India on prod, 2026-10-28: p50 ~0.6s,
// p90 ~1.5s, with spikes to many seconds. Typing "tokyo" should not show a
// spinner for any of that, so the field answers from memory first:
//   1. results already fetched for this exact query (any mount, this tab);
//   2. results fetched for a shorter prefix, filtered to the new query
//      ("tok" → "Tokyo" while "toky" is in flight);
//   3. a short list of popular destinations.
// The network results replace these as soon as they arrive.
//
// Items use Google's autocomplete shape so the list renders and picks them
// exactly like a real result (pickSuggestion reads structuredFormat.mainText).

// [main, secondary]. Main is what gets stored as the destination.
const POPULAR = [
  ["Tokyo", "Japan"],
  ["Kyoto", "Japan"],
  ["Osaka", "Japan"],
  ["Hokkaido", "Japan"],
  ["Japan", ""],
  ["Seoul", "South Korea"],
  ["Bangkok", "Thailand"],
  ["Phuket", "Thailand"],
  ["Chiang Mai", "Thailand"],
  ["Koh Samui", "Thailand"],
  ["Krabi", "Thailand"],
  ["Thailand", ""],
  ["Bali", "Indonesia"],
  ["Singapore", ""],
  ["Kuala Lumpur", "Malaysia"],
  ["Langkawi", "Malaysia"],
  ["Hanoi", "Vietnam"],
  ["Ho Chi Minh City", "Vietnam"],
  ["Da Nang", "Vietnam"],
  ["Hoi An", "Vietnam"],
  ["Vietnam", ""],
  ["Siem Reap", "Cambodia"],
  ["Hong Kong", ""],
  ["Taipei", "Taiwan"],
  ["Beijing", "China"],
  ["Shanghai", "China"],
  ["Manila", "Philippines"],
  ["Palawan", "Philippines"],
  ["Maldives", ""],
  ["Sri Lanka", ""],
  ["Kathmandu", "Nepal"],
  ["Bhutan", ""],
  ["Dubai", "United Arab Emirates"],
  ["Abu Dhabi", "United Arab Emirates"],
  ["Istanbul", "Turkey"],
  ["Cappadocia", "Turkey"],
  ["Goa", "India"],
  ["Kerala", "India"],
  ["Rajasthan", "India"],
  ["Jaipur", "Rajasthan, India"],
  ["Udaipur", "Rajasthan, India"],
  ["Jodhpur", "Rajasthan, India"],
  ["Jaisalmer", "Rajasthan, India"],
  ["Delhi", "India"],
  ["Mumbai", "Maharashtra, India"],
  ["Agra", "Uttar Pradesh, India"],
  ["Varanasi", "Uttar Pradesh, India"],
  ["Rishikesh", "Uttarakhand, India"],
  ["Ladakh", "India"],
  ["Leh", "Ladakh, India"],
  ["Manali", "Himachal Pradesh, India"],
  ["Shimla", "Himachal Pradesh, India"],
  ["Darjeeling", "West Bengal, India"],
  ["Andaman and Nicobar Islands", "India"],
  ["Hampi", "Karnataka, India"],
  ["Munnar", "Kerala, India"],
  ["Pondicherry", "India"],
  ["Paris", "France"],
  ["Nice", "France"],
  ["London", "United Kingdom"],
  ["Edinburgh", "Scotland, United Kingdom"],
  ["Scottish Highlands", "Scotland, United Kingdom"],
  ["Amsterdam", "Netherlands"],
  ["Barcelona", "Spain"],
  ["Madrid", "Spain"],
  ["Seville", "Spain"],
  ["Lisbon", "Portugal"],
  ["Porto", "Portugal"],
  ["Rome", "Italy"],
  ["Florence", "Italy"],
  ["Venice", "Italy"],
  ["Milan", "Italy"],
  ["Amalfi Coast", "Italy"],
  ["Sicily", "Italy"],
  ["Tuscany", "Italy"],
  ["Santorini", "Greece"],
  ["Athens", "Greece"],
  ["Mykonos", "Greece"],
  ["Crete", "Greece"],
  ["Prague", "Czechia"],
  ["Vienna", "Austria"],
  ["Budapest", "Hungary"],
  ["Berlin", "Germany"],
  ["Munich", "Germany"],
  ["Zurich", "Switzerland"],
  ["Interlaken", "Switzerland"],
  ["Switzerland", ""],
  ["Copenhagen", "Denmark"],
  ["Stockholm", "Sweden"],
  ["Iceland", ""],
  ["Norway", ""],
  ["Dubrovnik", "Croatia"],
  ["Morocco", ""],
  ["Marrakesh", "Morocco"],
  ["Cairo", "Egypt"],
  ["Cape Town", "South Africa"],
  ["Zanzibar", "Tanzania"],
  ["Kenya", ""],
  ["Mauritius", ""],
  ["Seychelles", ""],
  ["New York", "NY, USA"],
  ["Los Angeles", "CA, USA"],
  ["San Francisco", "CA, USA"],
  ["Las Vegas", "NV, USA"],
  ["Hawaii", "USA"],
  ["Miami", "FL, USA"],
  ["Vancouver", "BC, Canada"],
  ["Banff", "AB, Canada"],
  ["Mexico City", "Mexico"],
  ["Cancún", "Quintana Roo, Mexico"],
  ["Peru", ""],
  ["Cusco", "Peru"],
  ["Patagonia", "Argentina"],
  ["Buenos Aires", "Argentina"],
  ["Rio de Janeiro", "Brazil"],
  ["Sydney", "NSW, Australia"],
  ["Melbourne", "VIC, Australia"],
  ["Queenstown", "New Zealand"],
  ["New Zealand", ""],
  ["Fiji", ""],
];

const shape = (main, secondary) => ({
  placePrediction: {
    text: { text: secondary ? `${main}, ${secondary}` : main },
    structuredFormat: {
      mainText: { text: main },
      ...(secondary ? { secondaryText: { text: secondary } } : {}),
    },
  },
  _instant: true,
});

const POPULAR_ITEMS = POPULAR.map(([m, s]) => shape(m, s));

// Cache key / match normaliser: case- and accent-insensitive.
export const fold = (s) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// True when any word of the item's text starts with the query
// ("ho chi" matches "Ho Chi Minh City", "minh" matches it too).
function matches(item, q) {
  const p = item?.placePrediction;
  const main = fold(p?.structuredFormat?.mainText?.text || p?.text?.text);
  if (!main) return false;
  return (
    main.startsWith(q) || main.split(/[\s,-]+/).some((w) => w.startsWith(q))
  );
}

// fold(query) → suggestions, shared by every SetupForm mount in this tab, so
// reopening the sheet or going back a step answers instantly.
export const destSuggestCache = new Map();

// Best answer available without the network for `query`, or null.
// `exact` is true when it is the full network result for this query (no
// request needed); otherwise the items are provisional.
export function instantSuggestions(query, limit = 8) {
  const q = fold(query);
  if (q.length < 2) return null;
  const hit = destSuggestCache.get(q);
  if (hit) return { items: hit, exact: true };

  const out = [];
  const seen = new Set();
  const push = (item) => {
    const p = item.placePrediction;
    const key = fold(p?.text?.text || p?.structuredFormat?.mainText?.text);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };
  // Longest cached prefix first — it is the closest to what Google will say.
  for (let n = q.length - 1; n >= 2 && out.length === 0; n--) {
    const prev = destSuggestCache.get(q.slice(0, n));
    if (prev) prev.filter((it) => matches(it, q)).forEach(push);
  }
  POPULAR_ITEMS.filter((it) => matches(it, q)).forEach(push);
  return out.length ? { items: out.slice(0, limit), exact: false } : null;
}
