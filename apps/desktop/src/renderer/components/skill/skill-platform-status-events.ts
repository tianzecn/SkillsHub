export const SKILL_PLATFORM_STATUS_CHANGE_EVENT =
  "prompthub:skill-platform-status-change";

export interface SkillPlatformStatusChangeDetail {
  skillName: string;
}

export function dispatchSkillPlatformStatusChange(skillName: string): void {
  window.dispatchEvent(
    new CustomEvent<SkillPlatformStatusChangeDetail>(
      SKILL_PLATFORM_STATUS_CHANGE_EVENT,
      { detail: { skillName } },
    ),
  );
}
