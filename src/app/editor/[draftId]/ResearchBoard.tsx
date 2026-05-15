"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import Link from "next/link";
import type { NoteFact, NoteIdea, NoteQuote, Notes } from "@/lib/v1/notes-generator";
import {
  MAX_IMAGE_URL,
  type ResearchBoardCard,
  type ResearchBoardCardKind,
  type ResearchBoardConnection,
  type ResearchBoardState,
} from "@/lib/v1/research-board";
import { saveResearchBoardAction } from "@/lib/v1/actions";
import {
  AddSourceForm,
  DeleteManualSourceButton,
  MoreQuotesButton,
  RemixIdeasButton,
} from "./NotesActions";
import { SendNotesToWpForm } from "./SendNotesToWpForm";

const QUOTE_CAP = 12;
const RESEARCH_TUTORIAL_DONE_KEY = "flavorpress.research.onboarded.v1";

type BoardLaneId = "sources" | "evidence" | "angles" | "scraps";
type ResearchTutorialStep = "collect" | "arrange" | "draft";

declare global {
  interface Window {
    __flavorpressSaveResearchBoard?: (draftId: string) => Promise<void>;
  }
}

interface SourceRow {
  id: string;
  title: string;
  display_name: string | null;
  source_url: string;
  published_at: number;
  is_manual: boolean;
}

interface Center {
  x: number;
  y: number;
}

interface Props {
  draftId: string;
  clusterId: string;
  topic: string;
  notes: Notes;
  sources: SourceRow[];
  sourceCount: number;
  wpEditLink: string | null;
  initialBoard: ResearchBoardState | null;
  sibling?: React.ReactNode;
}

