import { describe, expect, it } from "vitest";
import { filterVisibleSkills } from "../../../src/renderer/services/skill-filter";

const skills = [
  {
    id: "skill-1",
    name: "alpha",
    description: "alpha deploy",
    tags: ["ops"],
    protocol_type: "skill",
    is_favorite: false,
    created_at: 1,
    updated_at: 1,
  },
  {
    id: "skill-2",
    name: "beta",
    description: "beta pending",
    tags: ["docs"],
    protocol_type: "skill",
    is_favorite: true,
    created_at: 1,
    updated_at: 1,
  },
] as any;

describe("filterVisibleSkills", () => {
  it("uses distribution view as deployed-only source of truth", () => {
    const result = filterVisibleSkills({
      deployedSkillNames: new Set(["alpha"]),
      filterType: "pending",
      skills,
      storeView: "distribution",
    });

    expect(result.map((skill) => skill.name)).toEqual(["alpha"]);
  });

  it("filters pending skills from my-skills view", () => {
    const result = filterVisibleSkills({
      deployedSkillNames: new Set(["alpha"]),
      filterType: "pending",
      skills,
      storeView: "my-skills",
    });

    expect(result.map((skill) => skill.name)).toEqual(["beta"]);
  });

  it("applies search on top of current visible skill set", () => {
    const result = filterVisibleSkills({
      deployedSkillNames: new Set(["alpha"]),
      filterType: "pending",
      searchQuery: "beta",
      skills,
      storeView: "my-skills",
    });

    expect(result.map((skill) => skill.name)).toEqual(["beta"]);
  });

  it("can search cached AI insight text through the optional resolver", () => {
    const result = filterVisibleSkills({
      deployedSkillNames: new Set(),
      filterType: "all",
      getInsightSearchText: (skill) =>
        skill.name === "alpha" ? "semantic spreadsheet formatter" : "",
      searchQuery: "spreadsheet",
      skills,
      storeView: "my-skills",
    });

    expect(result.map((skill) => skill.name)).toEqual(["alpha"]);
  });
});
