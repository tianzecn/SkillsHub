import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SkillFullDetailPage } from "../../../src/renderer/components/skill/SkillFullDetailPage";
import { SkillSplitList } from "../../../src/renderer/components/skill/SkillSplitList";
import { SkillManager } from "../../../src/renderer/components/skill/SkillManager";
import { SKILL_PLATFORM_STATUS_CHANGE_EVENT } from "../../../src/renderer/components/skill/skill-platform-status-events";
import {
  createSkillFixture,
  createSkillLocalFileEntryFixture,
  createSkillPlatformFixture,
} from "../../fixtures/skills";
import { renderWithI18n } from "../../helpers/i18n";
import { installWindowMocks } from "../../helpers/window";

const useSkillStoreMock = vi.fn();
const useSettingsStoreMock = vi.fn();
const useToastMock = vi.fn();
const useSkillPlatformMock = vi.fn();

vi.mock("../../../src/renderer/stores/skill.store", () => ({
  useSkillStore: (selector: (state: Record<string, unknown>) => unknown) =>
    useSkillStoreMock(selector),
}));

vi.mock("../../../src/renderer/stores/settings.store", () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    useSettingsStoreMock(selector),
}));

vi.mock("../../../src/renderer/components/ui/Toast", () => ({
  useToast: () => useToastMock(),
}));

vi.mock("../../../src/renderer/components/skill/use-skill-platform", () => ({
  useSkillPlatform: (...args: unknown[]) => useSkillPlatformMock(...args),
}));

vi.mock("../../../src/renderer/components/skill/SkillPreviewPane", () => ({
  SkillPreviewPane: () => <div>preview-pane</div>,
}));

vi.mock("../../../src/renderer/components/skill/SkillPlatformPanel", () => ({
  SkillPlatformPanel: () => <div>platform-panel</div>,
}));

vi.mock("../../../src/renderer/components/skill/SkillCodePane", () => ({
  SkillCodePane: () => <div>code-pane</div>,
}));

vi.mock("../../../src/renderer/components/skill/SkillFileEditor", () => ({
  SkillFileEditor: () => <div>file-editor</div>,
}));

vi.mock("../../../src/renderer/components/skill/EditSkillModal", () => ({
  EditSkillModal: () => null,
}));

vi.mock("../../../src/renderer/components/ui/ConfirmDialog", () => ({
  ConfirmDialog: () => null,
}));

vi.mock("../../../src/renderer/components/ui/UnsavedChangesDialog", () => ({
  UnsavedChangesDialog: () => null,
}));

vi.mock("../../../src/renderer/components/skill/SkillVersionHistoryModal", () => ({
  SkillVersionHistoryModal: () => null,
}));

const baseSkill = createSkillFixture();

function createSkillStoreState(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    skills: [baseSkill],
    loadSkills: vi.fn().mockResolvedValue(undefined),
    deleteSkill: vi.fn().mockResolvedValue(undefined),
    toggleFavorite: vi.fn().mockResolvedValue(undefined),
    updateSkill: vi.fn().mockResolvedValue(undefined),
    isLoading: false,
    selectedSkillId: null,
    selectSkill: vi.fn(),
    filterType: "all",
    searchQuery: "",
    viewMode: "gallery",
    setViewMode: vi.fn(),
    storeView: "my-skills",
    setStoreView: vi.fn(),
    setFilterType: vi.fn(),
    deployedSkillNames: new Set<string>(),
    loadDeployedStatus: vi.fn().mockResolvedValue(undefined),
    filterTags: [],
    scanLocalPreview: vi.fn().mockResolvedValue([]),
    importScannedSkills: vi.fn().mockResolvedValue({ importedCount: 0 }),
    syncSkillFromRepo: vi.fn().mockRejectedValue(new Error("No local repo")),
    saveSafetyReport: vi.fn().mockResolvedValue(undefined),
    skillInsightCache: {},
    getSkillInsight: vi.fn().mockReturnValue(null),
    generateSkillInsight: vi.fn().mockResolvedValue(undefined),
    refreshSkillInsight: vi.fn().mockResolvedValue(undefined),
    rememberDetailTabState: vi.fn(),
    getDetailTabState: vi.fn().mockReturnValue(undefined),
    translateContent: vi.fn().mockResolvedValue(undefined),
    getTranslation: vi.fn().mockReturnValue(null),
    clearTranslation: vi.fn(),
    setSearchQuery: vi.fn(),
    toggleFilterTag: vi.fn(),
    clearFilterTags: vi.fn(),
    ...overrides,
  };
}

