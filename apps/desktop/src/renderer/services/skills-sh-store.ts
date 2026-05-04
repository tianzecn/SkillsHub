import type { RegistrySkill, SkillCategory } from "@prompthub/shared/types";

export const SKILLS_SH_BASE_URL = "https://skills.sh";

const DEFAULT_COMPATIBILITY = [
  "claude",
  "codex",
  "cursor",
  "opencode",
  "antigravity",
];
const DETAIL_PATH_PATTERN = /^\/([^/?#]+)(?:\/([^/?#]+))?\/([^/?#]+)\/?$/;
const HTML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

export interface SkillsShLeaderboardEntry {
  owner: string;
  repo: string;
  skillName: string;
  detailPath: string;
  detailUrl: string;
  rank?: number;
  weeklyInstalls?: string;
}

function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, rawValue) => {
    const value = String(rawValue).toLowerCase();
    if (value.startsWith("#x")) {
      const code = Number.parseInt(value.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
    }
    if (value.startsWith("#")) {
      const code = Number.parseInt(value.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
    }
    return HTML_ENTITY_MAP[value] ?? entity;
  });
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function stripTags(input: string): string {
  return normalizeWhitespace(
    decodeHtmlEntities(
      input
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|section|article|li|ul|ol|h1|h2|h3|h4|h5|h6|pre|code)>/gi, "\n")
        .replace(/<[^>]+>/g, " "),
    ).replace(/[ \t]{2,}/g, " "),
  );
}

function htmlToText(html: string): string {
  return normalizeWhitespace(
    decodeHtmlEntities(
      html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|section|article|header|footer|aside|main|nav|li|ul|ol|h1|h2|h3|h4|h5|h6|pre|code|blockquote|table|thead|tbody|tr)>/gi, "\n")
        .replace(/<[^>]+>/g, ""),
    )
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n"),
  );
}

function humanizeSkillName(value: string): string {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function inferCategory(slug: string, description: string): SkillCategory {
  const text = `${slug} ${description}`.toLowerCase();
  if (/(pdf|doc|ppt|sheet|spreadsheet|word|xlsx|docx)/.test(text)) return "office";
  if (/(github|git|web|playwright|mcp|code|cli|dev|pr)/.test(text)) return "dev";
  if (/(design|figma|css|ui|frontend|canvas|brand)/.test(text)) return "design";
  if (/(deploy|vercel|docker|cloudflare|netlify)/.test(text)) return "deploy";
  if (/(secure|security|audit|auth|secret)/.test(text)) return "security";
  if (/(analy|data|sql|chart|research)/.test(text)) return "data";
  if (/(manage|project|notion|linear)/.test(text)) return "management";
  if (/(ai|generate|translation|speech|image|video|art)/.test(text)) return "ai";
  return "general";
}

function formatCount(value: number | undefined): string | undefined {
  if (!Number.isFinite(value)) return undefined;
  const count = value ?? 0;
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  }
  return String(count);
}

function getEntrySource(entry: SkillsShLeaderboardEntry): string {
  return entry.repo ? `${entry.owner}/${entry.repo}` : entry.owner;
}

function getEntrySourceUrl(entry: SkillsShLeaderboardEntry): string {
  const source = getEntrySource(entry);
  return entry.repo ? `https://github.com/${source}` : `https://${source}`;
}

function parseEmbeddedEntries(html: string, limit: number): SkillsShLeaderboardEntry[] {
  const entries: SkillsShLeaderboardEntry[] = [];
  const seen = new Set<string>();
  const pattern =
    /\\"source\\":\\"([^\\"]+)\\",\\"skillId\\":\\"([^\\"]+)\\",\\"name\\":\\"([^\\"]+)\\",\\"installs\\":(\d+)/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const [, source, skillId, name, installsRaw] = match;
    const sourceParts = source.split("/").filter(Boolean);
    const owner = sourceParts[0];
    const repo = sourceParts.length > 1 ? sourceParts.slice(1).join("/") : "";
    if (!owner || !skillId) continue;

    const detailPath = `/${source}/${skillId}`;
    if (seen.has(detailPath)) continue;

    seen.add(detailPath);
    entries.push({
      owner,
      repo,
      skillName: decodeHtmlEntities(name || skillId),
      detailPath,
      detailUrl: new URL(detailPath, SKILLS_SH_BASE_URL).toString(),
      rank: entries.length + 1,
      weeklyInstalls: formatCount(Number.parseInt(installsRaw, 10)),
    });

    if (entries.length >= limit) break;
  }

  return entries;
}

