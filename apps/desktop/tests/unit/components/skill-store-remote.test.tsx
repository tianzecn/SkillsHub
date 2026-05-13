import { act, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SkillStore } from "../../../src/renderer/components/skill/SkillStore";
import { SkillStoreDetail } from "../../../src/renderer/components/skill/SkillStoreDetail";
import { renderWithI18n } from "../../helpers/i18n";
import { installWindowMocks } from "../../helpers/window";
import { useSkillStore } from "../../../src/renderer/stores/skill.store";
import { useSettingsStore } from "../../../src/renderer/stores/settings.store";

const { showToast } = vi.hoisted(() => ({
  showToast: vi.fn(),
}));

vi.mock("../../../src/renderer/components/ui/Toast", () => ({
  useToast: () => ({ showToast }),
}));

const resetSkillStore = () => {
  useSkillStore.setState({
    skills: [],
    selectedSkillId: null,
    isLoading: false,
    error: null,
    viewMode: "gallery",
    searchQuery: "",
    filterType: "all",
    filterTags: [],
    deployedSkillNames: new Set<string>(),
    storeView: "store",
    registrySkills: [],
    isLoadingRegistry: false,
    storeCategory: "all",
    storeSearchQuery: "",
    selectedRegistrySlug: null,
    customStoreSources: [],
    selectedStoreSourceId: "claude-code",
    remoteStoreEntries: {},
    skillInsightCache: {},
    translationCache: {},
  });
};

