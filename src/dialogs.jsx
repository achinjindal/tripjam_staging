// Module-level toast + confirm-sheet, replacing native alert()/confirm().
// Same store pattern as credits.js: plain module state + useSyncExternalStore,
// so any code can call showToast()/confirmSheet() without prop drilling.
// <DialogHost /> is mounted once at the root in main.jsx.
import { useSyncExternalStore } from "react";
import { T, RADIUS, SHADOW } from "./theme";

let state = { toast: null, confirm: null };
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = () => state;

let toastTimer = null;
export function showToast(message) {
  clearTimeout(toastTimer);
  state = { ...state, toast: { message, key: Date.now() } };
  emit();
  toastTimer = setTimeout(() => {
    state = { ...state, toast: null };
    emit();
  }, 2600);
}

// Drop-in async replacement for window.confirm — resolves true/false.
export function confirmSheet({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
}) {
  return new Promise((resolve) => {
    state = {
      ...state,
      confirm: { title, message, confirmLabel, cancelLabel, danger, resolve },
    };
    emit();
  });
}

function closeConfirm(result) {
  state.confirm?.resolve(result);
  state = { ...state, confirm: null };
  emit();
}

const btnBase = {
  flex: 1,
  padding: "13px 0",
  borderRadius: RADIUS.lg,
  fontFamily: "Georgia,serif",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

export default function DialogHost() {
  const { toast, confirm } = useSyncExternalStore(subscribe, getSnapshot);
  if (!toast && !confirm) return null;
  return (
    <>
      <style>{`@keyframes dlgToastUp{from{opacity:0;transform:translate(-50%,10px);}to{opacity:1;transform:translate(-50%,0);}}
@keyframes dlgSheetUp{from{transform:translateY(40px);opacity:0.6;}to{transform:translateY(0);opacity:1;}}`}</style>

      {toast && (
        <div
          key={toast.key}
          role="status"
          style={{
            position: "fixed",
            bottom: "calc(84px + env(safe-area-inset-bottom, 0px))",
            left: "50%",
            transform: "translate(-50%, 0)",
            background: T.ink,
            color: T.chalk,
            fontFamily: "Georgia,serif",
            fontSize: 13,
            padding: "10px 18px",
            borderRadius: RADIUS.full,
            boxShadow: SHADOW.lg,
            zIndex: 3000,
            maxWidth: "85vw",
            textAlign: "center",
            animation: "dlgToastUp 0.2s ease",
            pointerEvents: "none",
          }}
        >
          {toast.message}
        </div>
      )}

      {confirm && (
        <div
          onClick={() => closeConfirm(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 3000,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-label={confirm.title}
            style={{
              background: T.chalk,
              borderRadius: "20px 20px 0 0",
              padding:
                "24px 20px calc(28px + env(safe-area-inset-bottom, 0px))",
              width: "100%",
              maxWidth: 430,
              animation: "dlgSheetUp 0.2s ease",
            }}
          >
            <div
              style={{
                fontFamily: "'DM Serif Display',serif",
                fontSize: 19,
                color: T.ink,
                marginBottom: 8,
              }}
            >
              {confirm.title}
            </div>
            {confirm.message && (
              <div
                style={{
                  fontFamily: "Georgia,serif",
                  fontSize: 13,
                  color: T.mist,
                  lineHeight: 1.55,
                  marginBottom: 20,
                }}
              >
                {confirm.message}
              </div>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => closeConfirm(false)}
                style={{
                  ...btnBase,
                  background: T.chalk,
                  border: `1.5px solid ${T.sand}`,
                  color: T.ink,
                }}
              >
                {confirm.cancelLabel}
              </button>
              <button
                onClick={() => closeConfirm(true)}
                autoFocus
                style={{
                  ...btnBase,
                  background: confirm.danger ? T.error : T.ocean,
                  border: "none",
                  color: "white",
                }}
              >
                {confirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
