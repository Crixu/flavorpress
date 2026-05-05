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
    const duration = payload.durationMs ?? DEFAULT_DURATION_MS;
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
  if (!toast) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 bottom-4 z-50 max-w-[360px] rounded-2xl px-4 py-3"
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
      title: isResearcher ? "Research notes sent to WordPress" : "Sent to WordPress",
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
