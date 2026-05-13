import { useTranslation } from "react-i18next";
import {
  ArrowUpIcon,
  BookOpenIcon,
  CodeIcon,
  SaveIcon,
  FolderOpenIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldIcon,
  RefreshCwIcon,
  AlertTriangleIcon,
  InfoIcon,
  CheckCircleIcon,
} from "lucide-react";
import { SkillCodePane } from "./SkillCodePane";
import { SkillDetailActionHeader } from "./SkillDetailActionHeader";
import { useState, useEffect, useMemo, useRef } from "react";
import { SkillPlatformPanel } from "./SkillPlatformPanel";
import { SkillPreviewPane } from "./SkillPreviewPane";
import {
  type SkillDetailTab,
  useSkillStore,
} from "../../stores/skill.store";
import { useSettingsStore } from "../../stores/settings.store";
import { useToast } from "../ui/Toast";
import { UnsavedChangesDialog } from "../ui/UnsavedChangesDialog";
import { EditSkillModal } from "./EditSkillModal";
import { SkillFileEditor } from "./SkillFileEditor";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Modal, Textarea } from "../ui";
import type { MouseEvent } from "react";
import "highlight.js/styles/github-dark.css";
import "./SkillMarkdown.css";
import {
  downloadSkillExport,
  getErrorMessage,
  getSafetyScanAIConfig,
  groupSkillSafetyFindings,
  resolveSkillDescription,
  stripFrontmatter,
} from "./detail-utils";
import { useSkillPlatform } from "./use-skill-platform";
import { SkillVersionHistoryModal } from "./SkillVersionHistoryModal";
import type { RegistrySkill, SkillSafetyReport } from "@prompthub/shared/types";
import {
  getSkillSafetyFindingTitle,
  getSkillSafetyMethodDescription,
  getSkillSafetySummary,
} from "./safety-i18n";
import { getRuntimeCapabilities } from "../../runtime";
import { SkillInsightPanel } from "./SkillInsightPanel";
import { createInstalledSkillInsightSkill } from "../../services/skill-insight";

/**
 * Full-width Skill Detail Page
 * 全宽技能详情页
 *
 * Supports two surfaces:
 *   - Standalone full-screen (default): owns the back arrow and full layout.
 *   - Embedded right pane (`embedded={true}`): hides the back arrow and shows
 *     a fullscreen toggle so SkillSplitView can promote it into a temporary
 *     full-screen reading mode.
 */
export type InstallMode = "copy" | "symlink";

export interface SkillFullDetailPageProps {
  /**
   * When true, the page is rendered inside the SkillSplitView right pane.
   * Hides the back arrow and shows a fullscreen-toggle button instead.
   */
  embedded?: boolean;
  /**
   * Whether the embedded view is currently promoted to fullscreen reading.
   * Only consulted when `embedded === true`.
   */
  isFullscreen?: boolean;
  /** Toggle fullscreen-reading mode. Only used when `embedded === true`. */
  onToggleFullscreen?: () => void;
  /** Selected skill id to render. Split View passes a debounced id here. */
  skillId?: string | null;
  /** Reports editor dirty state so Split View can guard skill switching. */
  onDirtyStateChange?: (dirty: boolean) => void;
}

