import { describe, expect, it } from "vitest";
import type { SkillSearchCandidate } from "@prompthub/shared/types";
import {
  buildSkillInsightSearchText,
  createFallbackSkillSearchResponse,
  parseSkillSearchResponse,
  shouldExpandSkillSearch,
  shouldTriggerSkillAISearch,
} from "../../../src/renderer/services/skill-search";

const candidates: SkillSearchCandidate[] = [
  {
    id: "installed:docx",
    slug: "docx",
    name: "docx",
    description: "Create and edit Word documents",
    tags: ["office"],
    source: "installed",
    sourceId: "installed",
    isInstalled: true,
    insightSummary: "handles docx formatting and revision workflows",
    qualitySignals: [],
  },
  {
    id: "registry:community:pdf",
    slug: "pdf",
    name: "pdf",
    description: "Analyze PDFs",
    tags: ["office", "analysis"],
    source: "community",
    sourceId: "community",
    isInstalled: false,
    qualitySignals: [{ type: "audit-pass", tone: "positive" }],
  },
];

describe("skill-search service", () => {
  it("uses CJK and Latin minimum query thresholds", () => {
    expect(shouldTriggerSkillAISearch("文")).toBe(false);
    expect(shouldTriggerSkillAISearch("文档")).toBe(true);
    expect(shouldTriggerSkillAISearch("ai")).toBe(false);
    expect(shouldTriggerSkillAISearch("doc")).toBe(true);
  });

  it("builds search text from positive cached insight fields only", () => {
    const text = buildSkillInsightSearchText({
      version: 1,
      language: "zh",
      generatedAt: 1,
      contentHash: "hash",
      verdict: "recommended",
      verdictReason: "Good for document workflows.",
      capabilitySummary: "Creates Word documents.",
      bestFor: ["drafting contracts"],
      notFor: ["image editing"],
      triggerGuidance: ["write a DOCX"],
      promptExamples: {
        explicit: ["Use docx to create a report"],
        natural: ["帮我生成 Word 报告"],
        boundary: ["Edit a video"],
      },
      prerequisites: ["Office compatible file"],
      riskNotes: ["None obvious"],
      confidence: "high",
      evidence: [],
    });

    expect(text).toContain("Creates Word documents");
    expect(text).toContain("帮我生成 Word 报告");
    expect(text).not.toContain("image editing");
    expect(text).not.toContain("Edit a video");
  });

  it("parses valid JSON, ignores unknown candidate ids, and deduplicates results", () => {
    const parsed = parseSkillSearchResponse(
      JSON.stringify({
        expandedQueries: ["word document"],
        results: [
          {
            candidateId: "installed:docx",
            score: 91,
            confidence: "high",
            reason: "Matches document creation.",
            matchedKeywords: ["document"],
          },
          {
            candidateId: "missing",
            score: 99,
            confidence: "high",
          },
          {
            candidateId: "installed:docx",
            score: 40,
            confidence: "low",
          },
        ],
        suggestions: ["docx report"],
        needsExternalSearch: false,
      }),
      candidates,
    );

    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0]).toMatchObject({
      candidateId: "installed:docx",
      score: 91,
      confidence: "high",
    });
    expect(parsed.suggestions).toEqual(["docx report"]);
  });

  it("falls back to local metadata and cached insight scoring", () => {
    const response = createFallbackSkillSearchResponse("docx revision", candidates);

    expect(response.results[0]?.candidateId).toBe("installed:docx");
    expect(response.results[0]?.score).toBeGreaterThan(0);
  });

  it("expands externally when matches are sparse or low-confidence", () => {
    expect(
      shouldExpandSkillSearch({
        expandedQueries: [],
        results: [
          {
            candidateId: "registry:community:pdf",
            score: 30,
            confidence: "low",
            reason: "",
            matchedKeywords: [],
            weakMatch: true,
          },
        ],
        suggestions: [],
        needsExternalSearch: false,
      }),
    ).toBe(true);
  });
});
