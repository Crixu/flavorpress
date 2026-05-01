import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock, ensureSchemaMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  ensureSchemaMock: vi.fn(),
}));

vi.mock("../../db", () => ({
  db: { execute: executeMock },
  ensureSchema: ensureSchemaMock,
  SINGLE_USER_ID: "default-user",
}));

import { buildExportEnvelope } from "../export";

describe("buildExportEnvelope", () => {
  beforeEach(() => {
    executeMock.mockReset();
    ensureSchemaMock.mockReset();
  });

  it("exports explicit source-to-outlet assignments", async () => {
    executeMock.mockImplementation(({ sql }: { sql: string }) => {
      if (sql.includes("FROM users")) {
        return Promise.resolve({
          rows: [
            {
              id: "default-user",
              email: "writer@example.com",
              niche_label: null,
              created_at: 1000,
              last_active_at: null,
            },
          ],
        });
      }
      if (sql.includes("FROM outlets WHERE")) {
        return Promise.resolve({
          rows: [
            {
              id: "outlet-a",
              base_url: "https://example.com",
              display_name: "Example",
              username: "writer",
              kind: "wp-org",
              is_default: 1,
              app_password_encrypted: new Uint8Array([1]),
              connected_at: 1100,
              created_at: 1000,
              last_used_at: null,
            },
          ],
        });
      }
      if (sql.includes("FROM voice_profiles")) return Promise.resolve({ rows: [] });
      if (sql.includes("FROM source_folders")) return Promise.resolve({ rows: [] });
      if (sql.includes("FROM sources WHERE")) {
        return Promise.resolve({
          rows: [
            {
              id: "source-a",
              kind: "rss",
              url: "https://reader.example/feed",
              display_name: "Reader",
              folder_id: null,
              trust_score: 0.5,
              poll_interval_seconds: 300,
              active: 1,
              created_at: 1200,
            },
          ],
        });
      }
      if (sql.includes("FROM outlet_sources")) {
        return Promise.resolve({
          rows: [{ outlet_id: "outlet-a", source_id: "source-a", created_at: 1300 }],
        });
      }
      if (sql.includes("FROM drafts")) return Promise.resolve({ rows: [] });
      throw new Error(`Unexpected query: ${sql}`);
    });

    const envelope = await buildExportEnvelope();

    expect(envelope.outletSourceAssignments).toEqual([
      { outletId: "outlet-a", sourceId: "source-a", createdAt: 1300 },
    ]);
  });
});