export function SkillFullDetailPage({
  embedded = false,
  isFullscreen = false,
  onToggleFullscreen,
  skillId,
  onDirtyStateChange,
}: SkillFullDetailPageProps = {}) {
  const { t, i18n } = useTranslation();
  const { showToast } = useToast();
  const runtimeCapabilities = getRuntimeCapabilities();
  const storeSelectedSkillId = useSkillStore((state) => state.selectedSkillId);
  const skills = useSkillStore((state) => state.skills);
  const selectSkill = useSkillStore((state) => state.selectSkill);
  const deleteSkill = useSkillStore((state) => state.deleteSkill);
  const toggleFavorite = useSkillStore((state) => state.toggleFavorite);
  const loadSkills = useSkillStore((state) => state.loadSkills);
  const syncSkillFromRepo = useSkillStore((state) => state.syncSkillFromRepo);
  const saveSafetyReport = useSkillStore((state) => state.saveSafetyReport);
  const skillInsightCache = useSkillStore((state) => state.skillInsightCache);
  const getSkillInsight = useSkillStore((state) => state.getSkillInsight);
  const generateSkillInsight = useSkillStore(
    (state) => state.generateSkillInsight,
  );
  const refreshSkillInsight = useSkillStore(
    (state) => state.refreshSkillInsight,
  );
  const rememberDetailTabState =
    useSkillStore((state) => state.rememberDetailTabState) ??
    (() => undefined);
  const getDetailTabState =
    useSkillStore((state) => state.getDetailTabState) ?? (() => undefined);
  const selectedSkillId = skillId ?? storeSelectedSkillId;

  const selectedSkill = useMemo(
    () => skills.find((s) => s.id === selectedSkillId),
    [skills, selectedSkillId],
  );

  const [copyStatus, setCopyStatus] = useState<Record<string, boolean>>({});
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<SkillDetailTab>("preview");

  const translationMode = useSettingsStore((state) => state.translationMode);
  const skillInstallMethod = useSettingsStore(
    (state) => state.skillInstallMethod,
  );
  const autoScanInstalledSkills = useSettingsStore(
    (state) => state.autoScanInstalledSkills,
  );
  const skillInsightAutoGenerateEnabled = useSettingsStore(
    (state) => state.skillInsightAutoGenerateEnabled,
  );
  const aiModels = useSettingsStore((state) => state.aiModels);
  const [installMode, setInstallMode] = useState<InstallMode>(
    () => skillInstallMethod,
  );
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [isVersionHistoryOpen, setIsVersionHistoryOpen] = useState(false);
  const [isScanningSafety, setIsScanningSafety] = useState(false);
  const [isSafetyModalOpen, setIsSafetyModalOpen] = useState(false);
  const [safetyReport, setSafetyReport] = useState<SkillSafetyReport | null>(
    () => selectedSkill?.safetyReport ?? null,
  );
  const [isSnapshotModalOpen, setIsSnapshotModalOpen] = useState(false);
  const [isCreatingSnapshot, setIsCreatingSnapshot] = useState(false);
  const [snapshotNote, setSnapshotNote] = useState("");
  const [resolvedSkillMdContent, setResolvedSkillMdContent] = useState("");
  const [resolvedSkillMdContentSkillId, setResolvedSkillMdContentSkillId] =
    useState<string | null>(null);
  const [fileEditorHasUnsavedChanges, setFileEditorHasUnsavedChanges] =
    useState(false);
  const [isUnsavedDialogOpen, setIsUnsavedDialogOpen] = useState(false);
  const [pendingUnsavedAction, setPendingUnsavedAction] = useState<
    (() => void) | null
  >(null);
  const translateContent = useSkillStore((state) => state.translateContent);
  const getTranslation = useSkillStore((state) => state.getTranslation);
  const clearTranslation = useSkillStore((state) => state.clearTranslation);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const restoreScrollRef = useRef<number | null>(null);
  const rememberScrollTimerRef = useRef<number | null>(null);
  const buildDefaultSnapshotNote = () =>
    t("skill.snapshotDefaultNote", {
      timestamp: new Date().toLocaleString(i18n.language || undefined),
      defaultValue: `Manual snapshot ${new Date().toLocaleString()}`,
    });

  const targetLang = useMemo(() => {
    const lang = (i18n.language || "").toLowerCase();
    return lang.startsWith("zh")
      ? "中文"
      : lang.startsWith("ja")
        ? "日本語"
        : lang.startsWith("ko")
          ? "한국어"
          : "English";
  }, [i18n.language]);

  const displaySkillMdContent =
    resolvedSkillMdContentSkillId === selectedSkill?.id
      ? resolvedSkillMdContent
      : (selectedSkill?.instructions ?? selectedSkill?.content ?? "");
  const resolvedDescription = useMemo(
    () =>
      resolveSkillDescription(displaySkillMdContent) ||
      selectedSkill?.description ||
      "",
    [displaySkillMdContent, selectedSkill?.description],
  );
  const installedInsightSkill = useMemo(() => {
    if (
      !selectedSkill ||
      resolvedSkillMdContentSkillId !== selectedSkill.id ||
      !displaySkillMdContent.trim()
    ) {
      return null;
    }

    return createInstalledSkillInsightSkill(
      selectedSkill,
      displaySkillMdContent,
      resolvedDescription,
    );
  }, [
    displaySkillMdContent,
    resolvedDescription,
    resolvedSkillMdContentSkillId,
    selectedSkill,
  ]);
  const installedInsightEntry = useMemo(
    () =>
      installedInsightSkill
        ? getSkillInsight(installedInsightSkill, targetLang)
        : null,
    [getSkillInsight, installedInsightSkill, skillInsightCache, targetLang],
  );
  const safetyTone =
    safetyReport?.level === "blocked"
      ? "border-destructive/40 bg-destructive/5 text-destructive"
      : safetyReport?.level === "high-risk"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300"
        : safetyReport?.level === "warn"
          ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300"
          : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  const groupedSafetyFindings = useMemo(
    () => groupSkillSafetyFindings(safetyReport?.findings ?? []),
    [safetyReport?.findings],
  );

  const translationCacheKey = selectedSkill
    ? `skill_${selectedSkill.id}_${targetLang}_${translationMode}`
    : "";
  const descriptionTranslationCacheKey = selectedSkill
    ? `skill_desc_${selectedSkill.id}_${targetLang}_${translationMode}`
    : "";
  const cachedInstructionsTranslation = translationCacheKey
    ? getTranslation(translationCacheKey)
    : null;
  const cachedDescriptionTranslation = descriptionTranslationCacheKey
    ? getTranslation(descriptionTranslationCacheKey)
    : null;
  // Refresh when skill changes
  useEffect(() => {
    if (!runtimeCapabilities.skillFileEditing && activeTab === "files") {
      setActiveTab("preview");
    }
  }, [activeTab, runtimeCapabilities.skillFileEditing]);

  useEffect(() => {
    if (selectedSkill) {
      setShowTranslation(false);
      const cachedState = getDetailTabState(selectedSkill.id);
      if (cachedState) {
        setActiveTab(cachedState.activeTab);
        restoreScrollRef.current = cachedState.scrollTop;
      } else {
        setActiveTab("preview");
        restoreScrollRef.current = 0;
      }
      // Restore persisted safety report when switching skills
      setSafetyReport(selectedSkill.safetyReport ?? null);
    }
  }, [getDetailTabState, selectedSkill?.id]);

  useEffect(() => {
    onDirtyStateChange?.(
      (runtimeCapabilities.skillFileEditing &&
        activeTab === "files" &&
        fileEditorHasUnsavedChanges) ||
        isEditModalOpen,
    );
  }, [
    activeTab,
    fileEditorHasUnsavedChanges,
    isEditModalOpen,
    onDirtyStateChange,
    runtimeCapabilities.skillFileEditing,
  ]);

  useEffect(() => {
    if (!selectedSkill) return;
    rememberDetailTabState(selectedSkill.id, {
      activeTab,
      scrollTop: contentScrollRef.current?.scrollTop ?? 0,
    });
  }, [activeTab, rememberDetailTabState, selectedSkill]);

  useEffect(() => {
    if (restoreScrollRef.current === null || activeTab === "files") return;
    const nextScrollTop = restoreScrollRef.current;
    const handle = window.setTimeout(() => {
      if (typeof contentScrollRef.current?.scrollTo === "function") {
        contentScrollRef.current.scrollTo({ top: nextScrollTop });
      } else if (contentScrollRef.current) {
        contentScrollRef.current.scrollTop = nextScrollTop;
      }
      restoreScrollRef.current = null;
    }, 0);
    return () => window.clearTimeout(handle);
  }, [activeTab, selectedSkill?.id]);

  useEffect(() => {
    let cancelled = false;

    async function resolveSkillMdContent() {
      if (!selectedSkill) {
        setResolvedSkillMdContent("");
        setResolvedSkillMdContentSkillId(null);
        return;
      }

      setResolvedSkillMdContentSkillId(null);

      try {
        const syncedSkill = await syncSkillFromRepo(selectedSkill.id);
        const repoSkillMd =
          syncedSkill?.instructions ||
          syncedSkill?.content ||
          selectedSkill.instructions ||
          selectedSkill.content ||
          "";
        if (!cancelled) {
          setResolvedSkillMdContent(repoSkillMd);
          setResolvedSkillMdContentSkillId(selectedSkill.id);
        }
      } catch {
        if (!cancelled) {
          setResolvedSkillMdContent(
            selectedSkill.instructions || selectedSkill.content || "",
          );
          setResolvedSkillMdContentSkillId(selectedSkill.id);
        }
      }
    }

    void resolveSkillMdContent();

    return () => {
      cancelled = true;
    };
  }, [
    selectedSkill?.id,
    selectedSkill?.instructions,
    selectedSkill?.content,
    selectedSkill?.updated_at,
    syncSkillFromRepo,
  ]);

  useEffect(() => {
    if (!selectedSkill || !autoScanInstalledSkills) {
      return;
    }

    if (resolvedSkillMdContentSkillId !== selectedSkill.id) {
      return;
    }

    let cancelled = false;
    const skillId = selectedSkill.id;
    const skillName = selectedSkill.name;
    const skillContent =
      resolvedSkillMdContent || selectedSkill.instructions || selectedSkill.content;
    const sourceUrl = selectedSkill.source_url;
    const contentUrl = selectedSkill.content_url;
    const localRepoPath = selectedSkill.local_repo_path;

    const runScan = async () => {
      setIsScanningSafety(true);
      try {
        const report = await window.api.skill.scanSafety({
          name: skillName,
          content: skillContent,
          sourceUrl,
          contentUrl,
          localRepoPath,
          aiConfig: getSafetyScanAIConfig(aiModels),
        });
        if (!cancelled) {
          setSafetyReport(report);
          try {
            await saveSafetyReport(skillId, report);
          } catch (err) {
            console.warn("Failed to persist auto-scan safety report:", err);
          }
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("Failed to auto-scan skill safety:", error);
        }
      } finally {
        if (!cancelled) {
          setIsScanningSafety(false);
        }
      }
    };

    void runScan();

    return () => {
      cancelled = true;
    };
  }, [
    aiModels,
    autoScanInstalledSkills,
    resolvedSkillMdContent,
    resolvedSkillMdContentSkillId,
    saveSafetyReport,
    selectedSkill?.content,
    selectedSkill?.content_url,
    selectedSkill?.id,
    selectedSkill?.instructions,
    selectedSkill?.local_repo_path,
    selectedSkill?.name,
    selectedSkill?.source_url,
  ]);

  useEffect(() => {
    if (
      !skillInsightAutoGenerateEnabled ||
      !installedInsightSkill ||
      activeTab !== "preview" ||
      installedInsightEntry?.status
    ) {
      return;
    }

    let cancelled = false;

    void generateSkillInsight(installedInsightSkill, targetLang).catch((error) => {
      if (!cancelled) {
        console.warn("Failed to generate installed skill insight:", error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    generateSkillInsight,
    installedInsightEntry?.status,
    installedInsightSkill,
    skillInsightAutoGenerateEnabled,
    targetLang,
  ]);

  const {
    availablePlatforms,
    batchInstall: installSelectedPlatforms,
    deselectAllPlatforms,
    installProgress,
    installStatus: skillMdInstallStatus,
    isBatchInstalling,
    selectedPlatforms,
    selectAllPlatforms,
    togglePlatformSelection,
    uninstallFromPlatform: uninstallSkillFromPlatform,
    uninstalledPlatforms,
  } = useSkillPlatform(selectedSkill, installMode);

  const batchInstall = async () => {
    try {
      const result = await installSelectedPlatforms();
      if (result.successCount > 0) {
        const modeLabel =
          installMode === "symlink"
            ? t("skill.symlink", "Symlink")
            : t("skill.copyMode", "Copy");
        showToast(
          `${t("skill.installSuccess", "Installation successful")} (${modeLabel}) — ${result.successCount}/${result.totalCount}`,
          "success",
        );
      }
    } catch (error) {
      console.error("Batch install failed:", error);
      showToast(
        `${t("skill.updateFailed")}: ${getErrorMessage(error)}`,
        "error",
      );
    }
  };

  const uninstallFromPlatform = async (platformId: string) => {
    try {
      await uninstallSkillFromPlatform(platformId);
      showToast(t("skill.uninstallSuccess", "Uninstall successful"), "success");
    } catch (error) {
      console.error(`Failed to uninstall from ${platformId}:`, error);
      showToast(
        `${t("skill.updateFailed")}: ${getErrorMessage(error)}`,
        "error",
      );
    }
  };

  if (!selectedSkill) return null;

  const runSafetyScan = async () => {
    setIsScanningSafety(true);
    try {
      const report = await window.api.skill.scanSafety({
        name: selectedSkill.name,
        content: displaySkillMdContent,
        sourceUrl: selectedSkill.source_url,
        contentUrl: selectedSkill.content_url,
        localRepoPath: selectedSkill.local_repo_path,
        aiConfig: getSafetyScanAIConfig(aiModels),
      });
      setSafetyReport(report);
      // Persist to DB + update store
      try {
        await saveSafetyReport(selectedSkill.id, report);
      } catch (err) {
        console.warn("Failed to persist safety report:", err);
      }
      return report;
    } catch (error) {
      showToast(
        `${t("skill.safetyScanFailed", "Safety scan failed")}: ${getErrorMessage(error)}`,
        "error",
      );
      return null;
    } finally {
      setIsScanningSafety(false);
    }
  };

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopyStatus({ ...copyStatus, [key]: true });
    setTimeout(() => {
      setCopyStatus({ ...copyStatus, [key]: false });
    }, 2000);
  };

  const handleExport = async (format: "skillmd" | "json") => {
    if (!selectedSkill) return;
    try {
      const content = await window.api.skill.export(selectedSkill.id, format);
      downloadSkillExport(content, selectedSkill.name, format);

      setCopyStatus({ ...copyStatus, [`export_${format}`]: true });
      setTimeout(() => {
        setCopyStatus({ ...copyStatus, [`export_${format}`]: false });
      }, 2000);
    } catch (error) {
      showToast(
        `${t("skill.exportFailed", "Export failed")}: ${getErrorMessage(error)}`,
        "error",
      );
    }
  };

  const handleDelete = () => {
    if (!selectedSkill) return;
    setIsDeleteConfirmOpen(true);
  };

  const confirmDelete = async () => {
    if (!selectedSkill) return;
    await deleteSkill(selectedSkill.id);
    setIsDeleteConfirmOpen(false);
    selectSkill(null);
  };

  const handleTranslateSkill = async (forceRefresh = false) => {
    if (!selectedSkill) return;

    if (!forceRefresh && cachedInstructionsTranslation) {
      setShowTranslation(!showTranslation);
      return;
    }

    setIsTranslating(true);
    try {
      if (forceRefresh) {
        clearTranslation(translationCacheKey);
        clearTranslation(descriptionTranslationCacheKey);
      }

      const stripped = stripFrontmatter(displaySkillMdContent);
      const promises: Promise<unknown>[] = [
        translateContent(stripped, translationCacheKey, targetLang, {
          forceRefresh,
        }),
      ];

      if (resolvedDescription) {
        promises.push(
          translateContent(
            resolvedDescription,
            descriptionTranslationCacheKey,
            targetLang,
            { forceRefresh },
          ),
        );
      }

      await Promise.all(promises);
      setShowTranslation(true);
      showToast(
        forceRefresh
          ? t("skill.translateRefreshed", "Translation refreshed")
          : t("skill.translateSuccess", "Translation complete"),
        "success",
      );
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "AI_NOT_CONFIGURED") {
        showToast(
          t(
            "skill.aiNotConfigured",
            "Please configure AI model in Settings first",
          ),
          "error",
        );
      } else {
        showToast(
          `${t("skill.translateFailed", "Translation failed")}: ${getErrorMessage(error)}`,
          "error",
        );
      }
    } finally {
      setIsTranslating(false);
    }
  };

  const handleRefreshInstalledInsight = async (
    skill: RegistrySkill,
    event: MouseEvent,
  ) => {
    event.stopPropagation();

    try {
      await refreshSkillInsight(skill, targetLang);
      showToast(t("skill.insightRefreshed", "AI insight refreshed"), "success");
    } catch (error) {
      showToast(
        `${t("skill.insightFailed", "AI insight failed")}: ${getErrorMessage(error)}`,
        "error",
      );
    }
  };

  const handleContentScroll = () => {
    const scrollTop = contentScrollRef.current?.scrollTop ?? 0;
    setShowBackToTop(scrollTop > 480);
    if (!selectedSkill) return;
    if (rememberScrollTimerRef.current !== null) {
      window.clearTimeout(rememberScrollTimerRef.current);
    }
    rememberScrollTimerRef.current = window.setTimeout(() => {
      rememberDetailTabState(selectedSkill.id, {
        activeTab,
        scrollTop: contentScrollRef.current?.scrollTop ?? scrollTop,
      });
    }, 120);
  };

  const scrollToTop = () => {
    contentScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const requestLeaveFileEditing = (action: () => void) => {
    if (activeTab !== "files" || !fileEditorHasUnsavedChanges) {
      action();
      return;
    }

    setPendingUnsavedAction(() => action);
    setIsUnsavedDialogOpen(true);
  };

  const openSnapshotModal = () => {
    setSnapshotNote(buildDefaultSnapshotNote());
    setIsSnapshotModalOpen(true);
  };

  const handleCreateSnapshot = async () => {
    if (!selectedSkill) return;

    setIsCreatingSnapshot(true);
    try {
      await window.api.skill.versionCreate(
        selectedSkill.id,
        snapshotNote.trim() || buildDefaultSnapshotNote(),
      );
      await loadSkills();
      setIsSnapshotModalOpen(false);
      showToast(t("skill.snapshotCreated"), "success");
    } catch (error) {
      console.error("Failed to create skill snapshot:", error);
      showToast(
        `${t("skill.updateFailed", "Update failed")}: ${getErrorMessage(error)}`,
        "error",
      );
    } finally {
      setIsCreatingSnapshot(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-background overflow-hidden animate-in fade-in slide-in-from-right-4 duration-300">
      <SkillDetailActionHeader
        selectedSkill={selectedSkill}
        t={t}
        showBackButton={!embedded}
        showFullscreenToggle={embedded}
        isFullscreen={isFullscreen}
        isCreatingSnapshot={isCreatingSnapshot}
        onBack={() => requestLeaveFileEditing(() => selectSkill(null))}
        onOpenSnapshot={openSnapshotModal}
        onToggleFavorite={() => toggleFavorite(selectedSkill.id)}
        onOpenVersionHistory={() => setIsVersionHistoryOpen(true)}
        onOpenEdit={() => setIsEditModalOpen(true)}
        onDelete={handleDelete}
        onToggleFullscreen={onToggleFullscreen}
      />

      {/* Tabs */}
      <div className="flex items-center px-6 gap-6 border-b border-border bg-accent/20">
        <button
          onClick={() => {
            requestLeaveFileEditing(() => {
              setActiveTab("preview");
            });
          }}
          className={`py-3 text-sm font-semibold relative transition-colors ${activeTab === "preview" ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
        >
          <div className="flex items-center gap-2">
            <BookOpenIcon className="w-4 h-4" />
            {t("common.preview", "Preview")}
          </div>
          {activeTab === "preview" && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
          )}
        </button>
        <button
          onClick={() => {
            requestLeaveFileEditing(() => {
              setActiveTab("code");
            });
          }}
          className={`py-3 text-sm font-semibold relative transition-colors ${activeTab === "code" ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
        >
          <div className="flex items-center gap-2">
            <CodeIcon className="w-4 h-4" />
            {t("common.content", "Source / Content")}
          </div>
          {activeTab === "code" && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
          )}
        </button>
        {runtimeCapabilities.skillFileEditing && (
          <button
            onClick={() => setActiveTab("files")}
            className={`py-3 text-sm font-semibold relative transition-colors ${activeTab === "files" ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            <div className="flex items-center gap-2">
              <FolderOpenIcon className="w-4 h-4" />
              {t("skill.files", "Files")}
            </div>
            {activeTab === "files" && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
            )}
          </button>
        )}

        {/* Safety pill — compact, right-aligned in tab bar */}
        <button
          onClick={() => {
            if (safetyReport && !isScanningSafety) {
              setIsSafetyModalOpen(true);
            } else if (!isScanningSafety) {
              void runSafetyScan();
            }
          }}
          disabled={isScanningSafety}
          title={
            safetyReport
              ? t("skill.safetyModalTitle", "Safety Report")
              : t("skill.safetyAssessmentEmpty", "No safety scan run yet")
          }
          className={`ml-auto my-auto flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${safetyReport ? safetyTone : "border-border text-muted-foreground hover:border-primary/30 hover:text-primary"}`}
        >
          {isScanningSafety ? (
            <ShieldAlertIcon className="w-3.5 h-3.5 animate-pulse" />
          ) : safetyReport?.level === "safe" ? (
            <ShieldCheckIcon className="w-3.5 h-3.5" />
          ) : safetyReport ? (
            <ShieldAlertIcon className="w-3.5 h-3.5" />
          ) : (
            <ShieldIcon className="w-3.5 h-3.5" />
          )}
          {isScanningSafety
            ? t("skill.safetyScanning", "Scanning...")
            : safetyReport
              ? `${t("skill.safetyLevelLabel", "Risk Level")} - ${
                  (
                    {
                      safe: t("skill.safetyLevelSafe", "Safe"),
                      warn: t("skill.safetyLevelWarn", "Needs review"),
                      "high-risk": t("skill.safetyLevelHighRisk", "High risk"),
                      blocked: t("skill.safetyLevelBlocked", "Blocked"),
                    } as Record<string, string>
                  )[safetyReport.level] ?? safetyReport.level
                }`
              : t("skill.safetyAssessment", "Safety Assessment")}
        </button>
      </div>

      {/* Main content - two column layout */}
      <div
        ref={contentScrollRef}
        onScroll={handleContentScroll}
        className={`flex-1 flex flex-col ${runtimeCapabilities.skillFileEditing && activeTab === "files" ? "overflow-hidden" : "overflow-y-auto"}`}
      >
        {runtimeCapabilities.skillFileEditing && activeTab === "files" ? (
          /* Files Tab: inline file editor fills the entire content area */
          <div className="flex-1 flex flex-col bg-card min-h-0 overflow-hidden">
            <SkillFileEditor
              skillId={selectedSkill.id}
              skillName={selectedSkill.name}
              isOpen={true}
              onSave={() => loadSkills()}
              onUnsavedChange={setFileEditorHasUnsavedChanges}
              mode="inline"
            />
          </div>
        ) : (
          <div
            className={
              embedded ? "p-6 w-full" : "max-w-6xl mx-auto p-6 w-full"
            }
          >
            {activeTab === "preview" ? (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:items-stretch">
                <SkillPreviewPane
                  cachedDescriptionTranslation={cachedDescriptionTranslation}
                  cachedInstructionsTranslation={cachedInstructionsTranslation}
                  copyStatus={copyStatus}
                  handleCopy={handleCopy}
                  handleTranslateSkill={handleTranslateSkill}
                  isTranslating={isTranslating}
                  resolvedDescription={resolvedDescription}
                  selectedSkill={selectedSkill}
                  showTranslation={showTranslation}
                  skillInsightPanel={
                    installedInsightSkill ? (
                      <SkillInsightPanel
                        skill={installedInsightSkill}
                        insightEntry={installedInsightEntry}
                        insightEnabled
                        onRefreshInsight={handleRefreshInstalledInsight}
                        pendingMessage={t(
                          "skill.insightGenerateOnRefresh",
                          "Click Refresh insight to generate AI guidance for this installed skill.",
                        )}
                      />
                    ) : null
                  }
                  skillContent={displaySkillMdContent}
                  t={t}
                  translationMode={translationMode}
                />

                <SkillPlatformPanel
                  availablePlatforms={availablePlatforms}
                  handleExport={handleExport}
                  installMode={installMode}
                  installProgress={installProgress}
                  isBatchInstalling={isBatchInstalling}
                  onBatchInstall={batchInstall}
                  selectedPlatforms={selectedPlatforms}
                  selectedSkill={selectedSkill}
                  selectAllPlatforms={selectAllPlatforms}
                  deselectAllPlatforms={deselectAllPlatforms}
                  setInstallMode={setInstallMode}
                  skillMdInstallStatus={skillMdInstallStatus}
                  t={t}
                  togglePlatformSelection={togglePlatformSelection}
                  uninstallFromPlatform={uninstallFromPlatform}
                  uninstalledPlatforms={uninstalledPlatforms}
                />
              </div>
            ) : (
              <SkillCodePane
                copyStatus={copyStatus}
                handleCopy={handleCopy}
                selectedSkill={selectedSkill}
                skillContent={displaySkillMdContent}
                t={t}
              />
            )}
          </div>
        )}
      </div>

      {showBackToTop && activeTab !== "files" && (
        <button
          onClick={scrollToTop}
          className="absolute bottom-6 left-1/2 z-20 -translate-x-1/2 inline-flex items-center gap-2 rounded-full border border-border bg-card/95 px-4 py-2 text-sm font-medium text-foreground shadow-lg backdrop-blur hover:bg-accent transition-colors"
        >
          <ArrowUpIcon className="w-4 h-4" />
          {t("common.backToTop", "Back to Top")}
        </button>
      )}

      {/* Edit Modal */}
      <EditSkillModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        skill={selectedSkill}
      />

      {/* Delete confirmation dialog */}
      {/* 删除确认对话框 */}
      <ConfirmDialog
        isOpen={isDeleteConfirmOpen}
        onClose={() => setIsDeleteConfirmOpen(false)}
        onConfirm={confirmDelete}
        variant="destructive"
        title={t("skill.confirmDeleteTitle", "Confirm Delete")}
        message={
          <div className="space-y-2">
            <p>
              {t("skill.confirmDeleteSingle", {
                name: selectedSkill?.name || "",
                defaultValue: `Are you sure you want to delete skill "${selectedSkill?.name || ""}"?`,
              })}
            </p>
            <p className="text-xs text-muted-foreground/80">
              {t(
                "skill.deleteHint",
                "Only removes from PromptHub library. Source files are preserved. Platform installations will be uninstalled.",
              )}
            </p>
          </div>
        }
        confirmText={t("common.delete", "Delete")}
        cancelText={t("common.cancel", "Cancel")}
      />
      <UnsavedChangesDialog
        isOpen={isUnsavedDialogOpen}
        onClose={() => {
          setIsUnsavedDialogOpen(false);
          setPendingUnsavedAction(null);
        }}
        onSave={() => {
          setIsUnsavedDialogOpen(false);
          setPendingUnsavedAction(null);
        }}
        onDiscard={() => {
          setIsUnsavedDialogOpen(false);
          pendingUnsavedAction?.();
          setPendingUnsavedAction(null);
        }}
      />

      <SkillVersionHistoryModal
        isOpen={isVersionHistoryOpen}
        onClose={() => setIsVersionHistoryOpen(false)}
        skill={selectedSkill}
        currentContent={displaySkillMdContent}
        onReload={loadSkills}
      />

      <Modal
        isOpen={isSnapshotModalOpen}
        onClose={() => {
          if (!isCreatingSnapshot) {
            setIsSnapshotModalOpen(false);
          }
        }}
        title={t("skill.createSnapshot", "Create Snapshot")}
        size="lg"
      >
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            {t("skill.snapshotPrompt", "Enter a note for this snapshot")}
          </div>
          <Textarea
            value={snapshotNote}
            onChange={(event) => setSnapshotNote(event.target.value)}
            placeholder={t(
              "skill.versionNotePlaceholder",
              "Describe the changes...",
            )}
            rows={4}
            autoFocus
            disabled={isCreatingSnapshot}
          />
          <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
            <button
              type="button"
              onClick={() => setIsSnapshotModalOpen(false)}
              disabled={isCreatingSnapshot}
              className="rounded-xl border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
            >
              {t("common.cancel", "Cancel")}
            </button>
            <button
              type="button"
              onClick={handleCreateSnapshot}
              disabled={isCreatingSnapshot}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {isCreatingSnapshot ? (
                <>
                  <SaveIcon className="h-4 w-4 animate-pulse" />
                  {t("common.saving", "Saving")}
                </>
              ) : (
                <>
                  <SaveIcon className="h-4 w-4" />
                  {t("skill.createSnapshot", "Create Snapshot")}
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* Safety Report Modal */}
      <Modal
        isOpen={isSafetyModalOpen}
        onClose={() => setIsSafetyModalOpen(false)}
        title={t("skill.safetyModalTitle", "Safety Report")}
        size="lg"
      >
        {safetyReport && (
          <div className="space-y-5">
            {/* Header: level badge + meta */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-2">
                <div
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold w-fit ${safetyTone}`}
                >
                  {safetyReport.level === "safe" ? (
                    <ShieldCheckIcon className="w-4 h-4" />
                  ) : (
                    <ShieldAlertIcon className="w-4 h-4" />
                  )}
                  {(
                    {
                      safe: t("skill.safetyLevelSafe", "Safe"),
                      warn: t("skill.safetyLevelWarn", "Needs review"),
                      "high-risk": t("skill.safetyLevelHighRisk", "High risk"),
                      blocked: t("skill.safetyLevelBlocked", "Blocked"),
                    } as Record<string, string>
                  )[safetyReport.level] ?? safetyReport.level}
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {getSkillSafetySummary(t, safetyReport)}
                </p>
              </div>
              {safetyReport.score !== undefined && (
                <div
                  className="flex flex-col items-center shrink-0 cursor-help"
                  title={t(
                    "skill.safetyScoreDesc",
                    "Score 0–100 (higher = safer). Based on risk level and number of findings: blocked 0–10, high-risk 20–40, caution 50–70, safe 80–100.",
                  )}
                >
                  <span className="text-2xl font-bold text-foreground">
                    {safetyReport.score}
                  </span>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                    {t("skill.safetyScore", "Score")} / 100
                  </span>
                </div>
              )}
            </div>

            {/* Scoring dimensions */}
            {(() => {
              const CONTENT_CODES = new Set([
                "shell-pipe-exec",
                "dangerous-delete",
                "encoded-powershell",
                "encoded-shell-bootstrap",
                "privilege-escalation",
                "system-persistence",
                "secret-access",
                "security-bypass",
                "network-exfil",
                "exec-bit",
                "network-bootstrap",
                "env-mutation",
              ]);
              const SOURCE_CODES = new Set([
                "untrusted-source-host",
                "external-audits",
                "internal-source",
                "unknown-source",
                "invalid-source-url",
                "insecure-source-url",
              ]);
              const REPO_CODES = new Set([
                "persistence-file",
                "high-risk-binary",
                "script-file",
              ]);
              const findings = safetyReport.findings ?? [];
              const contentCount = findings.filter((f) =>
                CONTENT_CODES.has(f.code),
              ).length;
              const sourceCount = findings.filter((f) =>
                SOURCE_CODES.has(f.code),
              ).length;
              const repoCount = findings.filter((f) =>
                REPO_CODES.has(f.code),
              ).length;
              const dims = [
                {
                  key: "content",
                  label: t("skill.safetyDimContent", "Content patterns"),
                  desc: t(
                    "skill.safetyDimContentDesc",
                    "Static regex scan for shell injections, destructive commands, encoded payloads, privilege escalation, credential access, and suspicious network calls.",
                  ),
                  count: contentCount,
                },
                {
                  key: "source",
                  label: t("skill.safetyDimSource", "Source trust"),
                  desc: t(
                    "skill.safetyDimSourceDesc",
                    "Validates source URL — HTTPS enforcement, known trusted hosts, and SSRF guard against internal addresses.",
                  ),
                  count: sourceCount,
                },
                {
                  key: "repo",
                  label: t("skill.safetyDimRepo", "Repository structure"),
                  desc: t(
                    "skill.safetyDimRepoDesc",
                    "Inspects the local repo file tree for binaries, executable scripts, and persistence-related files.",
                  ),
                  count: repoCount,
                },
              ];
              return (
                <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 space-y-2">
                  <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
                    {t("skill.safetyDimensionTitle", "Scoring Dimensions")}
                  </p>
                  {dims.map((dim) => (
                    <div
                      key={dim.key}
                      className="flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-sm text-foreground truncate">
                          {dim.label}
                        </span>
                        <span
                          className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-muted text-muted-foreground text-[10px] cursor-help shrink-0"
                          title={dim.desc}
                        >
                          ?
                        </span>
                      </div>
                      <span
                        className={`text-xs font-medium shrink-0 ${
                          dim.count === 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        {dim.count === 0
                          ? t("skill.safetyDimNoFindings", "Clean")
                          : t(
                              "skill.safetyDimFindings",
                              "{{count}} finding(s)",
                              {
                                count: dim.count,
                              },
                            )}
                      </span>
                    </div>
                  ))}
                  <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/50 leading-relaxed">
                    {t(
                      "skill.safetyScoreFormula",
                      "Score formula: level sets the base range (blocked 0–10 · high-risk 20–40 · caution 50–70 · safe 80–100), then each finding deducts points within that range.",
                    )}
                  </p>
                </div>
              );
            })()}

            {/* Meta row */}
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground border-t border-border pt-3">
              <span>
                {t("skill.safetyFilesChecked", "{{count}} file(s) checked", {
                  count: safetyReport.checkedFileCount,
                })}
              </span>
              <span>
                {t("skill.safetyScanMethod", "Method")}:{" "}
                {safetyReport.scanMethod === "ai"
                  ? t("skill.safetyScanMethodAI", "AI-assisted")
                  : t("skill.safetyScanMethodStatic", "Static analysis")}
              </span>
              <span>
                {t("skill.safetyScanTime", "Scanned")}:{" "}
                {new Date(safetyReport.scannedAt).toLocaleString(
                  i18n.language || undefined,
                )}
              </span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              {getSkillSafetyMethodDescription(t, safetyReport)}
            </p>

            {/* Findings list */}
            <div className="space-y-2">
              {groupedSafetyFindings.length === 0 ? (
                <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
                  <CheckCircleIcon className="w-4 h-4 shrink-0" />
                  {t("skill.safetyNoFindings", "No issues found")}
                </div>
              ) : (
                groupedSafetyFindings.map((finding, idx) => {
                  const severityConfig = {
                    high: {
                      cls: "border-red-500/30 bg-red-500/5",
                      icon: (
                        <AlertTriangleIcon className="w-4 h-4 text-destructive shrink-0" />
                      ),
                      badge: "bg-red-500/15 text-red-700 dark:text-red-400",
                      label: t("skill.safetySeverityHigh", "High"),
                    },
                    warn: {
                      cls: "border-amber-500/30 bg-amber-500/5",
                      icon: (
                        <AlertTriangleIcon className="w-4 h-4 text-amber-500 shrink-0" />
                      ),
                      badge:
                        "bg-amber-500/15 text-amber-700 dark:text-amber-400",
                      label: t("skill.safetySeverityWarn", "Warning"),
                    },
                    info: {
                      cls: "border-blue-500/20 bg-blue-500/5",
                      icon: (
                        <InfoIcon className="w-4 h-4 text-blue-500 shrink-0" />
                      ),
                      badge: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
                      label: t("skill.safetySeverityInfo", "Info"),
                    },
                  };
                  const cfg =
                    severityConfig[finding.severity] ?? severityConfig.info;
                  return (
                    <div
                      key={idx}
                      className={`rounded-lg border px-4 py-3 ${cfg.cls}`}
                    >
                      <div className="flex items-start gap-3">
                        {cfg.icon}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-foreground">
                              {getSkillSafetyFindingTitle(t, finding)}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cfg.badge}`}
                            >
                              {cfg.label}
                            </span>
                            {finding.count > 1 && (
                              <span className="text-[10px] text-muted-foreground font-medium">
                                × {finding.count}
                              </span>
                            )}
                            {finding.filePaths[0] && (
                              <span className="text-[10px] text-muted-foreground font-mono truncate">
                                {finding.filePaths[0]}
                              </span>
                            )}
                          </div>
                          {finding.detail && (
                            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                              {finding.detail}
                            </p>
                          )}
                          {finding.evidences[0] && (
                            <code className="mt-1.5 block text-[11px] bg-muted/60 rounded px-2 py-1 text-muted-foreground font-mono break-all">
                              {finding.evidences[0]}
                            </code>
                          )}
                          {finding.filePaths.length > 1 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {finding.filePaths.slice(1, 5).map((filePath) => (
                                <span
                                  key={filePath}
                                  className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground font-mono"
                                >
                                  {filePath}
                                </span>
                              ))}
                              {finding.filePaths.length > 5 && (
                                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                                  +{finding.filePaths.length - 5}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer: rescan button */}
            <div className="flex items-center justify-end border-t border-border pt-4">
              <button
                type="button"
                onClick={async () => {
                  setIsSafetyModalOpen(false);
                  await runSafetyScan();
                  setIsSafetyModalOpen(true);
                }}
                disabled={isScanningSafety}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
              >
                <RefreshCwIcon
                  className={`h-4 w-4 ${isScanningSafety ? "animate-spin" : ""}`}
                />
                {isScanningSafety
                  ? t("skill.safetyScanning", "Scanning...")
                  : t("skill.safetyRescan", "Rescan")}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
