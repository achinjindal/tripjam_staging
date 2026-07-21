// Platform-aware billing module.
// On Android (native Capacitor app): Google Play Billing via RevenueCat.
// On web: no-op — CreditsOverlay handles Lemon Squeezy directly.
//
// Required env vars:
//   VITE_REVENUECAT_ANDROID_KEY  — RevenueCat public SDK key (starts with goog_)
//
// Required Supabase secrets (set per environment):
//   REVENUECAT_SECRET_KEY        — RevenueCat server API key (starts with sk_)
//   REVENUECAT_WEBHOOK_SECRET    — shared secret configured in RC webhook settings

import { Capacitor } from "@capacitor/core";
import { Purchases } from "@revenuecat/purchases-capacitor";

// SKU map: TripJam pack ID → Google Play product identifier
const SKUS = {
  small: "tripjam_credits_300",
  large: "tripjam_credits_1000",
};

// Credit amounts per pack (must match revenuecat-webhook edge function)
const PACK_CREDITS = {
  small: 300,
  large: 1000,
};

export function isAndroidApp() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

// Call once after sign-in on Android. Safe to call multiple times (RC is idempotent).
export async function initRevenueCat(userId) {
  if (!isAndroidApp()) return;
  const apiKey = import.meta.env.VITE_REVENUECAT_ANDROID_KEY;
  if (!apiKey) {
    console.warn(
      "VITE_REVENUECAT_ANDROID_KEY not set — RevenueCat not initialised",
    );
    return;
  }
  try {
    await Purchases.configure({ apiKey, appUserID: userId });
  } catch (e) {
    console.warn("RevenueCat configure failed:", e.message);
  }
}

// Trigger a Google Play purchase for the given pack.
// opts.tripId (optional): when set, the server funds that trip's pool instead
// of the buyer's personal wallet. A purchase with no opts is byte-identical to
// a personal purchase.
// Returns { transactionId, credits } on success.
// Returns { cancelled: true } if the user dismissed the Play sheet.
// Returns { error: string } on any other failure.
export async function purchaseCredits(packId, opts = {}) {
  if (!isAndroidApp()) return { error: "Not on Android" };

  const sku = SKUS[packId];
  if (!sku) return { error: "Unknown pack" };

  try {
    const { products } = await Purchases.getProducts({
      productIdentifiers: [sku],
      type: "inapp",
    });

    if (!products?.length) {
      return { error: "Product not found in Google Play. Try again later." };
    }

    const result = await Purchases.purchaseStoreProduct({
      product: products[0],
    });

    const transactionId = result.transaction?.transactionIdentifier;

    // Immediately verify with the server so credits appear without waiting
    // for the RevenueCat webhook. The webhook is the idempotent fallback.
    if (transactionId) {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const session = (await import("./supabase")).supabase.auth.getSession
        ? (await (await import("./supabase")).supabase.auth.getSession()).data
            .session
        : null;
      if (session?.access_token && supabaseUrl) {
        try {
          await fetch(`${supabaseUrl}/functions/v1/revenuecat-verify`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              transactionId,
              productId: sku,
              ...(opts.tripId ? { trip_id: opts.tripId } : {}),
            }),
          });
        } catch {
          // Webhook will handle it as fallback
        }
      }
    }

    return {
      transactionId,
      credits: PACK_CREDITS[packId],
    };
  } catch (e) {
    // User tapped back / cancelled the Play sheet — not an error
    if (e.userCancelled === true || e.code === "PURCHASE_CANCELLED_ERROR") {
      return { cancelled: true };
    }
    return { error: e.message || "Purchase failed. Try again." };
  }
}
