import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log("Request body:", JSON.stringify(body));
    const { destinations, numDays, travelers, styles, budget, pace, morningStart, startDate, arrivalCity, arrivalTime, departureCity, departureTime, hotelName, hotelArea } = body;

    const budgetLabel = { budget: "budget (hostels, street food)", mid: "mid-range (3-star hotels, local restaurants)", luxury: "luxury (5-star hotels, fine dining)" }[budget] || "mid-range";
    const stylesText = styles.join(", ");
    const paceNote = pace === "relaxed"
      ? "PACE: This is a relaxed trip. Plan 2-3 activities per day maximum, with gaps for rest, wandering, or sitting at a cafe. Do not pack the day."
      : "PACE: This is an active trip. Plan 3-4 activities per day and make good use of the time available.";
    const morningNote = morningStart === "late"
      ? "MORNING ROUTINE: These travelers like a slow start. On days without a flight constraint, the first activity should not begin before 10:30–11:00. Build in time for a leisurely breakfast. Only start earlier if there is a genuinely unmissable reason (e.g. sunrise at a landmark, avoiding extreme midday heat, timed entry)."
      : "MORNING ROUTINE: These travelers are early birds. First activity can start at 08:00–09:00 to beat crowds and enjoy the cool morning.";

    // Compute ready time if arrival is provided
    let day1Note = "";
    if (arrivalTime) {
      const [h, m] = arrivalTime.split(":").map(Number);
      const rawReady = h * 60 + m + 30 + 45 + 90; // airport + drive + hotel check-in
      const readyMins = Math.round(rawReady / 30) * 30;
      const readyHH = String(Math.floor(readyMins / 60) % 24).padStart(2, "0");
      const readyMM = String(readyMins % 60).padStart(2, "0");
      day1Note = `DAY 1 CONSTRAINT: Traveler lands at ${arrivalTime} in ${arrivalCity || destinations[0]}${hotelName ? ` and checks into ${hotelName}` : ""}. They will be ready to start sightseeing at ${readyHH}:${readyMM}. Day 1 activities MUST start at ${readyHH}:${readyMM} or later and MUST be in ${arrivalCity || destinations[0]}. Plan only 2-3 activities that fit naturally between ${readyHH}:${readyMM} and 21:30. Do not start Day 1 at 09:00.`;
    }

    let lastDayNote = "";
    if (departureTime) {
      const [h, m] = departureTime.split(":").map(Number);
      const cutoffMins = h * 60 + m - 150; // 2.5h buffer for travel + check-in
      const cutHH = String(Math.floor(cutoffMins / 60) % 24).padStart(2, "0");
      const cutMM = String(cutoffMins % 60).padStart(2, "0");
      lastDayNote = `LAST DAY CONSTRAINT: Return flight departs at ${departureTime} from ${departureCity || destinations[destinations.length - 1]}. All activities on the last day must end by ${cutHH}:${cutMM} to allow time to travel to the airport and check in.`;
    }

    const hotelNote = hotelName ? `The traveler is staying at ${hotelName}${hotelArea ? ` in ${hotelArea}` : ""}. Plan the trip to minimise commute — start with activities closest to the hotel and fan outward through the day.` : "";

    const travelMonth = startDate ? new Date(startDate).toLocaleString("en-US", { month: "long" }) : null;

    const prompt = `You are a travel expert. Generate a ${numDays}-day itinerary for: ${destinations.join(" → ")}.

Trip: ${travelers} travelers, ${stylesText} style, ${budgetLabel} budget.${travelMonth ? ` Travel dates: ${travelMonth}.` : ""}

${paceNote}
${morningNote}${day1Note ? `\n\n${day1Note}` : ""}${lastDayNote ? `\n\n${lastDayNote}` : ""}${hotelNote ? `\n${hotelNote}` : ""}

Rules:
- Titles must be REAL specific place names — e.g. Trishna, Leopold Cafe, Juhu Beach, Khao San Road street food. Never use generic titles like Lunch, Dinner, City Park, Local Restaurant.
- NEVER invent or combine place names. Use the exact name as it is known — do not merge two real places into one (e.g. "Bandra-Kurla Bandstand Promenade" is wrong because Bandra-Kurla Complex and Bandstand Promenade are two different places; the correct name is simply "Bandstand Promenade"). If you are not certain of the exact name of a place, suggest a well-known area or street instead. Before finalising any title, ask yourself: "Am I combining two distinct place names into one?" — if yes, use only the more specific of the two.
- CRITICAL: Only suggest a restaurant if you are certain it is actually located in that neighbourhood. If you are unsure of a restaurant's exact location, suggest a food street, market, or well-known dining area instead (e.g. Bandra food stalls near Hill Road, Chowpatty Beach chaat).
- RELIABILITY: Strongly prefer restaurants and venues established for many years — well-known institutions unlikely to have closed. Avoid trendy or recently-opened places. Favour decades-old Irani cafes, heritage dhabas, long-running seafood spots over newer fashionable options.
- Each activity covers exactly ONE thing — never combine transit with a meal or two sights into one slot (e.g. "Return ferry and lunch" is wrong; make them separate activities).
- Transit to a day-trip destination (ferry, boat, bus) includes the return — do NOT add a separate Return activity.
- The note field: keep very short, no apostrophes or quotes in the text.
- The geocode field: the shortest plain name that will find the DEPARTURE/MEETING POINT on a map. For ferry or boat day trips use the departure pier — e.g. "Elephanta Caves day trip" → geocode "Gateway of India Pier Mumbai". For all other activities strip descriptors and use just the place name (e.g. "Colaba Causeway Street Market" → "Colaba Causeway"). Do NOT append a neighbourhood, area, or locality to the geocode — the place name itself is sufficient and more accurate. "Thane Creek Flamingo Sanctuary" is correct; "Thane Creek Flamingo Sanctuary Airoli" is wrong.
- For multi-destination trips: include a transit activity on the first day of each new city.
- GEOGRAPHY: Think in zones. Each day should be anchored in one zone or neighbourhood — cover what that zone has to offer fully before moving on. Travelers should not need to return to a zone they already visited. Example of what NOT to do: morning at Gateway of India (South Mumbai) → lunch in Bandra (15km away) → back to Marine Drive for sunset. That is wrong. Meals must be in the same zone as surrounding sightseeing.
- WEATHER: Consider the travel month and destination climate. If the weather is expected to be hot or humid in the afternoon (e.g. Mumbai May–September, Rajasthan April–June, Bangkok March–May), do not schedule outdoor activities between 12:00–16:00. Reserve outdoor sightseeing for mornings, evenings, or after dark. Indoor activities (museums, restaurants, galleries, malls) are fine in the afternoon heat.
- HOTEL: If a hotel is provided, minimise commute. On early days plan activities closest to the hotel first, fanning outward. If the first day starts late, suggest nearby points first and save a further-away experience for the evening when travel feels more worthwhile.
- COMMUTE: Look for unique or characterful ways to get between points — a local train in Mumbai, a longtail boat in Bangkok, a tuk-tuk in Delhi, a vaporetto in Venice. Where one fits naturally as a transit activity, include it.
- Distribute days evenly across destinations if multiple.
- Each day must include a "description" field: 2-3 sentences painting a picture of the day — what neighbourhood we're in, what we'll experience, and what makes it special. Second person ("You'll start your morning…"). Vivid and concise, no bullet points.

Return ONLY valid JSON, no markdown, no code fences:
{"name":"Mumbai Explorer","days":[{"label":"Day 1","city":"Mumbai","description":"You'll spend the morning in the heart of colonial Mumbai, tracing the seafront from the iconic Gateway of India to the caves of Elephanta. The afternoon winds through the charming lanes of Kala Ghoda, ending with a stroll along the vibrant Colaba Causeway.","activities":[{"time":"09:00","title":"Gateway of India","geocode":"Gateway of India","type":"sight","duration":"1h","note":"Arrive early to beat crowds","icon":"🏛️"},{"time":"11:00","title":"Elephanta Caves day trip","geocode":"Elephanta Caves","type":"sight","duration":"3h","note":"Ferry departs from Gateway pier","icon":"🗿"},{"time":"14:30","title":"Trishna","geocode":"Trishna","type":"food","duration":"1.5h","note":"Famous crab dishes in Kala Ghoda","icon":"🦀"},{"time":"16:30","title":"Colaba Causeway Street Market","geocode":"Colaba Causeway","type":"shop","duration":"1.5h","note":"Bargain for textiles and handicrafts","icon":"🛍️"}]}]}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    console.log("Anthropic response status:", response.status);
    if (!response.ok) {
      const err = await response.text();
      console.error("Anthropic error:", err);
      throw new Error(`Anthropic error: ${err}`);
    }

    const anthropicData = await response.json();
    const text = anthropicData.content[0].text;

    // Extract JSON — strip any markdown fences Claude might add
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");

    let itinerary;
    try {
      itinerary = JSON.parse(jsonMatch[0]);
    } catch (_firstErr) {
      // Lenient retry: fix common LLM JSON issues
      let fixed = jsonMatch[0];
      // 1. Remove trailing commas before } or ]
      fixed = fixed.replace(/,\s*([}\]])/g, "$1");
      // 2. Replace literal newlines/tabs inside string values with a space
      fixed = fixed.replace(/"((?:[^"\\]|\\.)*)"/g, (_m: string, inner: string) =>
        `"${inner.replace(/[\n\r\t]/g, " ")}"`
      );
      try {
        itinerary = JSON.parse(fixed);
      } catch (parseErr) {
        console.error("JSON parse error. Raw text:", text.substring(0, 500));
        throw new Error(`JSON parse failed: ${parseErr.message}`);
      }
    }

    return new Response(JSON.stringify(itinerary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Function error:", err.message, err.stack);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
