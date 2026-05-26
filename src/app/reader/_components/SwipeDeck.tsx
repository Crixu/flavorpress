"use client";

/**
 * Tinder-style swipe deck.
 *
 * One card at a time, drag to throw it off-screen. Threshold for a
 * commit is 110px. Right = save, left = skip. Keyboard shortcuts
 * (left/right arrows, space) mirror the gesture. Server actions fire
 * optimistically; if the action returns a formed cluster batch we
 * surface a banner.
 *
 * The deck renders three cards stacked back-to-front to give a "pile
 * of stories" feel: when the top card flies away, the cards behind
 * animate up to take its place. The leaving card is detached from the
 * queue immediately so the rise feels continuous, not a pop.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  clusterMarkedAction,
  dismissItemAction,
  markItemAction,
  unmarkItemAction,
} from "../actions";

export interface ReaderItem {
  id: string;
  title: string;
  lede: string;
  publishedAt: number;
  canonicalUrl: string;
  sourceId: string;
  sourceName: string;
  sourceKind: string;
  folderId: string | null;
  folderName: string | null;
  score: number | null;
  commentCount: number | null;
  alsoCoveredBy: string[];
}

interface Props {
  initialItems: ReaderItem[];
  initialMarkedCount: number;
  /** Total items in the current folder scope (from server) for the "N of M" strip. */
  totalQueueCount: number;
}

type Direction = "left" | "right";

interface HistoryEntry {
  item: ReaderItem;
  direction: Direction;
}

interface LeavingCard {
  item: ReaderItem;
  direction: Direction;
  startX: number;
  startY: number;
  startAngle: number;
  fly: boolean;
}

const SWIPE_COMMIT_PX = 110;
const FLY_DURATION_MS = 260;
const STACK_TRANSITION_MS = 260;

