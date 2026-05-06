import { describe, expect, it } from "vitest";
import { ensureSchema, db } from "@/lib/db";

describe("item_tags schema", () => {
  it("creates the item_tags table with correct columns", async () => {
    await ensureSchema();
    const r = await db.execute({
      sql: `SELECT name FROM pragma_table_info('item_tags')`,
      args: [],
    });
    const cols = r.rows.map((row) => row.name);
    expect(cols).toEqual(
      expect.arrayContaining(["item_id", "tag", "confidence", "created_at"]),
    );
  });

  it("creates index on item_id", async () => {
    await ensureSchema();
    const r = await db.execute({
      sql: `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='item_tags'`,
      args: [],
    });
    const names = r.rows.map((row) => String(row.name));
    expect(names.some((n) => n.includes("item"))).toBe(true);
  });
});