export function ResearchBoard({
  draftId,
  clusterId,
  topic,
  notes,
  sources,
  sourceCount,
  wpEditLink,
  initialBoard,
  sibling,
}: Props) {
  const initialCards = useMemo(() => buildInitialCards(notes, sources), [notes, sources]);
  const initialConnections = useMemo(() => buildInitialConnections(initialCards), [initialCards]);
  // Track every card id we've ever seen so a delete sticks across re-renders;
  // otherwise the reconcile effect below would re-insert deleted server cards.
  // For boards saved by an older client without `seenIds`, fall back to seeding
  // with the currently-derivable set so prior deletions don't resurrect; the
  // first save after this open backfills `seenIds` and the heuristic drops out.
  const knownIdsRef = useRef<Set<string>>(new Set());
  const [cards, setCards] = useState<ResearchBoardCard[]>(() => {
    const seed = !initialBoard
      ? initialCards
      : initialBoard.layout === "lanes-v1"
        ? initialBoard.cards
        : arrangeCards(initialBoard.cards);
    for (const c of seed) knownIdsRef.current.add(c.id);
    if (initialBoard) {
      if (initialBoard.seenIds && initialBoard.seenIds.length > 0) {
        for (const id of initialBoard.seenIds) knownIdsRef.current.add(id);
      } else {
        for (const c of initialCards) knownIdsRef.current.add(c.id);
      }
    }
    return seed;
  });
  const [connections, setConnections] = useState<ResearchBoardConnection[]>(
    initialBoard?.connections ?? initialConnections,
  );
  // Stays true once the user makes any edit so subsequent reconcile-driven
  // setCards calls (e.g. server material auto-imported on remount) keep
  // auto-saving. Do not reset this on save success; doing so would silently
  // drop saves that follow a server-triggered reconcile.
  const hasUserEditedRef = useRef(false);
  const [view, setView] = useState<"board" | "list" | "magazine">("board");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const tutorialDone = useSyncExternalStore(
    subscribeToResearchTutorialStore,
    readResearchTutorialDone,
    readServerResearchTutorialDone,
  );
  const [tutorialDismissed, setTutorialDismissed] = useState(false);
  const [tutorialReplay, setTutorialReplay] = useState(false);
  const [tutorialStep, setTutorialStep] = useState<ResearchTutorialStep>("collect");
  const [status, setStatus] = useState(
    "Drag cards to arrange the argument. Select one, then shift-click another to connect them.",
  );
  const [centers, setCenters] = useState<Record<string, Center>>({});
  const [boardSize, setBoardSize] = useState({ width: 1400, height: 920 });
  const [zoom, setZoom] = useState(0.85);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const pastePointRef = useRef({ x: 520, y: 620 });
  // Keep autosave and handoff saves in order so an older write cannot win last.
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    offsetX: number;
    offsetY: number;
    boardLeft: number;
    boardTop: number;
  } | null>(null);
  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);

  const saveBoardNow = useCallback(async () => {
    const payload = JSON.stringify({
      layout: "lanes-v1",
      cards,
      connections,
      seenIds: Array.from(knownIdsRef.current),
    });
    const run = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const fd = new FormData();
        fd.set("draftId", draftId);
        fd.set("board", payload);
        await saveResearchBoardAction(fd);
      });
    saveQueueRef.current = run;
    await run;
  }, [cards, connections, draftId]);

  const measureCenters = useCallback(() => {
    const board = boardRef.current;
    if (board) {
      setBoardSize({
        width: Math.max(1400, board.offsetWidth / zoom),
        height: Math.max(920, board.offsetHeight / zoom),
      });
    }
    const next: Record<string, Center> = {};
    for (const card of cards) {
      const node = cardRefs.current[card.id];
      if (!node) continue;
      next[card.id] = {
        x: node.offsetLeft + node.offsetWidth / 2,
        y: node.offsetTop + node.offsetHeight / 2,
      };
    }
    setCenters(next);
  }, [cards, zoom]);

  useLayoutEffect(() => {
    measureCenters();
    window.addEventListener("resize", measureCenters);
    return () => window.removeEventListener("resize", measureCenters);
  }, [measureCenters, view]);

  // Pull in any new notes/sources material as new cards without clobbering
  // the user's positions or re-resurrecting cards they deleted.
  useEffect(() => {
    const fresh = buildInitialCards(notes, sources);
    const additions = fresh.filter((card) => !knownIdsRef.current.has(card.id));
    if (additions.length === 0) return;
    for (const card of additions) knownIdsRef.current.add(card.id);
    setCards((current) => [...current, ...additions]);
  }, [notes, sources]);

  useEffect(() => {
    if (!hasUserEditedRef.current) return;
    const id = window.setTimeout(() => {
      saveBoardNow()
        .then(() => setSaveError(null))
        .catch((err) => {
          console.error("Research board save failed", err);
          setSaveError("Save failed. Edits are still on your board; try again or reload.");
        });
    }, 500);
    return () => window.clearTimeout(id);
  }, [saveBoardNow]);

  useEffect(() => {
    window.__flavorpressSaveResearchBoard = async (targetDraftId: string) => {
      if (targetDraftId !== draftId) return;
      await saveBoardNow();
    };
    return () => {
      if (window.__flavorpressSaveResearchBoard) {
        delete window.__flavorpressSaveResearchBoard;
      }
    };
  }, [draftId, saveBoardNow]);

  function rememberPastePoint(event: MouseEvent<HTMLDivElement>) {
    const board = boardRef.current;
    if (!board) return;
    const rect = board.getBoundingClientRect();
    pastePointRef.current = {
      x: Math.max(24, Math.round((event.clientX - rect.left + board.scrollLeft) / zoom)),
      y: Math.max(96, Math.round((event.clientY - rect.top + board.scrollTop) / zoom)),
    };
    board.focus();
  }

  function selectCard(cardId: string, shiftKey: boolean) {
    if (shiftKey && selectedCardId && selectedCardId !== cardId) {
      const label = window.prompt("Label this connection", "supports");
      if (!label?.trim()) return;
      const trimmed = label.trim().slice(0, 32);
      hasUserEditedRef.current = true;
      setConnections((current) => [
        ...current,
        {
          id: `connection-${crypto.randomUUID()}`,
          from: selectedCardId,
          to: cardId,
          label: trimmed,
        },
      ]);
      setStatus(`Connected: ${trimmed}`);
      return;
    }
    setSelectedCardId(cardId);
    setStatus("Selected. Shift-click another card to create a labeled connection.");
  }

  function deleteCard(cardId: string) {
    hasUserEditedRef.current = true;
    knownIdsRef.current.add(cardId);
    setCards((current) => current.filter((card) => card.id !== cardId));
    setConnections((current) =>
      current.filter((connection) => connection.from !== cardId && connection.to !== cardId),
    );
    if (selectedCardId === cardId) setSelectedCardId(null);
    setStatus("Removed from the board. Original source links stay in the left rail.");
  }

  function startDrag(event: PointerEvent<HTMLElement>, card: ResearchBoardCard) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("a, button, input, textarea")) return;
    const board = boardRef.current;
    const node = cardRefs.current[card.id];
    if (!board || !node) return;
    const boardRect = board.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    dragRef.current = {
      id: card.id,
      pointerId: event.pointerId,
      offsetX: (event.clientX - nodeRect.left) / zoom,
      offsetY: (event.clientY - nodeRect.top) / zoom,
      boardLeft: boardRect.left,
      boardTop: boardRect.top,
    };
    node.setPointerCapture(event.pointerId);
    node.classList.add("is-dragging");
  }

  function moveDrag(event: PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const board = boardRef.current;
    const scrollLeft = board?.scrollLeft ?? 0;
    const scrollTop = board?.scrollTop ?? 0;
    const x = Math.max(
      0,
      Math.round((event.clientX - drag.boardLeft + scrollLeft) / zoom - drag.offsetX),
    );
    const y = Math.max(
      0,
      Math.round((event.clientY - drag.boardTop + scrollTop) / zoom - drag.offsetY),
    );
    hasUserEditedRef.current = true;
    setCards((current) => current.map((card) => (card.id === drag.id ? { ...card, x, y } : card)));
  }

  function finishDrag() {
    const drag = dragRef.current;
    if (!drag) return;
    cardRefs.current[drag.id]?.classList.remove("is-dragging");
    dragRef.current = null;
    requestAnimationFrame(measureCenters);
  }

  function startPan(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("[data-card], a, button, input, textarea")) return;
    const board = boardRef.current;
    if (!board) return;
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: board.scrollLeft,
      scrollTop: board.scrollTop,
    };
    board.setPointerCapture(event.pointerId);
    board.classList.add("is-panning");
  }

  function movePan(event: PointerEvent<HTMLElement>) {
    const pan = panRef.current;
    const board = boardRef.current;
    if (!pan || !board) return;
    board.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX);
    board.scrollTop = pan.scrollTop - (event.clientY - pan.startY);
  }

  function finishPan() {
    const board = boardRef.current;
    if (board) board.classList.remove("is-panning");
    panRef.current = null;
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    const imageItem = Array.from(event.clipboardData.items).find((item) =>
      item.type.startsWith("image/"),
    );
    if (imageItem) {
      const file = imageItem.getAsFile();
      if (!file) return;
      event.preventDefault();
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        if (typeof reader.result !== "string") return;
        if (reader.result.length > MAX_IMAGE_URL) {
          setStatus("That image is too large to paste; try a smaller crop or screenshot.");
          return;
        }
        addCard({
          kind: "image",
          title: "Pasted image",
          body: "Visual reference. It stays as evidence, not a factual claim.",
          meta: "visual note",
          imageUrl: reader.result,
        });
      });
      reader.readAsDataURL(file);
      return;
    }

    const text = event.clipboardData.getData("text/plain").trim();
    if (!text) return;
    event.preventDefault();
    if (looksLikeUrl(text)) {
      addCard({
        kind: "link",
        title: hostFromUrl(text),
        body: "Fetch this source into the cluster before drafting from it.",
        meta: "pasted link",
        sourceUrl: text,
        sourceLabel: hostFromUrl(text),
      });
    } else {
      addCard({
        kind: "note",
        title: "Pasted note",
        body: text.slice(0, 240),
        meta: "manual note",
      });
    }
  }

  function addCard(input: Omit<ResearchBoardCard, "id" | "x" | "y">) {
    const id = `${input.kind}-${crypto.randomUUID()}`;
    hasUserEditedRef.current = true;
    knownIdsRef.current.add(id);
    setCards((current) => {
      const index = current.length + 1;
      return [
        ...current,
        {
          ...input,
          id,
          x: pastePointRef.current.x + index * 8,
          y: pastePointRef.current.y + index * 8,
        },
      ];
    });
    setSelectedCardId(id);
    setStatus(`${input.title} added. Shift-click from another card to connect it.`);
  }

  function addStickyNote() {
    addCard({
      kind: "note",
      title: "Sticky",
      body: "",
      meta: "manual note",
    });
  }

  function updateCard(cardId: string, patch: Partial<Pick<ResearchBoardCard, "body" | "comment">>) {
    hasUserEditedRef.current = true;
    setCards((current) =>
      current.map((card) => (card.id === cardId ? { ...card, ...patch } : card)),
    );
    requestAnimationFrame(measureCenters);
  }

  function updateZoom(next: number) {
    setZoom(Math.max(0.55, Math.min(1.2, next)));
    requestAnimationFrame(measureCenters);
  }

  function tidyBoard() {
    hasUserEditedRef.current = true;
    setCards((current) => arrangeCards(current));
    setStatus("Tidied into sources, evidence, angles, and scraps.");
    requestAnimationFrame(measureCenters);
  }

  const selectedCount = cards.length;
  const quoteCards = cards.filter((card) => card.kind === "quote");
  const leadCards = cards.filter((card) => card.kind === "lead");
  const angleCards = cards.filter((card) => card.kind === "angle");
  const showTutorial = (tutorialReplay || !tutorialDone) && !tutorialDismissed;

  function finishTutorial() {
    try {
      window.localStorage.setItem(RESEARCH_TUTORIAL_DONE_KEY, "1");
    } catch {
      // ignore; hiding it for this tab is enough if storage is unavailable
    }
    setTutorialDismissed(true);
    setTutorialReplay(false);
  }

  function advanceTutorial() {
    if (tutorialStep === "collect") {
      setTutorialStep("arrange");
      return;
    }
    if (tutorialStep === "arrange") {
      setTutorialStep("draft");
      return;
    }
    finishTutorial();
  }

  function replayTutorial() {
    setTutorialStep("collect");
    setTutorialDismissed(false);
    setTutorialReplay(true);
  }

  return (
    <div
      className={`fp-research${showTutorial ? " is-tutorial" : ""}`}
      data-research-tutorial-step={showTutorial ? tutorialStep : undefined}
    >
      {showTutorial ? <div className="fp-research-tutorial-scrim" aria-hidden="true" /> : null}
      <header className="fp-research-h">
        <div className="fp-eyebrow">
          <Link href="/" className="hover:underline" style={{ color: "var(--fg-subtle)" }}>
            Back to Today
          </Link>
          <span className="mx-2" style={{ color: "var(--border-strong)" }}>
            /
          </span>
          <span>Research</span>
          <span className="mx-2" style={{ color: "var(--border-strong)" }}>
            /
          </span>
          <span>{sourceCount} sources</span>
        </div>
        <div className="fp-research-title-row">
          <div>
            <h1 className="fp-research-title">{topic}</h1>
            <p className="fp-research-lede">
              Arrange sources, quotes, leads, and pasted material before turning the cluster into a
              WordPress draft.
            </p>
          </div>
          <div
            className={`fp-research-actions${
              showTutorial && tutorialStep === "draft" ? " fp-research-tutorial-focus" : ""
            }`}
          >
            {sibling ? <div>{sibling}</div> : null}
            {wpEditLink ? (
              <a
                href={wpEditLink}
                target="_blank"
                rel="noreferrer"
                className="fp-btn fp-btn-primary"
              >
                Open in WordPress
              </a>
            ) : (
              <SendNotesToWpForm
                draftId={draftId}
                topic={topic}
                className="fp-btn fp-btn-primary"
                pendingLabel="Saving draft"
              >
                Draft in WordPress
              </SendNotesToWpForm>
            )}
          </div>
        </div>
      </header>

      {saveError ? (
        <div className="fp-research-save-error" role="alert">
          {saveError}
        </div>
      ) : null}

      <div className="fp-research-tabs" role="tablist" aria-label="Research views">
        <div className="fp-research-tab-group">
          {(["board", "list", "magazine"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={view === tab}
              className="fp-research-tab"
              onClick={() => setView(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="fp-research-zoom" aria-label="Board zoom">
          <button type="button" onClick={() => updateZoom(zoom - 0.1)} disabled={zoom <= 0.55}>
            Zoom out
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => updateZoom(zoom + 0.1)} disabled={zoom >= 1.2}>
            Zoom in
          </button>
          <button type="button" onClick={() => updateZoom(0.75)}>
            Fit
          </button>
          <button type="button" onClick={addStickyNote}>
            Sticky
          </button>
          <button type="button" onClick={tidyBoard}>
            Tidy
          </button>
          <button type="button" onClick={replayTutorial}>
            Tutorial
          </button>
        </div>
      </div>

      <div className="fp-research-grid">
        <aside
          className={`fp-research-source-rail${
            showTutorial && tutorialStep === "collect" ? " fp-research-tutorial-focus" : ""
          }`}
          aria-label="Original sources"
        >
          <div className="fp-research-panel-h">
            <h2>Original sources</h2>
            <span>{sources.length}</span>
          </div>
          <ul className="fp-research-sources">
            {sources.map((row) => (
              <li key={row.id} className="fp-research-source">
                <div className="fp-research-source-row">
                  <a href={row.source_url} target="_blank" rel="noreferrer">
                    {row.display_name ?? hostFromUrl(row.source_url)}
                  </a>
                  {row.is_manual ? (
                    <DeleteManualSourceButton
                      draftId={draftId}
                      clusterId={clusterId}
                      itemId={row.id}
                    />
                  ) : null}
                </div>
                <span>{relativeTime(row.published_at)}</span>
                <p>{row.title}</p>
              </li>
            ))}
          </ul>
          <div className="fp-research-add-source">
            <p>Paste a URL here to add it to the cluster source set.</p>
            <AddSourceForm draftId={draftId} clusterId={clusterId} />
          </div>
        </aside>

        {view === "board" ? (
          <div className="fp-research-board-area">
            {showTutorial ? (
              <ResearchTutorialCoach
                step={tutorialStep}
                onNext={advanceTutorial}
                onSkip={finishTutorial}
              />
            ) : (
              <>
                <div className="fp-research-paste-hint">
                  <strong>Paste onto the board</strong>
                  <span>Click the board, then paste a URL, image, screenshot, or text note.</span>
                </div>
                <div className="fp-research-tutorial">
                  <strong>Strict board rules</strong>
                  <ol>
                    <li>Drag empty grid to pan.</li>
                    <li>Use zoom to see the whole argument.</li>
                    <li>Paste links as sources, images as visual notes.</li>
                    <li>Connect evidence to an angle before drafting.</li>
                    <li>Delete scraps freely. Left-rail sources stay.</li>
                  </ol>
                </div>
                <div className="fp-research-status">{status}</div>
              </>
            )}
            <section
              ref={boardRef}
              className={`fp-research-board${
                showTutorial && tutorialStep === "arrange" ? " fp-research-tutorial-focus" : ""
              }`}
              tabIndex={0}
              onClick={rememberPastePoint}
              onPaste={handlePaste}
              onPointerDown={startPan}
              onPointerMove={(event) => {
                moveDrag(event);
                movePan(event);
              }}
              onPointerUp={() => {
                finishDrag();
                finishPan();
              }}
              onPointerCancel={() => {
                finishDrag();
                finishPan();
              }}
              aria-label="Research board"
            >
              <div
                className="fp-research-canvas"
                style={{
                  width: boardSize.width,
                  height: boardSize.height,
                  transform: `scale(${zoom})`,
                }}
              >
                <svg
                  className="fp-research-connections"
                  width={boardSize.width}
                  height={boardSize.height}
                  viewBox={`0 0 ${boardSize.width} ${boardSize.height}`}
                  aria-hidden="true"
                >
                  {connections.map((connection) => (
                    <ConnectionLine
                      key={connection.id}
                      connection={connection}
                      centers={centers}
                      onRename={(label) => {
                        hasUserEditedRef.current = true;
                        setConnections((current) =>
                          current.map((item) =>
                            item.id === connection.id ? { ...item, label } : item,
                          ),
                        );
                      }}
                    />
                  ))}
                </svg>
                {cards.map((card) => (
                  <BoardCardView
                    key={card.id}
                    card={card}
                    selected={card.id === selectedCardId}
                    setRef={(node) => {
                      cardRefs.current[card.id] = node;
                    }}
                    onSelect={(shiftKey) => selectCard(card.id, shiftKey)}
                    onDelete={() => deleteCard(card.id)}
                    onUpdateBody={(body) => updateCard(card.id, { body })}
                    onUpdateComment={(comment) => updateCard(card.id, { comment })}
                    onPointerDown={(event) => startDrag(event, card)}
                    onImageLoad={measureCenters}
                  />
                ))}
              </div>
            </section>
          </div>
        ) : null}

        {view === "list" ? <ListView cards={cards} /> : null}
        {view === "magazine" ? (
          <MagazineView
            topic={topic}
            angle={angleCards[0]}
            quote={quoteCards[0]}
            lead={leadCards[0]}
          />
        ) : null}

        <aside
          className={`fp-research-draft-rail${
            showTutorial && tutorialStep === "draft" ? " fp-research-tutorial-focus" : ""
          }`}
          aria-label="Draft moves"
        >
          <div className="fp-research-panel-h">
            <h2>Draft moves</h2>
            <span>{selectedCount}</span>
          </div>
          <div className="fp-research-move">
            <span>Opening</span>
            <h3>{quoteCards[0]?.body ?? "Start with the strongest quote."}</h3>
          </div>
          <div className="fp-research-move">
            <span>Angle</span>
            <h3>{angleCards[0]?.title ?? "Choose a frame before drafting."}</h3>
            {angleCards[0]?.body ? <p>{angleCards[0].body}</p> : null}
          </div>
          <div className="fp-research-move">
            <span>Guardrail</span>
            <h3>Private board, public post</h3>
            <p>Delete weak scraps here. Original source links stay in the left rail.</p>
          </div>
          <div className="fp-research-rail-actions">
            <RemixIdeasButton draftId={draftId} />
            <MoreQuotesButton draftId={draftId} atCap={notes.quotes.length >= QUOTE_CAP} />
          </div>
        </aside>
      </div>
    </div>
  );
}

function ResearchTutorialCoach({
  step,
  onNext,
  onSkip,
}: {
  step: ResearchTutorialStep;
  onNext: () => void;
  onSkip: () => void;
}) {
  const copy = {
    collect: {
      label: "1 of 3",
      title: "Collect the reading",
      body: "The left rail keeps original sources. Paste extra links, screenshots, images, and notes directly onto the board.",
      buttonLabel: "Arrange",
    },
    arrange: {
      label: "2 of 3",
      title: "Connect evidence to an angle",
      body: "Drag cards into a useful order. Select a card, then shift-click another to label why those two items belong together.",
      buttonLabel: "Draft",
    },
    draft: {
      label: "3 of 3",
      title: "Generate from the board",
      body: "When you generate the drafted version, FlavorPress saves the board and passes the cards plus connection labels into the draft prompt.",
      buttonLabel: "Done",
    },
  }[step];

  return (
    <section
      className="fp-research-tutorial-coach"
      aria-label="Research board tutorial"
      data-testid="research-tutorial-coach"
    >
      <div>
        <span>{copy.label}</span>
        <h2>{copy.title}</h2>
        <p>{copy.body}</p>
      </div>
      <div className="fp-research-tutorial-actions">
        <button type="button" className="fp-btn fp-btn-ghost" onClick={onSkip}>
          Skip tutorial
        </button>
        <button type="button" className="fp-btn fp-btn-primary" onClick={onNext}>
          {copy.buttonLabel}
        </button>
      </div>
    </section>
  );
}

function BoardCardView({
  card,
  selected,
  setRef,
  onSelect,
  onDelete,
  onUpdateBody,
  onUpdateComment,
  onPointerDown,
  onImageLoad,
}: {
  card: ResearchBoardCard;
  selected: boolean;
  setRef: (node: HTMLElement | null) => void;
  onSelect: (shiftKey: boolean) => void;
  onDelete: () => void;
  onUpdateBody: (body: string) => void;
  onUpdateComment: (comment: string) => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onImageLoad: () => void;
}) {
  const className = `fp-research-card fp-research-card-${card.kind}${selected ? " is-selected" : ""}`;
  return (
    <article
      ref={setRef}
      className={className}
      style={{ left: card.x, top: card.y }}
      data-card={card.id}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(event.shiftKey);
      }}
      onPointerDown={onPointerDown}
      title="Drag to move. Shift-click from a selected card to connect."
    >
      <button
        type="button"
        className="fp-research-card-delete"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        aria-label="Delete board card"
      >
        x
      </button>
      <div className="fp-research-card-meta">
        <span>{labelForKind(card.kind)}</span>
        <span>{card.meta}</span>
      </div>
      {card.imageUrl ? (
        // Pasted images are local data URLs. Next/Image cannot optimize them.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={card.imageUrl} alt="" className="fp-research-card-media" onLoad={onImageLoad} />
      ) : null}
      {card.kind === "note" ? (
        <textarea
          className="fp-research-card-textarea"
          value={card.body}
          placeholder="Write a sticky note"
          rows={4}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) => onUpdateBody(event.target.value)}
          aria-label="Sticky note text"
        />
      ) : card.kind === "quote" ? (
        <blockquote>{card.body}</blockquote>
      ) : (
        <>
          <h3>{card.title}</h3>
          <p>{card.body}</p>
        </>
      )}
      {card.sourceUrl ? (
        <a href={card.sourceUrl} target="_blank" rel="noreferrer" className="fp-research-card-link">
          {card.sourceLabel ?? hostFromUrl(card.sourceUrl)}
        </a>
      ) : null}
      <textarea
        className="fp-research-card-comment"
        value={card.comment ?? ""}
        placeholder="Comment"
        rows={2}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onChange={(event) => onUpdateComment(event.target.value)}
        aria-label={`Comment on ${labelForKind(card.kind)}`}
      />
    </article>
  );
}

