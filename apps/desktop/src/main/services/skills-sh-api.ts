import * as https from "https";
import type { IncomingHttpHeaders } from "http";
import type {
  RegistrySkill,
  SkillCategory,
  SkillFileSnapshot,
  SkillsShRateLimitInfo,
  SkillsShStoreRequest,
  SkillsShStoreResponse,
  SkillStoreAuditResult,
} from "@prompthub/shared/types";
import { resolvePublicAddress } from "./skill-installer-remote";

const SKILLS_SH_HOST = "skills.sh";
const SKILLS_SH_BASE_URL = `https://${SKILLS_SH_HOST}`;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 3 * 1024 * 1024;
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 40;
const DETAIL_CONCURRENCY = 3;

interface HttpJsonResponse<T> {
  data: T;
  rateLimit?: SkillsShRateLimitInfo;
  cacheMaxAgeSeconds?: number;
}

interface V1Skill {
  id: string;
  slug: string;
  name: string;
  source: string;
  installs: number;
  sourceType: "github" | "well-known" | string;
  installUrl?: string | null;
  url: string;
  isDuplicate?: boolean;
}

interface V1ListResponse {
  data?: V1Skill[];
}

interface V1SearchResponse {
  data?: V1Skill[];
}

interface V1CuratedOwner {
  skills?: V1Skill[];
}

interface V1CuratedResponse {
  data?: V1CuratedOwner[];
}

interface V1DetailFile {
  path: string;
  contents: string;
}

interface V1DetailResponse {
  id: string;
  source: string;
  slug: string;
  installs: number;
  hash: string | null;
  files: V1DetailFile[] | null;
}

interface V1AuditResponse {
  audits?: SkillStoreAuditResult[];
}

class SkillsShApiError extends Error {
  statusCode: number;
  retryAfterSeconds?: number;
  rateLimit?: SkillsShRateLimitInfo;

  constructor(
    message: string,
    statusCode: number,
    options?: {
      retryAfterSeconds?: number;
      rateLimit?: SkillsShRateLimitInfo;
    },
  ) {
    super(message);
    this.name = "SkillsShApiError";
    this.statusCode = statusCode;
    this.retryAfterSeconds = options?.retryAfterSeconds;
    this.rateLimit = options?.rateLimit;
  }
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit ?? DEFAULT_LIMIT)));
}

function toNumberHeader(value: string | string[] | undefined): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseRateLimit(headers: IncomingHttpHeaders): SkillsShRateLimitInfo | undefined {
  const rateLimit = {
    limit: toNumberHeader(headers["x-ratelimit-limit"]),
    remaining: toNumberHeader(headers["x-ratelimit-remaining"]),
    reset: toNumberHeader(headers["x-ratelimit-reset"]),
  };
  return rateLimit.limit !== undefined ||
    rateLimit.remaining !== undefined ||
    rateLimit.reset !== undefined
    ? rateLimit
    : undefined;
}

function parseCacheMaxAge(headers: IncomingHttpHeaders): number | undefined {
  const raw = Array.isArray(headers["cache-control"])
    ? headers["cache-control"][0]
    : headers["cache-control"];
  if (!raw) return undefined;
  if (/\bno-store\b|\bno-cache\b/i.test(raw)) return 0;
  const match = raw.match(/\bmax-age=(\d+)\b/i);
  if (!match) return undefined;
  const seconds = Number.parseInt(match[1], 10);
  return Number.isFinite(seconds) ? seconds : undefined;
}

function buildApiPath(pathname: string, params?: Record<string, string | number | undefined>): string {
  const url = new URL(pathname, SKILLS_SH_BASE_URL);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return `${url.pathname}${url.search}`;
}