function parseFrontmatter(content: string): {
  name?: string;
  description?: string;
  tags: string[];
} {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return { tags: [] };
  }

  const block = match[1];
  const tagsLine = block.match(/^tags:\s*\[(.+)\]$/m)?.[1] ?? "";

  return {
    name: block.match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, ""),
    description: block.match(/^description:\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, ""),
    tags: tagsLine
      .split(",")
      .map((tag) => tag.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean),
  };
}

function getSectionLines(text: string, heading: string, stopHeadings: string[]): string[] {
  const lines = text.split("\n").map((line) => line.trim());
  const startIndex = lines.findIndex(
    (line) => line.toLowerCase() === heading.toLowerCase(),
  );
  if (startIndex === -1) {
    return [];
  }

  const stopSet = new Set(stopHeadings.map((line) => line.toLowerCase()));
  const collected: string[] = [];

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const current = lines[index];
    if (stopSet.has(current.toLowerCase())) {
      break;
    }
    collected.push(current);
  }

  return collected;
}

function normalizeSectionContent(lines: string[]): string {
  return normalizeWhitespace(lines.join("\n"));
}

function extractInstalledOnAgents(lines: string[]): string[] {
  return lines
    .map((line) => line.match(/^([a-z0-9-]+)\s+\d+/i)?.[1]?.toLowerCase() ?? null)
    .filter((value): value is string => Boolean(value));
}

function extractSimpleMetric(text: string, heading: string): string | undefined {
  const lines = getSectionLines(text, heading, [
    "Summary",
    "SKILL.md",
    "Weekly Installs",
    "Repository",
    "GitHub Stars",
    "Installed on",
    "Security audits",
  ]);
  return normalizeSectionContent(lines) || undefined;
}

export function parseSkillsShLeaderboard(
  html: string,
  options?: { limit?: number },
): SkillsShLeaderboardEntry[] {
  const entries: SkillsShLeaderboardEntry[] = [];
  const seen = new Set<string>();
  const limit = options?.limit ?? 24;
  const embeddedEntries = parseEmbeddedEntries(html, limit);
  if (embeddedEntries.length > 0) {
    return embeddedEntries;
  }
  const linkPattern = /<a[^>]+href="(\/[^"/?#]+\/[^"/?#]+\/[^"/?#]+\/?)"[^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(html)) !== null) {
    const detailPath = match[1];
    if (seen.has(detailPath)) {
      continue;
    }

    const parsed = detailPath.match(DETAIL_PATH_PATTERN);
    if (!parsed) {
      continue;
    }

    const [, owner, repo = "", skillName] = parsed;
    const anchorText = stripTags(match[2]);
    const lowerAnchorText = anchorText.toLowerCase();
    const sourceLabel = repo ? `${owner}/${repo}` : owner;
    if (!lowerAnchorText.includes(sourceLabel.toLowerCase()) && !lowerAnchorText.includes(skillName.toLowerCase())) {
      continue;
    }

    const rank = Number.parseInt(anchorText.match(/^(\d+)\b/)?.[1] ?? "", 10);
    const weeklyInstalls = anchorText.match(/(\d+(?:\.\d+)?[KMB]?)\s*$/i)?.[1];

    seen.add(detailPath);
    entries.push({
      owner,
      repo,
      skillName: decodeURIComponent(skillName),
      detailPath,
      detailUrl: new URL(detailPath, SKILLS_SH_BASE_URL).toString(),
      rank: Number.isFinite(rank) ? rank : undefined,
      weeklyInstalls,
    });

    if (entries.length >= limit) {
      break;
    }
  }

  return entries;
}

