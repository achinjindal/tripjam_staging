// Opt-in DNS pin for E2E runs on networks whose ISP hijacks *.supabase.co
// (2026-09: port-53 interception poisoning both project domains; DoH returns
// the real Cloudflare edge). Activate with:
//
//   TRIPJAM_DNS_PIN=1 npx playwright test …
//
// Patches dns.lookup for THIS Node process (undici/fetch resolve through it),
// so fixture seeding works; the Chromium side is handled by the
// host-resolver-rules launch arg in playwright.config.ts (same env gate).
// The pinned IP is resolved live via DoH at process start — no stale
// hard-coded edge IPs.
import dns from "node:dns";

const PIN_DOMAINS = [
  "wlrzvwjdrjpfqcwgmzch.supabase.co",
  "viyvdqwwnbbqjuwiuzbh.supabase.co",
];

if (process.env.TRIPJAM_DNS_PIN === "1") {
  const doh = async (name) => {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${name}&type=A`,
      { headers: { accept: "application/dns-json" } },
    );
    const data = await res.json();
    return (data.Answer || []).find((a) => a.type === 1)?.data || null;
  };
  // Last-known-good Supabase Cloudflare edge — used when DoH itself is
  // unreachable (the hijacking ISP has been seen degrading DoH too).
  const STATIC_FALLBACK = "172.64.149.246";
  const pins = {};
  for (const d of PIN_DOMAINS) {
    pins[d] = null;
    for (let i = 0; i < 3 && !pins[d]; i++) {
      try {
        pins[d] = await doh(d);
      } catch {
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    if (!pins[d]) pins[d] = STATIC_FALLBACK;
  }
  const realLookup = dns.lookup;
  dns.lookup = (hostname, options, callback) => {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    const pinned = pins[hostname];
    if (pinned) {
      const addr = { address: pinned, family: 4 };
      return process.nextTick(() =>
        options?.all ? callback(null, [addr]) : callback(null, pinned, 4),
      );
    }
    return realLookup(hostname, options, callback);
  };
  console.log(`[dns-pin] active:`, pins);
}
