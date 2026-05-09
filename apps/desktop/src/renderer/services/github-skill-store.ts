import type {
  GitHubRepoMetadata,
  GitHubTreeEntry,
  GitHubTreeResponse,
  RegistrySkill,
  SkillCategory,
} from "@prompthub/shared/types";
import { retryAsync, runWithConcurrency } from "./concurrency";

/** Default concurrency for fetching SKILL.md files from raw.githubusercontent.com */
export const GITHUB_SKILL_FETCH_CONCURRENCY = 5;
/** Default retry attempts per file (so each file is tried up to 3 times in total) */
export const GITHUB_SKILL_FETCH_RETRIES = 2;

export interface SkillFetchFailure {
  path: string;
  message: string;
}

interface ParsedGithubRepo {
  owner: string;
  repo: string;
  repositoryUrl: string;
  branch?: string;
  subdir?: string;
}

function stripQuotes(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

export function parseFrontmatter(content: string): {
  name: string;
  description: string;
  tags: string[];
} {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return { name: "", description: "", tags: [] };
  }

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

export function toTitleCase(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
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
  if (/(pdf|doc|ppt|sheet|spreadsheet|word|xlsx|docx)/.test(text)) {
    return "office";
  }
  if (/(github|git|web|playwright|mcp|code|cli|dev|pr)/.test(text)) {
    return "dev";
  }
  if (/(design|figma|css|ui|frontend|canvas|brand)/.test(text)) {
    return "design";
  }
  if (/(deploy|vercel|docker|cloudflare|netlify)/.test(text)) {
    return "deploy";
  }
  if (/(secure|security|audit|auth|secret)/.test(text)) {
    return "security";
  }
  if (/(analy|data|sql|chart|research)/.test(text)) {
    return "data";
  }
  if (/(manage|project|notion|linear)/.test(text)) {
    return "management";
  }
  if (/(ai|generate|translation|speech|image|video|art)/.test(text)) {
    return "ai";
  }
  return "general";
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function isGitHubTreeEntry(
  value: unknown,
): value is GitHubTreeEntry & { path: string; type: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "path" in value &&
    typeof value.path === "string" &&
    "type" in value &&
    typeof value.type === "string"
  );
}

function isGitHubRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("github api rate limit reached");
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function dedupeRegistrySkills(skills: RegistrySkill[]): RegistrySkill[] {
  const bySlug = new Map<string, RegistrySkill>();
  const seenNames = new Set<string>();
  for (const skill of skills) {
    if (bySlug.has(skill.slug)) {
      continue;
    }
    const normalizedName = (skill.install_name || skill.slug).toLowerCase();
    if (seenNames.has(normalizedName)) {
      continue;
    }
    bySlug.set(skill.slug, skill);
    seenNames.add(normalizedName);
  }
  return Array.from(bySlug.values());
}

function buildRawUrl(
  owner: string,
  repo: string,
  branch: string,
  filePath: string,
): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
}

function isSkillMarkdownPath(filePath: string): boolean {
  return filePath === "SKILL.md" || filePath.endsWith("/SKILL.md");
}

function isRootReadmePath(filePath: string): boolean {
  return /^[^/]+$/u.test(filePath) && /^readme\.md$/i.test(filePath);
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeRepoSubdir(parts: string[]): string | undefined {
  const normalizedParts = parts
    .map((part) => safeDecodeURIComponent(part).trim())
    .filter(Boolean);
  if (normalizedParts.some((part) => part === "." || part === "..")) {
    return undefined;
  }
  return normalizedParts.join("/") || undefined;
}

function isWithinRepoSubdir(filePath: string, subdir?: string): boolean {
  if (!subdir) return true;
  return filePath === subdir || filePath.startsWith(`${subdir}/`);
}

function isSourceReadmePath(filePath: string, subdir?: string): boolean {
  if (!subdir) return isRootReadmePath(filePath);
  return filePath.toLowerCase() === `${subdir.toLowerCase()}/readme.md`;
}

export function parseGithubRepo(url: string): ParsedGithubRepo | null {
  const normalized = url
    .trim()
    .replace(/^git@github\.com:/i, "https://github.com/")
    .replace(/\.git$/i, "");

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(normalized);
  } catch {
    return null;
  }

  if (parsedUrl.hostname.toLowerCase() !== "github.com") {
    return null;
  }

  const parts = parsedUrl.pathname.split("/").filter(Boolean);
  const owner = parts[0];
  const repo = parts[1]?.replace(/\.git$/i, "");
  if (!owner || !repo) {
    return null;
  }

  const branch =
    parts[2] === "tree" && parts[3]
      ? safeDecodeURIComponent(parts[3])
      : undefined;
  const subdir =
    parts[2] === "tree" && parts[3]
      ? normalizeRepoSubdir(parts.slice(4))
      : undefined;

  return {
    owner,
    repo,
    repositoryUrl: `https://github.com/${owner}/${repo}`,
    branch,
    subdir,
  };
}