function ConnectionLine({
  connection,
  centers,
  onRename,
}: {
  connection: ResearchBoardConnection;
  centers: Record<string, Center>;
  onRename: (label: string) => void;
}) {
  const from = centers[connection.from];
  const to = centers[connection.to];
  if (!from || !to) return null;
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const bend = Math.max(44, Math.min(130, Math.abs(from.x - to.x) * 0.3));
  const c1x = from.x + (to.x > from.x ? bend : -bend);
  const c2x = to.x - (to.x > from.x ? bend : -bend);
  const labelWidth = Math.max(92, connection.label.length * 7 + 28);
  return (
    <g>
      <path d={`M${from.x} ${from.y} C${c1x} ${from.y}, ${c2x} ${to.y}, ${to.x} ${to.y}`} />
      <rect
        className="fp-research-connection-label-bg"
        x={midX - labelWidth / 2}
        y={midY - 12}
        width={labelWidth}
        height="24"
        rx="12"
      />
      <text x={midX} y={midY + 4} textAnchor="middle">
        {connection.label}
      </text>
      <rect
        className="fp-research-connection-hit"
        x={midX - labelWidth / 2}
        y={midY - 12}
        width={labelWidth}
        height="24"
        rx="12"
        onClick={(event) => {
          event.stopPropagation();
          const label = window.prompt("Rename connection", connection.label);
          if (label?.trim()) onRename(label.trim().slice(0, 32));
        }}
      />
    </g>
  );
}

