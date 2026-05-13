import type { SkillDB } from "../database/skill";
import { registerSkillCrudHandlers } from "./skill/crud-handlers";
import { registerSkillInsightCacheHandlers } from "./skill/insight-cache-handlers";
import { registerSkillLocalRepoHandlers } from "./skill/local-repo-handlers";
import { registerSkillPlatformHandlers } from "./skill/platform-handlers";
import { registerSkillsShHandlers } from "./skill/skills-sh-handlers";
import { registerSkillVersionHandlers } from "./skill/version-handlers";

/**
 * Register Skill-related IPC handlers.
 * Keep the public channel surface stable while organizing handlers by domain.
 */
export function registerSkillIPC(db: SkillDB): void {
  const context = { db };

  registerSkillCrudHandlers(context);
  registerSkillInsightCacheHandlers(context);
  registerSkillPlatformHandlers(context);
  registerSkillLocalRepoHandlers(context);
  registerSkillVersionHandlers(context);
  registerSkillsShHandlers();
}