/**
 * Build a `RegistrySkill` from a SKILL.md path + content.  Shared between the
 * fast-path tarball flow (one HTTP request → all files) and the slow-path
 * per-file raw fetch flow.
 */
function buildRegistrySkillFromContent(args: {
  parsedRepo: ParsedGithubRepo;
  defaultBranch: string;
  repoMeta: GitHubRepoMetadata;
  builtinBySlug: Map<string, RegistrySkill>;
  path: string;
  content: string;
  defaultCompatibility?: string[];
}): RegistrySkill {
  const {
    parsedRepo,
    defaultBranch,
    repoMeta,
    builtinBySlug,
    path,
    content,
    defaultCompatibility,
  } = args;
  const pathParts = path.split("/");
  const directoryPath = pathParts.slice(0, -1).join("/");
  const directoryName =
    pathParts.length > 1 ? pathParts[pathParts.length - 2] : "";
  const rawUrl = buildRawUrl(
    parsedRepo.owner,
    parsedRepo.repo,
    defaultBranch,
    path,
  );
  const sourceRepoUrl = directoryPath
    ? `${parsedRepo.repositoryUrl}/tree/${defaultBranch}/${directoryPath}`
    : `${parsedRepo.repositoryUrl}/tree/${defaultBranch}`;

  const parsed = parseFrontmatter(content);
  const slug = slugify(directoryName || parsed.name || parsedRepo.repo);
  const builtin = builtinBySlug.get(slug);
  const description =
    parsed.description || builtin?.description || `${toTitleCase(slug)} skill`;

  return {
    slug,
    name: builtin?.name || parsed.name || toTitleCase(slug),
    install_name: parsed.name || undefined,
    description,
    category: builtin?.category || inferCategory(slug, description),
    icon_url: builtin?.icon_url,
    icon_background: builtin?.icon_background,
    icon_emoji: builtin?.icon_emoji,
    author:
      builtin?.author ||
      repoMeta?.owner?.login ||
      (parsedRepo.owner === "anthropics" ? "Anthropic" : parsedRepo.owner),
    source_url: sourceRepoUrl,
    tags: builtin?.tags?.length
      ? builtin.tags
      : parsed.tags.length
        ? parsed.tags
        : slug.split(/[-_]/).filter(Boolean),
    version: builtin?.version || "1.0.0",
    content,
    content_url: rawUrl,
    prerequisites: builtin?.prerequisites,
    compatibility:
      defaultCompatibility || builtin?.compatibility || ["claude", "cursor"],
  } satisfies RegistrySkill;
}

