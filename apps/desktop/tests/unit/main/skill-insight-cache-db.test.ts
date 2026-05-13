import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SkillDB } from "../../../src/main/database/skill";
import {
  SCHEMA_INDEXES,
  SCHEMA_TABLES,
} from "../../../src/main/database/schema";
import DatabaseAdapter from "../../../src/main/database/sqlite";
import type { SkillInsightCacheEntry } from "@prompthub/shared/types";

function createReadyEntry(
  overrides: Partial<SkillInsightCacheEntry> = {},
): SkillInsightCacheEntry {
  return {
    status: "ready",
    timestamp: 100,
    language: "中文",
    contentHash: "hash-1",
    insight: {
      version: 1,
      language: "中文",
      generatedAt: 100,
      contentHash: "hash-1",
      verdict: "recommended",
      verdictReason: "Clear scope.",
      capabilitySummary: "Explains a demo skill before import.",
      bestFor: ["Import decisions"],
      notFor: ["Security replacement"],
      triggerGuidance: ["Ask when this skill should be used"],
      promptExamples: {
        explicit: ["Use demo-skill to inspect this workflow"],
        natural: ["Can you explain whether this skill fits my task?"],
        boundary: ["Do not use this as a security scan"],
      },
      prerequisites: ["Full SKILL.md content"],
      riskNotes: ["No obvious risk"],
      confidence: "high",
      evidence: [
        {
          label: "Overview",
          quote: "Use this skill for demo reviews.",
          source: "SKILL.md",
        },
      ],
    },
    ...overrides,
  };
}

describe("SkillDB skill insight cache", () => {
  let rawDb: DatabaseAdapter.Database;
  let db: SkillDB;

  beforeEach(() => {
    rawDb = new DatabaseAdapter(":memory:");
    rawDb.pragma("foreign_keys = ON");
    rawDb.exec(SCHEMA_TABLES);
    rawDb.exec(SCHEMA_INDEXES);
    db = new SkillDB(rawDb);
  });

  afterEach(() => {
    rawDb.close();
  });

  it("persists and reads ready skill insight entries", () => {
    const entry = createReadyEntry();

    db.saveSkillInsightCacheEntries({ "skill-insight:key": entry });

    expect(db.getSkillInsightCache()).toEqual({
      "skill-insight:key": entry,
    });
  });

  it("does not persist transient non-ready entries", () => {
    const entry: SkillInsightCacheEntry = {
      status: "error",
      timestamp: 100,
      language: "中文",
      contentHash: "hash-1",
      error: "AI_NOT_CONFIGURED",
    };

    db.saveSkillInsightCacheEntries({ "skill-insight:error": entry });

    expect(db.getSkillInsightCache()).toEqual({});
  });

  it("deletes a persisted cache entry by key", () => {
    db.saveSkillInsightCacheEntries({
      "skill-insight:key": createReadyEntry(),
    });

    expect(db.deleteSkillInsightCacheEntry("skill-insight:key")).toBe(true);
    expect(db.getSkillInsightCache()).toEqual({});
  });
});