function createSettingsState(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    customSkillScanPaths: [],
    translationMode: "full",
    skillInstallMethod: "symlink",
    autoScanInstalledSkills: false,
    skillInsightAutoGenerateEnabled: false,
    aiModels: [],
    ...overrides,
  };
}

describe("skill ui integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    installWindowMocks({
      api: {
        skill: {
          readLocalFiles: vi.fn().mockResolvedValue([
            createSkillLocalFileEntryFixture(),
          ]),
          versionCreate: vi.fn().mockResolvedValue(undefined),
        },
      },
    });

    useToastMock.mockReturnValue({ showToast: vi.fn() });
    useSkillPlatformMock.mockReturnValue({
      availablePlatforms: [],
      batchInstall: vi.fn().mockResolvedValue({
        successCount: 0,
        totalCount: 0,
      }),
      deselectAllPlatforms: vi.fn(),
      installProgress: null,
      installStatus: {},
      isBatchInstalling: false,
      selectedPlatforms: new Set<string>(),
      selectAllPlatforms: vi.fn(),
      togglePlatformSelection: vi.fn(),
      uninstallFromPlatform: vi.fn().mockResolvedValue(undefined),
      uninstalledPlatforms: [],
    });
  });

  it(
    "renders skill manager with real english locale and updates selection summary",
    async () => {
    const skillStoreState = createSkillStoreState();
    const settingsState = createSettingsState();

    useSkillStoreMock.mockImplementation((selector) => selector(skillStoreState));
    useSettingsStoreMock.mockImplementation((selector) => selector(settingsState));

    await renderWithI18n(<SkillManager />, { language: "en" });

    expect(screen.getByRole("button", { name: "Batch Manage" })).toBeInTheDocument();
    expect(
      screen.getByText("Manage all imported skills in one place, regardless of where they came from."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Batch Manage" }));

    expect(screen.getByText("Batch Mode")).toBeInTheDocument();
    expect(screen.getByText("0 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Select All" }));

    await waitFor(() => {
      expect(screen.getByText("1 selected")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Batch Deploy" })).toBeInTheDocument();
    },
    15000,
  );

  it("shows detected platform install status in the split list", async () => {
    const skill = createSkillFixture({
      id: "skill-split-platform-status",
      name: "split-platform-status",
    });
    const getMdInstallStatusBatch = vi.fn().mockResolvedValue({
      [skill.name]: {
        claude: true,
        cursor: false,
      },
    });

    installWindowMocks({
      api: {
        skill: {
          getSupportedPlatforms: vi.fn().mockResolvedValue([
            createSkillPlatformFixture({
              id: "claude",
              name: "Claude Code",
            }),
            createSkillPlatformFixture({
              id: "cursor",
              name: "Cursor",
            }),
          ]),
          detectPlatforms: vi.fn().mockResolvedValue(["claude", "cursor"]),
          getMdInstallStatusBatch,
        },
      },
    });

    const skillStoreState = createSkillStoreState({
      skills: [skill],
      filterTags: [],
    });
    useSkillStoreMock.mockImplementation((selector) => selector(skillStoreState));

    await act(async () => {
      await renderWithI18n(
        <SkillSplitList
          skills={[skill]}
          allSkills={[skill]}
          selectedSkillId={null}
          onSelect={vi.fn()}
          onEnterSelectionMode={vi.fn()}
          onCreateSkill={vi.fn()}
          onRefresh={vi.fn()}
          isRefreshing={false}
          isScanning={false}
          emptyTitle="No skills"
          emptyHint="Create a skill"
          width={320}
        />,
        { language: "en" },
      );
    });

    await waitFor(() => {
      expect(screen.getByText("1/2")).toBeInTheDocument();
    });
    expect(getMdInstallStatusBatch).toHaveBeenCalledWith([skill.name]);
  });

  it("refreshes split list platform status after an install event", async () => {
    const skill = createSkillFixture({
      id: "skill-split-platform-live-refresh",
      name: "split-platform-live-refresh",
    });
    let isInstalled = false;
    const getMdInstallStatusBatch = vi
      .fn()
      .mockImplementation(async (skillNames: string[]) => {
        return Object.fromEntries(
          skillNames.map((skillName) => [
            skillName,
            {
              claude: isInstalled,
              cursor: false,
            },
          ]),
        );
      });

    installWindowMocks({
      api: {
        skill: {
          getSupportedPlatforms: vi.fn().mockResolvedValue([
            createSkillPlatformFixture({
              id: "claude",
              name: "Claude Code",
            }),
            createSkillPlatformFixture({
              id: "cursor",
              name: "Cursor",
            }),
          ]),
          detectPlatforms: vi.fn().mockResolvedValue(["claude", "cursor"]),
          getMdInstallStatusBatch,
        },
      },
    });

    const skillStoreState = createSkillStoreState({
      skills: [skill],
      filterTags: [],
    });
    useSkillStoreMock.mockImplementation((selector) => selector(skillStoreState));

    await act(async () => {
      await renderWithI18n(
        <SkillSplitList
          skills={[skill]}
          allSkills={[skill]}
          selectedSkillId={null}
          onSelect={vi.fn()}
          onEnterSelectionMode={vi.fn()}
          onCreateSkill={vi.fn()}
          onRefresh={vi.fn()}
          isRefreshing={false}
          isScanning={false}
          emptyTitle="No skills"
          emptyHint="Create a skill"
          width={320}
        />,
        { language: "en" },
      );
    });

    await waitFor(() => {
      expect(screen.getByText("0/2")).toBeInTheDocument();
    });

    isInstalled = true;
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(SKILL_PLATFORM_STATUS_CHANGE_EVENT, {
          detail: { skillName: skill.name },
        }),
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText("1/2")).toBeInTheDocument();
    });
    expect(getMdInstallStatusBatch).toHaveBeenCalledTimes(2);
  });

  it("clears cached split list platform status when refresh is clicked", async () => {
    const skill = createSkillFixture({
      id: "skill-split-platform-refresh-click",
      name: "split-platform-refresh-click",
    });
    let isInstalled = false;
    const getMdInstallStatusBatch = vi
      .fn()
      .mockImplementation(async (skillNames: string[]) => {
        return Object.fromEntries(
          skillNames.map((skillName) => [
            skillName,
            {
              claude: isInstalled,
              cursor: false,
            },
          ]),
        );
      });
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    installWindowMocks({
      api: {
        skill: {
          getSupportedPlatforms: vi.fn().mockResolvedValue([
            createSkillPlatformFixture({
              id: "claude",
              name: "Claude Code",
            }),
            createSkillPlatformFixture({
              id: "cursor",
              name: "Cursor",
            }),
          ]),
          detectPlatforms: vi.fn().mockResolvedValue(["claude", "cursor"]),
          getMdInstallStatusBatch,
        },
      },
    });

    const skillStoreState = createSkillStoreState({
      skills: [skill],
      filterTags: [],
    });
    useSkillStoreMock.mockImplementation((selector) => selector(skillStoreState));

    await act(async () => {
      await renderWithI18n(
        <SkillSplitList
          skills={[skill]}
          allSkills={[skill]}
          selectedSkillId={null}
          onSelect={vi.fn()}
          onEnterSelectionMode={vi.fn()}
          onCreateSkill={vi.fn()}
          onRefresh={onRefresh}
          isRefreshing={false}
          isScanning={false}
          emptyTitle="No skills"
          emptyHint="Create a skill"
          width={320}
        />,
        { language: "en" },
      );
    });

    await waitFor(() => {
      expect(screen.getByText("0/2")).toBeInTheDocument();
    });

    isInstalled = true;
    await act(async () => {
      fireEvent.click(screen.getByTitle("Refresh"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText("1/2")).toBeInTheDocument();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(getMdInstallStatusBatch).toHaveBeenCalledTimes(2);
  });

  it(
    "creates a snapshot from the detail page through the in-app modal",
    async () => {
    const loadSkills = vi.fn().mockResolvedValue(undefined);
    const showToast = vi.fn();
    const skillStoreState = createSkillStoreState({
      selectedSkillId: baseSkill.id,
      loadSkills,
    });
    const settingsState = createSettingsState();

    useSkillStoreMock.mockImplementation((selector) => selector(skillStoreState));
    useSettingsStoreMock.mockImplementation((selector) => selector(settingsState));
    useToastMock.mockReturnValue({ showToast });

    await act(async () => {
      await renderWithI18n(<SkillFullDetailPage />, { language: "en" });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Snapshot" }));
    });

    expect(screen.getByRole("heading", { name: "Create Snapshot" })).toBeInTheDocument();
    expect(screen.getByText("Enter a note for this snapshot")).toBeInTheDocument();

    const textarea = screen.getByPlaceholderText("Describe what changed...");
    expect((textarea as HTMLTextAreaElement).value).toContain("Manual snapshot");

    await act(async () => {
      fireEvent.change(textarea, {
        target: { value: "Save the refreshed SKILL.md copy" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Create Snapshot" }));
    });

    await waitFor(() => {
      expect(window.api.skill.versionCreate).toHaveBeenCalledWith(
        baseSkill.id,
        "Save the refreshed SKILL.md copy",
      );
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Create Snapshot" }),
      ).not.toBeInTheDocument();
    });
    expect(loadSkills).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("Version snapshot created", "success");
    },
    15000,
  );

  it("runs automatic safety scan once after the current skill content settles", async () => {
    const syncedContent = "# Synced skill\n\nUse this content for scanning.";
    const safetyReport = {
      level: "safe",
      score: 96,
      findings: [],
      summary: "No risky behavior detected.",
      scannedAt: Date.now(),
    };
    const syncSkillFromRepo = vi.fn().mockResolvedValue({
      ...baseSkill,
      instructions: syncedContent,
      content: syncedContent,
    });
    let skillStoreState: ReturnType<typeof createSkillStoreState>;
    const saveSafetyReport = vi.fn().mockImplementation(async (_id, report) => {
      skillStoreState = {
        ...skillStoreState,
        skills: [{ ...baseSkill, safetyReport: report }],
      };
    });

    skillStoreState = createSkillStoreState({
      selectedSkillId: baseSkill.id,
      syncSkillFromRepo,
      saveSafetyReport,
    });
    const settingsState = createSettingsState({
      autoScanInstalledSkills: true,
      aiModels: [],
    });

    installWindowMocks({
      api: {
        skill: {
          readLocalFiles: vi.fn().mockResolvedValue([
            createSkillLocalFileEntryFixture(),
          ]),
          scanSafety: vi.fn().mockResolvedValue(safetyReport),
          versionCreate: vi.fn().mockResolvedValue(undefined),
        },
      },
    });

    useSkillStoreMock.mockImplementation((selector) => selector(skillStoreState));
    useSettingsStoreMock.mockImplementation((selector) => selector(settingsState));

    let view: Awaited<ReturnType<typeof renderWithI18n>> | null = null;
    await act(async () => {
      view = await renderWithI18n(
        <SkillFullDetailPage embedded skillId={baseSkill.id} />,
        { language: "en" },
      );
    });

    await waitFor(() => {
      expect(window.api.skill.scanSafety).toHaveBeenCalledTimes(1);
    });
    expect(window.api.skill.scanSafety).toHaveBeenCalledWith(
      expect.objectContaining({
        content: syncedContent,
        name: baseSkill.name,
      }),
    );

    if (view === null) {
      throw new Error("Expected SkillFullDetailPage render result");
    }

    await act(async () => {
      view.rerender(<SkillFullDetailPage embedded skillId={baseSkill.id} />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(syncSkillFromRepo).toHaveBeenCalledTimes(1);
    expect(window.api.skill.scanSafety).toHaveBeenCalledTimes(1);
    expect(saveSafetyReport).toHaveBeenCalledTimes(1);
  });
});
