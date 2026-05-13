import { ipcMain } from "electron";
import { IPC_CHANNELS } from "@prompthub/shared/constants";
import type {
  SkillInsight,
  SkillInsightCacheEntry,
  SkillInsightConfidence,
  SkillInsightVerdict,
} from "@prompthub/shared/types";
import type { SkillIPCContext } from "./shared";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isVerdict(value: unknown): value is SkillInsightVerdict {
  return (
    value === "recommended" ||
    value === "caution" ||
    value === "not-recommended"
  );
}

function isConfidence(value: unknown): value is SkillInsightConfidence {
  return value === "high" || value === "medium" || value === "low";
}

function isSkillInsight(value: unknown): value is SkillInsight {
  if (!isRecord(value) || !isRecord(value.promptExamples)) {
    return false;
  }

  return (
    typeof value.version === "number" &&
    typeof value.language === "string" &&
    typeof value.generatedAt === "number" &&
    typeof value.contentHash === "string" &&
    isVerdict(value.verdict) &&
    typeof value.verdictReason === "string" &&
    typeof value.capabilitySummary === "string" &&
    isStringArray(value.bestFor) &&
    isStringArray(value.notFor) &&
    isStringArray(value.triggerGuidance) &&
    isStringArray(value.promptExamples.explicit) &&
    isStringArray(value.promptExamples.natural) &&
    isStringArray(value.promptExamples.boundary) &&
    isStringArray(value.prerequisites) &&
    isStringArray(value.riskNotes) &&
    isConfidence(value.confidence) &&
    Array.isArray(value.evidence) &&
    value.evidence.every(
      (item) =>
        isRecord(item) &&
        typeof item.label === "string" &&
        typeof item.quote === "string" &&
        (item.source === undefined || typeof item.source === "string"),
    )
  );
}

function isReadySkillInsightCacheEntry(
  value: unknown,
): value is SkillInsightCacheEntry {
  return (
    isRecord(value) &&
    value.status === "ready" &&
    typeof value.timestamp === "number" &&
    Number.isFinite(value.timestamp) &&
    typeof value.language === "string" &&
    typeof value.contentHash === "string" &&
    isSkillInsight(value.insight) &&
    (value.error === undefined || typeof value.error === "string")
  );
}

function sanitizeInsightCache(
  value: Record<string, unknown>,
): Record<string, SkillInsightCacheEntry> {
  const cache: Record<string, SkillInsightCacheEntry> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key.trim().length > 0 && isReadySkillInsightCacheEntry(entry)) {
      cache[key] = entry;
    }
  }
  return cache;
}

export function registerSkillInsightCacheHandlers({
  db,
}: SkillIPCContext): void {
  ipcMain.handle(IPC_CHANNELS.SKILL_INSIGHT_CACHE_GET, async () =>
    db.getSkillInsightCache(),
  );

  ipcMain.handle(
    IPC_CHANNELS.SKILL_INSIGHT_CACHE_SAVE,
    async (_, cache: unknown) => {
      if (!isRecord(cache)) {
        throw new Error("skill:insightCache:save expects a cache object");
      }
      db.saveSkillInsightCacheEntries(sanitizeInsightCache(cache));
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.SKILL_INSIGHT_CACHE_DELETE,
    async (_, key: string) => {
      if (typeof key !== "string" || key.trim().length === 0) {
        throw new Error("skill:insightCache:delete requires a non-empty key");
      }
      return db.deleteSkillInsightCacheEntry(key);
    },
  );
}