async function requestJson<T>(
  pathname: string,
  params: Record<string, string | number | undefined>,
  apiKey?: string,
): Promise<HttpJsonResponse<T>> {
  const path = buildApiPath(pathname, params);
  const resolvedAddress = await resolvePublicAddress(SKILLS_SH_HOST);

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        protocol: "https:",
        hostname: resolvedAddress.address,
        family: resolvedAddress.family,
        servername: SKILLS_SH_HOST,
        port: 443,
        path,
        method: "GET",
        headers: {
          Host: SKILLS_SH_HOST,
          "User-Agent": "PromptHub/skills-sh-api",
          Accept: "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let received = 0;
        const rateLimit = parseRateLimit(response.headers);
        const retryAfterSeconds = toNumberHeader(response.headers["retry-after"]);

        response.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > MAX_RESPONSE_BYTES) {
            response.destroy(new Error("skills.sh response exceeds size limit"));
            return;
          }
          chunks.push(chunk);
        });

        response.on("end", () => {
          const statusCode = response.statusCode ?? 0;
          const body = Buffer.concat(chunks).toString("utf8");
          let parsed: unknown = {};
          if (body.trim()) {
            try {
              parsed = JSON.parse(body);
            } catch {
              reject(new SkillsShApiError("Invalid JSON returned by skills.sh", statusCode, {
                retryAfterSeconds,
                rateLimit,
              }));
              return;
            }
          }

          if (statusCode < 200 || statusCode >= 300) {
            const message =
              typeof parsed === "object" &&
              parsed !== null &&
              "message" in parsed &&
              typeof parsed.message === "string"
                ? parsed.message
                : `skills.sh returned HTTP ${statusCode}`;
            reject(
              new SkillsShApiError(message, statusCode, {
                retryAfterSeconds,
                rateLimit,
              }),
            );
            return;
          }

          resolve({
            data: parsed as T,
            rateLimit,
            cacheMaxAgeSeconds: parseCacheMaxAge(response.headers),
          });
        });
      },
    );

    request.on("timeout", () => {
      request.destroy(new Error("skills.sh request timed out"));
    });
    request.on("error", reject);
    request.end();
  });
}

function skillIdPath(id: string): string {
  return id
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function stripQuotes(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function parseFrontmatter(content: string): {
  name?: string;
  description?: string;
  tags: string[];
} {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { tags: [] };

  const block = match[1];
  const tagsLine = block.match(/^tags:\s*\[(.+)\]$/m)?.[1] ?? "";
  return {
    name: stripQuotes(block.match(/^name:\s*(.+)$/m)?.[1] ?? ""),
    description: stripQuotes(block.match(/^description:\s*(.+)$/m)?.[1] ?? ""),
    tags: tagsLine
      .split(",")
      .map((tag) => stripQuotes(tag))
      .filter(Boolean),
  };
}

function humanize(value: string): string {
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
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(count);
}

function normalizeFiles(files: V1DetailFile[] | null | undefined): SkillFileSnapshot[] {
  if (!Array.isArray(files)) return [];
  return files
    .filter((file) => {
      if (!file.path || typeof file.contents !== "string") return false;
      if (file.path.startsWith("/") || file.path.includes("..")) return false;
      return true;
    })
    .map((file) => ({
      relativePath: file.path,
      content: file.contents,
    }));
}

function hasInstallableContent(skill: RegistrySkill): boolean {
  return Boolean(
    skill.files?.some((file) => file.relativePath.toLowerCase() === "skill.md") ||
      skill.content.trim().length > 0,
  );
}

function mapToRegistrySkill(
  item: V1Skill,
  detail: V1DetailResponse | null,
  audits: SkillStoreAuditResult[],
): RegistrySkill {
  const files = normalizeFiles(detail?.files);
  const skillMd = files.find((file) => file.relativePath.toLowerCase() === "skill.md");
  const frontmatter = parseFrontmatter(skillMd?.content ?? "");
  const name = frontmatter.name || item.name || humanize(item.slug);
  const description =
    frontmatter.description ||
    `${name} community skill from ${item.source}`;
  const sourceUrl =
    item.installUrl ||
    (item.sourceType === "github" ? `https://github.com/${item.source}` : item.url);
  const tags = frontmatter.tags.length
    ? frontmatter.tags
    : Array.from(
        new Set(
          [item.source, item.slug, item.sourceType]
            .flatMap((tag) => tag.split(/[\/\-_]+/))
            .map((tag) => tag.toLowerCase().trim())
            .filter(Boolean),
        ),
      );
  const auditSummaries = audits.map((audit) =>
    `${audit.provider}: ${audit.status.toUpperCase()} - ${audit.summary}`,
  );

  return {
    slug: slugify(item.id),
    source_id: item.id,
    source_type: item.sourceType === "github" ? "github" : "well-known",
    name,
    install_name: item.slug,
    description,
    category: inferCategory(item.slug, description),
    author: item.source.split("/")[0] || "skills.sh",
    source_url: sourceUrl,
    store_url: item.url,
    install_url: item.installUrl ?? undefined,
    tags,
    version: detail?.hash ? `hash:${detail.hash.slice(0, 12)}` : "1.0.0",
    content: skillMd?.content ?? "",
    files: files.length > 0 ? files : undefined,
    remote_hash: detail?.hash ?? null,
    is_duplicate: item.isDuplicate === true,
    compatibility: ["claude", "codex", "cursor", "opencode", "antigravity"],
    weekly_installs: formatCount(item.installs),
    security_audits: auditSummaries.length > 0 ? auditSummaries : undefined,
    audit_results: audits.length > 0 ? audits : undefined,
  };
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runWorker()),
  );
  return results;
}

