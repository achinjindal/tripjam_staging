// Client build identity + the minimum-build gate.
//
// VITE_APP_BUILD is stamped by vite.config.js at build time (YYYYMMDDHHmm),
// so it only ever increases and the web bundle and the APK built from the
// same commit share it. The server-side minimum lives in the app_config row
// "min_client_build" (migration 20261008000001): raise it when an old client
// must stop running — e.g. before retiring a server contract the Android APK
// still relies on (it runs its bundled build until a Play Store update).
import { supabase } from "./supabase";

export const APP_BUILD = Number(import.meta.env.VITE_APP_BUILD) || 0;
export const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.tripjam.app";

let _platform = null;
export async function appPlatform() {
  if (_platform) return _platform;
  try {
    const { Capacitor } = await import("@capacitor/core");
    _platform = Capacitor.isNativePlatform() ? Capacitor.getPlatform() : "web";
  } catch {
    _platform = "web";
  }
  return _platform;
}

/** True only when both builds are known and ours is older. An unknown build
 *  (0), a missing row or a failed read never blocks: the gate fails open. */
export function isOutdated(minConfig, platform, build = APP_BUILD) {
  const need = Number(minConfig?.[platform]) || 0;
  return build > 0 && need > 0 && build < need;
}

export async function fetchMinBuild() {
  const { data, error } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", "min_client_build")
    .maybeSingle();
  if (error) return null;
  return data?.value || null;
}
