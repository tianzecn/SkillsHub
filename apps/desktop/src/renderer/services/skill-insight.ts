import type {
  RegistrySkill,
  Skill,
  SkillInsight,
  SkillInsightConfidence,
  SkillInsightEvidence,
  SkillInsightExamples,
  SkillInsightVerdict,
} from "@prompthub/shared/types";
import { normalizeSkill, normalizeStringArray } from "./skill-normalize";

export const SKILL_INSIGHT_PROMPT_VERSION = 1;
const MAX_ANALYSIS_CHARS = 48000;

interface SkillInsightRaw {
  verdict?: unknown;
  verdictReason?: unknown;
  capabilitySummary?: unknown;
  bestFor?: unknown;
  notFor?: unknown;
  triggerGuidance?: unknown;
  promptExamples?: unknown;
  prerequisites?: unknown;
  riskNotes?: unknown;
  confidence?: unknown;
  evidence?: unknown;
}

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

function stripTrailingWhitespace(content: string): string {
  return content
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");
}

function normalizeSkillContent(content: string): string {
  return stripTrailingWhitespace(normalizeLineEndings(content)).trim();
}

function simpleHash(content: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function asStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeVerdict(value: unknown): SkillInsightVerdict {
  return value === "recommended" ||
    value === "caution" ||
    value === "not-recommended"
    ? value
    : "caution";
}

function normalizeConfidence(value: unknown): SkillInsightConfidence {
  return value === "high" || value === "medium" || value === "low"
    ? value
    : "low";
}

function normalizeExamples(value: unknown): SkillInsightExamples {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { explicit: [], natural: [], boundary: [] };
  }

  const examples = value as Record<string, unknown>;
  return {
    explicit: asStringArray(examples.explicit, 2),
    natural: asStringArray(examples.natural, 2),
    boundary: asStringArray(examples.boundary, 2),
  };
}

function normalizeEvidence(value: unknown): SkillInsightEvidence[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): SkillInsightEvidence | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }
      const raw = item as Record<string, unknown>;
      const label = asString(raw.label);
      const quote = asString(raw.quote).slice(0, 260);
      if (!label || !quote) {
        return null;
      }
      const source = asString(raw.source);
      return source ? { label, quote, source } : { label, quote };
    })
    .filter((item): item is SkillInsightEvidence => item !== null)
    .slice(0, 6);
}

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

export function buildSkillInsightContent(skill: RegistrySkill): string {
  if (skill.files?.length) {
    return skill.files
      .map((file) => `# ${file.relativePath}\n${file.content}`)
      .join("\n\n");
  }
  return skill.content || "";
}

export function hasSkillInsightContent(skill: RegistrySkill): boolean {
  const normalized = normalizeSkillContent(buildSkillInsightContent(skill));
  const body = normalized.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  return body.length > 0;
}

export function computeSkillInsightContentHash(skill: RegistrySkill): string {
  const normalized = normalizeSkillContent(buildSkillInsightContent(skill));
  return simpleHash(normalized);
}

export function buildSkillInsightCacheKey(
  skill: RegistrySkill,
  language: string,
): string {
  const source = skill.source_id || skill.source_url || skill.source_type || "store";
  const contentHash = computeSkillInsightContentHash(skill);
  return [
    "skill-insight",
    SKILL_INSIGHT_PROMPT_VERSION,
    language,
    source,
    skill.slug,
    contentHash,
  ].join(":");
}