describe("SkillStore remote loading", () => {
  beforeEach(() => {
    showToast.mockReset();
    localStorage.clear();
    resetSkillStore();
    useSettingsStore.setState({
      device: {
        storeAutoSync: false,
        storeSyncCadence: "1d",
      },
    } as Partial<ReturnType<typeof useSettingsStore.getState>>);
  });

  it("does not retry indefinitely after a remote fetch failure", async () => {
    const fetchRemoteContent = vi
      .fn()
      .mockRejectedValue(
        new Error("Access to internal network addresses is not allowed"),
      );

    installWindowMocks({
      api: {
        settings: {
          get: vi.fn().mockResolvedValue({
            device: {
              storeAutoSync: false,
              storeSyncCadence: "1d",
            },
          }),
        },
        skill: {
          fetchRemoteContent,
          scanLocalPreview: vi.fn().mockResolvedValue([]),
          scanSafety: vi.fn().mockResolvedValue({
            level: "safe",
            summary: "safe",
            findings: [],
            recommendedAction: "allow",
            scannedAt: Date.now(),
            checkedFileCount: 1,
            scanMethod: "static",
          }),
        },
      },
    });

    await act(async () => {
      await renderWithI18n(<SkillStore />, { language: "en" });
    });

    await waitFor(() => {
      expect(
        useSkillStore.getState().remoteStoreEntries["claude-code"]?.error,
      ).toContain("Access to internal network addresses is not allowed");
    });

    await waitFor(() => {
      const claudeCodeRepoRequests = fetchRemoteContent.mock.calls.filter(
        ([url]) =>
          url === "https://api.github.com/repos/anthropics/skills",
      );
      expect(claudeCodeRepoRequests).toHaveLength(1);
    });
  });

  it("surfaces network failures for marketplace-json custom stores", async () => {
    const fetchRemoteContent = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "Error invoking remote method 'skill:fetchRemoteContent': Error: getaddrinfo ENOTFOUND api.github.com",
        ),
      );

    installWindowMocks({
      api: {
        skill: {
          fetchRemoteContent,
          scanLocalPreview: vi.fn().mockResolvedValue([]),
        },
      },
    });

    useSkillStore.setState({
      customStoreSources: [
        {
          id: "custom-marketplace",
          name: "Custom Marketplace",
          type: "marketplace-json",
          url: "https://api.github.com/repos/example/skills",
          enabled: true,
          createdAt: Date.now(),
        },
      ],
      selectedStoreSourceId: "custom-marketplace",
    });

    await act(async () => {
      await renderWithI18n(<SkillStore />, { language: "en" });
    });

    await waitFor(() => {
      expect(
        useSkillStore.getState().remoteStoreEntries["custom-marketplace"]
          ?.error,
      ).toBe(
        "Cannot connect to the remote skill store. Check your network, DNS, proxy, or VPN settings, then try again.",
      );
    });
  });

  it("does not auto-sync unrelated remote stores on initial open", async () => {
    const fetchRemoteContent = vi.fn(async (url: string) => {
      if (url === "https://api.github.com/repos/anthropics/skills") {
        return JSON.stringify({ default_branch: "main", owner: { login: "anthropics" } });
      }

      if (url === "https://api.github.com/repos/openai/skills") {
        return JSON.stringify({ default_branch: "main", owner: { login: "openai" } });
      }

      if (
        url ===
        "https://api.github.com/repos/anthropics/skills/git/trees/main?recursive=1"
      ) {
        return JSON.stringify({
            tree: [{ path: "demo-skill/SKILL.md", type: "blob" }],
          });
      }

      if (
        url ===
        "https://api.github.com/repos/openai/skills/git/trees/main?recursive=1"
      ) {
        return JSON.stringify({
          tree: [
            { path: "skills/.curated/openai-skill/SKILL.md", type: "blob" },
            { path: "skills/experimental/other-skill/SKILL.md", type: "blob" },
          ],
        });
      }

      if (
        url ===
        "https://raw.githubusercontent.com/anthropics/skills/main/demo-skill/SKILL.md"
      ) {
        return [
          "---",
          "name: demo-skill",
          "description: Demo skill",
          "tags: [demo]",
          "---",
          "",
          "# Demo",
        ].join("\n");
      }

      if (
        url ===
        "https://raw.githubusercontent.com/openai/skills/main/skills/.curated/openai-skill/SKILL.md"
      ) {
        return [
          "---",
          "name: openai-skill",
          "description: OpenAI demo skill",
          "tags: [openai]",
          "---",
          "",
          "# OpenAI Demo",
        ].join("\n");
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    installWindowMocks({
      api: {
        settings: {
          get: vi.fn().mockResolvedValue({
            device: {
              storeAutoSync: true,
              storeSyncCadence: "manual",
            },
          }),
        },
        skill: {
          fetchRemoteContent,
          scanLocalPreview: vi.fn().mockResolvedValue([]),
          scanSafety: vi.fn().mockResolvedValue({
            level: "safe",
            summary: "safe",
            findings: [],
            recommendedAction: "allow",
            scannedAt: Date.now(),
            checkedFileCount: 1,
            scanMethod: "static",
          }),
        },
      },
    });

    await act(async () => {
      await renderWithI18n(<SkillStore />, { language: "en" });
    });

    await waitFor(() => {
      expect(
        useSkillStore.getState().remoteStoreEntries["claude-code"]?.skills,
      ).toHaveLength(1);
    });

    const claudeCodeRepoRequests = fetchRemoteContent.mock.calls.filter(
      ([url]) => url === "https://api.github.com/repos/anthropics/skills",
    );
    expect(claudeCodeRepoRequests).toHaveLength(1);

    const communityRequests = fetchRemoteContent.mock.calls.filter(
      ([url]) => url === "https://skills.sh",
    );
    expect(communityRequests).toHaveLength(0);

    const openAiRepoRequests = fetchRemoteContent.mock.calls.filter(
      ([url]) => url === "https://api.github.com/repos/openai/skills",
    );
    expect(openAiRepoRequests).toHaveLength(0);
  });

  it("shows loaded remote source matches when searching from the official store", async () => {
    installWindowMocks({
      api: {
        settings: {
          get: vi.fn().mockResolvedValue({
            device: {
              storeAutoSync: false,
              storeSyncCadence: "manual",
            },
          }),
        },
        skill: {
          loadSkillsShStore: vi.fn().mockResolvedValue({
            skills: [],
            mode: "api",
            source: "api",
          }),
          fetchRemoteContent: vi.fn(),
          scanLocalPreview: vi.fn().mockResolvedValue([]),
          scanSafety: vi.fn().mockResolvedValue({
            level: "safe",
            summary: "safe",
            findings: [],
            recommendedAction: "allow",
            scannedAt: Date.now(),
            checkedFileCount: 1,
            scanMethod: "static",
          }),
        },
      },
    });

    useSkillStore.setState({
      selectedStoreSourceId: "official",
      storeSearchQuery: "sheet",
      registrySkills: [],
      remoteStoreEntries: {
        "claude-code": {
          loadedAt: 1,
          error: "cached failure",
          skills: [],
        },
        "openai-codex": {
          loadedAt: 1,
          error: "cached failure",
          skills: [],
        },
        "hermes-agent": {
          loadedAt: 1,
          error: "cached failure",
          skills: [],
        },
        "hermes-agent-optional": {
          loadedAt: 1,
          error: "cached failure",
          skills: [],
        },
        community: {
          loadedAt: 1,
          query: "sheet",
          skills: [
            {
              slug: "sheet-runner",
              source_id: "community",
              source_type: "html",
              name: "Sheet Runner",
              description: "Automates spreadsheet checks",
              category: "office",
              author: "Community",
              source_url: "https://skills.sh/demo/sheet-runner",
              tags: ["spreadsheet"],
              version: "1.0.0",
              content: "# Sheet Runner",
            },
          ],
        },
      },
    });

    let view:
      | Awaited<ReturnType<typeof renderWithI18n>>
      | undefined;
    await act(async () => {
      view = await renderWithI18n(<SkillStore />, { language: "en" });
    });

    expect(await view?.findByText("Sheet Runner")).toBeInTheDocument();
  });

  it("loads skills.sh query results from another store only after manual online search", async () => {
    const loadSkillsShStore = vi.fn().mockResolvedValue({
      skills: [
        {
          slug: "postgres-helper",
          source_id: "community",
          source_type: "html",
          name: "Postgres Helper",
          description: "Database workflow skill",
          category: "data",
          author: "Community",
          source_url: "https://skills.sh/demo/postgres-helper",
          tags: ["database"],
          version: "1.0.0",
          content: "# Postgres Helper",
        },
      ],
      mode: "api",
      source: "api",
    });

    installWindowMocks({
      api: {
        settings: {
          get: vi.fn().mockResolvedValue({
            device: {
              storeAutoSync: false,
              storeSyncCadence: "manual",
            },
          }),
        },
        skill: {
          loadSkillsShStore,
          fetchRemoteContent: vi.fn(),
          scanLocalPreview: vi.fn().mockResolvedValue([]),
          scanSafety: vi.fn().mockResolvedValue({
            level: "safe",
            summary: "safe",
            findings: [],
            recommendedAction: "allow",
            scannedAt: Date.now(),
            checkedFileCount: 1,
            scanMethod: "static",
          }),
        },
      },
    });

    useSkillStore.setState({
      selectedStoreSourceId: "official",
      storeSearchQuery: "postgres",
      registrySkills: [],
      remoteStoreEntries: {
        "claude-code": {
          loadedAt: 1,
          error: "cached failure",
          skills: [],
        },
        "openai-codex": {
          loadedAt: 1,
          error: "cached failure",
          skills: [],
        },
        "hermes-agent": {
          loadedAt: 1,
          error: "cached failure",
          skills: [],
        },
        "hermes-agent-optional": {
          loadedAt: 1,
          error: "cached failure",
          skills: [],
        },
      },
    });

    let view:
      | Awaited<ReturnType<typeof renderWithI18n>>
      | undefined;
    await act(async () => {
      view = await renderWithI18n(<SkillStore />, { language: "en" });
    });

    expect(loadSkillsShStore).not.toHaveBeenCalled();
    fireEvent.click(await view!.findByText("Find online"));

    await waitFor(() => {
      expect(loadSkillsShStore).toHaveBeenCalledWith(
        expect.objectContaining({ query: "postgres" }),
      );
    });
    expect(await view?.findByText("Postgres Helper")).toBeInTheDocument();
  });

  it("loads the built-in OpenAI Codex store from the curated subdirectory", async () => {
    const fetchRemoteContent = vi.fn(async (url: string) => {
      if (url === "https://api.github.com/repos/openai/skills") {
        return JSON.stringify({ default_branch: "main", owner: { login: "openai" } });
      }

      if (
        url ===
        "https://api.github.com/repos/openai/skills/git/trees/main?recursive=1"
      ) {
        return JSON.stringify({
          tree: [{ path: "skills/.curated/openai-skill/SKILL.md", type: "blob" }],
        });
      }

      if (
        url ===
        "https://raw.githubusercontent.com/openai/skills/main/skills/.curated/openai-skill/SKILL.md"
      ) {
        return [
          "---",
          "name: openai-skill",
          "description: OpenAI demo skill",
          "tags: [openai]",
          "---",
          "",
          "# OpenAI Demo",
        ].join("\n");
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    installWindowMocks({
      api: {
        settings: {
          get: vi.fn().mockResolvedValue({
            device: {
              storeAutoSync: false,
              storeSyncCadence: "manual",
            },
          }),
        },
        skill: {
          fetchRemoteContent,
          scanLocalPreview: vi.fn().mockResolvedValue([]),
          scanSafety: vi.fn().mockResolvedValue({
            level: "safe",
            summary: "safe",
            findings: [],
            recommendedAction: "allow",
            scannedAt: Date.now(),
            checkedFileCount: 1,
            scanMethod: "static",
          }),
        },
      },
    });

    useSkillStore.setState({
      selectedStoreSourceId: "openai-codex",
    });

    await act(async () => {
      await renderWithI18n(<SkillStore />, { language: "en" });
    });

    await waitFor(() => {
      expect(
        useSkillStore.getState().remoteStoreEntries["openai-codex"]?.skills,
      ).toHaveLength(1);
    });

    expect(
      useSkillStore.getState().remoteStoreEntries["openai-codex"]?.skills[0],
    ).toEqual(
      expect.objectContaining({
        source_url: "https://github.com/openai/skills/tree/main/skills/.curated/openai-skill",
        content_url:
          "https://raw.githubusercontent.com/openai/skills/main/skills/.curated/openai-skill/SKILL.md",
      }),
    );
  });

  it("loads the built-in Hermes store from the bundled skills subdirectory", async () => {
    const fetchRemoteContent = vi.fn(async (url: string) => {
      if (url === "https://api.github.com/repos/nousresearch/hermes-agent") {
        return JSON.stringify({
          default_branch: "main",
          owner: { login: "nousresearch" },
        });
      }

      if (
        url ===
        "https://api.github.com/repos/nousresearch/hermes-agent/git/trees/main?recursive=1"
      ) {
        return JSON.stringify({
          tree: [
            { path: "skills/dogfood/SKILL.md", type: "blob" },
            { path: "optional-skills/health/neuroskill-bci/SKILL.md", type: "blob" },
          ],
        });
      }

      if (
        url ===
        "https://raw.githubusercontent.com/nousresearch/hermes-agent/main/skills/dogfood/SKILL.md"
      ) {
        return [
          "---",
          "name: dogfood",
          "description: Hermes bundled skill",
          "tags: [hermes]",
          "---",
          "",
          "# Dogfood",
        ].join("\n");
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    installWindowMocks({
      api: {
        settings: {
          get: vi.fn().mockResolvedValue({
            device: {
              storeAutoSync: false,
              storeSyncCadence: "manual",
            },
          }),
        },
        skill: {
          fetchRemoteContent,
          scanLocalPreview: vi.fn().mockResolvedValue([]),
          scanSafety: vi.fn().mockResolvedValue({
            level: "safe",
            summary: "safe",
            findings: [],
            recommendedAction: "allow",
            scannedAt: Date.now(),
            checkedFileCount: 1,
            scanMethod: "static",
          }),
        },
      },
    });

    useSkillStore.setState({
      selectedStoreSourceId: "hermes-agent",
    });

    await act(async () => {
      await renderWithI18n(<SkillStore />, { language: "en" });
    });

    await waitFor(() => {
      expect(
        useSkillStore.getState().remoteStoreEntries["hermes-agent"]?.skills,
      ).toHaveLength(1);
    });

    expect(
      useSkillStore.getState().remoteStoreEntries["hermes-agent"]?.skills[0],
    ).toEqual(
      expect.objectContaining({
        slug: "dogfood",
        compatibility: ["hermes"],
        source_url:
          "https://github.com/nousresearch/hermes-agent/tree/main/skills/dogfood",
        content_url:
          "https://raw.githubusercontent.com/nousresearch/hermes-agent/main/skills/dogfood/SKILL.md",
      }),
    );
  });

  it("loads the built-in Hermes Optional store from optional-skills", async () => {
    const fetchRemoteContent = vi.fn(async (url: string) => {
      if (url === "https://api.github.com/repos/nousresearch/hermes-agent") {
        return JSON.stringify({
          default_branch: "main",
          owner: { login: "nousresearch" },
        });
      }

      if (
        url ===
        "https://api.github.com/repos/nousresearch/hermes-agent/git/trees/main?recursive=1"
      ) {
        return JSON.stringify({
          tree: [
            { path: "skills/dogfood/SKILL.md", type: "blob" },
            { path: "optional-skills/health/neuroskill-bci/SKILL.md", type: "blob" },
          ],
        });
      }

      if (
        url ===
        "https://raw.githubusercontent.com/nousresearch/hermes-agent/main/optional-skills/health/neuroskill-bci/SKILL.md"
      ) {
        return [
          "---",
          "name: neuroskill-bci",
          "description: Hermes optional skill",
          "tags: [hermes, optional]",
          "---",
          "",
          "# Neuroskill",
        ].join("\n");
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    installWindowMocks({
      api: {
        settings: {
          get: vi.fn().mockResolvedValue({
            device: {
              storeAutoSync: false,
              storeSyncCadence: "manual",
            },
          }),
        },
        skill: {
          fetchRemoteContent,
          scanLocalPreview: vi.fn().mockResolvedValue([]),
          scanSafety: vi.fn().mockResolvedValue({
            level: "safe",
            summary: "safe",
            findings: [],
            recommendedAction: "allow",
            scannedAt: Date.now(),
            checkedFileCount: 1,
            scanMethod: "static",
          }),
        },
      },
    });

    useSkillStore.setState({
      selectedStoreSourceId: "hermes-agent-optional",
    });

    await act(async () => {
      await renderWithI18n(<SkillStore />, { language: "en" });
    });

    await waitFor(() => {
      expect(
        useSkillStore.getState().remoteStoreEntries["hermes-agent-optional"]
          ?.skills,
      ).toHaveLength(1);
    });

    expect(
      useSkillStore.getState().remoteStoreEntries["hermes-agent-optional"]
        ?.skills[0],
    ).toEqual(
      expect.objectContaining({
        slug: "neuroskill-bci",
        compatibility: ["hermes"],
        source_url:
          "https://github.com/nousresearch/hermes-agent/tree/main/optional-skills/health/neuroskill-bci",
        content_url:
          "https://raw.githubusercontent.com/nousresearch/hermes-agent/main/optional-skills/health/neuroskill-bci/SKILL.md",
      }),
    );
  });

  it("loads the community store through the skills.sh API client", async () => {
    const loadSkillsShStore = vi.fn().mockResolvedValue({
      skills: [
        {
          slug: "demo-org-demo-repo-demo-skill",
          source_id: "demo-org/demo-repo/demo-skill",
          source_type: "github",
          name: "Demo Skill",
          install_name: "demo-skill",
          description: "API backed demo",
          category: "dev",
          author: "demo-org",
          source_url: "https://github.com/demo-org/demo-repo",
          store_url: "https://skills.sh/demo-org/demo-repo/demo-skill",
          tags: ["demo"],
          version: "hash:abc123",
          content: "---\nname: Demo Skill\n---\n# Demo",
          remote_hash: "abc123",
          compatibility: ["codex"],
        },
      ],
      mode: "api",
      source: "api-v1",
      cacheMaxAgeSeconds: 60,
    });
    const fetchRemoteContent = vi.fn();

    installWindowMocks({
      api: {
        settings: {
          get: vi.fn().mockResolvedValue({
            device: {
              storeAutoSync: false,
              storeSyncCadence: "manual",
            },
          }),
        },
        skill: {
          loadSkillsShStore,
          fetchRemoteContent,
          scanLocalPreview: vi.fn().mockResolvedValue([]),
        },
      },
    });

    useSettingsStore.setState({
      skillsShApiKey: "sk_test",
    } as Partial<ReturnType<typeof useSettingsStore.getState>>);
    useSkillStore.setState({
      selectedStoreSourceId: "community",
    });

    await act(async () => {
      await renderWithI18n(<SkillStore />, { language: "en" });
    });

    await waitFor(() => {
      expect(
        useSkillStore.getState().remoteStoreEntries["community"]?.skills,
      ).toHaveLength(1);
    });

    expect(loadSkillsShStore).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "sk_test",
        view: "trending",
        includeDuplicates: false,
        includeIncomplete: false,
      }),
    );
    expect(fetchRemoteContent).not.toHaveBeenCalled();
    expect(
      useSkillStore.getState().remoteStoreEntries["community"]?.expiresAt,
    ).toBeGreaterThan(Date.now());
  });

  it("shows a degradation banner when the skills.sh API asks for fallback", async () => {
    const loadSkillsShStore = vi.fn().mockResolvedValue({
      skills: [],
      mode: "fallback",
      source: "html",
      fallbackReason: "Rate limit exceeded",
      retryAfterSeconds: 12,
    });
    const fetchRemoteContent = vi.fn().mockResolvedValue("<html></html>");

    installWindowMocks({
      api: {
        settings: {
          get: vi.fn().mockResolvedValue({
            device: {
              storeAutoSync: false,
              storeSyncCadence: "manual",
            },
          }),
        },
        skill: {
          loadSkillsShStore,
          fetchRemoteContent,
          scanLocalPreview: vi.fn().mockResolvedValue([]),
        },
      },
    });

    useSkillStore.setState({
      selectedStoreSourceId: "community",
    });

    let view:
      | Awaited<ReturnType<typeof renderWithI18n>>
      | undefined;
    await act(async () => {
      view = await renderWithI18n(<SkillStore />, {
        language: "en",
      });
    });

    expect(
      await view?.findByText(/retry after 12 seconds/i),
    ).toBeInTheDocument();
    expect(fetchRemoteContent).toHaveBeenCalledWith("https://skills.sh");
  });

  it("keeps skills.sh legacy search results even when local text does not match the query", async () => {
    const loadSkillsShStore = vi.fn().mockResolvedValue({
      skills: [],
      mode: "fallback",
      source: "html",
      fallbackReason: "authentication_required",
    });
    const fetchRemoteContent = vi.fn(async (url: string) => {
      if (
        url ===
        "https://skills.sh/api/search?q=postgres&limit=200&offset=0"
      ) {
        return JSON.stringify({
          skills: [
            {
              source: "microsoft/github-copilot-for-azure",
              skillId: "azure-db",
              name: "Azure DB",
              installs: 34757,
            },
          ],
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    installWindowMocks({
      api: {
        settings: {
          get: vi.fn().mockResolvedValue({
            device: {
              storeAutoSync: false,
              storeSyncCadence: "manual",
            },
          }),
        },
        skill: {
          loadSkillsShStore,
          fetchRemoteContent,
          scanLocalPreview: vi.fn().mockResolvedValue([]),
        },
      },
    });

    useSkillStore.setState({
      selectedStoreSourceId: "community",
      storeSearchQuery: "postgres",
    });

    let view:
      | Awaited<ReturnType<typeof renderWithI18n>>
      | undefined;
    await act(async () => {
      view = await renderWithI18n(<SkillStore />, {
        language: "en",
      });
    });

    expect(await view?.findByText("Azure Db")).toBeInTheDocument();
    expect(fetchRemoteContent).toHaveBeenCalledWith(
      "https://skills.sh/api/search?q=postgres&limit=200&offset=0",
    );
  });

  it("falls back to repository root README when no SKILL.md exists", async () => {
    const fetchRemoteContent = vi.fn(async (url: string) => {
      if (url === "https://api.github.com/repos/demo/skills") {
        return JSON.stringify({ default_branch: "main", owner: { login: "demo" } });
      }

      if (
        url ===
        "https://api.github.com/repos/demo/skills/git/trees/main?recursive=1"
      ) {
        return JSON.stringify({
          tree: [{ path: "README.md", type: "blob" }],
        });
      }

      if (
        url ===
        "https://raw.githubusercontent.com/demo/skills/main/README.md"
      ) {
        return "# Demo skills\n\n![cover](./images/demo.png)";
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    installWindowMocks({
      api: {
        skill: {
          fetchRemoteContent,
          scanLocalPreview: vi.fn().mockResolvedValue([]),
          scanSafety: vi.fn().mockResolvedValue({
            level: "safe",
            summary: "safe",
            findings: [],
            recommendedAction: "allow",
            scannedAt: Date.now(),
            checkedFileCount: 1,
            scanMethod: "static",
          }),
        },
      },
    });

    useSkillStore.setState({
      customStoreSources: [
        {
          id: "demo-repo",
          name: "Demo Repo",
          type: "git-repo",
          url: "https://github.com/demo/skills",
          enabled: true,
          createdAt: Date.now(),
        },
      ],
      selectedStoreSourceId: "demo-repo",
    });

    await act(async () => {
      await renderWithI18n(<SkillStore />, { language: "en" });
    });

    await waitFor(() => {
      expect(
        useSkillStore.getState().remoteStoreEntries["demo-repo"]?.skills,
      ).toHaveLength(1);
    });

    expect(
      useSkillStore.getState().remoteStoreEntries["demo-repo"]?.skills[0],
    ).toEqual(
      expect.objectContaining({
        source_url: "https://github.com/demo/skills/tree/main",
        content_url: "https://raw.githubusercontent.com/demo/skills/main/README.md",
      }),
    );
  });

  it("does not block install when only static scan reports high risk", async () => {
    const installRegistrySkill = vi.fn().mockResolvedValue({
      id: "installed",
      name: "PDF",
    });

    useSkillStore.setState({
      installRegistrySkill,
      skills: [],
    } as never);

    useSettingsStore.setState({
      autoScanStoreSkillsBeforeInstall: true,
      aiModels: [],
    } as Partial<ReturnType<typeof useSettingsStore.getState>>);

    installWindowMocks({
      api: {
        skill: {
          scanSafety: vi.fn().mockResolvedValue({
            level: "high-risk",
            summary: "static false positive",
            findings: [
              {
                code: "system-persistence",
                severity: "high",
                title: "Touches persistence or system service mechanisms",
                detail: "false positive",
              },
            ],
            recommendedAction: "review",
            scannedAt: Date.now(),
            checkedFileCount: 2,
            scanMethod: "static",
          }),
        },
      },
    });

    const skill = {
      slug: "pdf",
      name: "PDF",
      description: "PDF helper",
      category: "office",
      tags: ["pdf"],
      version: "1.0.0",
      content: "# PDF",
      compatibility: ["claude"],
    } as never;

    const { getByText } = await renderWithI18n(
      <SkillStoreDetail skill={skill} isInstalled={false} onClose={vi.fn()} />,
      { language: "en" },
    );

    await act(async () => {
      getByText("Import to My Skills").click();
    });

    expect(installRegistrySkill).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "pdf" }),
    );
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining("Static scan found potentially risky patterns"),
      "warning",
    );
  });
});
