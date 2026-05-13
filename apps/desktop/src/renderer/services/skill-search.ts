import type {
  RegistrySkill,
  Skill,
  SkillInsight,
  SkillInsightCacheEntry,
  SkillSearchCandidate,
  SkillSearchConfidence,
  SkillSearchQualitySignal,
  SkillSearchResponse,
  SkillSearchResult,
  SkillSearchSource,
} from "@prompthub/shared/types";

const MAX_PROMPT_CANDIDATES = 50;
const MAX_INSIGHT_SUMMARY_CHARS = 700;
const CJK_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const LATIN_PATTERN = /[a-z0-9]/giu;

interface CandidateWithScore {
  candidate: SkillSearchCandidate;
  score: number;
}

interface SkillSearchRawResult {
  candidateId?: unknown;
  score?: unknown;
  confidence?: unknown;
  reason?: unknown;
  matchedKeywords?: unknown;
  weakMatch?: unknown;
  riskPenalty?: unknown;
}

interface SkillSearchRawResponse {
  expandedQueries?: unknown;
  results?: unknown;
  suggestions?: unknown;
  needsExternalSearch?: unknown;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSearch(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function clampScore(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(numeric)));
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

function normalizeConfidence(value: unknown): SkillSearchConfidence {
  return value === "high" || value === "medium" || value === "low"
    ? value
    : "low";
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

function tokenizeQuery(query: string): string[] {
  const normalized = normalizeSearch(query);
  const cjkTokens = normalized.match(CJK_PATTERN) ?? [];
  const wordTokens = normalized
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  return Array.from(new Set([...wordTokens, ...cjkTokens]));
}

function countMatches(value: string, tokens: string[]): number {
  const normalized = normalizeSearch(value);
  return tokens.filter((token) => normalized.includes(token)).length;
}

function hasRiskSignal(candidate: SkillSearchCandidate): boolean {
  return candidate.qualitySignals.some(
    (signal) => signal.tone === "warning" || signal.tone === "danger",
  );
}

function buildRegistrySource(
  sourceId: string | undefined,
): SkillSearchSource {
  if (sourceId === "official") return "official";
  if (sourceId === "community") return "community";
  if (sourceId) return "custom";
  return "external";
}

function buildAuditSignals(skill: RegistrySkill): SkillSearchQualitySignal[] {
  const auditResults = skill.audit_results ?? [];
  if (auditResults.some((audit) => String(audit.status).toLowerCase() === "fail")) {
    return [{ type: "audit-fail", tone: "danger" }];
  }
  if (
    auditResults.some((audit) => {
      const status = String(audit.status || "").toLowerCase();
      const riskLevel = String(audit.riskLevel || "").toUpperCase();
      return status === "warn" || riskLevel === "HIGH" || riskLevel === "CRITICAL";
    })
  ) {
    return [{ type: "audit-warn", tone: "warning" }];
  }
  if (
    auditResults.some((audit) => String(audit.status).toLowerCase() === "pass") ||
    (skill.security_audits ?? []).length > 0
  ) {
    return [{ type: "audit-pass", tone: "positive" }];
  }
  return [];
}

function buildInsightSignals(
  insight: SkillInsight | undefined,
): SkillSearchQualitySignal[] {
  if (!insight) {
    return [];
  }
  if (insight.verdict === "not-recommended") {
    return [{ type: "insight-not-recommended", tone: "danger" }];
  }
  if (insight.verdict === "caution") {
    return [{ type: "insight-caution", tone: "warning" }];
  }
  return [];
}

function buildBaseSignals(
  skill: RegistrySkill,
  insight: SkillInsight | undefined,
): SkillSearchQualitySignal[] {
  const signals: SkillSearchQualitySignal[] = [];
  if (skill.weekly_installs) {
    signals.push({
      type: "weekly-installs",
      value: skill.weekly_installs,
      tone: "positive",
    });
  }
  if (skill.github_stars) {
    signals.push({
      type: "github-stars",
      value: skill.github_stars,
      tone: "positive",
    });
  }
  return [...signals, ...buildAuditSignals(skill), ...buildInsightSignals(insight)];
}

export function shouldTriggerSkillOnlineSearch(query: string): boolean {
  const cjkCount = (query.match(CJK_PATTERN) ?? []).length;
  const latinCount = (query.match(LATIN_PATTERN) ?? []).length;
  return cjkCount >= 2 || latinCount >= 3;
}

export function shouldTriggerSkillAISearch(query: string): boolean {
  return shouldTriggerSkillOnlineSearch(query);
}

export function buildSkillInsightSearchText(
  insightOrEntry?: SkillInsight | SkillInsightCacheEntry | null,
): string {
  if (!insightOrEntry) {
    return "";
  }
  const insight: SkillInsight | undefined =
    "status" in insightOrEntry ? insightOrEntry.insight : insightOrEntry;
  if (!insight) {
    return "";
  }

  return normalizeWhitespace(
    [
      insight.capabilitySummary,
      insight.verdictReason,
      insight.bestFor.join(" "),
      insight.triggerGuidance.join(" "),
      insight.promptExamples.explicit.join(" "),
      insight.promptExamples.natural.join(" "),
      insight.prerequisites.join(" "),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

export function buildInstalledSkillSearchCandidate(
  skill: Skill,
  insightEntry?: SkillInsightCacheEntry | null,
): SkillSearchCandidate {
  const insight = insightEntry?.insight;
  const tags = Array.isArray(skill.tags) ? skill.tags : [];
  return {
    id: `installed:${skill.id}`,
    slug: skill.registry_slug || skill.name,
    name: skill.name,
    description: skill.description || "",
    tags,
    source: "installed",
    sourceId: "installed",
    isInstalled: true,
    author: skill.author || undefined,
    sourceUrl: skill.source_url || skill.local_repo_path || undefined,
    insightSummary: buildSkillInsightSearchText(insight).slice(
      0,
      MAX_INSIGHT_SUMMARY_CHARS,
    ),
    insightVerdict: insight?.verdict,
    insightConfidence: insight?.confidence,
    qualitySignals: buildInsightSignals(insight),
  };
}

export function buildRegistrySkillSearchCandidate(
  skill: RegistrySkill,
  options: {
    insightEntry?: SkillInsightCacheEntry | null;
    isInstalled: boolean;
    sourceId?: string;
  },
): SkillSearchCandidate {
  const insight = options.insightEntry?.insight;
  const sourceId = options.sourceId || skill.source_id || skill.source_type;
  return {
    id: `registry:${sourceId || "external"}:${skill.slug}`,
    slug: skill.slug,
    name: skill.name,
    description: skill.description || "",
    tags: Array.isArray(skill.tags) ? skill.tags : [],
    source: buildRegistrySource(sourceId),
    sourceId,
    isInstalled: options.isInstalled,
    author: skill.author || undefined,
    sourceUrl: skill.source_url || undefined,
    storeUrl: skill.store_url || undefined,
    insightSummary: buildSkillInsightSearchText(insight).slice(
      0,
      MAX_INSIGHT_SUMMARY_CHARS,
    ),
    insightVerdict: insight?.verdict,
    insightConfidence: insight?.confidence,
    qualitySignals: buildBaseSignals(skill, insight),
  };
}

export function scoreSkillSearchCandidate(
  candidate: SkillSearchCandidate,
  query: string,
): number {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) {
    return 0;
  }

  const normalizedQuery = normalizeSearch(query);
  const name = normalizeSearch(candidate.name);
  let score = 0;

  if (name === normalizedQuery) {
    score += 60;
  } else if (name.includes(normalizedQuery)) {
    score += 42;
  }

  score += countMatches(candidate.tags.join(" "), tokens) * 18;
  score += countMatches(candidate.description, tokens) * 12;
  score += countMatches(candidate.insightSummary || "", tokens) * 14;
  score += countMatches(candidate.author || "", tokens) * 4;

  if (candidate.isInstalled) {
    score += 8;
  }
  if (candidate.source === "official") {
    score += 4;
  }
  if (candidate.qualitySignals.some((signal) => signal.type === "audit-pass")) {
    score += 3;
  }
  if (hasRiskSignal(candidate)) {
    score -= 10;
  }

  return Math.max(0, Math.min(100, score));
}

export function rankSkillSearchCandidatesForPrompt(
  candidates: SkillSearchCandidate[],
  query: string,
  limit = MAX_PROMPT_CANDIDATES,
): SkillSearchCandidate[] {
  const byId = new Map<string, CandidateWithScore>();
  for (const candidate of candidates) {
    const score = scoreSkillSearchCandidate(candidate, query);
    const existing = byId.get(candidate.id);
    if (!existing || score > existing.score) {
      byId.set(candidate.id, { candidate, score });
    }
  }

  return Array.from(byId.values())
    .sort((left, right) => {
      if (left.candidate.isInstalled !== right.candidate.isInstalled) {
        return left.candidate.isInstalled ? -1 : 1;
      }
      return right.score - left.score;
    })
    .slice(0, limit)
    .map((item) => item.candidate);
}

export function buildSkillSearchMessages(
  query: string,
  candidates: SkillSearchCandidate[],
  language: string,
) {
  const payload = candidates.map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    description: candidate.description,
    tags: candidate.tags.slice(0, 12),
    source: candidate.source,
    sourceId: candidate.sourceId,
    isInstalled: candidate.isInstalled,
    author: candidate.author,
    insightSummary: candidate.insightSummary,
    insightVerdict: candidate.insightVerdict,
    insightConfidence: candidate.insightConfidence,
    qualitySignals: candidate.qualitySignals,
  }));

  const system = `You rerank AI agent skills for a user search. Use only the provided candidate metadata, cached AI insight summaries, and quality signals. Do not assume unseen SKILL.md content. Output only valid JSON. Write user-facing string values in this target language: ${language}.`;
  const user = `Search query: ${query}

Return JSON:
{
  "expandedQueries": ["keyword or paraphrase"],
  "results": [
    {
      "candidateId": "id from candidates",
      "score": 0-100,
      "confidence": "high" | "medium" | "low",
      "reason": "one short sentence explaining why it matches",
      "matchedKeywords": ["query term"],
      "weakMatch": false,
      "riskPenalty": false
    }
  ],
  "suggestions": ["alternative search term if results are weak or empty"],
  "needsExternalSearch": true
}

Rules:
- Prefer installed skills when relevance is similar.
- Risky or weak matches should be kept but ranked lower and marked with weakMatch or riskPenalty.
- If fewer than 5 useful candidates are present, or top matches are low confidence, set needsExternalSearch true.
- Do not include candidate IDs that are not in the candidates list.
- Keep reasons under 24 words.

Candidates:
${JSON.stringify(payload)}`;

  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
}

export function parseSkillSearchResponse(
  raw: string,
  candidates: SkillSearchCandidate[],
): SkillSearchResponse {
  const parsed = JSON.parse(extractJson(raw)) as SkillSearchRawResponse;
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const seen = new Set<string>();
  const rawResults = Array.isArray(parsed.results) ? parsed.results : [];

  const results = rawResults
    .map((item): SkillSearchResult | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }
      const rawResult = item as SkillSearchRawResult;
      const candidateId = asString(rawResult.candidateId);
      if (!candidateIds.has(candidateId) || seen.has(candidateId)) {
        return null;
      }
      seen.add(candidateId);
      const score = clampScore(rawResult.score);
      const confidence = normalizeConfidence(rawResult.confidence);
      return {
        candidateId,
        score,
        confidence,
        reason: asString(rawResult.reason).slice(0, 180),
        matchedKeywords: asStringArray(rawResult.matchedKeywords, 8),
        weakMatch:
          typeof rawResult.weakMatch === "boolean"
            ? rawResult.weakMatch
            : confidence === "low" || score < 35,
        riskPenalty:
          typeof rawResult.riskPenalty === "boolean"
            ? rawResult.riskPenalty
            : undefined,
      };
    })
    .filter((item): item is SkillSearchResult => item !== null)
    .sort((left, right) => right.score - left.score);

  return {
    expandedQueries: asStringArray(parsed.expandedQueries, 8),
    results,
    suggestions: asStringArray(parsed.suggestions, 6),
    needsExternalSearch:
      typeof parsed.needsExternalSearch === "boolean"
        ? parsed.needsExternalSearch
        : shouldExpandSkillSearch({ results, suggestions: [], expandedQueries: [], needsExternalSearch: false }),
  };
}

