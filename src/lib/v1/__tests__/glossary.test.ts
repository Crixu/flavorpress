import { describe, expect, it } from "vitest";
import { GLOSSARY, getEntry, listEntries } from "../glossary";

describe("glossary", () => {
  describe("getEntry", () => {
    it("returns the entry when the id exists", () => {
      const entry = getEntry("trust");
      expect(entry).not.toBeNull();
      expect(entry?.id).toBe("trust");
      expect(entry?.term).toBe("Source trust");
    });

    it("returns null for unknown ids", () => {
      expect(getEntry("does-not-exist")).toBeNull();
    });
  });

  describe("listEntries", () => {
    it("returns every entry sorted by term", () => {
      const entries = listEntries();
      expect(entries).toHaveLength(Object.keys(GLOSSARY).length);
      const terms = entries.map((e) => e.term);
      const sorted = [...terms].sort((a, b) => a.localeCompare(b));
      expect(terms).toEqual(sorted);
    });
  });

  describe("entry shape", () => {
    it("uses self-consistent ids on every entry", () => {
      for (const [key, entry] of Object.entries(GLOSSARY)) {
        expect(entry.id).toBe(key);
      }
    });

    it("has only valid `related` references", () => {
      const knownIds = new Set(Object.keys(GLOSSARY));
      for (const entry of Object.values(GLOSSARY)) {
        for (const ref of entry.related ?? []) {
          expect(knownIds, `unknown related id "${ref}" on entry "${entry.id}"`).toContain(ref);
        }
      }
    });

    it("has a non-empty short and body on every entry", () => {
      for (const entry of Object.values(GLOSSARY)) {
        expect(entry.short.length, `empty short on ${entry.id}`).toBeGreaterThan(0);
        expect(entry.body.length, `empty body on ${entry.id}`).toBeGreaterThan(0);
        for (const para of entry.body) {
          expect(para.trim().length).toBeGreaterThan(0);
        }
      }
    });
  });
});
