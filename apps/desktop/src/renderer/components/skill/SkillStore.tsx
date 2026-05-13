import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  SearchIcon,
  Loader2Icon,
  LayoutGridIcon,
  CodeIcon,
  SparklesIcon,
  BarChartIcon,
  ShieldIcon,
  RocketIcon,
  PaletteIcon,
  WandIcon,
  BriefcaseIcon,
  FileSpreadsheetIcon,
  BoxesIcon,
  GlobeIcon,
  FolderIcon,
  DatabaseIcon,
  RefreshCwIcon,
  InfoIcon,
} from "lucide-react";
import { SkillStoreDetail } from "./SkillStoreDetail";
import { SkillStoreCard } from "./SkillStoreCard";
import { SkillStoreCustomSources } from "./SkillStoreCustomSources";
import { SkillStoreSourceForm } from "./SkillStoreSourceForm";
import {
  loadGitHubSkillRepo,
  parseFrontmatter,
  toTitleCase,
  type SkillFetchFailure,
} from "../../services/github-skill-store";
import { useSkillStore } from "../../stores/skill.store";
import { useSettingsStore } from "../../stores/settings.store";
import { isLikelyLocalSource } from "../../services/skill-store-source";
import {
  mapSkillsShEntryToRegistrySkill,
  parseSkillsShLeaderboard,
  SKILLS_SH_BASE_URL,
  type SkillsShLeaderboardEntry,
} from "../../services/skills-sh-store";
import { useToast } from "../ui/Toast";
import type {
  DeviceManagementSettings,
  MarketplaceReferenceEntry,
  MarketplaceRegistryDocument,
  MarketplaceSkillEntry,
  RegistrySkill,
  Settings,
  SkillsShCatalogView,
  SkillCategory,
  SkillStoreSource,
} from "@prompthub/shared/types";
import { SKILL_CATEGORIES } from "@prompthub/shared/constants/skill-registry";
import { getSafetyScanAIConfig } from "./detail-utils";
import { findInstalledRegistrySkill } from "../../services/skill-store-update";
import {
  isConfiguredModel,
  resolveScenarioModel,
} from "../../services/ai-defaults";
import {
  buildSkillInsightSearchText,
  shouldTriggerSkillOnlineSearch,
} from "../../services/skill-search";

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  all: <LayoutGridIcon className="w-3.5 h-3.5" />,
  office: <FileSpreadsheetIcon className="w-3.5 h-3.5" />,
  dev: <CodeIcon className="w-3.5 h-3.5" />,
  ai: <SparklesIcon className="w-3.5 h-3.5" />,
  data: <BarChartIcon className="w-3.5 h-3.5" />,
  management: <BriefcaseIcon className="w-3.5 h-3.5" />,
  deploy: <RocketIcon className="w-3.5 h-3.5" />,
  design: <PaletteIcon className="w-3.5 h-3.5" />,
  security: <ShieldIcon className="w-3.5 h-3.5" />,
  meta: <WandIcon className="w-3.5 h-3.5" />,
};

const noopLoadSkillInsightCache = async (): Promise<void> => undefined;

const CUSTOM_SOURCE_TYPE_OPTIONS: Array<{
  value: Extract<
    SkillStoreSource["type"],
    "marketplace-json" | "git-repo" | "local-dir"
  >;
  icon: React.ReactNode;
}> = [
  {
    value: "marketplace-json",
    icon: <DatabaseIcon className="w-4 h-4" />,
  },
  {
    value: "git-repo",
    icon: <GlobeIcon className="w-4 h-4" />,
  },
  {
    value: "local-dir",
    icon: <FolderIcon className="w-4 h-4" />,
  },
];

const MAX_REMOTE_STORE_DEPTH = 3;
const MAX_SKILLS_SH_SKILLS = 200;
const BUILTIN_REMOTE_STORES: Record<
  string,
  {
    id: string;
    type: "git-repo" | "skills-sh";
    url: string;
  }
> = {
  "claude-code": {
    id: "claude-code",
    type: "git-repo",
    url: "https://github.com/anthropics/skills",
  },
  "openai-codex": {
    id: "openai-codex",
    type: "git-repo",
    url: "https://github.com/openai/skills/tree/main/skills/.curated",
  },
  "hermes-agent": {
    id: "hermes-agent",
    type: "git-repo",
    url: "https://github.com/nousresearch/hermes-agent/tree/main/skills",
  },
  "hermes-agent-optional": {
    id: "hermes-agent-optional",
    type: "git-repo",
    url: "https://github.com/nousresearch/hermes-agent/tree/main/optional-skills",
  },
  community: {
    id: "community",
    type: "skills-sh",
    url: SKILLS_SH_BASE_URL,
  },
};
const BUILTIN_REMOTE_STORE_IDS = Object.keys(BUILTIN_REMOTE_STORES);

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function inferCategory(slug: string, description: string): SkillCategory {
  const text = `${slug} ${description}`.toLowerCase();
  if (/(pdf|doc|ppt|sheet|spreadsheet|word|xlsx|docx)/.test(text))
    return "office";
  if (/(github|git|web|playwright|mcp|code|cli|dev|pr)/.test(text))
    return "dev";
  if (/(design|figma|css|ui|frontend|canvas|brand)/.test(text)) return "design";
  if (/(deploy|vercel|docker|cloudflare|netlify)/.test(text)) return "deploy";
  if (/(secure|security|audit|auth|secret)/.test(text)) return "security";
  if (/(analy|data|sql|chart|research)/.test(text)) return "data";
  if (/(manage|project|notion|linear)/.test(text)) return "management";
  if (/(ai|generate|translation|speech|image|video|art)/.test(text))
    return "ai";
  return "general";
}

function buildStoreSkillSafetyContent(skill: RegistrySkill): string {
  if (!skill.files?.length) {
    return skill.content;
  }
  return skill.files
    .map((file) => `# ${file.relativePath}\n${file.content}`)
    .join("\n\n");
}

function hasHighRiskStoreAudit(skill: RegistrySkill): boolean {
  return (skill.audit_results ?? []).some((audit) => {
    const status = String(audit.status || "").toLowerCase();
    const riskLevel = String(audit.riskLevel || "").toUpperCase();
    return status === "fail" || riskLevel === "HIGH" || riskLevel === "CRITICAL";
  });
}

