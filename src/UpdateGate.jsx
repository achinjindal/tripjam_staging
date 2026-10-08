import { useEffect, useState } from "react";
import posthog from "posthog-js";
import { T, TYPE, RADIUS, SHADOW } from "./theme";
import {
  APP_BUILD,
  PLAY_STORE_URL,
  appPlatform,
  fetchMinBuild,
  isOutdated,
} from "./version";

// Blocking "Update TripJam" screen for clients older than the server's
// min_client_build (see src/version.js). Checks on start, when the app comes
// back to the foreground (at most every 10 minutes) and every 30 minutes.
const RECHECK_MS = 30 * 60 * 1000;
const FOREGROUND_MIN_GAP_MS = 10 * 60 * 1000;

export default function UpdateGate() {
  const [gate, setGate] = useState(null); // {platform, message} when outdated

  useEffect(() => {
    let cancelled = false;
    let lastCheck = 0;
    const check = async () => {
      lastCheck = Date.now();
      try {
        const [platform, min] = await Promise.all([
          appPlatform(),
          fetchMinBuild(),
        ]);
        if (cancelled) return;
        if (isOutdated(min, platform)) {
          setGate({ platform, message: min?.message || null });
          posthog.capture("client_outdated", {
            platform,
            build: APP_BUILD,
            min_build: Number(min?.[platform]) || 0,
          });
        } else setGate(null);
      } catch {
        /* fail open */
      }
    };
    check();
    const timer = setInterval(check, RECHECK_MS);
    const onVisible = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastCheck > FOREGROUND_MIN_GAP_MS
      )
        check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!gate) return null;
  const android = gate.platform === "android";

  const update = async () => {
    posthog.capture("client_update_clicked", { platform: gate.platform });
    if (android) {
      try {
        const { Browser } = await import("@capacitor/browser");
        await Browser.open({ url: PLAY_STORE_URL });
      } catch {
        window.open(PLAY_STORE_URL, "_blank");
      }
      return;
    }
    // Web: fetch the new service worker (it activates itself and the
    // controllerchange handler in main.jsx reloads), then reload anyway in
    // case there was nothing to wait for.
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      await reg?.update();
    } catch {
      /* reload regardless */
    }
    window.location.reload();
  };

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="update-gate-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: T.bgPage,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 380,
          width: "100%",
          background: T.chalk,
          borderRadius: RADIUS.lg,
          boxShadow: SHADOW.md,
          padding: "28px 24px",
          textAlign: "center",
        }}
      >
        <div
          id="update-gate-title"
          style={{
            ...TYPE.display,
            fontSize: 24,
            color: T.ink,
            marginBottom: 10,
          }}
        >
          Update TripJam
        </div>
        <p
          style={{
            ...TYPE.body,
            fontSize: 15,
            lineHeight: 1.5,
            color: T.mist,
            margin: "0 0 22px",
          }}
        >
          {gate.message ||
            (android
              ? "This version of TripJam is out of date. Update from the Play Store to keep planning — your trips are saved."
              : "A newer version of TripJam is available. Reload to keep planning — your trips are saved.")}
        </p>
        <button
          onClick={update}
          style={{
            width: "100%",
            padding: "13px 16px",
            borderRadius: RADIUS.md,
            border: "none",
            background: T.ocean,
            color: "white",
            fontFamily: "Georgia, serif",
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          {android ? "Open the Play Store" : "Reload"}
        </button>
      </div>
    </div>
  );
}
