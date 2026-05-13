import { describe, expect, it } from "vitest";

import {
  buildSkillInsightCacheKey,
  hasSkillInsightContent,
  parseSkillInsightResponse,
} from "../../../src/renderer/services/skill-insight";
import type { RegistrySkill } from "@prompthub/shared/types";

function createSkill(overrides: Partial<RegistrySkill> = {}): RegistrySkill {
  return {
    slug: "demo-skill",
    name: "Demo Skill",
    description: "Demo description",
    category: "dev",
    author: "PromptHub",
    source_url: "https://example.com/demo",
    tags: ["demo"],
    version: "1.0.0",
    content: [
      "---",
      "name: demo-skill",
      "description: Demo description",
      "---",
      "",
      "## Overview",
      "Use this skill for demo reviews.",
    ].join("\n"),
    ...overrides,
  };
}

describe("skill insight service", () => {
  it("parses fenced JSON into a normalized SkillInsight", () => {
    const raw = [
      "```json",
      JSON.stringify({
        verdict: "recommended",
        verdictReason: "Clear and focused.",
        capabilitySummary: "Reviews demo workflows.",
        bestFor: ["Demo review", "Workflow critique", "Extra item"],
        notFor: ["Security incident"],
        triggerGuidance: ["Ask for a demo workflow review"],
        promptExamples: {
          explicit: ["Use demo-skill on this draft"],
          natural: ["Can you review this demo flow?"],
          boundary: ["Do not use this for production incidents"],
        },
        prerequisites: ["A draft"],
        riskNotes: ["No obvious risk"],
        confidence: "high",
        evidence: [
          {
            label: "Overview",
            quote: "Use this skill for demo reviews.",
            source: "SKILL.md",
          },
        ],
      }),
      "```",
    ].join("\n");

    const insight = parseSkillInsightResponse(raw, "中文", "hash", 100);

    expect(insight.verdict).toBe("recommended");
    expect(insight.language).toBe("中文");
    expect(insight.generatedAt).toBe(100);
    expect(insight.promptExamples.natural).toEqual([
      "Can you review this demo flow?",
    ]);
    expect(insight.evidence[0]).toEqual({
      label: "Overview",
      quote: "Use this skill for demo reviews.",
      source: "SKILL.md",
    });
  });

  it("rejects malformed model responses that omit required summaries", () => {
    expect(() =>
      parseSkillInsightResponse(
        JSON.stringify({ verdict: "recommended" }),
        "English",
        "hash",
      ),
    ).toThrow(/missing required summary fields/i);
  });

  it("uses content changes in the cache key", () => {
    const first = buildSkillInsightCacheKey(createSkill(), "English");
    const second = buildSkillInsightCacheKey(
      createSkill({ content: `${createSkill().content}\n\nExtra detail` }),
      "English",
    );

    expect(first).not.toBe(second);
  });

  it("requires a real SKILL.md body before generating insight", () => {
    expect(hasSkillInsightContent(createSkill({ content: "" }))).toBe(false);
    expect(
      hasSkillInsightContent(
        createSkill({
          content: ["---", "name: only-frontmatter", "---"].join("\n"),
        }),
      ),
    ).toBe(false);
    expect(hasSkillInsightContent(createSkill())).toBe(true);
  });
});