function resolveUrl(baseUrl: string, value?: string | null) {
  if (!value) return null;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function dedupeRegistrySkills(skills: RegistrySkill[]) {
  const bySlug = new Map<string, RegistrySkill>();
  // Also deduplicate by normalized name to stay consistent with the
  // backend SkillDB which uses LOWER(name) as the uniqueness key.
  const seenNames = new Set<string>();
  for (const skill of skills) {
    if (bySlug.has(skill.slug)) continue;
    const normalizedName = (skill.install_name || skill.slug).toLowerCase();
    if (seenNames.has(normalizedName)) continue;
    bySlug.set(skill.slug, skill);
    seenNames.add(normalizedName);
  }
  return Array.from(bySlug.values());
}

function getSearchableRemoteSourceIds(
  customStoreSources: SkillStoreSource[],
): string[] {
  return [
    ...BUILTIN_REMOTE_STORE_IDS,
    ...customStoreSources
      .filter((source) => source.enabled)
      .map((source) => source.id),
  ];
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getRemoteStoreErrorMessage(error: unknown, t: TFunction): string {
  const message = getErrorMessage(error);

  if (/GitHub API rate limit reached/i.test(message)) {
    return t(
      "skill.remoteStoreRateLimitHint",
      "GitHub API rate limit reached. Try again in a few minutes, or add a GitHub token in settings.",
    );
  }

  if (
    /ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED|Failed to resolve remote host|getaddrinfo/i.test(
      message,
    )
  ) {
    return t(
      "skill.remoteStoreNetworkHint",
      "Cannot connect to the remote skill store. Check your network, DNS, proxy, or VPN settings, then try again.",
    );
  }

  if (
    /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ERR_NETWORK|socket hang up|timed out/i.test(
      message,
    )
  ) {
    return t(
      "skill.remoteStoreConnectionHint",
      "The remote skill store did not respond. Check your connection or try again later.",
    );
  }

  return (
    message || t("skill.remoteStoreLoadFailed", "Failed to load remote store")
  );
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function cadenceToMs(
  cadence: DeviceManagementSettings["storeSyncCadence"],
): number | null {
  switch (cadence) {
    case "1h":
      return 60 * 60 * 1000;
    case "1d":
      return 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

function shouldForceRefreshSource(
  loadedAt: number | undefined,
  intervalMs: number | null,
): boolean {
  if (!loadedAt || loadedAt <= 0) {
    return true;
  }

  if (intervalMs === null) {
    return false;
  }

  return Date.now() - loadedAt >= intervalMs;
}

function resolveMarketplaceReference(
  entry: string | MarketplaceReferenceEntry,
): string | undefined {
  if (typeof entry === "string") return entry;
  return entry.url || entry.index || entry.manifest;
}

interface LegacySkillsShSearchSkill {
  id?: string;
  skillId?: string;
  name?: string;
  installs?: number;
  source?: string;
}

interface LegacySkillsShSearchResponse {
  skills?: LegacySkillsShSearchSkill[];
}

export function SkillStore() {
  const { t, i18n } = useTranslation();
  const isZh = i18n.language?.startsWith("zh");
  const insightLanguage = useMemo(() => {
    const lang = (i18n.language || "").toLowerCase();
    if (lang.startsWith("zh")) return "中文";
    if (lang.startsWith("ja")) return "日本語";
    if (lang.startsWith("fr")) return "Français";
    if (lang.startsWith("de")) return "Deutsch";
    if (lang.startsWith("es")) return "Español";
    return "English";
  }, [i18n.language]);

  const loadRegistry = useSkillStore((state) => state.loadRegistry);
  const storeCategory = useSkillStore((state) => state.storeCategory) ?? "all";
  const setStoreCategory = useSkillStore((state) => state.setStoreCategory);
  const storeSearchQuery =
    useSkillStore((state) => state.storeSearchQuery) ?? "";
  const installRegistrySkill = useSkillStore(
    (state) => state.installRegistrySkill,
  );
  const scanLocalPreview = useSkillStore((state) => state.scanLocalPreview);
  const skills = useSkillStore((state) => state.skills);
  const selectRegistrySkill = useSkillStore(
    (state) => state.selectRegistrySkill,
  );
  const selectedRegistrySlug = useSkillStore(
    (state) => state.selectedRegistrySlug,
  );
  const registrySkills = useSkillStore((state) => state.registrySkills) ?? [];
  const selectedStoreSourceId = useSkillStore(
    (state) => state.selectedStoreSourceId,
  ) ?? "official";
  const selectStoreSource = useSkillStore((state) => state.selectStoreSource);
  const customStoreSources =
    useSkillStore((state) => state.customStoreSources) ?? [];
  const addCustomStoreSource = useSkillStore(
    (state) => state.addCustomStoreSource,
  );
  const removeCustomStoreSource = useSkillStore(
    (state) => state.removeCustomStoreSource,
  );
  const toggleCustomStoreSource = useSkillStore(
    (state) => state.toggleCustomStoreSource,
  );
  const remoteStoreEntries =
    useSkillStore((state) => state.remoteStoreEntries) ?? {};
  const setRemoteStoreEntry = useSkillStore(
    (state) => state.setRemoteStoreEntry,
  );
  const skillInsightCache = useSkillStore((state) => state.skillInsightCache);
  const loadSkillInsightCache =
    useSkillStore((state) => state.loadSkillInsightCache) ??
    noopLoadSkillInsightCache;
  const getSkillInsight = useSkillStore((state) => state.getSkillInsight);
  const generateSkillInsight = useSkillStore(
    (state) => state.generateSkillInsight,
  );
  const refreshSkillInsight = useSkillStore(
    (state) => state.refreshSkillInsight,
  );
  const [installingSlug, setInstallingSlug] = useState<string | null>(null);
  const [sourceType, setSourceType] =
    useState<
      Extract<
        SkillStoreSource["type"],
        "marketplace-json" | "git-repo" | "local-dir"
      >
    >("marketplace-json");
  const [sourceName, setSourceName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [loadingSourceId, setLoadingSourceId] = useState<string | null>(null);
  const [skillsShView, setSkillsShView] =
    useState<SkillsShCatalogView>("trending");
  const [showHiddenSkillsShItems, setShowHiddenSkillsShItems] = useState(false);
  const [skillsShFallbackNotice, setSkillsShFallbackNotice] = useState<
    string | null
  >(null);
  const remoteStoreEntriesRef = useRef(remoteStoreEntries);
  const inflightStoreLoadsRef = useRef(new Map<string, Promise<void>>());
  const skillsShCacheExpiresAtRef = useRef<number | undefined>(undefined);
  const loadRegistryRef = useRef(loadRegistry);
  const loadStoreSourceRef = useRef<
    (sourceId: string, forceRefresh?: boolean) => Promise<void>
  >(async () => undefined);
  const { showToast } = useToast();
  const autoScanBeforeInstall = useSettingsStore(
    (state) => state.autoScanStoreSkillsBeforeInstall,
  );
  const aiModels = useSettingsStore((state) => state.aiModels);
  const scenarioModelDefaults = useSettingsStore(
    (state) => state.scenarioModelDefaults,
  );
  const legacyAiApiKey = useSettingsStore((state) => state.aiApiKey);
  const legacyAiApiUrl = useSettingsStore((state) => state.aiApiUrl);
  const legacyAiModel = useSettingsStore((state) => state.aiModel);
  const skillInsightAutoGenerateEnabled = useSettingsStore(
    (state) => state.skillInsightAutoGenerateEnabled,
  );
  const skillInsightAutoGenerateConfirmed = useSettingsStore(
    (state) => state.skillInsightAutoGenerateConfirmed,
  );
  const setSkillInsightAutoGenerateEnabled = useSettingsStore(
    (state) => state.setSkillInsightAutoGenerateEnabled,
  );
  const setSkillInsightAutoGenerateConfirmed = useSettingsStore(
    (state) => state.setSkillInsightAutoGenerateConfirmed,
  );
  const skillsShApiKey = useSettingsStore((state) => state.skillsShApiKey);
  const customStoreSourcesSyncKey = useMemo(
    () =>
      customStoreSources
        .map((source) =>
          [source.id, source.type, source.url, source.enabled ? "1" : "0"].join(
            ":",
          ),
        )
        .join("|"),
    [customStoreSources],
  );
  const searchableRemoteSourceIds = useMemo(
    () => getSearchableRemoteSourceIds(customStoreSources),
    [customStoreSources],
  );
  const skillInsightModel = useMemo(
    () =>
      resolveScenarioModel(
        aiModels,
        scenarioModelDefaults,
        "skillInsight",
        "chat",
      ),
    [aiModels, scenarioModelDefaults],
  );
  const isSkillInsightModelConfigured =
    isConfiguredModel(skillInsightModel) ||
    Boolean(
      legacyAiApiKey.trim() && legacyAiApiUrl.trim() && legacyAiModel.trim(),
    );

  useEffect(() => {
    remoteStoreEntriesRef.current = remoteStoreEntries;
  }, [remoteStoreEntries]);

  useEffect(() => {
    loadRegistryRef.current = loadRegistry;
  }, [loadRegistry]);

  useEffect(() => {
    if (typeof loadRegistry === "function") {
      void loadRegistry();
    }
  }, [loadRegistry]);

  useEffect(() => {
    void loadSkillInsightCache();
  }, [loadSkillInsightCache]);

  const installedSlugs = useMemo(() => {
    return skills
      .filter((skill) => skill.registry_slug)
      .map((skill) => skill.registry_slug!);
  }, [skills]);

  // Locally-imported skills won't have registry_slug but may share a name
  // with a registry skill.  Build a lowercase name set so the UI can
  // correctly mark them as "installed" even without a slug match.
  const installedNamesLower = useMemo(() => {
    return new Set(skills.map((skill) => skill.name.toLowerCase()));
  }, [skills]);

  const selectedCustomSource = useMemo(
    () =>
      customStoreSources.find(
        (source) => source.id === selectedStoreSourceId,
      ) || null,
    [customStoreSources, selectedStoreSourceId],
  );

  const selectedRemoteEntry = remoteStoreEntries[selectedStoreSourceId];
  const isSelectedSourceRemote =
    selectedStoreSourceId === "claude-code" ||
    selectedStoreSourceId === "openai-codex" ||
    selectedStoreSourceId === "hermes-agent" ||
    selectedStoreSourceId === "hermes-agent-optional" ||
    selectedStoreSourceId === "community" ||
    Boolean(selectedCustomSource);

  const loadGitHubRepoSkills = useCallback(
    async (
      repoUrl: string,
      partialFailures?: SkillFetchFailure[],
      defaultCompatibility?: string[],
    ): Promise<RegistrySkill[]> => {
      // Old preload bundles (pre-tarball) won't have fetchGithubTarball.
      // Guard the lookup so we don't surface a TypeError before falling back.
      const tarballFetcher =
        typeof window.api?.skill?.fetchGithubTarball === "function"
          ? (owner: string, repo: string, branch: string) =>
              window.api.skill.fetchGithubTarball(owner, repo, branch)
          : undefined;
      try {
        return await loadGitHubSkillRepo(repoUrl, {
          fetchRemoteContent: (url) => window.api.skill.fetchRemoteContent(url),
          fetchGithubTarball: tarballFetcher,
          registrySkills,
          defaultCompatibility,
          rateLimitMessage: t(
            "skill.remoteStoreRateLimitHint",
            "GitHub API rate limit reached. Try again in a few minutes, or add a GitHub token in settings.",
          ),
          onPartialFailure: (failures) => {
            // Record into the caller-supplied bucket so the UI can surface a
            // banner with the failed-count next to the (still-rendered) cards.
            if (partialFailures) partialFailures.push(...failures);
            // Always log the full failure list so support can inspect why
            // 14/22 files dropped — silent failures were the original bug.
            console.warn(
              `[SkillStore] ${failures.length} SKILL.md file(s) failed to download from ${repoUrl}:`,
              failures,
            );
          },
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Invalid GitHub repository URL"
        ) {
          throw new Error(
            t(
              "skill.invalidGitRepo",
              "Please enter a GitHub repository URL, or use a local directory path instead",
            ),
          );
        }
        throw error;
      }
    },
    [registrySkills, t],
  );

  const loadMarketplaceStore = useCallback(
    async (
      url: string,
      visited = new Set<string>(),
      depth = 0,
    ): Promise<RegistrySkill[]> => {
      const resolvedUrl = resolveUrl(url, url);
      if (
        !resolvedUrl ||
        visited.has(resolvedUrl) ||
        depth > MAX_REMOTE_STORE_DEPTH
      ) {
        return [];
      }
      visited.add(resolvedUrl);

      const raw = await window.api.skill.fetchRemoteContent(resolvedUrl);
      if (!raw) return [];

      const data = parseJson<MarketplaceRegistryDocument>(raw, {});
      const builtinBySlug = new Map(
        registrySkills.map((skill) => [skill.slug, skill]),
      );
      const directSkills = Array.isArray(data.skills) ? data.skills : [];

      const mappedSkills = await Promise.all(
        directSkills.map(async (item: MarketplaceSkillEntry) => {
          const slug =
            item.slug ||
            item.id ||
            slugify(item.name || item.title || "remote-skill");
          if (!slug) return null;

          const builtin = builtinBySlug.get(slug);
          const contentUrl =
            resolveUrl(
              resolvedUrl,
              item.content_url ||
                item.contentUrl ||
                item.skill_url ||
                item.skillUrl ||
                item.raw_url ||
                item.rawUrl,
            ) || undefined;
          const sourceUrl =
            resolveUrl(
              resolvedUrl,
              item.source_url ||
                item.sourceUrl ||
                item.repo_url ||
                item.repoUrl ||
                item.repository ||
                item.repo,
            ) ||
            contentUrl ||
            resolvedUrl;

          let content = typeof item.content === "string" ? item.content : "";
          if (!content && contentUrl) {
            try {
              content = await window.api.skill.fetchRemoteContent(contentUrl);
            } catch {
              content = "";
            }
          }

          const parsed = content
            ? parseFrontmatter(content)
            : { name: "", description: "", tags: [] as string[] };
          const description =
            item.description ||
            parsed.description ||
            builtin?.description ||
            `${toTitleCase(slug)} skill`;

          return {
            slug,
            name:
              item.name ||
              item.title ||
              parsed.name ||
              builtin?.name ||
              toTitleCase(slug),
            install_name: item.install_name || item.installName,
            description,
            category:
              item.category ||
              builtin?.category ||
              inferCategory(slug, description),
            icon_url: item.icon_url || item.iconUrl || builtin?.icon_url,
            icon_emoji:
              item.icon_emoji || item.iconEmoji || builtin?.icon_emoji,
            author: item.author || builtin?.author || "Community",
            source_url: sourceUrl,
            store_url: item.store_url || item.storeUrl,
            tags:
              Array.isArray(item.tags) && item.tags.length > 0
                ? item.tags
                : parsed.tags.length > 0
                  ? parsed.tags
                  : builtin?.tags || slug.split(/[-_]/).filter(Boolean),
            version: String(item.version || builtin?.version || "1.0.0"),
            content:
              content || `# ${item.name || parsed.name || toTitleCase(slug)}`,
            content_url: contentUrl,
            prerequisites: Array.isArray(item.prerequisites)
              ? item.prerequisites
              : builtin?.prerequisites,
            compatibility: Array.isArray(item.compatibility)
              ? item.compatibility
              : builtin?.compatibility || ["claude", "cursor"],
            weekly_installs: item.weekly_installs || item.weeklyInstalls,
            github_stars: item.github_stars || item.githubStars,
            installed_on: item.installed_on || item.installedOn,
            security_audits: item.security_audits || item.securityAudits,
          } satisfies RegistrySkill;
        }),
      );

      const nestedStoreRefs = [
        ...(Array.isArray(data.marketplaces) ? data.marketplaces : []),
        ...(Array.isArray(data.sources) ? data.sources : []),
        ...(Array.isArray(data.registries) ? data.registries : []),
      ]
        .map((entry) => resolveMarketplaceReference(entry))
        .filter(Boolean)
        .map((entry: string) => resolveUrl(resolvedUrl, entry))
        .filter((entry: string | null): entry is string => Boolean(entry));

      const nestedSkills = await Promise.all(
        nestedStoreRefs.map((entry) =>
          loadMarketplaceStore(entry, visited, depth + 1),
        ),
      );

      return dedupeRegistrySkills([
        ...mappedSkills.filter(isDefined),
        ...nestedSkills.flat(),
      ]);
    },
    [registrySkills],
  );

  const loadLocalDirectoryStore = useCallback(
    async (dirPath: string): Promise<RegistrySkill[]> => {
      const scannedSkills = await scanLocalPreview([dirPath]);
      const mapped = scannedSkills.map((skill) => ({
        slug: slugify(skill.name),
        name: skill.name,
        description: skill.description || `${skill.name} skill`,
        category: inferCategory(skill.name, skill.description || ""),
        author: skill.author || "Local",
        source_url: skill.localPath || dirPath,
        tags: skill.tags?.length
          ? skill.tags
          : slugify(skill.name).split("-").filter(Boolean),
        version: skill.version || "1.0.0",
        content: skill.instructions,
        content_url: skill.filePath,
        compatibility: skill.platforms,
      }));
      // Deduplicate by slug, consistent with other store loaders
      return dedupeRegistrySkills(mapped);
    },
    [scanLocalPreview],
  );

  const loadSkillsShHtmlFallback = useCallback(async (): Promise<RegistrySkill[]> => {
    const query = storeSearchQuery.trim();
    let entries: SkillsShLeaderboardEntry[] = [];

    if (query.length >= 2) {
      const raw = await window.api.skill.fetchRemoteContent(
        `${SKILLS_SH_BASE_URL}/api/search?q=${encodeURIComponent(query)}&limit=${MAX_SKILLS_SH_SKILLS}&offset=0`,
      );
      const data = parseJson<LegacySkillsShSearchResponse>(raw, {});
      entries = (data.skills || [])
        .map((skill) => {
          const source = skill.source || "";
          const sourceParts = source.split("/").filter(Boolean);
          const owner = sourceParts[0];
          const repo =
            sourceParts.length > 1 ? sourceParts.slice(1).join("/") : "";
          const skillName = skill.skillId || skill.name || "";
          if (!owner || !skillName) {
            return null;
          }
          return {
            owner,
            repo,
            skillName,
            detailPath: `/${source}/${skillName}`,
            detailUrl: `${SKILLS_SH_BASE_URL}/${source}/${skillName}`,
            weeklyInstalls:
              typeof skill.installs === "number" ? String(skill.installs) : undefined,
          };
        })
        .filter(isDefined);
    } else {
      const leaderboardHtml =
        await window.api.skill.fetchRemoteContent(SKILLS_SH_BASE_URL);
      entries = parseSkillsShLeaderboard(leaderboardHtml, {
        limit: MAX_SKILLS_SH_SKILLS,
      });
    }

    return dedupeRegistrySkills(entries.map(mapSkillsShEntryToRegistrySkill));
  }, [storeSearchQuery]);

  const loadSkillsShStore = useCallback(async (): Promise<RegistrySkill[]> => {
    setSkillsShFallbackNotice(null);
    const query = storeSearchQuery.trim();
    try {
      if (typeof window.api.skill.loadSkillsShStore === "function") {
        const response = await window.api.skill.loadSkillsShStore({
          apiKey: skillsShApiKey,
          view: skillsShView,
          query: query.length >= 2 ? query : undefined,
          limit: MAX_SKILLS_SH_SKILLS,
          includeDuplicates: showHiddenSkillsShItems,
          includeIncomplete: showHiddenSkillsShItems,
        });

        if (response.mode === "api") {
          skillsShCacheExpiresAtRef.current =
            response.cacheMaxAgeSeconds !== undefined
              ? Date.now() + response.cacheMaxAgeSeconds * 1000
              : undefined;
          return dedupeRegistrySkills(response.skills);
        }

        setSkillsShFallbackNotice(
          response.retryAfterSeconds
            ? t("skill.skillsShFallbackRetryAfter", {
                seconds: response.retryAfterSeconds,
                defaultValue:
                  "skills.sh API is rate limited. Showing degraded results; retry after {{seconds}} seconds.",
              })
            : t("skill.skillsShFallbackMode", {
                reason: response.fallbackReason || "API unavailable",
                defaultValue:
                  "skills.sh API is unavailable. Showing degraded results from the public catalog. Some details, audits, or files may be missing.",
              }),
        );
      }
    } catch (error) {
      console.warn("skills.sh API load failed, falling back to public catalog:", error);
      setSkillsShFallbackNotice(
        t(
          "skill.skillsShFallbackMode",
          "skills.sh API is unavailable. Showing degraded results from the public catalog. Some details, audits, or files may be missing.",
        ),
      );
    }

    return loadSkillsShHtmlFallback();
  }, [
    loadSkillsShHtmlFallback,
    showHiddenSkillsShItems,
    skillsShApiKey,
    skillsShView,
    storeSearchQuery,
    t,
  ]);

  const loadStoreSource = useCallback(
    async (sourceId: string, forceRefresh = false) => {
      if (typeof setRemoteStoreEntry !== "function") {
        return;
      }

      if (sourceId === "official" || sourceId === "new-custom") {
        return;
      }

      const source = BUILTIN_REMOTE_STORES[sourceId] ?? customStoreSources.find((item) => item.id === sourceId);

      if (!source) return;
      if ("enabled" in source && !source.enabled) return;

      const loadKey = `${sourceId}:${forceRefresh ? "force" : "cached"}`;
      const inflightLoad = inflightStoreLoadsRef.current.get(loadKey);
      if (inflightLoad) {
        await inflightLoad;
        return;
      }

      const cachedEntry = remoteStoreEntriesRef.current[sourceId];
      const cacheExpired =
        cachedEntry?.expiresAt !== undefined &&
        cachedEntry.expiresAt <= Date.now();
      const requestQuery =
        source.type === "skills-sh" && storeSearchQuery.trim().length >= 2
          ? storeSearchQuery.trim()
          : "";
      const queryCacheMiss =
        source.type === "skills-sh" && (cachedEntry?.query || "") !== requestQuery;
      // Most store caches are reused until manual refresh. The skills.sh API can
      // provide Cache-Control, so that source may expire automatically.
      const hasCachedSkills = cachedEntry && cachedEntry.skills.length > 0;
      const hasCachedFailure = Boolean(cachedEntry?.error);
      // Failed loads should not auto-retry on every rerender.
      // They may be retried via manual refresh or scheduled force refresh.
      if (!forceRefresh && hasCachedFailure && !queryCacheMiss) return;
      if (!forceRefresh && hasCachedSkills && !cacheExpired && !queryCacheMiss) return;

      const loadPromise = (async () => {
        setLoadingSourceId(sourceId);
        try {
          let skillsForSource: RegistrySkill[] = [];
          const partialFailures: SkillFetchFailure[] = [];
          if (source.type === "git-repo") {
            const defaultCompatibility =
              sourceId === "hermes-agent" ||
              sourceId === "hermes-agent-optional"
                ? ["hermes"]
                : undefined;
            skillsForSource = isLikelyLocalSource(source.url)
              ? await loadLocalDirectoryStore(source.url)
              : await loadGitHubRepoSkills(
                  source.url,
                  partialFailures,
                  defaultCompatibility,
                );
          } else if (source.type === "skills-sh") {
            skillsForSource = await loadSkillsShStore();
          } else if (source.type === "marketplace-json") {
            skillsForSource = await loadMarketplaceStore(source.url);
          } else if (source.type === "local-dir") {
            skillsForSource = await loadLocalDirectoryStore(source.url);
          }

          // Surface partial failures so the user understands why the count is
          // lower than expected.  Successful skills still render alongside the
          // banner, and the existing Retry button re-fetches the whole batch.
          const partialFailureMessage =
            partialFailures.length > 0
              ? t(
                  "skill.remoteStorePartialFailure",
                  "{{count}} skill file(s) failed to download. Click refresh to retry.",
                  { count: partialFailures.length },
                )
              : null;

          setRemoteStoreEntry(sourceId, {
            loadedAt: Date.now(),
            expiresAt:
              source.type === "skills-sh"
                ? skillsShCacheExpiresAtRef.current
                : undefined,
            error: partialFailureMessage,
            query: source.type === "skills-sh" ? requestQuery : undefined,
            skills: skillsForSource,
          });
        } catch (error) {
          console.error(`Failed to load remote store ${sourceId}:`, error);
          // Do NOT update loadedAt on failure — keeps cache stale so next visit retries automatically.
          // Preserve previously-cached skills (if any) so the UI isn't wiped.
          setRemoteStoreEntry(sourceId, {
            loadedAt: cachedEntry?.loadedAt || 0,
            error: getRemoteStoreErrorMessage(error, t),
            query: source.type === "skills-sh" ? requestQuery : cachedEntry?.query,
            skills: cachedEntry?.skills || [],
          });
        } finally {
          inflightStoreLoadsRef.current.delete(loadKey);
          setLoadingSourceId((current) =>
            current === sourceId ? null : current,
          );
        }
      })();

      inflightStoreLoadsRef.current.set(loadKey, loadPromise);
      await loadPromise;
    },
    [
      customStoreSources,
      loadGitHubRepoSkills,
      loadLocalDirectoryStore,
      loadMarketplaceStore,
      loadSkillsShStore,
      setRemoteStoreEntry,
      t,
    ],
  );

  useEffect(() => {
    loadStoreSourceRef.current = loadStoreSource;
  }, [loadStoreSource]);

  useEffect(() => {
    if (!isSelectedSourceRemote) return;
    void loadStoreSource(selectedStoreSourceId);
  }, [isSelectedSourceRemote, loadStoreSource, selectedStoreSourceId]);

  useEffect(() => {
    if (selectedStoreSourceId !== "community") return;
    const timeoutId = window.setTimeout(() => {
      void loadStoreSource("community", true);
    }, 350);
    return () => window.clearTimeout(timeoutId);
  }, [
    loadStoreSource,
    selectedStoreSourceId,
    showHiddenSkillsShItems,
    skillsShApiKey,
    skillsShView,
    storeSearchQuery,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let disposed = false;
    let intervalId: number | undefined;

    const enabledCustomSourceIds = customStoreSources
      .filter((source) => source.enabled)
      .map((source) => source.id);
    const remoteSourceIds = [
      "claude-code",
      "openai-codex",
      "hermes-agent",
      "hermes-agent-optional",
      "community",
      ...enabledCustomSourceIds,
    ];

    const refreshStoreSources = async (forceRefresh: boolean, intervalMs: number | null) => {
      if (typeof loadRegistryRef.current === "function") {
        await loadRegistryRef.current();
      }

      await Promise.allSettled(
        remoteSourceIds.map((sourceId) => {
          const cachedEntry = remoteStoreEntriesRef.current[sourceId];
          const nextForceRefresh =
            forceRefresh &&
            shouldForceRefreshSource(cachedEntry?.loadedAt, intervalMs);
          return loadStoreSourceRef.current(sourceId, nextForceRefresh);
        }),
      );
    };

    const configure = async () => {
      const settings = (await window.api?.settings?.get?.()) as
        | Settings
        | undefined;
      if (disposed) {
        return;
      }

      const deviceSettings = settings?.device;
      const autoSyncEnabled = deviceSettings?.storeAutoSync ?? true;
      const intervalMs = cadenceToMs(
        deviceSettings?.storeSyncCadence ?? "1d",
      );

      if (!autoSyncEnabled) {
        return;
      }

      if (!intervalMs) {
        return;
      }

      intervalId = window.setInterval(() => {
        void refreshStoreSources(true, intervalMs);
      }, intervalMs);
    };

    void configure();

    return () => {
      disposed = true;
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };
  }, [customStoreSources, customStoreSourcesSyncKey]);

  const sourceRegistrySkills = useMemo(() => {
    const query = storeSearchQuery.trim().toLowerCase();
    const searchableSourceIds = new Set(searchableRemoteSourceIds);
    const remoteSkills = Object.entries(remoteStoreEntries)
      .filter(([sourceId]) => searchableSourceIds.has(sourceId))
      .flatMap(([, entry]) => entry.skills);
    const shouldSearchAcrossSources =
      Boolean(query) && selectedStoreSourceId !== "new-custom";
    let baseSkills: RegistrySkill[] = [];
    if (shouldSearchAcrossSources) {
      baseSkills = dedupeRegistrySkills([...registrySkills, ...remoteSkills]);
    } else if (selectedStoreSourceId === "official") {
      baseSkills = registrySkills;
    } else {
      baseSkills = selectedRemoteEntry?.skills || [];
    }

    if (storeCategory !== "all") {
      baseSkills = baseSkills.filter(
        (skill) => skill.category === storeCategory,
      );
    }

    const communityQueryMatches =
      query.length >= 2 &&
      (remoteStoreEntries.community?.query || "").toLowerCase() === query;
    const communityResultSlugs = new Set(
      remoteStoreEntries.community?.skills.map((skill) => skill.slug) ?? [],
    );
    if (query) {
      baseSkills = baseSkills.filter(
        (skill) => {
          const insightText = buildSkillInsightSearchText(
            getSkillInsight(skill, insightLanguage),
          );
          const fromCurrentCommunitySearch =
            communityQueryMatches && communityResultSlugs.has(skill.slug);
          return (
            fromCurrentCommunitySearch ||
            skill.name.toLowerCase().includes(query) ||
            skill.description.toLowerCase().includes(query) ||
            skill.tags.some((tag) => tag.toLowerCase().includes(query)) ||
            insightText.toLowerCase().includes(query)
          );
        },
      );
    }

    return baseSkills;
  }, [
    getSkillInsight,
    insightLanguage,
    registrySkills,
    remoteStoreEntries,
    searchableRemoteSourceIds,
    selectedRemoteEntry?.skills,
    selectedStoreSourceId,
    skillInsightCache,
    storeCategory,
    storeSearchQuery,
  ]);

  const selectedDetailSkill = useMemo(() => {
    if (!selectedRegistrySlug) return null;
    return (
      sourceRegistrySkills.find(
        (skill) => skill.slug === selectedRegistrySlug,
      ) || null
    );
  }, [selectedRegistrySlug, sourceRegistrySkills]);

  const isSkillInstalled = useCallback(
    (regSkill: RegistrySkill): boolean => {
      if (installedSlugs.includes(regSkill.slug)) return true;
      if (regSkill.source_id && installedSlugs.includes(regSkill.source_id)) {
        return true;
      }
      // Fall back to name-based matching for locally-imported skills
      // that have no registry_slug
      const installName = (
        regSkill.install_name || regSkill.slug
      ).toLowerCase();
      return installedNamesLower.has(installName);
    },
    [installedSlugs, installedNamesLower],
  );

  const hasPotentialUpdate = useCallback(
    (regSkill: RegistrySkill): boolean => {
      const installedSkill = findInstalledRegistrySkill(skills, regSkill);
      if (!installedSkill) return false;
      if (installedSkill.installed_content_hash) {
        return installedSkill.installed_version !== regSkill.version;
      }
      return Boolean(installedSkill.version && installedSkill.version !== regSkill.version);
    },
    [skills],
  );

  const installed = useMemo(
    () => sourceRegistrySkills.filter(isSkillInstalled),
    [isSkillInstalled, sourceRegistrySkills],
  );

  const recommended = useMemo(
    () => sourceRegistrySkills.filter((skill) => !isSkillInstalled(skill)),
    [isSkillInstalled, sourceRegistrySkills],
  );
  const shouldShowOnlineSearch = shouldTriggerSkillOnlineSearch(storeSearchQuery);
  const isOnlineSearchLoading = loadingSourceId === "community";

  const handleFindOnlineSkills = () => {
    if (!shouldShowOnlineSearch) return;
    void loadStoreSource("community", true);
  };

  const skillInsightQueueKey = useMemo(
    () =>
      sourceRegistrySkills
        .map((skill) =>
          [
            skill.slug,
            skill.source_id || "",
            skill.remote_hash || "",
            skill.version,
            skill.content?.length || 0,
            skill.files?.length || 0,
          ].join(":"),
        )
        .join("|"),
    [sourceRegistrySkills],
  );

  useEffect(() => {
    if (selectedStoreSourceId === "new-custom") return;
    if (!skillInsightAutoGenerateEnabled) return;
    if (!isSkillInsightModelConfigured) return;

    let cancelled = false;
    let nextIndex = 0;
    const timerId = window.setTimeout(() => {
      const queue = sourceRegistrySkills.filter((skill) => {
        const entry = useSkillStore
          .getState()
          .getSkillInsight(skill, insightLanguage);
        return !entry;
      });

      const runWorker = async () => {
        while (!cancelled && nextIndex < queue.length) {
          const current = queue[nextIndex];
          nextIndex += 1;
          try {
            await generateSkillInsight(current, insightLanguage);
          } catch (error) {
            console.warn(
              `Failed to generate skill insight for "${current.slug}":`,
              error,
            );
          }
        }
      };

      void Promise.all([runWorker(), runWorker()]);
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [
    generateSkillInsight,
    insightLanguage,
    isSkillInsightModelConfigured,
    selectedStoreSourceId,
    skillInsightAutoGenerateEnabled,
    skillInsightQueueKey,
    sourceRegistrySkills,
  ]);

  const handleEnableSkillInsight = () => {
    if (!skillInsightAutoGenerateConfirmed) {
      const shouldEnable = window.confirm(
        `${t(
          "skill.insightConsentTitle",
          "Enable AI skill insights before importing?",
        )}\n\n${t(
          "skill.insightConsentDesc",
          "PromptHub can send full SKILL.md content for visible store items to your configured AI model to generate import guidance. This may consume tokens.",
        )}`,
      );

      if (!shouldEnable) return;
    }

    setSkillInsightAutoGenerateConfirmed(true);
    setSkillInsightAutoGenerateEnabled(true);
  };

  const handleDisableSkillInsight = () => {
    setSkillInsightAutoGenerateEnabled(false);
  };

  const getRenderedSkillInsight = useCallback(
    (skill: RegistrySkill) => getSkillInsight(skill, insightLanguage),
    [getSkillInsight, insightLanguage, skillInsightCache],
  );

  const handleRefreshInsight = async (
    skill: RegistrySkill,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    try {
      await refreshSkillInsight(skill, insightLanguage);
      showToast(t("skill.insightRefreshed", "AI insight refreshed"), "success");
    } catch (error: unknown) {
      const message =
        error instanceof Error && error.message === "AI_NOT_CONFIGURED"
          ? t(
              "skill.insightAiNotConfigured",
              "Configure a Skill insight model in Settings > AI first.",
            )
          : getErrorMessage(error);
      showToast(message, "error");
    }
  };

  const handleQuickInstall = async (
    skill: RegistrySkill,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    setInstallingSlug(skill.slug);
    try {
      if (hasHighRiskStoreAudit(skill)) {
        selectRegistrySkill(skill.slug);
        showToast(
          t(
            "skill.skillsShAuditReviewRequired",
            "skills.sh audit flagged this skill. Open the detail view to review and confirm before importing.",
          ),
          "warning",
        );
        return;
      }
      const insightEntry = useSkillStore
        .getState()
        .getSkillInsight(skill, insightLanguage);
      const insight = insightEntry?.insight;
      if (
        insight &&
        insight.verdict !== "recommended" &&
        typeof window.confirm === "function"
      ) {
        const confirmed = window.confirm(
          t("skill.insightInstallConfirm", {
            verdict: t(`skill.insightVerdict.${insight.verdict}`),
            reason: insight.verdictReason,
            defaultValue:
              "{{verdict}}: {{reason}}\n\nImport this skill anyway?",
          }),
        );
        if (!confirmed) {
          return;
        }
      }
      if (autoScanBeforeInstall) {
        const report = await window.api.skill.scanSafety({
          name: skill.name,
          content: buildStoreSkillSafetyContent(skill),
          sourceUrl: skill.source_url,
          contentUrl: skill.content_url,
          securityAudits: skill.security_audits,
          aiConfig: getSafetyScanAIConfig(aiModels),
        });
        const shouldBlockInstall =
          report.scanMethod === "ai" &&
          (report.level === "blocked" || report.level === "high-risk");
        if (shouldBlockInstall) {
          showToast(
            t(
              "skill.safetyScanBlockedInstall",
              "This skill was flagged as high risk. Review the safety report before adding it.",
            ),
            "error",
          );
          return;
        }
        if (
          report.scanMethod === "static" &&
          (report.level === "blocked" || report.level === "high-risk")
        ) {
          showToast(
            t(
              "skill.safetyScanStaticReviewOnly",
              "Static scan found potentially risky patterns. Review the safety report before installing, but installation is not blocked without AI confirmation.",
            ),
            "warning",
          );
        }
      }
      const result = await installRegistrySkill(skill);
      if (result) {
        showToast(`${t("skill.addedToLibrary")}: ${skill.name}`, "success");
      }
    } catch (error: unknown) {
      showToast(getErrorMessage(error) || t("skill.updateFailed"), "error");
    } finally {
      setTimeout(() => setInstallingSlug(null), 500);
    }
  };

  const handleAddSource = async () => {
    if (!sourceName.trim() || !sourceUrl.trim()) {
      showToast(t("skill.storeSourceRequired"), "error");
      return;
    }

    try {
      addCustomStoreSource(sourceName, sourceUrl, sourceType);
      const createdId = useSkillStore.getState().selectedStoreSourceId;
      setSourceName("");
      setSourceUrl("");
      setSourceType("marketplace-json");
      showToast(t("skill.storeSourceAdded"), "success");
      if (createdId) {
        void loadStoreSource(createdId, true);
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error &&
        error.message === "STORE_SOURCE_HTTPS_REQUIRED"
          ? t("skill.storeSourceHttpsRequired", "Store URL must use HTTPS")
          : t("skill.storeSourceInvalidUrl", "Invalid store URL format");
      showToast(message, "error");
    }
  };

  const categories: { key: SkillCategory | "all"; label: string }[] = [
    { key: "all", label: t("common.showAll", "All") },
    ...Object.entries(SKILL_CATEGORIES).map(([key, value]) => ({
      key: key as SkillCategory,
      label: isZh ? value.label : value.labelEn,
    })),
  ];

  const sourceMeta = useMemo(() => {
    if (selectedStoreSourceId === "community") {
      return {
        title: t("skill.communityStore", "Community Store"),
        hint: t(
          "skill.communityStoreHint",
          "This area will aggregate third-party community skill sources. The entry is ready for connecting a community registry next.",
        ),
        count: sourceRegistrySkills.length,
        showCatalog: true,
        canRefresh: true,
      };
    }

    if (selectedStoreSourceId === "claude-code") {
      return {
        title: t("skill.claudeCodeStore", "Claude Code Store"),
        hint: t(
          "skill.claudeCodeStoreHint",
          "Built-in Claude Code source with first-class support for the official skills repo and common marketplace.json indexes.",
        ),
        count: sourceRegistrySkills.length,
        showCatalog: true,
        canRefresh: true,
      };
    }

    if (selectedStoreSourceId === "openai-codex") {
      return {
        title: t("skill.openaiCodexStore", "OpenAI Codex Store"),
        hint: t(
          "skill.openaiCodexStoreHint",
          "Built-in OpenAI Codex source with first-class support for the curated openai/skills catalog.",
        ),
        count: sourceRegistrySkills.length,
        showCatalog: true,
        canRefresh: true,
      };
    }

    if (selectedStoreSourceId === "hermes-agent") {
      return {
        title: t("skill.hermesAgentStore", "Hermes Store"),
        hint: t(
          "skill.hermesAgentStoreHint",
          "Built-in Hermes Agent source for bundled skills that are active in a standard Hermes install.",
        ),
        count: sourceRegistrySkills.length,
        showCatalog: true,
        canRefresh: true,
      };
    }

    if (selectedStoreSourceId === "hermes-agent-optional") {
      return {
        title: t("skill.hermesAgentOptionalStore", "Hermes Optional Store"),
        hint: t(
          "skill.hermesAgentOptionalStoreHint",
          "Official Hermes optional skills that ship with the repo but are not activated by default.",
        ),
        count: sourceRegistrySkills.length,
        showCatalog: true,
        canRefresh: true,
      };
    }

    if (selectedStoreSourceId === "new-custom") {
      return {
        title: t("skill.addStoreSource", "Add Store"),
        hint: t(
          "skill.customStoresHint",
          "Add your own store endpoints here. A later step can connect remote manifests or registries.",
        ),
        count: customStoreSources.length,
        showCatalog: false,
        canRefresh: false,
      };
    }

    if (selectedCustomSource) {
      return {
        title: selectedCustomSource.name,
        hint: selectedCustomSource.url,
        count: sourceRegistrySkills.length,
        showCatalog: true,
        canRefresh: true,
      };
    }

    return {
      title: t("skill.officialStore", "Official Store"),
      hint: t(
        "skill.storeHint",
        "Discover and import skills from official, community, and custom stores.",
      ),
      count: sourceRegistrySkills.length,
      showCatalog: true,
      canRefresh: false,
    };
  }, [
    customStoreSources.length,
    selectedCustomSource,
    selectedStoreSourceId,
    sourceRegistrySkills.length,
    t,
  ]);

  const currentRemoteError = selectedRemoteEntry?.error || null;
  const shouldShowInitialLoading =
    isSelectedSourceRemote &&
    loadingSourceId === selectedStoreSourceId &&
    (!selectedRemoteEntry || selectedRemoteEntry.skills.length === 0);
  const isRefreshingCachedSource =
    isSelectedSourceRemote &&
    loadingSourceId === selectedStoreSourceId &&
    Boolean(selectedRemoteEntry?.skills.length);

  return (
    <div className="flex-1 flex flex-col h-full bg-background overflow-hidden">
      <div className="px-6 py-4 border-b border-border shrink-0 bg-background/50 backdrop-blur-sm z-10 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-lg font-semibold">{sourceMeta.title}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {sourceMeta.hint}
            </p>
          </div>
          <span className="text-[11px] font-medium text-muted-foreground bg-accent/50 px-2 py-0.5 rounded-full border border-white/5">
            {sourceMeta.count} {t("skill.skillsCount", "skills")}
          </span>
          {isRefreshingCachedSource && (
            <span className="text-[11px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full border border-border inline-flex items-center gap-1">
              <Loader2Icon className="w-3 h-3 animate-spin" />
              {t("common.refreshing", "Refreshing")}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {sourceMeta.canRefresh && (
            <button
              onClick={() => void loadStoreSource(selectedStoreSourceId, true)}
              disabled={loadingSourceId === selectedStoreSourceId}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40"
              title={t("common.refresh", "Refresh")}
            >
              <RefreshCwIcon
                className={`w-4 h-4 ${loadingSourceId === selectedStoreSourceId ? "animate-spin" : ""}`}
              />
            </button>
          )}
        </div>
      </div>

      <div className="px-6 py-3 border-b border-border bg-background/30 space-y-3">
        {sourceMeta.showCatalog && (
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
            {selectedStoreSourceId === "community" &&
              ([
                ["trending", t("skill.skillsShViewTrending", "Trending")],
                ["all-time", t("skill.skillsShViewAllTime", "All-time")],
                ["hot", t("skill.skillsShViewHot", "Hot")],
                ["curated", t("skill.skillsShViewCurated", "Official")],
              ] as Array<[SkillsShCatalogView, string]>).map(([view, label]) => (
                <button
                  key={view}
                  onClick={() => setSkillsShView(view)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                    skillsShView === view
                      ? "bg-primary text-white shadow-sm"
                      : "bg-muted hover:bg-muted/80 text-muted-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            {categories.map((cat) => (
              <button
                key={cat.key}
                onClick={() => setStoreCategory(cat.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  storeCategory === cat.key
                    ? "bg-primary text-white shadow-sm"
                    : "bg-muted hover:bg-muted/80 text-muted-foreground"
                }`}
              >
                {CATEGORY_ICONS[cat.key]}
                {cat.label}
              </button>
            ))}
            {selectedStoreSourceId === "community" && (
              <button
                onClick={() => setShowHiddenSkillsShItems((value) => !value)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  showHiddenSkillsShItems
                    ? "bg-primary text-white shadow-sm"
                    : "bg-muted hover:bg-muted/80 text-muted-foreground"
                }`}
              >
                {t("skill.skillsShShowHidden", "Show filtered")}
              </button>
            )}
          </div>
        )}

        {selectedStoreSourceId === "community" && (
          <div className="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
            <InfoIcon className="w-3.5 h-3.5" />
            <span>
              {t(
                "skill.skillsShPrivacyHint",
                "Searches in this source are sent to skills.sh. PromptHub does not save search terms.",
              )}
            </span>
          </div>
        )}

        {selectedStoreSourceId === "new-custom" && (
          <SkillStoreSourceForm
            handleAddSource={handleAddSource}
            setSourceName={setSourceName}
            setSourceType={setSourceType}
            setSourceUrl={setSourceUrl}
            sourceName={sourceName}
            sourceType={sourceType}
            sourceUrl={sourceUrl}
            t={t}
            typeOptions={CUSTOM_SOURCE_TYPE_OPTIONS}
          />
        )}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide p-6 space-y-8">
        {shouldShowInitialLoading && (
          <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground inline-flex items-center gap-2">
            <Loader2Icon className="w-4 h-4 animate-spin" />
            {selectedStoreSourceId === "claude-code"
              ? t(
                  "skill.loadingRemoteStore",
                  "Loading Claude Code skills from the remote source...",
                )
              : selectedStoreSourceId === "openai-codex"
                ? t(
                    "skill.loadingOpenAiStore",
                    "Loading OpenAI Codex skills from the remote source...",
                  )
              : selectedStoreSourceId === "hermes-agent"
                ? t(
                    "skill.loadingHermesAgentStore",
                    "Loading Hermes bundled skills from the remote source...",
                  )
              : selectedStoreSourceId === "hermes-agent-optional"
                ? t(
                    "skill.loadingHermesAgentOptionalStore",
                    "Loading Hermes optional skills from the remote source...",
                  )
              : selectedStoreSourceId === "community"
                ? t(
                    "skill.loadingCommunityStore",
                    "Loading skills.sh community skill list...",
                  )
                : t(
                    "skill.loadingCustomStore",
                    "Loading custom store content...",
                  )}
          </div>
        )}

        {currentRemoteError && !shouldShowInitialLoading && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive space-y-2">
            <div>
              <span className="font-medium">
                {t(
                  "skill.remoteStoreLoadFailed",
                  "Failed to load remote store",
                )}
                :{" "}
              </span>
              {currentRemoteError}
            </div>
            <button
              onClick={() => void loadStoreSource(selectedStoreSourceId, true)}
              disabled={loadingSourceId === selectedStoreSourceId}
              className="text-xs px-3 py-1.5 rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive font-medium transition-colors disabled:opacity-40"
            >
              {t("skill.remoteStoreRetry", "Retry")}
            </button>
          </div>
        )}

        {selectedStoreSourceId === "community" &&
          skillsShFallbackNotice &&
          !shouldShowInitialLoading && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-300 space-y-2">
              <div>{skillsShFallbackNotice}</div>
              <div className="text-xs">
                {t(
                  "skill.skillsShApiKeyCta",
                  "Add a skills.sh API Key in Settings > Skill to enable full metadata, file snapshots, and audits.",
                )}
              </div>
            </div>
          )}

        {sourceMeta.showCatalog &&
          !skillInsightAutoGenerateConfirmed &&
          !shouldShowInitialLoading && (
            <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4 text-sm text-foreground space-y-3">
              <div>
                <div className="font-medium">
                  {t(
                    "skill.insightConsentTitle",
                    "Enable AI skill insights before importing?",
                  )}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {t(
                    "skill.insightConsentDesc",
                    "PromptHub can send full SKILL.md content for visible store items to your configured AI model to generate import guidance. This may consume tokens.",
                  )}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleEnableSkillInsight}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary/90"
                >
                  {t("skill.enableInsight", "Enable AI insights")}
                </button>
                <button
                  onClick={() => setSkillInsightAutoGenerateConfirmed(true)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
                >
                  {t("common.cancel", "Cancel")}
                </button>
              </div>
            </div>
          )}

        {sourceMeta.showCatalog &&
          skillInsightAutoGenerateEnabled &&
          !isSkillInsightModelConfigured &&
          !shouldShowInitialLoading && (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive space-y-2">
              <div className="font-medium">
                {t(
                  "skill.insightAiNotConfiguredTitle",
                  "AI skill insights are enabled but no model is configured",
                )}
              </div>
              <p className="text-xs leading-relaxed">
                {t(
                  "skill.insightAiNotConfigured",
                  "Configure a Skill insight model in Settings > AI first.",
                )}
              </p>
              <button
                onClick={handleDisableSkillInsight}
                className="rounded-lg bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20"
              >
                {t("skill.disableInsight", "Disable AI insights")}
              </button>
            </div>
          )}

        {sourceMeta.showCatalog &&
          shouldShowOnlineSearch &&
          !shouldShowInitialLoading && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs">
              <div className="min-w-0">
                <div className="font-medium text-foreground">
                  {t("skill.searchOnlineTitle", "Need more matches?")}
                </div>
                <div className="mt-0.5 text-muted-foreground">
                  {t(
                    "skill.searchOnlineDesc",
                    "Current results use loaded sources and cached AI insights. Online search queries skills.sh without calling AI.",
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={handleFindOnlineSkills}
                disabled={isOnlineSearchLoading}
                className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-border bg-background px-3 font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
              >
                {isOnlineSearchLoading ? (
                  <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <GlobeIcon className="h-3.5 w-3.5" />
                )}
                {isOnlineSearchLoading
                  ? t("skill.searchOnlineLoading", "Searching...")
                  : t("skill.searchOnlineButton", "Find online")}
              </button>
            </div>
          )}

        {sourceMeta.showCatalog && (
          <>
            {installed.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
                    {t("skill.importedSection", "Imported")}
                  </h3>
                  <span className="text-[10px] bg-green-500/10 text-green-500 px-2 py-0.5 rounded-full font-bold">
                    {installed.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {installed.map((skill, index) => (
                    <SkillStoreCard
                      key={skill.slug}
                      skill={skill}
                      isInstalled={true}
                      hasUpdate={hasPotentialUpdate(skill)}
                      index={index}
                      insightEntry={getRenderedSkillInsight(skill)}
                      insightEnabled={skillInsightAutoGenerateEnabled}
                      onRefreshInsight={handleRefreshInsight}
                      onClick={() => selectRegistrySkill(skill.slug)}
                    />
                  ))}
                </div>
              </section>
            )}

            {recommended.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
                    {t("skill.availableSection", "Available")}
                  </h3>
                  <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-bold">
                    {recommended.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {recommended.map((skill, index) => (
                    <SkillStoreCard
                      key={skill.slug}
                      skill={skill}
                      isInstalled={false}
                      index={index}
                      installingSlug={installingSlug}
                      insightEntry={getRenderedSkillInsight(skill)}
                      insightEnabled={skillInsightAutoGenerateEnabled}
                      onQuickInstall={handleQuickInstall}
                      onRefreshInsight={handleRefreshInsight}
                      onClick={() => selectRegistrySkill(skill.slug)}
                    />
                  ))}
                </div>
              </section>
            )}

            {installed.length === 0 &&
              recommended.length === 0 &&
              !shouldShowInitialLoading && (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                  <SearchIcon className="w-12 h-12 opacity-20 mb-4" />
                  <h3 className="text-lg font-semibold text-foreground mb-1">
                    {t("skill.noResults", "No skills found")}
                  </h3>
                  <p className="text-sm opacity-70">
                    {t(
                      "skill.tryDifferentSearch",
                      "Try a different search or category",
                    )}
                  </p>
                </div>
              )}
          </>
        )}

        {selectedStoreSourceId === "claude-code" && (
          <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-foreground">
              <GlobeIcon className="w-5 h-5 text-primary" />
              <h3 className="text-base font-semibold">
                {t("skill.claudeCodeStore", "Claude Code Store")}
              </h3>
            </div>
            <p className="text-sm text-muted-foreground leading-7">
              {t(
                "skill.claudeCodeStoreDetail",
                "This built-in source is meant for the Claude Code ecosystem. It is designed to work first with the official skills repository and marketplace.json indexes, and can later become a browsable remote store.",
              )}
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <div className="text-sm font-medium text-foreground mb-1">
                  {t("skill.supportedFormat", "Supported Formats")}
                </div>
                <div className="text-xs text-muted-foreground leading-6">
                  {t(
                    "skill.formatDirectoryRepo",
                    "`SKILL.md` directory-style repository",
                  )}
                  <br />
                  {t(
                    "skill.formatIndexStore",
                    "`marketplace.json` index-style store",
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <div className="text-sm font-medium text-foreground mb-1">
                  {t("skill.exampleSources", "Built-in Reference Sources")}
                </div>
                <div className="text-xs text-muted-foreground leading-6 break-all">
                  https://github.com/anthropics/skills
                  <br />
                  https://raw.githubusercontent.com/docker/claude-code-plugin-manager/main/marketplace.json
                </div>
              </div>
            </div>
          </div>
        )}

        {selectedStoreSourceId === "openai-codex" && (
          <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-foreground">
              <GlobeIcon className="w-5 h-5 text-primary" />
              <h3 className="text-base font-semibold">
                {t("skill.openaiCodexStore", "OpenAI Codex Store")}
              </h3>
            </div>
            <p className="text-sm text-muted-foreground leading-7">
              {t(
                "skill.openaiCodexStoreDetail",
                "This built-in source is meant for the OpenAI Codex ecosystem. It focuses on the curated openai/skills catalog and keeps the install flow compatible with directory-style SKILL.md repositories.",
              )}
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <div className="text-sm font-medium text-foreground mb-1">
                  {t("skill.supportedFormat", "Supported Formats")}
                </div>
                <div className="text-xs text-muted-foreground leading-6">
                  {t(
                    "skill.formatDirectoryRepo",
                    "`SKILL.md` directory-style repository",
                  )}
                  <br />
                  {t(
                    "skill.formatCuratedSubdir",
                    "Curated subdirectory inside a larger Git repository",
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <div className="text-sm font-medium text-foreground mb-1">
                  {t("skill.exampleSources", "Built-in Reference Sources")}
                </div>
                <div className="text-xs text-muted-foreground leading-6 break-all">
                  https://github.com/openai/skills/tree/main/skills/.curated
                </div>
              </div>
            </div>
          </div>
        )}

        {selectedStoreSourceId === "hermes-agent" && (
          <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-foreground">
              <GlobeIcon className="w-5 h-5 text-primary" />
              <h3 className="text-base font-semibold">
                {t("skill.hermesAgentStore", "Hermes Store")}
              </h3>
            </div>
            <p className="text-sm text-muted-foreground leading-7">
              {t(
                "skill.hermesAgentStoreDetail",
                "This built-in source lists bundled Hermes Agent skills from the official repository. Imported entries default to the Hermes Agent platform.",
              )}
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <div className="text-sm font-medium text-foreground mb-1">
                  {t("skill.supportedFormat", "Supported Formats")}
                </div>
                <div className="text-xs text-muted-foreground leading-6">
                  {t(
                    "skill.formatDirectoryRepo",
                    "`SKILL.md` directory-style repository",
                  )}
                  <br />
                  {t(
                    "skill.formatHermesBundledSubdir",
                    "Hermes bundled skills subdirectory",
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <div className="text-sm font-medium text-foreground mb-1">
                  {t("skill.exampleSources", "Built-in Reference Sources")}
                </div>
                <div className="text-xs text-muted-foreground leading-6 break-all">
                  https://github.com/nousresearch/hermes-agent/tree/main/skills
                </div>
              </div>
            </div>
          </div>
        )}

        {selectedStoreSourceId === "hermes-agent-optional" && (
          <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-foreground">
              <GlobeIcon className="w-5 h-5 text-primary" />
              <h3 className="text-base font-semibold">
                {t("skill.hermesAgentOptionalStore", "Hermes Optional Store")}
              </h3>
            </div>
            <p className="text-sm text-muted-foreground leading-7">
              {t(
                "skill.hermesAgentOptionalStoreDetail",
                "This built-in source lists official optional Hermes skills that ship with the repository but are not active by default.",
              )}
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <div className="text-sm font-medium text-foreground mb-1">
                  {t("skill.supportedFormat", "Supported Formats")}
                </div>
                <div className="text-xs text-muted-foreground leading-6">
                  {t(
                    "skill.formatDirectoryRepo",
                    "`SKILL.md` directory-style repository",
                  )}
                  <br />
                  {t(
                    "skill.formatHermesOptionalSubdir",
                    "Hermes optional skills subdirectory",
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <div className="text-sm font-medium text-foreground mb-1">
                  {t("skill.exampleSources", "Built-in Reference Sources")}
                </div>
                <div className="text-xs text-muted-foreground leading-6 break-all">
                  https://github.com/nousresearch/hermes-agent/tree/main/optional-skills
                </div>
              </div>
            </div>
          </div>
        )}

        {selectedStoreSourceId === "community" && (
          <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2 mb-3 text-foreground">
              <BoxesIcon className="w-5 h-5 text-primary" />
              <h3 className="text-base font-semibold">
                {t("skill.communityStore", "Community Store")}
              </h3>
            </div>
            <p className="text-sm text-muted-foreground leading-6">
              {t(
                "skill.communityStoreHint",
                "This area will aggregate third-party community skill sources. The entry is ready for connecting a community registry next.",
              )}
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <div className="text-sm font-medium text-foreground mb-1">
                  {t("skill.supportedFormat", "Supported Formats")}
                </div>
                <div className="text-xs text-muted-foreground leading-6">
                  {t(
                    "skill.formatCommunityLeaderboard",
                    "skills.sh community leaderboard",
                  )}
                  <br />
                  {t(
                    "skill.formatSkillDetailPage",
                    "skills.sh skill detail page",
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <div className="text-sm font-medium text-foreground mb-1">
                  {t("skill.exampleSources", "Built-in Reference Sources")}
                </div>
                <div className="text-xs text-muted-foreground leading-6 break-all">
                  https://skills.sh/
                </div>
              </div>
            </div>
          </div>
        )}

        {(selectedStoreSourceId === "new-custom" || selectedCustomSource) && (
          <section className="space-y-4">
            <div>
              <h3 className="text-base font-semibold text-foreground">
                {selectedCustomSource
                  ? selectedCustomSource.name
                  : t("skill.customStores", "My Stores")}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                {selectedCustomSource
                  ? selectedCustomSource.url
                  : t(
                      "skill.customStoresHint",
                      "Add your own store endpoints here. A later step can connect remote manifests or registries.",
                    )}
              </p>
            </div>

            <SkillStoreCustomSources
              customStoreSources={customStoreSources}
              loadStoreSource={loadStoreSource}
              loadingSourceId={loadingSourceId}
              remoteStoreEntries={remoteStoreEntries}
              removeCustomStoreSource={removeCustomStoreSource}
              selectStoreSource={selectStoreSource}
              selectedCustomSource={selectedCustomSource}
              selectedStoreSourceId={selectedStoreSourceId}
              t={t}
              toggleCustomStoreSource={toggleCustomStoreSource}
            />
          </section>
        )}
      </div>

      {selectedDetailSkill && (
        <SkillStoreDetail
          skill={selectedDetailSkill}
          isInstalled={isSkillInstalled(selectedDetailSkill)}
          insightEntry={getRenderedSkillInsight(selectedDetailSkill)}
          insightEnabled={skillInsightAutoGenerateEnabled}
          onRefreshInsight={(skill, event) => void handleRefreshInsight(skill, event)}
          onClose={() => selectRegistrySkill(null)}
        />
      )}
    </div>
  );
}
