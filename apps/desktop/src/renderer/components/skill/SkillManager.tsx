import React, { useEffect, useMemo, lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CuboidIcon,
  TrashIcon,
  StarIcon,
  SendIcon,
  FolderInputIcon,
  CheckSquareIcon,
  SquareIcon,
  XIcon,
  TagsIcon,
} from "lucide-react";
import { SkillSplitView } from "./SkillSplitView";
import { useSkillStore } from "../../stores/skill.store";
import { useSettingsStore } from "../../stores/settings.store";
import { SkillQuickInstall } from "./SkillQuickInstall";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useToast } from "../ui/Toast";
import type { Skill, ScannedSkill } from "@prompthub/shared/types";
import { updateSkillTags, type SkillBatchTagMode } from "./batch-utils";
import { filterVisibleSkills } from "../../services/skill-filter";
import { createInstalledSkillInsightSkill } from "../../services/skill-insight";
import { buildSkillInsightSearchText } from "../../services/skill-search";
import { getRuntimeCapabilities } from "../../runtime";

// Progressive rendering thresholds for the visible skill list.
const LARGE_SKILL_LIST_THRESHOLD = 120;
const INITIAL_SKILL_RENDER_COUNT = 120;
const SKILL_RENDER_CHUNK_SIZE = 120;
const SKILL_RENDER_CHUNK_DELAY_MS = 24;

// Lazy load heavy panels for better performance.
const SkillStore = lazy(() =>
  import("./SkillStore").then((m) => ({ default: m.SkillStore })),
);
const CreateSkillModal = lazy(() =>
  import("./CreateSkillModal").then((m) => ({ default: m.CreateSkillModal })),
);
const SkillScanPreview = lazy(() =>
  import("./SkillScanPreview").then((m) => ({ default: m.SkillScanPreview })),
);
const SkillBatchDeployDialog = lazy(() =>
  import("./SkillBatchDeployDialog").then((m) => ({
    default: m.SkillBatchDeployDialog,
  })),
);
const SkillBatchTagDialog = lazy(() =>
  import("./SkillBatchTagDialog").then((m) => ({
    default: m.SkillBatchTagDialog,
  })),
);

