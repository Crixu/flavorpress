"use client";

/**
 * Tinder-style swipe deck.
 *
 * One card at a time, drag to throw it off-screen. Threshold for a
 * commit is 30% of card width. Right = mark, left = dismiss. Keyboard
 * shortcuts (← / →) mirror the gesture for desk users. Server actions
 * fire optimistically; if the action returns a formed cluster batch we
 * route the user to Today so they see the payoff immediately.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  clusterMarkedAction,
  dismissItemAction,
  markItemAction,
  unmarkItemAction,
} from "../actions";

interface ReaderItem {
  id: string;
  title: string;
  lede: string;
  publishedAt: number;
  canonicalUrl: string;
  sourceId: string;
  sourceName: string;
  folderId: string | null;
  folderName: string | null;
  alsoCoveredBy: string[];
}

interface Props {
  initialItems: ReaderItem[];
  initialMarkedCount: number;
  threshold: number;
}

type Direction = "left" | "right";

interface HistoryEntry {
  item: ReaderItem;
  direction: Direction;
}

const SWIPE_COMMIT_PX = 110;
const FLY_DURATION_MS = 220;

export function SwipeDeck({ initialItems, initialMarkedCount, threshold }: Props) {
  const router = useRouter();
  const [queue, setQueue] = useState<ReaderItem[]>(initialItems);
  const [markedCount, setMarkedCount] = useState(initialMarkedCount);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [flyout, setFlyout] = useState<Direction | null>(null);
  const [pendingClustering, startClustering] = useTransition();
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const top = queue[0] ?? null;
  const next = queue[1] ?? null;

  // Keyboard support. Bind once, scoped to whatever card is on top.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!top || flyout) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        commitSwipe("right");
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        commitSwipe("left");
      } else if (e.key === "z" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        undo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top?.id, flyout, history.length]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!top || flyout) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    setDrag({ x: 0, y: 0 });
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setDrag({ x: dx, y: dy });
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    dragStartRef.current = null;
    if (Math.abs(dx) >= SWIPE_COMMIT_PX) {
      commitSwipe(dx > 0 ? "right" : "left");
    } else {
      setDrag(null);
    }
  }

  function commitSwipe(direction: Direction) {
    if (!top || flyout) return;
    const swiped = top;
    setFlyout(direction);
    // Wait for the fly-out animation to clear visually before mutating
    // the queue. The card unmounts; the stack shifts forward.
    window.setTimeout(() => {
      setQueue((q) => q.slice(1));
      setHistory((h) => [...h, { item: swiped, direction }]);
      setDrag(null);
      setFlyout(null);
    }, FLY_DURATION_MS);

    if (direction === "right") {
      void (async () => {
        const res = await markItemAction(swiped.id);
        setMarkedCount(res.markedCount);
        if (res.formed && res.formed.length > 0) {
          setBannerMsg(
            `Formed ${res.formed.length} ${
              res.formed.length === 1 ? "cluster" : "clusters"
            }. Heading to Today.`,
          );
          // Route after a short beat so the banner is readable.
          window.setTimeout(() => router.push("/"), 900);
        }
      })();
    } else {
      void (async () => {
        const res = await dismissItemAction(swiped.id);
        setMarkedCount(res.markedCount);
      })();
    }
  }

  function undo() {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((h) => h.slice(0, -1));
    setQueue((q) => [last.item, ...q]);
    void (async () => {
      const res = await unmarkItemAction(last.item.id);
      setMarkedCount(res.markedCount);
    })();
  }

  function formClustersNow() {
    startClustering(async () => {
      const res = await clusterMarkedAction();
      if (res.formed.length > 0) {
        setBannerMsg(
          `Formed ${res.formed.length} ${
            res.formed.length === 1 ? "cluster" : "clusters"
          }. Heading to Today.`,
        );
        setMarkedCount(0);
        window.setTimeout(() => router.push("/"), 900);
      }
    });
  }

  const angle = drag ? drag.x / 14 : 0;
  const opacity = drag ? Math.max(0.6, 1 - Math.abs(drag.x) / 600) : 1;
  const overlayDirection: Direction | null = drag
    ? drag.x > 40
      ? "right"
      : drag.x < -40
        ? "left"
        : null
    : null;

  const cardTransform = useMemo(() => {
    if (flyout) {
      const offset = flyout === "right" ? 600 : -600;
      const rot = flyout === "right" ? 22 : -22;
      return `translate(${offset}px, 60px) rotate(${rot}deg)`;
    }
    if (drag) return `translate(${drag.x}px, ${drag.y}px) rotate(${angle}deg)`;
    return "translate(0, 0) rotate(0deg)";
  }, [drag, flyout, angle]);

  return (
    <div className="space-y-5">
      <StatusBar
        markedCount={markedCount}
        threshold={threshold}
        remaining={queue.length}
        onCluster={formClustersNow}
        clustering={pendingClustering}
      />

      {bannerMsg ? (
        <div
          className="fp-card p-3 text-sm"
          style={{
            background: "var(--emerald-tint)",
            borderColor: "var(--emerald)",
            color: "var(--fg)",
          }}
        >
          {bannerMsg}
        </div>
      ) : null}

      <div className="relative mx-auto" style={{ height: 460, maxWidth: 540, touchAction: "none" }}>
        {next ? (
          <div className="absolute inset-0" style={{ transform: "scale(0.96)", opacity: 0.85 }}>
            <Card item={next} muted />
          </div>
        ) : null}
        {top ? (
          <div
            ref={cardRef}
            className="absolute inset-0 cursor-grab active:cursor-grabbing"
            style={{
              transform: cardTransform,
              opacity,
              transition: flyout
                ? `transform ${FLY_DURATION_MS}ms ease-in, opacity ${FLY_DURATION_MS}ms ease-in`
                : drag
                  ? "none"
                  : "transform 200ms ease-out",
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <Card item={top} overlay={overlayDirection} />
          </div>
        ) : (
          <div
            className="fp-card-feature absolute inset-0 flex flex-col items-center justify-center p-8 text-center"
            style={{ background: "var(--surface)" }}
          >
            <h2 className="fp-h1-serif" style={{ fontSize: 22 }}>
              Deck cleared.
            </h2>
            <p className="mt-2 max-w-sm text-sm" style={{ color: "var(--fg-muted)" }}>
              You triaged everything in the queue. New items appear as your sources poll again.
            </p>
            {markedCount > 0 ? (
              <button
                type="button"
                onClick={formClustersNow}
                disabled={pendingClustering}
                className="fp-btn fp-btn-primary mt-5"
              >
                {pendingClustering
                  ? "Forming clusters…"
                  : `Form clusters from ${markedCount} marked →`}
              </button>
            ) : null}
          </div>
        )}
      </div>

      <ActionBar
        canSwipe={Boolean(top) && !flyout}
        canUndo={history.length > 0}
        onLeft={() => commitSwipe("left")}
        onRight={() => commitSwipe("right")}
        onUndo={undo}
      />
    </div>
  );
}

function StatusBar({
  markedCount,
  threshold,
  remaining,
  onCluster,
  clustering,
}: {
  markedCount: number;
  threshold: number;
  remaining: number;
  onCluster: () => void;
  clustering: boolean;
}) {
  const pct = Math.min(100, (markedCount / threshold) * 100);
  const ready = markedCount >= threshold;
  return (
    <div className="fp-card p-4">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">
          {markedCount} marked · {remaining} left in deck
        </span>
        <button
          type="button"
          onClick={onCluster}
          disabled={markedCount === 0 || clustering}
          className="fp-btn"
          style={{
            background: ready ? "var(--indigo)" : "var(--bg-subtle)",
            color: ready ? "#fff" : "var(--fg-muted)",
            opacity: markedCount === 0 ? 0.5 : 1,
          }}
        >
          {clustering ? "Forming…" : ready ? "Form clusters now →" : "Form clusters"}
        </button>
      </div>
      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full"
        style={{ background: "var(--border)" }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${pct}%`,
            background: ready
              ? "linear-gradient(90deg, var(--indigo), var(--emerald))"
              : "linear-gradient(90deg, var(--indigo), var(--rose))",
            transitionDuration: "300ms",
          }}
        />
      </div>
      <div className="mt-2 text-xs" style={{ color: "var(--fg-subtle)" }}>
        Auto-clusters once {threshold} are marked. Or hit the button any time.
      </div>
    </div>
  );
}

function Card({
  item,
  overlay,
  muted,
}: {
  item: ReaderItem;
  overlay?: Direction | null;
  muted?: boolean;
}) {
  return (
    <article
      className="fp-card-feature flex h-full flex-col p-7"
      style={{
        background: "var(--surface)",
        userSelect: "none",
      }}
    >
      <div className="flex items-center gap-2 text-xs" style={{ color: "var(--fg-subtle)" }}>
        <span className="fp-eyebrow">{item.sourceName || "Source"}</span>
        {item.folderName ? (
          <>
            <span>·</span>
            <span>{item.folderName}</span>
          </>
        ) : null}
        <span>·</span>
        <span>{relativeTime(item.publishedAt)}</span>
      </div>
      <h2 className="fp-h1-serif mt-3" style={{ fontSize: 26, lineHeight: 1.2 }}>
        {item.title}
      </h2>
      {item.alsoCoveredBy.length > 0 ? (
        <div
          className="mt-2 inline-flex max-w-full items-center gap-1.5 self-start rounded-full px-2.5 py-1 text-[11px]"
          style={{
            background: "var(--indigo-tint, var(--bg-subtle))",
            border: "1px solid var(--border)",
            color: "var(--fg-muted)",
          }}
          title={`Also covered by ${item.alsoCoveredBy.join(", ")}`}
        >
          <span className="uppercase tracking-wider" style={{ color: "var(--fg-subtle)" }}>
            Also covered by
          </span>
          <span className="truncate font-medium" style={{ color: "var(--fg)" }}>
            {item.alsoCoveredBy.join(", ")}
          </span>
        </div>
      ) : null}
      <p
        className="mt-3 flex-1 overflow-hidden text-sm leading-relaxed"
        style={{ color: "var(--fg-muted)" }}
      >
        {item.lede}
      </p>
      <div className="mt-4 flex items-center justify-between text-xs">
        <a
          href={item.canonicalUrl}
          target="_blank"
          rel="noreferrer"
          className="underline"
          style={{ color: "var(--fg-subtle)" }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          Open original →
        </a>
        <span className="tabular" style={{ color: "var(--fg-subtle)" }}>
          {hostname(item.canonicalUrl)}
        </span>
      </div>
      {overlay && !muted ? <SwipeOverlay direction={overlay} /> : null}
    </article>
  );
}

function SwipeOverlay({ direction }: { direction: Direction }) {
  const isRight = direction === "right";
  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-start justify-end p-5"
      style={{
        background: isRight
          ? "linear-gradient(135deg, transparent 60%, color-mix(in srgb, var(--emerald) 25%, transparent))"
          : "linear-gradient(225deg, transparent 60%, color-mix(in srgb, var(--rose) 25%, transparent))",
      }}
    >
      <div
        className="rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-wide"
        style={{
          background: isRight ? "var(--emerald)" : "var(--rose)",
          color: "#fff",
          alignSelf: isRight ? "flex-start" : "flex-start",
          marginLeft: isRight ? "auto" : 0,
          marginRight: isRight ? 0 : "auto",
        }}
      >
        {isRight ? "Mark" : "Skip"}
      </div>
    </div>
  );
}

function ActionBar({
  canSwipe,
  canUndo,
  onLeft,
  onRight,
  onUndo,
}: {
  canSwipe: boolean;
  canUndo: boolean;
  onLeft: () => void;
  onRight: () => void;
  onUndo: () => void;
}) {
  return (
    <div className="flex items-center justify-center gap-3">
      <IconButton label="Skip (←)" onClick={onLeft} disabled={!canSwipe} tone="rose">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="6" y1="18" x2="18" y2="6" />
        </svg>
      </IconButton>
      <IconButton label="Undo (⌘Z)" onClick={onUndo} disabled={!canUndo} tone="neutral" small>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 7v6h6" />
          <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
        </svg>
      </IconButton>
      <IconButton label="Mark (→)" onClick={onRight} disabled={!canSwipe} tone="emerald">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </IconButton>
    </div>
  );
}

function IconButton({
  children,
  label,
  onClick,
  disabled,
  tone,
  small,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone: "rose" | "emerald" | "neutral";
  small?: boolean;
}) {
  const size = small ? 44 : 56;
  const colorVar =
    tone === "rose" ? "var(--rose)" : tone === "emerald" ? "var(--emerald)" : "var(--fg-subtle)";
  const bgVar =
    tone === "rose"
      ? "var(--rose-tint)"
      : tone === "emerald"
        ? "var(--emerald-tint)"
        : "var(--bg-subtle)";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="inline-flex items-center justify-center rounded-full transition disabled:opacity-40"
      style={{
        width: size,
        height: size,
        background: bgVar,
        color: colorVar,
        border: `1px solid ${colorVar}`,
      }}
    >
      {children}
    </button>
  );
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < hour) return `${Math.max(1, Math.round(diff / min))}m ago`;
  if (diff < day) return `${Math.round(diff / hour)}h ago`;
  return `${Math.round(diff / day)}d ago`;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
