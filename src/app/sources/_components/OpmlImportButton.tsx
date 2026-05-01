"use client";

import { useId, useRef, useState, useTransition, type ChangeEvent } from "react";
import { importOpmlSelectionAction, parseOpmlAction, type OpmlPickerFeed } from "@/lib/v1/actions";
import { OPML_IMPORT_CAP } from "@/lib/v1/opml";

interface OpmlImportButtonProps {
  folders: { id: string; name: string }[];
  currentFolderId?: string | null;
}

/**
 * OPML picker. Onboarding cold-start otherwise stalls the reading-to-writing
 * loop because the user has zero sources. We accept an OPML export, parse
 * it server-side, and let the user pick at most OPML_IMPORT_CAP feeds before
 * they land in `sources`. The cap is the slop guardrail; bulk-importing
 * dozens of feeds at once is the same anti-pattern as a marketplace of
 * connectors. The picker preserves the OPML title as the seed display name
 * so background auto-titling does not clobber the user's chosen label.
 */
export function OpmlImportButton({ folders, currentFolderId }: OpmlImportButtonProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const fileInputId = useId();

  const [open, setOpen] = useState(false);
  const [parsing, startParse] = useTransition();
  const [importing, startImport] = useTransition();

  const [feeds, setFeeds] = useState<OpmlPickerFeed[] | null>(null);
  const [meta, setMeta] = useState<{
    rawCount: number;
    alreadyAddedCount: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [folderId, setFolderId] = useState<string>(currentFolderId ?? "");
  const [filter, setFilter] = useState("");

  function reset() {
    setFeeds(null);
    setMeta(null);
    setError(null);
    setSelected(new Set());
    setFilter("");
    if (fileRef.current) fileRef.current.value = "";
  }

  function close() {
    setOpen(false);
    reset();
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    setError(null);
    setFeeds(null);
    setMeta(null);
    setSelected(new Set());
    startParse(async () => {
      const res = await parseOpmlAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setFeeds(res.feeds);
      setMeta({
        rawCount: res.rawCount,
        alreadyAddedCount: res.alreadyAddedCount,
      });
    });
  }

  function toggle(url: string, alreadyAdded: boolean) {
    if (alreadyAdded) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else if (next.size < OPML_IMPORT_CAP) {
        next.add(url);
      }
      return next;
    });
  }

  function submit() {
    if (selected.size === 0 || !feeds) return;
    const fd = new FormData();
    for (const feed of feeds) {
      if (!selected.has(feed.url)) continue;
      fd.append("url", feed.url);
      fd.append("title", feed.title);
    }
    if (folderId) fd.append("folderId", folderId);
    startImport(async () => {
      await importOpmlSelectionAction(fd);
      close();
    });
  }

  const visibleFeeds = (feeds ?? []).filter((f) => {
    if (!filter.trim()) return true;
    const q = filter.trim().toLowerCase();
    return (
      f.title.toLowerCase().includes(q) ||
      f.url.toLowerCase().includes(q) ||
      (f.groupTitle ?? "").toLowerCase().includes(q)
    );
  });

  const importableSelected = selected.size;
  const atCap = importableSelected >= OPML_IMPORT_CAP;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-stone-200 bg-white px-3 py-1.5 text-sm hover:bg-stone-50"
        title="Import a list of feeds from an OPML export"
      >
        Import OPML
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="opml-title"
        >
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
          />
          <div
            className="relative flex max-h-[88vh] w-[min(640px,92vw)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            style={{ border: "1px solid var(--border)" }}
          >
            <header className="flex items-start justify-between gap-4 border-b border-stone-200 px-5 py-4">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-stone-500">Import</div>
                <h2 id="opml-title" className="mt-0.5 text-lg font-semibold tracking-tight">
                  Pick feeds from OPML
                </h2>
                <p className="mt-1 text-[12px] leading-relaxed text-stone-500">
                  Choose up to {OPML_IMPORT_CAP} feeds you actually still read. Bulk-importing every
                  feed in the file is the fastest path to slop; a tighter pick keeps the cluster
                  engine honest.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="rounded-md px-2 py-1 text-stone-500 hover:bg-stone-100"
              >
                ✕
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {feeds === null ? (
                <div className="flex flex-col items-start gap-3">
                  <label
                    htmlFor={fileInputId}
                    className="cursor-pointer rounded border border-dashed border-stone-300 bg-stone-50 px-4 py-6 text-sm text-stone-600 hover:border-stone-400"
                  >
                    {parsing ? "Parsing OPML…" : "Choose an .opml or .xml file"}
                    <input
                      ref={fileRef}
                      id={fileInputId}
                      type="file"
                      accept=".opml,.xml,application/xml,text/xml"
                      onChange={onFile}
                      disabled={parsing}
                      className="sr-only"
                    />
                  </label>
                  <p className="text-[11px] text-stone-500">
                    Most readers (Feedly, Inoreader, NetNewsWire, Reeder) can export their full
                    subscription list as OPML. We parse it locally on the server; nothing is
                    uploaded anywhere else.
                  </p>
                  {error ? (
                    <p
                      className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700"
                      role="alert"
                    >
                      {error}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3 text-[12px] text-stone-600">
                    <span>
                      {feeds.length} feed{feeds.length === 1 ? "" : "s"} found
                      {meta && meta.alreadyAddedCount > 0 ? (
                        <>
                          {" · "}
                          {meta.alreadyAddedCount} already in your sources
                        </>
                      ) : null}
                    </span>
                    <span className={atCap ? "font-medium text-amber-700" : "text-stone-500"}>
                      {importableSelected} / {OPML_IMPORT_CAP} selected
                    </span>
                  </div>
                  {feeds.length > 8 ? (
                    <input
                      type="search"
                      placeholder="Filter by title or domain"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      className="w-full rounded border border-stone-300 px-3 py-1.5 text-xs"
                    />
                  ) : null}
                  <ul className="divide-y divide-stone-100 rounded border border-stone-200">
                    {visibleFeeds.map((feed) => {
                      const isSelected = selected.has(feed.url);
                      const disabled = feed.alreadyAdded || (atCap && !isSelected);
                      return (
                        <li
                          key={feed.url}
                          className={`flex items-start gap-3 px-3 py-2 ${
                            disabled && !isSelected ? "opacity-60" : ""
                          }`}
                        >
                          <input
                            type="checkbox"
                            id={`opml-${feed.url}`}
                            className="mt-1"
                            checked={isSelected}
                            disabled={feed.alreadyAdded}
                            onChange={() => toggle(feed.url, feed.alreadyAdded)}
                          />
                          <label
                            htmlFor={`opml-${feed.url}`}
                            className="min-w-0 flex-1 cursor-pointer"
                          >
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                              <span className="text-sm font-medium">{feed.title}</span>
                              {feed.groupTitle ? (
                                <span className="text-[11px] text-stone-500">
                                  in {feed.groupTitle}
                                </span>
                              ) : null}
                              {feed.alreadyAdded ? (
                                <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-stone-500">
                                  Already added
                                </span>
                              ) : null}
                            </div>
                            <div className="truncate font-mono text-[11px] text-stone-500">
                              {feed.url}
                            </div>
                          </label>
                        </li>
                      );
                    })}
                    {visibleFeeds.length === 0 ? (
                      <li className="px-3 py-3 text-center text-[12px] text-stone-500">
                        No feeds match that filter.
                      </li>
                    ) : null}
                  </ul>
                </div>
              )}
            </div>

            {feeds !== null ? (
              <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 bg-stone-50 px-5 py-3">
                <div className="flex items-center gap-2 text-xs">
                  <label htmlFor="opml-folder" className="text-stone-500">
                    Add to folder
                  </label>
                  <select
                    id="opml-folder"
                    value={folderId}
                    onChange={(e) => setFolderId(e.target.value)}
                    className="rounded border border-stone-300 px-2 py-1 text-xs"
                  >
                    <option value="">Ungrouped</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={reset}
                    className="rounded px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-100"
                    disabled={importing}
                  >
                    Choose different file
                  </button>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={importableSelected === 0 || importing}
                    className="rounded bg-indigo-600 px-4 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {importing
                      ? "Importing…"
                      : importableSelected === 0
                        ? "Pick at least one"
                        : `Import ${importableSelected}`}
                  </button>
                </div>
              </footer>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