export function SwipeDeck({ initialItems, initialMarkedCount, totalQueueCount }: Props) {
  const [queue, setQueue] = useState<ReaderItem[]>(initialItems);
  const [markedCount, setMarkedCount] = useState(initialMarkedCount);
  const [savedThisSession, setSavedThisSession] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [leaving, setLeaving] = useState<LeavingCard | null>(null);
  const [pendingClustering, startClustering] = useTransition();
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  // Track how many items started in the deck so we can compute the index.
  const initialCountRef = useRef(initialItems.length);

  const top = queue[0] ?? null;
  const next = queue[1] ?? null;
  const nextNext = queue[2] ?? null;

  // Current index = how many we've consumed from the initial set.
  const triaged = initialCountRef.current - queue.length;
  const currentIndex = triaged + 1;

  // Keyboard support. Bind once, scoped to whatever card is on top.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (leaving) return;
      const isUndo = (e.key === "z" || e.key === "Z") && (e.metaKey || e.ctrlKey) && !e.shiftKey;
      if (isUndo) {
        if (history.length === 0) return;
        e.preventDefault();
        undo();
        return;
      }
      if (!top) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        commitSwipe("right");
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        commitSwipe("left");
      } else if (e.key === " ") {
        e.preventDefault();
        window.open(top.canonicalUrl, "_blank", "noreferrer");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top?.id, leaving, history.length]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!top || leaving) return;
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
    if (!top || leaving) return;
    const swiped = top;
    // Detach the swiped card immediately. The cards behind animate up
    // because their CSS transitions on transform/opacity kick in once
    // their stack depth changes. The leaving card keeps animating out
    // as a separate overlay until FLY_DURATION_MS.
    const startX = drag?.x ?? 0;
    const startY = drag?.y ?? 0;
    const startAngle = drag ? drag.x / 14 : 0;
    setLeaving({ item: swiped, direction, startX, startY, startAngle, fly: false });
    setQueue((q) => q.slice(1));
    setHistory((h) => [...h, { item: swiped, direction }]);
    setDrag(null);
    // Two rAFs so the element paints at its starting transform before
    // the CSS transition target is applied. One is enough in most
    // browsers; two is defensive against React batching.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setLeaving((l) => (l && l.item.id === swiped.id ? { ...l, fly: true } : l));
      });
    });
    window.setTimeout(() => {
      setLeaving((l) => (l && l.item.id === swiped.id ? null : l));
    }, FLY_DURATION_MS + 50);

    if (direction === "right") {
      setSavedThisSession((n) => n + 1);
      void (async () => {
        const res = await markItemAction(swiped.id);
        setMarkedCount(res.markedCount);
        if (res.formed && res.formed.length > 0) {
          setBannerMsg(
            `Formed ${res.formed.length} ${
              res.formed.length === 1 ? "cluster" : "clusters"
            }. View them on Today.`,
          );
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
    if (!last || leaving) return;
    setHistory((h) => h.slice(0, -1));
    setQueue((q) => [last.item, ...q]);
    if (last.direction === "right") {
      setSavedThisSession((n) => Math.max(0, n - 1));
    }
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
          }. View them on Today.`,
        );
        setMarkedCount(0);
      }
    });
  }

  const angle = drag ? drag.x / 14 : 0;
  const dragOpacity = drag ? Math.max(0.6, 1 - Math.abs(drag.x) / 600) : 1;
  const overlayDirection: Direction | null = drag
    ? drag.x > 40
      ? "right"
      : drag.x < -40
        ? "left"
        : null
    : null;

  const topTransform = useMemo(() => {
    if (drag) return `translate(${drag.x}px, ${drag.y}px) rotate(${angle}deg)`;
    return "translate(0, 0) rotate(0deg)";
  }, [drag, angle]);

  const leavingStyle = useMemo(() => {
    if (!leaving) return null;
    if (!leaving.fly) {
      return {
        transform: `translate(${leaving.startX}px, ${leaving.startY}px) rotate(${leaving.startAngle}deg)`,
        opacity: 1,
      };
    }
    const offset = leaving.direction === "right" ? 640 : -640;
    const rot = leaving.direction === "right" ? 24 : -24;
    return {
      transform: `translate(${offset}px, 60px) rotate(${rot}deg)`,
      opacity: 0,
    };
  }, [leaving]);

  return (
    <div className="space-y-5">
      {/* Counter strip */}
      <div className="flex items-center justify-between gap-3 text-xs">
        <span style={{ color: "var(--fg-muted)" }}>
          {top
            ? `${currentIndex} of ${totalQueueCount}`
            : `${totalQueueCount} of ${totalQueueCount}`}
          {savedThisSession > 0 ? ` · ${savedThisSession} saved this session` : ""}
        </span>
        <button
          type="button"
          onClick={formClustersNow}
          disabled={markedCount === 0 || pendingClustering}
          className="fp-btn shrink-0"
          style={{
            opacity: markedCount === 0 ? 0.5 : 1,
            color: markedCount > 0 ? "var(--fg)" : "var(--fg-muted)",
          }}
        >
          {pendingClustering ? "Forming…" : "Form clusters"}
        </button>
      </div>

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

      <div
        className="fp-reader-deck-frame relative mx-auto"
        style={{ height: 460, maxWidth: 540, touchAction: "none" }}
      >
        {[top, next, nextNext].map((item, depth) =>
          item ? (
            <DeckCard
              key={item.id}
              item={item}
              depth={depth as 0 | 1 | 2}
              topTransform={topTransform}
              topOpacity={dragOpacity}
              topOverlay={overlayDirection}
              dragging={Boolean(drag)}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
          ) : null,
        )}
        {!top && !leaving ? (
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
                  : `Form clusters from ${markedCount} saved →`}
              </button>
            ) : null}
          </div>
        ) : null}
        {leaving && leavingStyle ? (
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              transform: leavingStyle.transform,
              opacity: leavingStyle.opacity,
              transition: `transform ${FLY_DURATION_MS}ms ease-in, opacity ${FLY_DURATION_MS}ms ease-in`,
              zIndex: 4,
            }}
          >
            <Card item={leaving.item} overlay={leaving.direction} />
          </div>
        ) : null}
      </div>

      <ActionBar
        canSwipe={Boolean(top) && !leaving}
        canUndo={history.length > 0 && !leaving}
        onLeft={() => commitSwipe("left")}
        onRight={() => commitSwipe("right")}
        onUndo={undo}
      />

      {/* Always-visible keyboard hints */}
      <p
        className="text-center text-xs"
        style={{ color: "var(--fg-subtle)" }}
        aria-label="Keyboard shortcuts"
      >
        <kbd>&#8592;</kbd> skip &middot; <kbd>&#8594;</kbd> save &middot; <kbd>space</kbd> open
      </p>
    </div>
  );
}

function DeckCard({
  item,
  depth,
  topTransform,
  topOpacity,
  topOverlay,
  dragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  item: ReaderItem;
  depth: 0 | 1 | 2;
  topTransform: string;
  topOpacity: number;
  topOverlay: Direction | null;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const isTop = depth === 0;
  const scale = depth === 1 ? 0.96 : 0.92;
  const ty = depth === 1 ? 10 : 20;
  const stackOpacity = depth === 1 ? 0.9 : 0.7;
  return (
    <div
      className={`absolute inset-0 ${
        isTop ? "cursor-grab active:cursor-grabbing" : "pointer-events-none"
      }`}
      style={{
        transform: isTop ? topTransform : `translateY(${ty}px) scale(${scale})`,
        opacity: isTop ? topOpacity : stackOpacity,
        transition:
          isTop && dragging
            ? "none"
            : `transform ${STACK_TRANSITION_MS}ms ease-out, opacity ${STACK_TRANSITION_MS}ms ease-out`,
        zIndex: 3 - depth,
      }}
      onPointerDown={isTop ? onPointerDown : undefined}
      onPointerMove={isTop ? onPointerMove : undefined}
      onPointerUp={isTop ? onPointerUp : undefined}
      onPointerCancel={isTop ? onPointerUp : undefined}
    >
      <Card item={item} overlay={isTop ? topOverlay : null} muted={!isTop} />
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
      className="fp-reader-deck-card fp-card-feature flex h-full flex-col p-7"
      style={{
        background: "var(--surface)",
        userSelect: "none",
      }}
    >
      {/* Source eyebrow row */}
      <div
        className="flex items-start justify-between gap-2 text-xs"
        style={{ color: "var(--fg-subtle)" }}
      >
        <span className="fp-eyebrow">
          {item.sourceKind ? `${item.sourceKind.toUpperCase()} · ` : ""}
          {item.sourceName || "Source"}
          {" · "}
          {relativeTime(item.publishedAt)}
        </span>
        <a
          href={item.canonicalUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 underline"
          style={{ color: "var(--fg-subtle)" }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          Open original &#8599;
        </a>
      </div>

      {/* Title - Newsreader serif, 28px */}
      <h2 className="fp-h1-serif mt-3" style={{ fontSize: 28, lineHeight: 1.2 }}>
        {item.title}
      </h2>

      {/* Also covered by badge */}
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

      {/* Summary block */}
      <p
        className="mt-3 flex-1 overflow-hidden text-sm leading-relaxed"
        style={{ color: "var(--fg-muted)" }}
      >
        {item.lede}
      </p>

      {/* Reddit-specific stats */}
      {item.sourceKind === "reddit" && (item.score !== null || item.commentCount !== null) ? (
        <div
          className="mt-3 flex flex-wrap items-center gap-3 text-[11px] tabular"
          style={{ color: "var(--fg-muted)" }}
        >
          {item.score !== null ? (
            <span title={`${item.score.toLocaleString()} upvotes`}>
              &#8593; {compactNumber(item.score)}
            </span>
          ) : null}
          {item.commentCount !== null ? (
            <span title={`${item.commentCount.toLocaleString()} comments`}>
              {compactNumber(item.commentCount)} {item.commentCount === 1 ? "comment" : "comments"}
            </span>
          ) : null}
        </div>
      ) : null}

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
        {isRight ? "Save" : "Skip"}
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
      <IconButton label="Skip (left arrow)" onClick={onLeft} disabled={!canSwipe} tone="rose">
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
      <IconButton label="Undo (Cmd+Z)" onClick={onUndo} disabled={!canUndo} tone="neutral" small>
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
      <IconButton label="Save (right arrow)" onClick={onRight} disabled={!canSwipe} tone="emerald">
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

function compactNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 10_000) return `${(n / 1000).toFixed(0)}k`;
  if (abs >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return n.toLocaleString();
}