export function createFallbackSkillSearchResponse(
  query: string,
  candidates: SkillSearchCandidate[],
): SkillSearchResponse {
  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: scoreSkillSearchCandidate(candidate, query),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 12);

  return {
    expandedQueries: [],
    results: scored.map(({ candidate, score }) => ({
      candidateId: candidate.id,
      score,
      confidence: score >= 55 ? "medium" : "low",
      reason: "",
      matchedKeywords: tokenizeQuery(query),
      weakMatch: score < 35,
      riskPenalty: hasRiskSignal(candidate),
    })),
    suggestions: [],
    needsExternalSearch: scored.length < 5 || scored.every((item) => item.score < 55),
  };
}

export function shouldExpandSkillSearch(response: SkillSearchResponse): boolean {
  if (response.needsExternalSearch) {
    return true;
  }
  if (response.results.length < 5) {
    return true;
  }
  const confidentResults = response.results.filter(
    (result) => result.confidence !== "low" && result.score >= 55,
  );
  return confidentResults.length === 0;
}

export function dedupeSkillSearchCandidates(
  candidates: SkillSearchCandidate[],
): SkillSearchCandidate[] {
  const byKey = new Map<string, SkillSearchCandidate>();
  for (const candidate of candidates) {
    const key = (candidate.slug || candidate.name).toLowerCase();
    const existing = byKey.get(key);
    const shouldReplace =
      !existing ||
      (candidate.isInstalled && !existing.isInstalled) ||
      (candidate.source === "official" &&
        !existing.isInstalled &&
        existing.source !== "official");
    if (shouldReplace) {
      byKey.set(key, candidate);
    }
  }
  return Array.from(byKey.values());
}

export function dedupeRegistrySkillList(skills: RegistrySkill[]): RegistrySkill[] {
  const bySlug = new Map<string, RegistrySkill>();
  for (const skill of skills) {
    if (!bySlug.has(skill.slug)) {
      bySlug.set(skill.slug, skill);
    }
  }
  return Array.from(bySlug.values());
}

export function mergeSkillSearchResponses(
  primary: SkillSearchResponse,
  secondary: SkillSearchResponse,
): SkillSearchResponse {
  const byCandidateId = new Map<string, SkillSearchResult>();
  for (const result of [...primary.results, ...secondary.results]) {
    const existing = byCandidateId.get(result.candidateId);
    if (!existing || result.score > existing.score) {
      byCandidateId.set(result.candidateId, result);
    }
  }

  return {
    expandedQueries: Array.from(
      new Set([...primary.expandedQueries, ...secondary.expandedQueries]),
    ).slice(0, 8),
    results: Array.from(byCandidateId.values()).sort(
      (left, right) => right.score - left.score,
    ),
    suggestions: Array.from(
      new Set([...primary.suggestions, ...secondary.suggestions]),
    ).slice(0, 6),
    needsExternalSearch: false,
  };
}
