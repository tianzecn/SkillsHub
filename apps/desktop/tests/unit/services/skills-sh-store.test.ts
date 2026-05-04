import { describe, expect, it } from "vitest";

import {
  mapSkillsShEntryToRegistrySkill,
  parseSkillsShDetail,
  parseSkillsShLeaderboard,
} from "../../../src/renderer/services/skills-sh-store";

describe("skills-sh-store", () => {
  it("parses leaderboard cards into unique detail entries", () => {
    const html = `
      <main>
        <a href="/vercel-labs/skills/find-skills">
          <span>1</span>
          <span>find-skills</span>
          <span>vercel-labs/skills</span>
          <span>774.9K</span>
        </a>
        <a href="/openai/codex/api-design-review">
          <span>2</span>
          <span>api-design-review</span>
          <span>openai/codex</span>
          <span>193.2K</span>
        </a>
        <a href="/vercel-labs/skills/find-skills">
          <span>1</span>
          <span>find-skills</span>
          <span>vercel-labs/skills</span>
          <span>774.9K</span>
        </a>
      </main>
    `;

    expect(parseSkillsShLeaderboard(html, { limit: 10 })).toEqual([
      expect.objectContaining({
        owner: "vercel-labs",
        repo: "skills",
        skillName: "find-skills",
        weeklyInstalls: "774.9K",
      }),
      expect.objectContaining({
        owner: "openai",
        repo: "codex",
        skillName: "api-design-review",
        weeklyInstalls: "193.2K",
      }),
    ]);
  });

  it("parses embedded catalog data from the skills.sh homepage", () => {
    const html = `
      <script>
        self.__next_f.push([1,"{\\"source\\":\\"supabase/agent-skills\\",\\"skillId\\":\\"supabase-postgres-best-practices\\",\\"name\\":\\"supabase-postgres-best-practices\\",\\"installs\\":140695}"])
        self.__next_f.push([1,"{\\"source\\":\\"neondatabase/agent-skills\\",\\"skillId\\":\\"neon-postgres\\",\\"name\\":\\"neon-postgres\\",\\"installs\\":30489}"])
      </script>
    `;

    const entries = parseSkillsShLeaderboard(html, { limit: 10 });

    expect(entries).toEqual([
      expect.objectContaining({
        owner: "supabase",
        repo: "agent-skills",
        skillName: "supabase-postgres-best-practices",
        detailPath:
          "/supabase/agent-skills/supabase-postgres-best-practices",
        weeklyInstalls: "140.7K",
      }),
      expect.objectContaining({
        owner: "neondatabase",
        repo: "agent-skills",
        skillName: "neon-postgres",
        weeklyInstalls: "30.5K",
      }),
    ]);
  });

  it("maps homepage entries into lightweight installable registry records", () => {
    const skill = mapSkillsShEntryToRegistrySkill({
      owner: "context7.com",
      repo: "",
      skillName: "docs",
      detailPath: "/context7.com/docs",
      detailUrl: "https://skills.sh/context7.com/docs",
      weeklyInstalls: "12.3K",
    });

    expect(skill).toEqual(
      expect.objectContaining({
        slug: "context7-com-docs",
        source_id: "context7.com/docs",
        source_type: "html",
        source_url: "https://context7.com",
        store_url: "https://skills.sh/context7.com/docs",
        content: "",
      }),
    );
  });

  it("maps detail page content into a registry skill", () => {
    const html = `
      <article>
        <h1>find-skills</h1>
        <h2>Summary</h2>
        <p>Use this skill whenever the user asks how to find or discover skills.</p>
        <h2>SKILL.md</h2>
        <pre><code>---
name: find-skills
description: Discover relevant skills and recommend the best next step.
tags: [search, discovery]
---

# Finding Skills

Use this skill to look up the right capability for a task.
        </code></pre>
        <h2>Weekly Installs</h2>
        <p>774.9K</p>
        <h2>Repository</h2>
        <p>vercel-labs/skills</p>
        <h2>GitHub Stars</h2>
        <p>8.3K</p>
        <h2>Installed on</h2>
        <p>opencode 689.9K</p>
        <p>codex 79.4K</p>
        <p>claude 5.7K</p>
        <h2>Security audits</h2>
        <p>No auditors found</p>
      </article>
    `;

    const skill = parseSkillsShDetail(html, {
      owner: "vercel-labs",
      repo: "skills",
      skillName: "find-skills",
      detailPath: "/vercel-labs/skills/find-skills",
      detailUrl: "https://skills.sh/vercel-labs/skills/find-skills",
      weeklyInstalls: "774.9K",
    });

    expect(skill).toEqual(
      expect.objectContaining({
        slug: "vercel-labs-skills-find-skills",
        name: "find-skills",
        install_name: "find-skills",
        description:
          "Use this skill whenever the user asks how to find or discover skills.",
        source_url: "https://github.com/vercel-labs/skills",
        store_url: "https://skills.sh/vercel-labs/skills/find-skills",
        weekly_installs: "774.9K",
        github_stars: "8.3K",
        compatibility: ["opencode", "codex", "claude"],
        tags: ["search", "discovery"],
        installed_on: ["opencode", "codex", "claude"],
        security_audits: ["No auditors found"],
      }),
    );
    expect(skill?.content).toContain("# Finding Skills");
  });

  it("falls back to the default compatibility list when Installed on is absent", () => {
    const html = `
      <article>
        <h1>find-skills</h1>
        <h2>Summary</h2>
        <p>Use this skill whenever the user asks how to find or discover skills.</p>
        <h2>SKILL.md</h2>
        <pre><code>---
name: find-skills
description: Discover relevant skills and recommend the best next step.
tags: [search, discovery]
---

# Finding Skills
        </code></pre>
      </article>
    `;

    const skill = parseSkillsShDetail(html, {
      owner: "vercel-labs",
      repo: "skills",
      skillName: "find-skills",
      detailPath: "/vercel-labs/skills/find-skills",
      detailUrl: "https://skills.sh/vercel-labs/skills/find-skills",
    });

    expect(skill?.compatibility).toEqual([
      "claude",
      "codex",
      "cursor",
      "opencode",
      "antigravity",
    ]);
  });
});
