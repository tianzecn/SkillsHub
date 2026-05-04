import { ipcMain } from "electron";
import { IPC_CHANNELS } from "@prompthub/shared/constants";
import type { SkillsShStoreRequest } from "@prompthub/shared/types";
import { loadSkillsShStore } from "../../services/skills-sh-api";

function sanitizeSkillsShRequest(input: unknown): SkillsShStoreRequest {
  if (input === undefined || input === null) {
    return {};
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new Error("skill:loadSkillsShStore expects an options object");
  }

  const value = input as Partial<SkillsShStoreRequest>;
  const request: SkillsShStoreRequest = {};
  if (typeof value.apiKey === "string") {
    request.apiKey = value.apiKey;
  }
  if (
    value.view === "trending" ||
    value.view === "all-time" ||
    value.view === "hot" ||
    value.view === "curated"
  ) {
    request.view = value.view;
  }
  if (typeof value.query === "string") {
    request.query = value.query;
  }
  if (typeof value.limit === "number") {
    request.limit = value.limit;
  }
  if (typeof value.includeDuplicates === "boolean") {
    request.includeDuplicates = value.includeDuplicates;
  }
  if (typeof value.includeIncomplete === "boolean") {
    request.includeIncomplete = value.includeIncomplete;
  }
  return request;
}

export function registerSkillsShHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SKILL_LOAD_SKILLS_SH_STORE, async (_, input) => {
    return loadSkillsShStore(sanitizeSkillsShRequest(input));
  });
}