function ListView({ cards }: { cards: ResearchBoardCard[] }) {
  return (
    <section className="fp-research-list" aria-label="Research list">
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Material</th>
            <th>Source</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((card) => (
            <tr key={card.id}>
              <td>{labelForKind(card.kind)}</td>
              <td>{card.kind === "quote" || card.kind === "note" ? card.body : card.title}</td>
              <td>
                {card.sourceLabel ?? (card.sourceUrl ? hostFromUrl(card.sourceUrl) : "board")}
              </td>
              <td>{card.comment ? `Comment: ${card.comment}` : card.meta}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function MagazineView({
  topic,
  angle,
  quote,
  lead,
}: {
  topic: string;
  angle?: ResearchBoardCard;
  quote?: ResearchBoardCard;
  lead?: ResearchBoardCard;
}) {
  return (
    <section className="fp-research-magazine" aria-label="Magazine view">
      <article className="fp-research-mag-feature">
        <span>Working frame</span>
        <h2>{topic}</h2>
        <p>{angle?.body ?? "Pick one angle from the board before opening the draft wizard."}</p>
      </article>
      <div className="fp-research-mag-stack">
        <article>
          <span>Best quote</span>
          <p>{quote?.body ?? "No pinned quote yet."}</p>
        </article>
        <article>
          <span>Lead to verify</span>
          <p>{lead?.body ?? "No lead selected yet."}</p>
        </article>
      </div>
    </section>
  );
}

function buildInitialCards(notes: Notes, sources: SourceRow[]): ResearchBoardCard[] {
  const cards: ResearchBoardCard[] = [];
  sources.slice(0, 5).forEach((source, index) => {
    cards.push({
      id: `source-${source.id}`,
      kind: "source",
      title: source.title,
      body: "Original source. Keep it available even when board scraps are deleted.",
      meta: source.display_name ?? hostFromUrl(source.source_url),
      sourceUrl: source.source_url,
      sourceLabel: hostFromUrl(source.source_url),
      x: 34 + (index % 2) * 258,
      y: 118 + Math.floor(index / 2) * 156,
    });
  });
  notes.quotes.slice(0, 4).forEach((quote, index) => {
    cards.push(cardFromQuote(quote, index));
  });
  notes.ideas.slice(0, 3).forEach((idea, index) => {
    cards.push(cardFromIdea(idea, index));
  });
  notes.facts.slice(0, 3).forEach((fact, index) => {
    cards.push(cardFromFact(fact, index));
  });
  return arrangeCards(cards);
}

function arrangeCards(cards: ResearchBoardCard[]): ResearchBoardCard[] {
  const counters: Record<BoardLaneId, number> = {
    sources: 0,
    evidence: 0,
    angles: 0,
    scraps: 0,
  };
  return cards.map((card) => {
    const lane = laneForCard(card);
    const index = counters[lane];
    counters[lane] += 1;
    const x = xForLane(lane);
    const gap = card.kind === "image" ? 320 : card.kind === "angle" ? 178 : 154;
    return {
      ...card,
      x,
      y: 96 + index * gap,
    };
  });
}

function laneForCard(card: ResearchBoardCard): BoardLaneId {
  if (card.kind === "source") return "sources";
  if (card.kind === "quote" || card.kind === "lead") return "evidence";
  if (card.kind === "angle") return "angles";
  return "scraps";
}

function xForLane(lane: BoardLaneId): number {
  if (lane === "sources") return 34;
  if (lane === "evidence") return 350;
  if (lane === "angles") return 684;
  return 1052;
}

function subscribeToResearchTutorialStore(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

function readResearchTutorialDone(): boolean {
  try {
    return window.localStorage.getItem(RESEARCH_TUTORIAL_DONE_KEY) === "1";
  } catch {
    return true;
  }
}

function readServerResearchTutorialDone(): boolean {
  return true;
}

function buildInitialConnections(cards: ResearchBoardCard[]): ResearchBoardConnection[] {
  const firstSource = cards.find((card) => card.kind === "source");
  const firstQuote = cards.find((card) => card.kind === "quote");
  const firstAngle = cards.find((card) => card.kind === "angle");
  const firstLead = cards.find((card) => card.kind === "lead");
  const connections: ResearchBoardConnection[] = [];
  if (firstSource && firstQuote) {
    connections.push({
      id: "connection-source-quote",
      from: firstSource.id,
      to: firstQuote.id,
      label: "backs quote",
    });
  }
  if (firstQuote && firstAngle) {
    connections.push({
      id: "connection-quote-angle",
      from: firstQuote.id,
      to: firstAngle.id,
      label: "supports angle",
    });
  }
  if (firstAngle && firstLead) {
    connections.push({
      id: "connection-angle-lead",
      from: firstAngle.id,
      to: firstLead.id,
      label: "needs verify",
    });
  }
  return connections;
}

function cardFromQuote(quote: NoteQuote, index: number): ResearchBoardCard {
  return {
    id: `quote-${index}`,
    kind: "quote",
    title: "Quote",
    body: quote.text,
    meta: quote.speaker ?? hostFromUrl(quote.sourceUrl),
    sourceUrl: quote.sourceUrl,
    sourceLabel: hostFromUrl(quote.sourceUrl),
    x: 318 + (index % 3) * 246,
    y: 112 + Math.floor(index / 3) * 156,
  };
}

function cardFromIdea(idea: NoteIdea, index: number): ResearchBoardCard {
  return {
    id: `angle-${index}`,
    kind: "angle",
    title: idea.angle,
    body: idea.rationale,
    meta: "angle",
    x: 330 + (index % 2) * 292,
    y: 292 + Math.floor(index / 2) * 156,
  };
}

function cardFromFact(fact: NoteFact, index: number): ResearchBoardCard {
  return {
    id: `lead-${index}`,
    kind: "lead",
    title: "Lead to verify",
    body: fact.text,
    meta: "verify",
    sourceUrl: fact.sourceUrl,
    sourceLabel: hostFromUrl(fact.sourceUrl),
    x: 34 + (index % 3) * 250,
    y: 448 + Math.floor(index / 3) * 148,
  };
}

function labelForKind(kind: ResearchBoardCardKind): string {
  if (kind === "source") return "Source";
  if (kind === "quote") return "Quote";
  if (kind === "lead") return "Lead";
  if (kind === "angle") return "Angle";
  if (kind === "image") return "Image";
  if (kind === "link") return "Link";
  return "Note";
}

function looksLikeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function hostFromUrl(s: string): string {
  try {
    return new URL(s).host;
  } catch {
    return s;
  }
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}
