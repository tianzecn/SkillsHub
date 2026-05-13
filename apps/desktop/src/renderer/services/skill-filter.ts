import type { Skill } from "@prompthub/shared/types";
import type {
  SkillFilterType,
  SkillStoreView,
} from "../stores/skill.store";

interface FilterVisibleSkillsOptions {
  deployedSkillNames: Set<string>;
  filterTags?: string[];
  filterType: SkillFilterType;
  getInsightSearchText?: (skill: Skill) => string;
  searchQuery?: string;
  skills: Skill[];
  storeView: SkillStoreView;
}

export function filterVisibleSkills({
  deployedSkillNames,
  filterTags = [],
  filterType,
  getInsightSearchText,
  searchQuery = "",
  skills,
  storeView,
}: FilterVisibleSkillsOptions): Skill[] {
  let result = skills;

  if (storeView === "distribution") {
    result = result.filter((skill) => deployedSkillNames.has(skill.name));
  } else if (filterType === "favorites") {
    result = result.filter((skill) => skill.is_favorite);
  } else if (filterType === "installed") {
    result = result.filter((skill) => Boolean(skill.registry_slug));
  } else if (filterType === "deployed") {
    result = result.filter((skill) => deployedSkillNames.has(skill.name));
  } else if (filterType === "pending") {
    result = result.filter((skill) => !deployedSkillNames.has(skill.name));
  }

  if (filterTags.length > 0) {
    result = result.filter(
      (skill) =>
        skill.tags && filterTags.some((tag) => skill.tags?.includes(tag)),
    );
  }

  const query = searchQuery.trim().toLowerCase();
  if (!query) {
    return result;
  }

  return result.filter((skill) => {
    const fields = [
      skill.name,
      skill.description || "",
      skill.author || "",
      skill.instructions || "",
      skill.content || "",
      skill.source_url || "",
      skill.local_repo_path || "",
      getInsightSearchText?.(skill) || "",
      ...(skill.tags || []),
    ];

    return fields.some((value) => value.toLowerCase().includes(query));
  });
}