export function mapSkillsShEntryToRegistrySkill(
  entry: SkillsShLeaderboardEntry,
): RegistrySkill {
  const displayName = humanizeSkillName(entry.skillName);
  const source = getEntrySource(entry);
  const description = `${displayName} community skill from ${source}`;
  return {
    slug: slugify(`${source}-${entry.skillName}`),
    source_id: `${source}/${entry.skillName}`,
    source_type: "html",
    name: displayName,
    install_name: entry.skillName,
    description,
    category: inferCategory(entry.skillName, description),
    author: entry.owner,
    source_url: getEntrySourceUrl(entry),
    store_url: entry.detailUrl,
    install_url: getEntrySourceUrl(entry),
    tags: Array.from(
      new Set(
        [entry.owner, entry.repo, ...entry.skillName.split(/[-_]+/)]
          .map((tag) => tag.trim().toLowerCase())
          .filter(Boolean),
      ),
    ),
    version: "1.0.0",
    content: "",
    compatibility: DEFAULT_COMPATIBILITY,
    weekly_installs: entry.weeklyInstalls,
  };
}

export function parseSkillsShDetail(
  html: string,
  entry: SkillsShLeaderboardEntry,
): RegistrySkill | null {
  const text = htmlToText(html);
  const summary = normalizeSectionContent(
    getSectionLines(text, "Summary", [
      "SKILL.md",
      "Weekly Installs",
      "Repository",
      "GitHub Stars",
      "Installed on",
      "Security audits",
    ]),
  );
  const skillMd = normalizeSectionContent(
    getSectionLines(text, "SKILL.md", [
      "Weekly Installs",
      "Repository",
      "GitHub Stars",
      "Installed on",
      "Security audits",
    ]),
  );

  if (!summary && !skillMd) {
    return null;
  }

  const repository =
    extractSimpleMetric(text, "Repository") || getEntrySource(entry);
  const weeklyInstalls =
    extractSimpleMetric(text, "Weekly Installs") || entry.weeklyInstalls;
  const githubStars = extractSimpleMetric(text, "GitHub Stars");
  const installedOn = extractInstalledOnAgents(
    getSectionLines(text, "Installed on", ["Security audits"]),
  );
  const securityAudits = getSectionLines(text, "Security audits", [])
    .map((line) => line.trim())
    .filter(Boolean);

  const frontmatter = parseFrontmatter(skillMd);
  const displayName =
    frontmatter.name?.trim() || humanizeSkillName(entry.skillName);
  const description =
    summary ||
    frontmatter.description?.trim() ||
    `${displayName} community skill`;
  const compatibility =
    installedOn.length > 0 ? Array.from(new Set(installedOn)) : DEFAULT_COMPATIBILITY;
  const sourceUrl = repository.match(/^[^/\s]+\/[^/\s]+$/)
    ? `https://github.com/${repository}`
    : repository.includes(".") && !repository.startsWith("http")
      ? `https://${repository}`
      : new URL(entry.detailPath, SKILLS_SH_BASE_URL).toString();
  const tags = frontmatter.tags.length > 0
    ? frontmatter.tags
    : Array.from(
        new Set(
          [entry.owner, entry.repo, ...entry.skillName.split(/[-_]+/)]
            .map((tag) => tag.trim().toLowerCase())
            .filter(Boolean),
        ),
      );

  return {
    slug: slugify(`${getEntrySource(entry)}-${entry.skillName}`),
    source_id: `${getEntrySource(entry)}/${entry.skillName}`,
    source_type: "html",
    name: displayName,
    install_name: entry.skillName,
    description,
    category: inferCategory(entry.skillName, description),
    author: entry.owner,
    source_url: sourceUrl,
    store_url: entry.detailUrl,
    install_url: sourceUrl,
    tags,
    version: "1.0.0",
    content: skillMd || `# ${displayName}\n\n${description}`,
    compatibility,
    weekly_installs: weeklyInstalls,
    github_stars: githubStars,
    installed_on: installedOn.length > 0 ? installedOn : undefined,
    security_audits: securityAudits.length > 0 ? securityAudits : undefined,
  };
}
