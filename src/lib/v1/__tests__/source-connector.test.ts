import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Source } from "../types";
import type { RawItem, SourceConnector } from "../source-connector";

const { executeMock, ensureSchemaMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  ensureSchemaMock: vi.fn(),
}));

vi.mock("../../db", () => ({
  db: { execute: executeMock },
  ensureSchema: ensureSchemaMock,
}));

import { runConnector } from "../source-connector";

describe("runConnector", () => {
  beforeEach(() => {
    executeMock.mockReset();
    ensureSchemaMock.mockReset();
  });

  it("refreshes mutable engagement fields for already-ingested items", async () => {
    executeMock.mockImplementation((query: string | { sql: string }) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (sql.includes("SELECT canonical_url FROM items")) {
        return Promise.resolve({
          rows: [{ canonical_url: "https://www.reddit.com/r/foo/comments/abc/hello" }],
        });
      }
      return Promise.resolve({ rows: [], rowsAffected: 0 });
    });

    const connector: SourceConnector<RawItem> = {
      kind: "reddit",
      defaultPollIntervalSeconds: 600,
      async fetch() {
        return [
          {
            externalId: "t3_abc",
            url: "https://www.reddit.com/r/foo/comments/abc/hello/",
            title: "Hello",
            lede: "Hello",
            body: null,
            authors: [],
            publishedAt: 1_700_000_000_000,
            raw: {},
            score: 42,
            commentCount: 7,
          },
        ];
      },
      parse(raw) {
        return raw;
      },
    };

    await runConnector(connector, source());

    expect(executeMock).toHaveBeenCalledWith({
      sql: `UPDATE items
            SET score = ?, comment_count = ?
            WHERE user_id = ? AND canonical_url = ?`,
      args: [42, 7, "user-1", "https://www.reddit.com/r/foo/comments/abc/hello"],
    });
    expect(
      executeMock.mock.calls.some(([query]) => {
        const sql = typeof query === "string" ? query : query.sql;
        return sql.includes("INSERT INTO items");
      }),
    ).toBe(false);
  });
});

function source(): Source {
  return {
    id: "source-1",
    userId: "user-1",
    kind: "reddit",
    url: "https://www.reddit.com/r/foo/",
    displayName: "r/foo",
    trustScore: 0.5,
    pollIntervalSeconds: 600,
    lastPolledAt: null,
    lastError: null,
    lastEtag: null,
    lastModified: null,
    backoffUntil: null,
    active: true,
    createdAt: 1_700_000_000_000,
  };
}