export function createInstalledSkillInsightSkill(
  skill: Skill,
  skillContent: string,
  resolvedDescription?: string,
): RegistrySkill {
  const normalizedSkill = normalizeSkill(skill);
  const originalTags = normalizeStringArray(normalizedSkill.original_tags);
  const currentTags = normalizeStringArray(normalizedSkill.tags);
  const tags = originalTags.length > 0 ? originalTags : currentTags;
  const sourceUrl =
    normalizedSkill.source_url ||
    normalizedSkill.content_url ||
    normalizedSkill.local_repo_path ||
    "installed";

  return {
    slug: normalizedSkill.registry_slug || normalizedSkill.name,
    name: normalizedSkill.name,
    install_name: normalizedSkill.name,
    description:
      resolvedDescription || normalizedSkill.description || normalizedSkill.name,
    category: normalizedSkill.category || "general",
    icon_url: normalizedSkill.icon_url,
    icon_background: normalizedSkill.icon_background,
    icon_emoji: normalizedSkill.icon_emoji,
    author: normalizedSkill.author || "",
    source_url: sourceUrl,
    content_url: normalizedSkill.content_url,
    source_type: normalizedSkill.local_repo_path ? "local-dir" : undefined,
    tags,
    version: normalizedSkill.version || "0.0.0",
    content: skillContent,
    prerequisites: normalizeStringArray(normalizedSkill.prerequisites),
    compatibility: normalizeStringArray(normalizedSkill.compatibility),
  };
}

export function buildSkillInsightMessages(skill: RegistrySkill, language: string) {
  const content = buildSkillInsightContent(skill).slice(0, MAX_ANALYSIS_CHARS);
  const system = `You analyze AI agent skills before users import them. Output only valid JSON. Be evidence-first and conservative. Do not promise that any platform will always auto-call a skill; use wording like "more likely to match". Write the JSON string values in this target language: ${language}.`;
  const user = `Analyze this skill for import decision and usage education.

Required JSON schema:
{
  "verdict": "recommended" | "caution" | "not-recommended",
  "verdictReason": "1-2 short sentences",
  "capabilitySummary": "what this skill helps the agent do",
  "bestFor": ["suitable scenario", "..."],
  "notFor": ["unsuitable scenario", "..."],
  "triggerGuidance": ["conservative user wording that is more likely to match this skill", "..."],
  "promptExamples": {
    "explicit": ["example that names the skill or target workflow"],
    "natural": ["natural intent phrasing"],
    "boundary": ["example that should not use this skill or needs caution"]
  },
  "prerequisites": ["required tools/accounts/files/config"],
  "riskNotes": ["usage/dependency/security risk; say none obvious if no evidence"],
  "confidence": "high" | "medium" | "low",
  "evidence": [
    {"label": "short claim label", "quote": "short source quote", "source": "SKILL.md or relative file path"}
  ]
}

Rules:
- Base conclusions on the provided skill content. If the content does not say something, mark it as unknown or inferred.
- Keep arrays short: 2-4 items for scenarios, 1-2 examples per example type, max 6 evidence items.
- "recommended" means the skill has clear purpose, usable workflow, and low obvious friction.
- "caution" means useful but needs prerequisites, has unclear scope, or depends on missing platform context.
- "not-recommended" means content is too incomplete, too risky, or not useful enough to import.
- Risk notes are decision aids only; they do not replace a security scan.

Skill metadata:
Name: ${skill.name}
Description: ${skill.description}
Author: ${skill.author}
Source: ${skill.source_url}
Tags: ${skill.tags.join(", ")}

Skill content:
${content}`;

  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
}

export function parseSkillInsightResponse(
  raw: string,
  language: string,
  contentHash: string,
  now = Date.now(),
): SkillInsight {
  const parsed = JSON.parse(extractJson(raw)) as SkillInsightRaw;
  const capabilitySummary = asString(parsed.capabilitySummary);
  const verdictReason = asString(parsed.verdictReason);

  if (!capabilitySummary || !verdictReason) {
    throw new Error("Skill insight response is missing required summary fields");
  }

  return {
    version: SKILL_INSIGHT_PROMPT_VERSION,
    language,
    generatedAt: now,
    contentHash,
    verdict: normalizeVerdict(parsed.verdict),
    verdictReason,
    capabilitySummary,
    bestFor: asStringArray(parsed.bestFor, 4),
    notFor: asStringArray(parsed.notFor, 4),
    triggerGuidance: asStringArray(parsed.triggerGuidance, 4),
    promptExamples: normalizeExamples(parsed.promptExamples),
    prerequisites: asStringArray(parsed.prerequisites, 4),
    riskNotes: asStringArray(parsed.riskNotes, 4),
    confidence: normalizeConfidence(parsed.confidence),
    evidence: normalizeEvidence(parsed.evidence),
  };
}
