import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RegistrySkill } from "@prompthub/shared/types";

import { SkillStoreCard } from "../../../src/renderer/components/skill/SkillStoreCard";
import { SkillInsightPanel } from "../../../src/renderer/components/skill/SkillInsightPanel";
import type { SkillInsightCacheEntry } from "../../../src/renderer/stores/skill.store";
import { renderWithI18n } from "../../helpers/i18n";

const skill: RegistrySkill = {
  slug: "demo-skill",
  name: "Demo Skill",
  description: "Helps with demo work.",
  category: "dev",
  author: "PromptHub",
  source_url: "https://example.com/demo-skill",
  tags: ["demo"],
  version: "1.0.0",
  content: "# Demo Skill\nUse this skill for demos.",
};

const readyInsight: SkillInsightCacheEntry = {
  status: "ready",
  timestamp: 1,
  language: "English",
  contentHash: "hash-1",
  insight: {
    version: 1,
    language: "English",
    generatedAt: 1,
    contentHash: "hash-1",
    verdict: "recommended",
    verdictReason: "It matches a narrow demo workflow.",
    capabilitySummary: "Explains when to use this demo skill.",
    bestFor: ["Demo preparation"],
    notFor: ["Production incident response"],
    triggerGuidance: ["Ask for demo help"],
    promptExamples: {
      explicit: [
        "Use Demo Skill to prepare this example.",
        "Run Demo Skill against this draft.",
      ],
      natural: ["Help me prepare a demo."],
      boundary: ["Do not use this for live incidents."],
    },
    prerequisites: ["Have demo content ready"],
    riskNotes: ["Only covers demo scenarios"],
    confidence: "high",
    evidence: [
      {
        label: "Scope",
        quote: "Use this skill for demos.",
        source: "SKILL.md",
      },
    ],
  },
};

describe("SkillStoreCard", () => {
  it("omits notes and evidence in the store list row", async () => {
    const onClick = vi.fn();

    await renderWithI18n(
      <SkillStoreCard
        skill={skill}
        isInstalled={false}
        index={0}
        insightEntry={readyInsight}
        insightEnabled
        onClick={onClick}
      />,
      { language: "en" },
    );

    expect(screen.queryByText("Notes")).toBeNull();
    expect(screen.queryByText("Evidence")).toBeNull();
  });
});

describe("SkillInsightPanel", () => {
  it("keeps notes and evidence available when supplemental details are shown", async () => {
    await renderWithI18n(
      <SkillInsightPanel
        skill={skill}
        insightEntry={readyInsight}
        insightEnabled
      />,
      { language: "en" },
    );

    const notesSummary = screen.getByText("Notes");
    expect(notesSummary.closest("details")).not.toHaveAttribute("open");

    fireEvent.click(notesSummary);

    expect(notesSummary.closest("details")).toHaveAttribute("open");

    const evidenceSummary = screen.getByText("Evidence");
    fireEvent.click(evidenceSummary);

    expect(evidenceSummary.closest("details")).toHaveAttribute("open");
  });

  it("copies prompt examples one at a time without opening the store detail", async () => {
    const onClick = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await renderWithI18n(
      <SkillStoreCard
        skill={skill}
        isInstalled={false}
        index={0}
        insightEntry={readyInsight}
        insightEnabled
        onClick={onClick}
      />,
      { language: "en" },
    );

    const copyButton = screen.getByLabelText(
      "Copy Prompt: Run Demo Skill against this draft.",
    );
    fireEvent.click(copyButton);

    expect(writeText).toHaveBeenCalledWith(
      "Run Demo Skill against this draft.",
    );
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(copyButton).toHaveAttribute("title", "Copied");
    });
  });
});