export function SkillManager() {
  const { t, i18n } = useTranslation();
  const { showToast } = useToast();
  const skills = useSkillStore((state) => state.skills);
  const loadSkills = useSkillStore((state) => state.loadSkills);
  const deleteSkill = useSkillStore((state) => state.deleteSkill);
  const toggleFavorite = useSkillStore((state) => state.toggleFavorite);
  const updateSkill = useSkillStore((state) => state.updateSkill);
  const isLoading = useSkillStore((state) => state.isLoading);
  const filterType = useSkillStore((state) => state.filterType);
  const searchQuery = useSkillStore((state) => state.searchQuery);
  const storeView = useSkillStore((state) => state.storeView);
  const setStoreView = useSkillStore((state) => state.setStoreView);
  const setFilterType = useSkillStore((state) => state.setFilterType);
  const deployedSkillNames = useSkillStore((state) => state.deployedSkillNames);
  const loadDeployedStatus = useSkillStore((state) => state.loadDeployedStatus);
  const skillFilterTags = useSkillStore((state) => state.filterTags);
  const getSkillInsight = useSkillStore((state) => state.getSkillInsight);
  const skillInsightCache = useSkillStore((state) => state.skillInsightCache);
  const customSkillScanPaths = useSettingsStore(
    (state) => state.customSkillScanPaths,
  );
  const runtimeCapabilities = getRuntimeCapabilities();
  const webSkillLibraryMode =
    !runtimeCapabilities.skillDistribution && !runtimeCapabilities.skillStore;
  const effectiveStoreView = webSkillLibraryMode ? "my-skills" : storeView;
  const effectiveFilterType =
    webSkillLibraryMode &&
    (filterType === "installed" ||
      filterType === "deployed" ||
      filterType === "pending")
      ? "all"
      : filterType;
  const isDistributionView = effectiveStoreView === "distribution";

  // Get filtered skills - filter directly in useMemo instead of using store function
  // 直接在 useMemo 中过滤，而不是使用 store 函数（避免函数引用作为依赖）
  const filteredSkills = useMemo(() => {
    return filterVisibleSkills({
      deployedSkillNames,
      filterTags: skillFilterTags,
      filterType: effectiveFilterType,
      getInsightSearchText: (skill) => {
        const content = skill.content || skill.instructions || "";
        if (!content.trim()) return "";
        const entry = getSkillInsight(
          createInstalledSkillInsightSkill(skill, content, skill.description),
          i18n.language,
        );
        return buildSkillInsightSearchText(entry);
      },
      searchQuery,
      skills,
      storeView: effectiveStoreView,
    });
  }, [
    deployedSkillNames,
    effectiveFilterType,
    effectiveStoreView,
    getSkillInsight,
    i18n.language,
    skillFilterTags,
    skillInsightCache,
    searchQuery,
    skills,
  ]);

  // Quick install state
  // 快速安装状态
  const [quickInstallSkill, setQuickInstallSkill] = useState<Skill | null>(
    null,
  );

  // Scan preview state
  // 扫描预览状态
  const [showScanPreview, setShowScanPreview] = useState(false);
  const [showBatchDeployDialog, setShowBatchDeployDialog] = useState(false);
  const [showBatchTagDialog, setShowBatchTagDialog] = useState(false);
  const [isCreateSkillModalOpen, setIsCreateSkillModalOpen] = useState(false);
  const [scannedSkills, setScannedSkills] = useState<ScannedSkill[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [renderedSkillCount, setRenderedSkillCount] = useState(() =>
    filteredSkills.length > LARGE_SKILL_LIST_THRESHOLD &&
    filteredSkills.length < 200
      ? Math.min(INITIAL_SKILL_RENDER_COUNT, filteredSkills.length)
      : filteredSkills.length,
  );
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(
    new Set(),
  );

  const scanLocalPreview = useSkillStore((state) => state.scanLocalPreview);
  const importScannedSkills = useSkillStore(
    (state) => state.importScannedSkills,
  );

  // Delete confirmation dialog state
  // 删除确认对话框状态
  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean;
    skillIds: string[];
    skillNames: string[];
  }>({ isOpen: false, skillIds: [], skillNames: [] });

  const handleScanLocal = async (customPaths?: string[]) => {
    if (!runtimeCapabilities.skillLocalScan) {
      return;
    }

    setIsScanning(true);
    try {
      const result = await scanLocalPreview(customPaths);
      setScannedSkills(result);
      setShowScanPreview(true);
    } catch (err) {
      console.error("Failed to scan local skills:", err);
    } finally {
      setIsScanning(false);
    }
  };

  // Re-scan handler passed down to the preview modal
  // 传给预览弹窗的重新扫描回调
  const handleRescan = async (customPaths: string[]) => {
    if (!runtimeCapabilities.skillLocalScan) {
      return;
    }

    const result = await scanLocalPreview(customPaths);
    setScannedSkills(result);
  };

  const handleImportScanned = async (
    skillsToImport: ScannedSkill[],
    userTagsByPath?: Record<string, string[]>,
  ) => {
    const result = await importScannedSkills(skillsToImport, userTagsByPath);
    // Refresh deployed status after import
    if (runtimeCapabilities.skillDistribution) {
      await loadDeployedStatus();
    }
    return result.importedCount;
  };

  const visibleSkills = useMemo(() => {
    if (
      filteredSkills.length > LARGE_SKILL_LIST_THRESHOLD &&
      filteredSkills.length < 200
    ) {
      return filteredSkills.slice(0, renderedSkillCount);
    }
    return filteredSkills;
  }, [filteredSkills, renderedSkillCount]);
  const selectedSkills = useMemo(
    () => filteredSkills.filter((skill) => selectedSkillIds.has(skill.id)),
    [filteredSkills, selectedSkillIds],
  );
  const allVisibleSelected = useMemo(
    () =>
      filteredSkills.length > 0 &&
      filteredSkills.every((skill) => selectedSkillIds.has(skill.id)),
    [filteredSkills, selectedSkillIds],
  );

  // Load skills on mount, then defer deployed status to idle time
  useEffect(() => {
    if (!webSkillLibraryMode) {
      return;
    }

    if (storeView !== "my-skills") {
      setStoreView("my-skills");
    }

    if (
      filterType === "installed" ||
      filterType === "deployed" ||
      filterType === "pending"
    ) {
      setFilterType("all");
    }
  }, [filterType, setFilterType, setStoreView, storeView, webSkillLibraryMode]);

  useEffect(() => {
    let disposed = false;
    let idleId: number | undefined;
    let timeoutId: number | undefined;
    const browserWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    void loadSkills().then(() => {
      if (disposed) return;

      if (!runtimeCapabilities.skillDistribution) {
        return;
      }

      const run = () => {
        if (!disposed) {
          void loadDeployedStatus();
        }
      };

      if (typeof browserWindow.requestIdleCallback === "function") {
        idleId = browserWindow.requestIdleCallback(run, { timeout: 800 });
      } else {
        timeoutId = window.setTimeout(run, 80);
      }
    });

    return () => {
      disposed = true;
      if (
        idleId !== undefined &&
        typeof browserWindow.cancelIdleCallback === "function"
      ) {
        browserWindow.cancelIdleCallback(idleId);
      }
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [loadSkills, loadDeployedStatus, runtimeCapabilities.skillDistribution]);

  useEffect(() => {
    if (storeView === "store") {
      setIsSelectionMode((prev) => (prev ? false : prev));
      setSelectedSkillIds((prev) => (prev.size === 0 ? prev : new Set()));
    }
  }, [storeView]);

  useEffect(() => {
    if (
      filteredSkills.length <= LARGE_SKILL_LIST_THRESHOLD ||
      filteredSkills.length >= 200
    ) {
      if (renderedSkillCount !== filteredSkills.length) {
        setRenderedSkillCount(filteredSkills.length);
      }
      return;
    }

    const initialCount = Math.min(
      INITIAL_SKILL_RENDER_COUNT,
      filteredSkills.length,
    );
    if (renderedSkillCount !== initialCount) {
      setRenderedSkillCount(initialCount);
    }

    let disposed = false;
    let timeoutId: number | undefined;
    const scheduleNextChunk = () => {
      timeoutId = window.setTimeout(() => {
        if (disposed) return;
        setRenderedSkillCount((current) => {
          const next = Math.min(
            current + SKILL_RENDER_CHUNK_SIZE,
            filteredSkills.length,
          );
          if (next < filteredSkills.length) {
            scheduleNextChunk();
          }
          return next;
        });
      }, SKILL_RENDER_CHUNK_DELAY_MS);
    };

    if (initialCount < filteredSkills.length) {
      scheduleNextChunk();
    }

    return () => {
      disposed = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [filteredSkills]);

  // Store view: show the skill store page
  // 商店视图：显示技能商店页面
  if (runtimeCapabilities.skillStore && effectiveStoreView === "store") {
    return (
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        }
      >
        <SkillStore />
      </Suspense>
    );
  }

  // Note: Split View renders the embedded detail in the right pane on every
  // render, so we no longer short-circuit to a full-screen SkillFullDetailPage
  // when a skill is selected. The legacy `<700px` fallback path will be added
  // back in tasks.md §6 (responsive collapse).

  const toggleSelectionMode = () => {
    setIsSelectionMode((prev) => !prev);
    setSelectedSkillIds((prev) => (prev.size === 0 ? prev : new Set()));
  };

  const exitSelectionMode = () => {
    setIsSelectionMode(false);
    setSelectedSkillIds(new Set());
  };

  const toggleSkillSelection = (skillId: string) => {
    setSelectedSkillIds((prev) => {
      const next = new Set(prev);
      if (next.has(skillId)) {
        next.delete(skillId);
      } else {
        next.add(skillId);
      }
      return next;
    });
  };

  const handleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedSkillIds(new Set());
      return;
    }
    setSelectedSkillIds(new Set(filteredSkills.map((skill) => skill.id)));
  };

  const handleBatchFavorite = async () => {
    const shouldFavorite = selectedSkills.some((skill) => !skill.is_favorite);
    for (const skill of selectedSkills) {
      if (skill.is_favorite !== shouldFavorite) {
        await toggleFavorite(skill.id);
      }
    }
    setSelectedSkillIds(new Set());
  };

  const handleBatchDelete = async () => {
    if (selectedSkills.length === 0) return;
    setDeleteConfirm({
      isOpen: true,
      skillIds: selectedSkills.map((s) => s.id),
      skillNames: selectedSkills.map((s) => s.name),
    });
  };

  const handleBatchDeploy = () => {
    if (selectedSkills.length === 0) return;
    setShowBatchDeployDialog(true);
  };

  const handleBatchTags = () => {
    if (selectedSkills.length === 0) return;
    setShowBatchTagDialog(true);
  };

  const handleBatchTagSubmit = async (tag: string, mode: SkillBatchTagMode) => {
    const results = await Promise.allSettled(
      selectedSkills.map(async (skill) => {
        const nextTags = updateSkillTags(skill.tags, tag, mode);
        const previousTags = skill.tags || [];

        if (JSON.stringify(nextTags) === JSON.stringify(previousTags)) {
          return { updated: false, name: skill.name };
        }

        await updateSkill(skill.id, { tags: nextTags });
        return { updated: true, name: skill.name };
      }),
    );

    const updatedCount = results.filter(
      (result) => result.status === "fulfilled" && result.value.updated,
    ).length;
    const failedCount = results.filter(
      (result) => result.status === "rejected",
    ).length;

    showToast(
      failedCount > 0
        ? t("skill.batchTagPartialFailure", {
            updated: updatedCount,
            failed: failedCount,
            defaultValue: `标签批量更新完成，成功 ${updatedCount} 个，失败 ${failedCount} 个`,
          })
        : mode === "add"
          ? t("skill.batchTagAddSuccess", {
              count: updatedCount,
              defaultValue: `已为 ${updatedCount} 个 skill 添加标签`,
            })
          : t("skill.batchTagRemoveSuccess", {
              count: updatedCount,
              defaultValue: `已从 ${updatedCount} 个 skill 移除标签`,
            }),
      failedCount > 0 ? "error" : "success",
    );
    setSelectedSkillIds(new Set());
  };

  const confirmDelete = async () => {
    for (const id of deleteConfirm.skillIds) {
      await deleteSkill(id);
    }
    setDeleteConfirm({ isOpen: false, skillIds: [], skillNames: [] });
    setSelectedSkillIds(new Set());
    setIsSelectionMode(false);
  };

  const headerTitle = isDistributionView
    ? t("nav.distribution", "Distribution")
    : effectiveFilterType === "favorites"
      ? t("nav.favorites", "Favorites")
      : effectiveFilterType === "installed"
        ? t("skill.imported", "Imported")
        : effectiveFilterType === "deployed"
          ? t("skill.deployed", "Distributed")
          : effectiveFilterType === "pending"
            ? t("skill.pendingDeployment", "Pending")
            : t("nav.mySkills", "My Skills");

  const emptyStateTitle = isDistributionView
    ? t("skill.noSkills", "No skills yet")
    : effectiveFilterType === "favorites"
      ? t("skill.noFavorites", "No favorite skills")
      : effectiveFilterType === "installed"
        ? t("skill.noImportedSkills", "No imported skills yet")
        : effectiveFilterType === "deployed"
          ? t("skill.noDeployedSkills", "No distributed skills yet")
          : effectiveFilterType === "pending"
            ? t("skill.noPendingSkills", "No pending skills")
            : t("skill.noSkills", "No skills yet");

  const emptyStateHint = webSkillLibraryMode
    ? t(
        "skill.webLibraryHint",
        "Create or import your own skills here. Platform distribution and skill marketplaces are desktop-only.",
      )
    : isDistributionView
    ? t(
        "skill.noDistributionSkillsHint",
        "Import skills first, then install, sync, or uninstall them to Claude, Cursor, and other platforms here.",
      )
      : effectiveFilterType === "favorites"
      ? t(
          "skill.noFavoritesHint",
          "Click the star on skill cards to add favorites",
        )
      : effectiveFilterType === "installed"
        ? t(
            "skill.noImportedSkillsHint",
            "After importing from Skill Store, local scan, GitHub, or manual creation, they will appear here.",
          )
        : effectiveFilterType === "deployed"
          ? t(
              "skill.noDeployedSkillsHint",
              "After distributing skills to Claude, Cursor, or other platforms, they will show up here.",
            )
          : effectiveFilterType === "pending"
            ? t(
                "skill.noPendingSkillsHint",
                "Skills not yet distributed to any platform will appear here.",
              )
            : t(
                "skill.noSkillsHint",
                "Import skills from Skill Store, scan local environments, or create one manually to get started",
              );

  const headerSubtitle = webSkillLibraryMode
    ? t(
        "skill.webLibrarySubtitle",
        "Manage your personal skill library in the self-hosted web workspace.",
      )
    : isDistributionView
    ? t(
        "skill.distributionHint",
        "Manage install, sync, and uninstall across connected platforms.",
      )
    : t(
        "skill.workspaceHint",
        "Manage all imported skills in one place, regardless of where they came from.",
      );
  const distributionStatsLabel = isDistributionView
    ? t("skill.distributionStats", {
        deployed: deployedSkillNames.size,
        total: skills.length,
        defaultValue: `${deployedSkillNames.size} deployed / ${skills.length} total`,
      })
    : null;

  return (
    <div className="flex-1 flex flex-row h-full bg-background overflow-hidden relative">
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="border-b border-border bg-background/80 px-4 py-4 backdrop-blur-sm z-10 sm:px-6">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <CuboidIcon className="w-5 h-5 text-primary" />
                    <h2 className="text-lg font-semibold">{headerTitle}</h2>
                  </div>
                  <span className="inline-flex items-center rounded-full border border-white/5 bg-accent/50 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                    {isDistributionView
                      ? distributionStatsLabel
                      : `${filteredSkills.length}${effectiveFilterType !== "all" ? ` / ${skills.length}` : ""}`}
                  </span>
                  {filteredSkills.length > visibleSkills.length && (
                    <span className="text-[11px] text-muted-foreground">
                      {t("skill.progressiveRendering", {
                        rendered: visibleSkills.length,
                        total: filteredSkills.length,
                        defaultValue: `正在分批渲染 ${visibleSkills.length}/${filteredSkills.length}`,
                      })}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {headerSubtitle}
                </p>
              </div>

              <div className="hidden items-center gap-2 self-start lg:self-center lg:justify-end" />
            </div>

            {false && isSelectionMode ? (
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-primary/15 bg-primary/[0.06] p-2">
                <div className="px-3 py-2">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-primary/80">
                    {t("skill.selectionMode", "Batch Mode")}
                  </div>
                  <div className="mt-0.5 text-sm font-semibold text-foreground">
                    {t("skill.selectedCount", {
                      count: selectedSkillIds.size,
                      defaultValue: `${selectedSkillIds.size} selected`,
                    })}
                  </div>
                </div>
                <button
                  onClick={handleSelectAllVisible}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/25 hover:bg-card"
                  title={
                    allVisibleSelected
                      ? t("common.clear", "Clear")
                      : t("common.selectAll", "Select All")
                  }
                >
                  {allVisibleSelected ? (
                    <CheckSquareIcon className="w-4 h-4 text-primary" />
                  ) : (
                    <SquareIcon className="w-4 h-4 text-muted-foreground" />
                  )}
                  {allVisibleSelected
                    ? t("common.clear", "Clear")
                    : t("common.selectAll", "Select All")}
                </button>
                <button
                  onClick={handleBatchFavorite}
                  disabled={selectedSkillIds.size === 0}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/25 hover:bg-card disabled:opacity-50"
                  title={
                    selectedSkills.every((skill) => skill.is_favorite)
                      ? t("skill.removeFavorite", "Remove Favorite")
                      : t("skill.addFavorite", "Add Favorite")
                  }
                >
                  <StarIcon className="w-4 h-4 text-amber-500" />
                  {selectedSkills.every((skill) => skill.is_favorite)
                    ? t("skill.removeFavorite", "Remove Favorite")
                    : t("skill.addFavorite", "Add Favorite")}
                </button>
                <button
                  onClick={handleBatchTags}
                  disabled={selectedSkillIds.size === 0}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/25 hover:bg-card disabled:opacity-50"
                  title={t("skill.batchTags", "Batch Tags")}
                >
                  <TagsIcon className="w-4 h-4 text-primary" />
                  {t("skill.batchTags", "Batch Tags")}
                </button>
                {runtimeCapabilities.skillDistribution && (
                  <button
                    onClick={handleBatchDeploy}
                    disabled={selectedSkillIds.size === 0}
                    className="inline-flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                    title={t("skill.batchDeploy", "Batch Deploy")}
                  >
                    <SendIcon className="w-4 h-4" />
                    {t("skill.batchDeploy", "Batch Deploy")}
                  </button>
                )}
                <button
                  onClick={handleBatchDelete}
                  disabled={selectedSkillIds.size === 0}
                  className="inline-flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/15 disabled:opacity-50"
                  title={t("common.delete", "Delete")}
                >
                  <TrashIcon className="w-4 h-4" />
                  {t("common.delete", "Delete")}
                </button>
                <button
                  onClick={toggleSelectionMode}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
                  title={t("common.cancel", "Cancel")}
                >
                  <XIcon className="w-4 h-4" />
                  {t("common.cancel", "Cancel")}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* Split View content (compact list + embedded detail) */}
        <div className="flex-1 overflow-hidden">
          <SkillSplitView
            visibleSkills={visibleSkills}
            allSkills={skills}
            selectionMode={isSelectionMode}
            selectedSkillIds={selectedSkillIds}
            selectedSkills={selectedSkills}
            onToggleSelection={toggleSkillSelection}
            onEnterSelectionMode={toggleSelectionMode}
            onExitSelectionMode={exitSelectionMode}
            onCreateSkill={() => setIsCreateSkillModalOpen(true)}
            onScanLocal={
              runtimeCapabilities.skillLocalScan
                ? () => handleScanLocal(customSkillScanPaths)
                : undefined
            }
            onOpenStore={
              runtimeCapabilities.skillStore
                ? () => setStoreView("store")
                : undefined
            }
            onRefresh={async () => {
              await loadSkills();
              if (runtimeCapabilities.skillDistribution) {
                await loadDeployedStatus();
              }
            }}
            isRefreshing={isLoading}
            isScanning={isScanning}
            emptyTitle={emptyStateTitle}
            emptyHint={emptyStateHint}
            onSelectAllVisible={handleSelectAllVisible}
            onBatchFavorite={handleBatchFavorite}
            onBatchTags={handleBatchTags}
            onBatchDeploy={handleBatchDeploy}
            onBatchDelete={handleBatchDelete}
            allVisibleSelected={allVisibleSelected}
            canDeploy={runtimeCapabilities.skillDistribution}
          />
        </div>
      </div>

      {/* Quick Install Modal */}
      {/* 快速安装弹窗 */}
      {runtimeCapabilities.skillPlatformIntegration && quickInstallSkill && (
        <SkillQuickInstall
          skill={quickInstallSkill}
          onClose={() => setQuickInstallSkill(null)}
        />
      )}

      {isCreateSkillModalOpen && (
        <Suspense fallback={null}>
          <CreateSkillModal
            isOpen={isCreateSkillModalOpen}
            onClose={() => setIsCreateSkillModalOpen(false)}
          />
        </Suspense>
      )}

      {/* Scan Preview Modal */}
      {/* 扫描预览弹窗 */}
      {runtimeCapabilities.skillLocalScan && showScanPreview && (
        <Suspense fallback={null}>
          <SkillScanPreview
            scannedSkills={scannedSkills}
            installedPaths={
              new Set(
                skills.flatMap((s) =>
                  [s.local_repo_path, s.source_url].filter(
                    (v): v is string => typeof v === "string" && v.length > 0,
                  ),
                ),
              )
            }
            onImport={handleImportScanned}
            onRescan={handleRescan}
            onClose={() => setShowScanPreview(false)}
          />
        </Suspense>
      )}

      {runtimeCapabilities.skillDistribution && showBatchDeployDialog && (
        <Suspense fallback={null}>
          <SkillBatchDeployDialog
            skills={selectedSkills}
            onClose={() => setShowBatchDeployDialog(false)}
            onComplete={async () => {
              if (runtimeCapabilities.skillDistribution) {
                await loadDeployedStatus();
              }
            }}
          />
        </Suspense>
      )}

      {showBatchTagDialog && (
        <Suspense fallback={null}>
          <SkillBatchTagDialog
            skills={selectedSkills}
            onClose={() => setShowBatchTagDialog(false)}
            onSubmit={handleBatchTagSubmit}
          />
        </Suspense>
      )}
      {/* Delete confirmation dialog */}
      {/* 删除确认对话框 */}
      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={() =>
          setDeleteConfirm({ isOpen: false, skillIds: [], skillNames: [] })
        }
        onConfirm={confirmDelete}
        variant="destructive"
        title={t("skill.confirmDeleteTitle", "Confirm Delete")}
        message={
          <div className="space-y-2">
            <p>
              {deleteConfirm.skillNames.length === 1
                ? t("skill.confirmDeleteSingle", {
                    name: deleteConfirm.skillNames[0],
                    defaultValue: `Are you sure you want to delete skill "${deleteConfirm.skillNames[0]}"?`,
                  })
                : t("skill.confirmDeleteMultiple", {
                    count: deleteConfirm.skillNames.length,
                    defaultValue: `Are you sure you want to delete ${deleteConfirm.skillNames.length} selected skills?`,
                  })}
            </p>
            <p className="text-xs text-muted-foreground/80">
              {t(
                "skill.deleteHint",
                "This will only remove them from the PromptHub library without deleting the source directory. Any platform distributions will also be uninstalled.",
              )}
            </p>
          </div>
        }
        confirmText={t("common.delete", "Delete")}
        cancelText={t("common.cancel", "Cancel")}
      />
    </div>
  );
}
