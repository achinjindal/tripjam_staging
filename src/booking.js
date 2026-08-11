// Hotel rate deep links (monetization level 1: affiliate outlinks).
//
// Env config — both optional; links work unbranded until these are set:
//   VITE_BOOKING_AID         Booking.com Affiliate Partner id (the `aid` param)
//   VITE_HOTEL_LINK_PREFIX   Wrapper redirect for affiliate networks that
//                            encode the target url, e.g. Travelpayouts:
//                            "https://tp.media/r?marker=XXXX&trs=YYYY&p=ZZZZ&u="
//                            The Booking url is appended URL-encoded.

const BOOKING_AID = import.meta.env.VITE_BOOKING_AID || "";
const LINK_PREFIX = import.meta.env.VITE_HOTEL_LINK_PREFIX || "";

export const HOTEL_AFFILIATE_ENABLED = !!(BOOKING_AID || LINK_PREFIX);

// Booking.com search deep link with hotel, dates and party size prefilled.
export function hotelRatesUrl({ hotelName, city, checkin, checkout, adults }) {
  if (!hotelName) return null;
  const params = new URLSearchParams();
  params.set("ss", city ? `${hotelName}, ${city}` : hotelName);
  if (checkin) params.set("checkin", checkin);
  if (checkout) params.set("checkout", checkout);
  params.set("group_adults", String(Math.max(1, parseInt(adults) || 2)));
  params.set("no_rooms", "1");
  params.set("group_children", "0");
  if (BOOKING_AID) params.set("aid", BOOKING_AID);
  const url = `https://www.booking.com/searchresults.html?${params.toString()}`;
  return LINK_PREFIX ? `${LINK_PREFIX}${encodeURIComponent(url)}` : url;
}

const isoPlusDays = (isoDate, n) => {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

// Check-in/checkout ISO dates for the hotel on days[dayIndex]:
// checkout = the next day that starts a different base (has its own check-in),
// else the trip's last day (departure day).
export function hotelStayRange(days, dayIndex, tripStartDate) {
  if (!tripStartDate) return { checkin: null, checkout: null };
  const startIso = String(tripStartDate).slice(0, 10);
  let checkoutIdx = days.length - 1;
  for (let j = dayIndex + 1; j < days.length; j++) {
    if ((days[j].activities || []).some((a) => a.type === "hotel")) {
      checkoutIdx = j;
      break;
    }
  }
  if (checkoutIdx <= dayIndex) checkoutIdx = dayIndex + 1;
  return {
    checkin: isoPlusDays(startIso, dayIndex),
    checkout: isoPlusDays(startIso, checkoutIdx),
  };
}