async function fetchDetail(id: string, apiKey?: string): Promise<V1DetailResponse | null> {
  try {
    const result = await requestJson<V1DetailResponse>(
      `/api/v1/skills/${skillIdPath(id)}`,
      {},
      apiKey,
    );
    return result.data;
  } catch (error) {
    if (error instanceof SkillsShApiError && error.statusCode === 404) {
      return null;
    }
    throw error;
  }
}

async function fetchAudits(id: string, apiKey?: string): Promise<SkillStoreAuditResult[]> {
  try {
    const result = await requestJson<V1AuditResponse>(
      `/api/v1/skills/audit/${skillIdPath(id)}`,
      {},
      apiKey,
    );
    return Array.isArray(result.data.audits) ? result.data.audits : [];
  } catch (error) {
    if (error instanceof SkillsShApiError && error.statusCode === 404) {
      return [];
    }
    throw error;
  }
}

async function fetchApiItems(
  request: SkillsShStoreRequest,
  apiKey?: string,
): Promise<{
  items: V1Skill[];
  rateLimit?: SkillsShRateLimitInfo;
  cacheMaxAgeSeconds?: number;
}> {
  const limit = normalizeLimit(request.limit);
  const query = request.query?.trim();

  if (query && query.length >= 2) {
    const result = await requestJson<V1SearchResponse>(
      "/api/v1/skills/search",
      { q: query, limit },
      apiKey,
    );
    return {
      items: Array.isArray(result.data.data) ? result.data.data : [],
      rateLimit: result.rateLimit,
      cacheMaxAgeSeconds: result.cacheMaxAgeSeconds,
    };
  }

  if (request.view === "curated") {
    const result = await requestJson<V1CuratedResponse>(
      "/api/v1/skills/curated",
      {},
      apiKey,
    );
    return {
      items: Array.isArray(result.data.data)
        ? result.data.data.flatMap((owner) =>
            Array.isArray(owner.skills) ? owner.skills : [],
          ).slice(0, limit)
        : [],
      rateLimit: result.rateLimit,
      cacheMaxAgeSeconds: result.cacheMaxAgeSeconds,
    };
  }

  const result = await requestJson<V1ListResponse>(
    "/api/v1/skills",
    {
      view: request.view === "hot" || request.view === "all-time" ? request.view : "trending",
      page: 0,
      per_page: limit,
    },
    apiKey,
  );
  return {
    items: Array.isArray(result.data.data) ? result.data.data : [],
    rateLimit: result.rateLimit,
    cacheMaxAgeSeconds: result.cacheMaxAgeSeconds,
  };
}

function shouldFallback(error: unknown): boolean {
  if (!(error instanceof SkillsShApiError)) return false;
  return [401, 429, 503].includes(error.statusCode);
}

function fallbackReason(error: unknown): {
  message: string;
  retryAfterSeconds?: number;
  rateLimit?: SkillsShRateLimitInfo;
} {
  if (error instanceof SkillsShApiError) {
    return {
      message: error.message,
      retryAfterSeconds: error.retryAfterSeconds,
      rateLimit: error.rateLimit,
    };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

export async function loadSkillsShStore(
  request: SkillsShStoreRequest = {},
): Promise<SkillsShStoreResponse> {
  const apiKey = request.apiKey?.trim() || undefined;

  try {
    const { items, rateLimit, cacheMaxAgeSeconds } = await fetchApiItems(request, apiKey);
    const skills = await runWithConcurrency(items, DETAIL_CONCURRENCY, async (item) => {
      const [detail, audits] = await Promise.all([
        fetchDetail(item.id, apiKey),
        fetchAudits(item.id, apiKey).catch(() => []),
      ]);
      return mapToRegistrySkill(item, detail, audits);
    });

    const filtered = skills.filter((skill) => {
      if (!request.includeDuplicates && skill.is_duplicate) return false;
      if (!request.includeIncomplete && !hasInstallableContent(skill)) return false;
      return true;
    });

    return {
      skills: filtered,
      mode: "api",
      source: "api-v1",
      rateLimit,
      cacheMaxAgeSeconds,
    };
  } catch (error) {
    if (!shouldFallback(error)) {
      throw error;
    }
    const reason = fallbackReason(error);
    return {
      skills: [],
      mode: "fallback",
      source: "html",
      fallbackReason: reason.message,
      retryAfterSeconds: reason.retryAfterSeconds,
      rateLimit: reason.rateLimit,
    };
  }
}
