"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

interface ToastAction {
  label: string;
  href: string;
  external?: boolean;
}

interface ToastPayload {
  title: string;
  body?: string;
  primary?: ToastAction;
  secondary?: ToastAction;
  durationMs?: number;
  /**
   * Render a progress bar at the bottom edge of the toast that fills
   * over `progressMs` milliseconds via CSS animation. Use this only
   * when no real progress source is available; for real progress use
   * `pollProgress` instead. When set without `pollProgress`, durationMs
   * defaults to progressMs so the toast auto-dismisses with the bar.
   */
  progressMs?: number;
  /**
   * Real-time progress driver. Called every `pollIntervalMs` (default
   * 1000) while the toast is mounted; the returned `progress` (0..1)
   * drives the bar width. When `complete` is true the toast dismisses.
   * Pair with `durationMs` to set a watchdog cap so a stuck poll does
   * not leave the toast on screen forever.
   */
  pollProgress?: () => Promise<{ progress: number; complete: boolean }>;
  /**
   * Called after a polled toast completes and dismisses. Use this for a
   * replacement toast, so the dismiss path cannot clear the new toast in
   * the same tick.
   */
  onComplete?: () => void;
  pollIntervalMs?: number;
}

interface ToastContextValue {
  show: (payload: ToastPayload) => void;
  dismiss: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION_MS = 8000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastPayload | null>(null);
  const [nonce, setNonce] = useState(0);
  const timerRef = useRef<number | null>(null);

  const dismiss = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setToast(null);
  }, []);

  const show = useCallback((payload: ToastPayload) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setToast(payload);
    setNonce((n) => n + 1);
    // When progressMs is set, auto-dismiss when the bar completes; the
    // bar IS the timer the user sees. Otherwise fall back to the
    // explicit durationMs or the default.
    const duration = payload.durationMs ?? payload.progressMs ?? DEFAULT_DURATION_MS;
    timerRef.current = window.setTimeout(() => {
      setToast(null);
      timerRef.current = null;
    }, duration);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastSlot key={nonce} toast={toast} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider.");
  return ctx;
}

function ToastSlot({ toast, onDismiss }: { toast: ToastPayload | null; onDismiss: () => void }) {
  // Drive determinate progress from the toast's pollProgress callback when
  // present. Hook is unconditional (per Rules of Hooks); bail out inside
  // the effect when there's nothing to poll.
  const [polledProgress, setPolledProgress] = useState<number>(0);
  const { pollProgress, pollIntervalMs, onComplete } = toast ?? {};
  useEffect(() => {
    if (!pollProgress) return;
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      try {
        const r = await pollProgress();
        if (cancelled) return;
        setPolledProgress(Math.max(0, Math.min(1, r.progress)));
        if (r.complete) {
          onDismiss();
          onComplete?.();
          return;
        }
      } catch {
        // Swallow polling errors; the watchdog durationMs will dismiss
        // the toast eventually so we don't get stuck.
      }
      timer = window.setTimeout(tick, pollIntervalMs ?? 1000);
    };

    tick();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [pollProgress, pollIntervalMs, onDismiss, onComplete]);

  if (!toast) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 bottom-4 left-4 z-50 max-w-[360px] rounded-2xl px-4 py-3 overflow-hidden sm:left-auto"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        boxShadow: "var(--shadow-md, 0 10px 30px rgba(0,0,0,0.12))",
      }}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold" style={{ color: "var(--fg)" }}>
            {toast.title}
          </div>
          {toast.body ? (
            <div className="mt-0.5 line-clamp-2 text-[12px]" style={{ color: "var(--fg-muted)" }}>
              {toast.body}
            </div>
          ) : null}
          {toast.primary || toast.secondary ? (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {toast.primary ? (
                <a
                  href={toast.primary.href}
                  target={toast.primary.external ? "_blank" : undefined}
                  rel={toast.primary.external ? "noreferrer" : undefined}
                  className="text-[12px] font-semibold hover:underline"
                  style={{ color: "var(--indigo)" }}
                >
                  {toast.primary.label}
                </a>
              ) : null}
              {toast.secondary ? (
                <a
                  href={toast.secondary.href}
                  target={toast.secondary.external ? "_blank" : undefined}
                  rel={toast.secondary.external ? "noreferrer" : undefined}
                  className="text-[12px] hover:underline"
                  style={{ color: "var(--fg-muted)" }}
                >
                  {toast.secondary.label}
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="ml-1 rounded-full px-1.5 py-0.5 text-[11px] transition hover:bg-stone-100"
          style={{ color: "var(--fg-subtle)" }}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
      {toast.pollProgress || toast.progressMs ? (
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 3,
            background: "var(--bg-subtle)",
          }}
        >
          {toast.pollProgress ? (
            <div
              style={{
                height: "100%",
                width: `${Math.round(polledProgress * 100)}%`,
                background: "var(--indigo)",
                transition: "width 400ms cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            />
          ) : (
            <div
              style={{
                height: "100%",
                background: "var(--indigo)",
                transformOrigin: "left center",
                animation: `fp-toast-progress ${toast.progressMs}ms linear forwards`,
              }}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

const PUBLISH_TOAST_KEY = "flavorpress:publish-toast";

interface PublishToastPayload {
  headline: string;
  editLink: string;
  draftId: string;
  mode?: "drafter" | "researcher";
}

/**
 * Stash a publish-toast payload before navigating to the new route. The
 * receiving page mounts <PublishToastBridge/> in the root layout, which
 * reads the payload on mount and fires a toast once.
 */
export function stashPublishToast(payload: PublishToastPayload) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PUBLISH_TOAST_KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage can be unavailable (private mode, quota); the toast
    // is a nice-to-have, not load-bearing.
  }
}

export function PublishToastBridge() {
  const { show } = useToast();
  const pathname = usePathname();

  useEffect(() => {
    let raw: string | null;
    try {
      raw = window.sessionStorage.getItem(PUBLISH_TOAST_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      window.sessionStorage.removeItem(PUBLISH_TOAST_KEY);
    } catch {
      // best-effort
    }

    let payload: PublishToastPayload;
    try {
      payload = JSON.parse(raw) as PublishToastPayload;
    } catch {
      return;
    }
    if (!payload || typeof payload.editLink !== "string") return;

    const isResearcher = payload.mode === "researcher";
    show({
      title: isResearcher ? "Notes sent to WordPress" : "Sent to WordPress",
      body: payload.headline ? truncate(payload.headline, 80) : undefined,
      primary: { label: "Open in WordPress ↗", href: payload.editLink, external: true },
      secondary: { label: "View receipt", href: `/editor/${payload.draftId}` },
    });
  }, [show, pathname]);

  return null;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}