export async function loadGitHubSkillRepo(
  repoUrl: string,
  options: {
    fetchRemoteContent: (url: string) => Promise<string>;
    /**
     * Optional fast path: download the entire repository tarball in a single
     * request and return all SKILL.md / README.md files at once.  When this
     * is provided and succeeds, we skip the per-file raw fetch fan-out
     * entirely.  On any failure, we transparently fall back to the slower
     * raw-content path.
     */
    fetchGithubTarball?: (
      owner: string,
      repo: string,
      branch: string,
    ) => Promise<Array<{ path: string; content: string }>>;
    registrySkills: RegistrySkill[];
    rateLimitMessage: string;
    /**
     * Bounded concurrency for SKILL.md downloads.  Defaults to
     * `GITHUB_SKILL_FETCH_CONCURRENCY` (5) — enough to overlap network
     * latency without tripping raw.githubusercontent.com's per-IP throttle.
     */
    concurrency?: number;
    /** Retry attempts per file on transient failure.  Default 2 (total 3 tries). */
    retries?: number;
    /**
     * Optional callback fired once after the batch completes when one or more
     * files failed to download.  The function still returns the successfully
     * loaded skills so the UI never throws away partial progress.
     */
    onPartialFailure?: (failures: SkillFetchFailure[]) => void;
    defaultCompatibility?: string[];
    /** Test-only sleep override forwarded to the retry helper. */
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<RegistrySkill[]> {
  const parsedRepo = parseGithubRepo(repoUrl);
  if (!parsedRepo) {
    throw new Error("Invalid GitHub repository URL");
  }

  let repoMetaRaw: string;
  try {
    repoMetaRaw = await options.fetchRemoteContent(
      `https://api.github.com/repos/${parsedRepo.owner}/${parsedRepo.repo}`,
    );
  } catch (error) {
    if (isGitHubRateLimitError(error)) {
      throw new Error(options.rateLimitMessage);
    }
    throw error;
  }
  const repoMeta = parseJson<GitHubRepoMetadata>(repoMetaRaw || "{}", {});
  const defaultBranch = parsedRepo.branch || repoMeta.default_branch || "main";

  const builtinBySlug = new Map(
    options.registrySkills.map((skill) => [skill.slug, skill]),
  );

  // ---------- Fast path: download the whole repository as a tarball ----------
  // One HTTP request to codeload.github.com replaces (1 tree-API call + N raw
  // file fetches).  This is the only way to compete with the speed of a real
  // `git clone` when a repo has 20+ skill files.
  if (options.fetchGithubTarball) {
    try {
      const tarFiles = await options.fetchGithubTarball(
        parsedRepo.owner,
        parsedRepo.repo,
        defaultBranch,
      );
      const tarballSkillFiles = tarFiles.filter((file) =>
        isSkillMarkdownPath(file.path) &&
          isWithinRepoSubdir(file.path, parsedRepo.subdir),
      );

      if (tarballSkillFiles.length > 0) {
        const skills = tarballSkillFiles.map((file) =>
          buildRegistrySkillFromContent({
            parsedRepo,
            defaultBranch,
            repoMeta,
            builtinBySlug,
            path: file.path,
            content: file.content,
            defaultCompatibility: options.defaultCompatibility,
          }),
        );
        return dedupeRegistrySkills(skills);
      }

      // Tarball succeeded but contained no SKILL.md.  Try the README fallback
      // by reusing the legacy tree path below — it might still find a
      // top-level README.md worth showing.
    } catch (error) {
      // Tarball failed (network blocked, codeload unreachable, parse error).
      // Fall through to the slower per-file raw-fetch path.  We deliberately
      // do *not* throw here — the slow path is the entire reason we still
      // ship that code.
      console.warn(
        `[loadGitHubSkillRepo] Tarball fast path failed for ${parsedRepo.owner}/${parsedRepo.repo}; falling back to per-file fetches.`,
        error,
      );
    }
  }

  // ---------- Slow path: GitHub tree API + per-file raw fetch ----------
  let treeRaw: string;
  try {
    treeRaw = await options.fetchRemoteContent(
      `https://api.github.com/repos/${parsedRepo.owner}/${parsedRepo.repo}/git/trees/${defaultBranch}?recursive=1`,
    );
  } catch (error) {
    if (isGitHubRateLimitError(error)) {
      throw new Error(options.rateLimitMessage);
    }
    throw error;
  }
  const treeData = parseJson<GitHubTreeResponse>(treeRaw || "{}", {});
  const treeEntries = Array.isArray(treeData.tree)
    ? treeData.tree.filter(isGitHubTreeEntry)
    : [];
  const skillFiles = treeEntries.filter(
    (item) =>
      item.type === "blob" &&
      isSkillMarkdownPath(item.path) &&
      isWithinRepoSubdir(item.path, parsedRepo.subdir),
  );

  const concurrency = options.concurrency ?? GITHUB_SKILL_FETCH_CONCURRENCY;
  const retries = options.retries ?? GITHUB_SKILL_FETCH_RETRIES;
  const failures: SkillFetchFailure[] = [];

  type FetchOutcome =
    | { ok: true; skill: RegistrySkill }
    | { ok: false; failure: SkillFetchFailure };

  const outcomes = await runWithConcurrency<
    GitHubTreeEntry & { path: string; type: string },
    FetchOutcome
  >(skillFiles, concurrency, async (item): Promise<FetchOutcome> => {
    const path = item.path;
    const rawUrl = buildRawUrl(
      parsedRepo.owner,
      parsedRepo.repo,
      defaultBranch,
      path,
    );

    let content: string;
    try {
      content = await retryAsync(() => options.fetchRemoteContent(rawUrl), {
        retries,
        initialDelayMs: 300,
        maxDelayMs: 3_000,
        // Bail out early on rate limiting — retrying just burns budget.
        shouldRetry: (error) => !isGitHubRateLimitError(error),
        sleep: options.sleep,
      });
    } catch (error) {
      return {
        ok: false,
        failure: {
          path,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }

    if (!content) {
      return {
        ok: false,
        failure: { path, message: "Empty SKILL.md content" },
      };
    }

    return {
      ok: true,
      skill: buildRegistrySkillFromContent({
        parsedRepo,
        defaultBranch,
        repoMeta,
        builtinBySlug,
        path,
        content,
        defaultCompatibility: options.defaultCompatibility,
      }),
    };
  });

  const remoteSkills: (RegistrySkill | null)[] = outcomes.map(
    (outcome: FetchOutcome): RegistrySkill | null => {
      if (outcome.ok === false) {
        failures.push(outcome.failure);
        return null;
      }
      return outcome.skill;
    },
  );

  if (failures.length > 0) {
    options.onPartialFailure?.(failures);
  }

  if (remoteSkills.some(isDefined)) {
    return dedupeRegistrySkills(remoteSkills.filter(isDefined));
  }

  // No SKILL.md content materialised.  If every file failed because the API
  // signalled a hard rate limit, surface that explicitly so the UI can show a
  // helpful hint instead of silently falling back to README parsing.
  if (
    failures.length > 0 &&
    failures.length === skillFiles.length &&
    failures.every((failure) =>
      failure.message.toLowerCase().includes("github api rate limit reached"),
    )
  ) {
    throw new Error(options.rateLimitMessage);
  }

  const readmeEntry = treeEntries.find(
    (item) =>
      item.type === "blob" && isSourceReadmePath(item.path, parsedRepo.subdir),
  );
  if (!readmeEntry) {
    return [];
  }

  const rawUrl = buildRawUrl(
    parsedRepo.owner,
    parsedRepo.repo,
    defaultBranch,
    readmeEntry.path,
  );
  const content = await options.fetchRemoteContent(rawUrl);
  const parsed = parseFrontmatter(content);
  const fallbackSlug = parsedRepo.subdir
    ? parsedRepo.subdir.split("/").filter(Boolean).pop() || parsedRepo.repo
    : parsedRepo.repo;
  const slug = slugify(parsed.name || fallbackSlug);
  const builtin = builtinBySlug.get(slug);
  const description =
    parsed.description || builtin?.description || `${toTitleCase(slug)} skill`;
  const sourceRepoUrl = parsedRepo.subdir
    ? `${parsedRepo.repositoryUrl}/tree/${defaultBranch}/${parsedRepo.subdir}`
    : `${parsedRepo.repositoryUrl}/tree/${defaultBranch}`;

  return [
    {
      slug,
      name: builtin?.name || parsed.name || toTitleCase(fallbackSlug),
      install_name: parsed.name || undefined,
      description,
      category: builtin?.category || inferCategory(slug, description),
      icon_url: builtin?.icon_url,
      icon_background: builtin?.icon_background,
      icon_emoji: builtin?.icon_emoji,
      author:
        builtin?.author ||
        repoMeta?.owner?.login ||
        (parsedRepo.owner === "anthropics" ? "Anthropic" : parsedRepo.owner),
      source_url: sourceRepoUrl,
      tags: builtin?.tags?.length
        ? builtin.tags
        : parsed.tags.length
          ? parsed.tags
          : slug.split(/[-_]/).filter(Boolean),
      version: builtin?.version || "1.0.0",
      content,
      content_url: rawUrl,
      prerequisites: builtin?.prerequisites,
      compatibility:
        options.defaultCompatibility ||
        builtin?.compatibility ||
        ["claude", "cursor"],
    } satisfies RegistrySkill,
  ];
}
