import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { CheckSquareIcon, CuboidIcon, MenuIcon } from "lucide-react";
import { useSkillStore } from "../../stores/skill.store";
import {
  DEFAULT_SPLIT_LIST_WIDTH,
  SPLIT_LIST_WIDTH_MAX,
  SPLIT_LIST_WIDTH_MIN,
  useSettingsStore,
} from "../../stores/settings.store";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { SkillSplitList } from "./SkillSplitList";
import { SkillRenderBoundary } from "./SkillRenderBoundary";
import { SkillBatchSummaryPanel } from "./SkillBatchSummaryPanel";
import { SkillIcon } from "./SkillIcon";
import { UnsavedChangesDialog } from "../ui/UnsavedChangesDialog";
import type { Skill } from "@prompthub/shared/types";

const SkillFullDetailPage = lazy(() =>
  import("./SkillFullDetailPage").then((m) => ({
    default: m.SkillFullDetailPage,
  })),
);

const SELECTION_DEBOUNCE_MS = 200;
const SPLIT_WIDTH_PERSIST_DEBOUNCE_MS = 200;

type SplitLayoutMode = "wide" | "collapsed" | "fallback";

interface SkillSplitViewProps {
  visibleSkills: Skill[];
  allSkills: Skill[];
  selectionMode: boolean;
  selectedSkillIds: Set<string>;
  selectedSkills: Skill[];
  onToggleSelection: (skillId: string) => void;
  onEnterSelectionMode: () => void;
  onExitSelectionMode: () => void;
  onCreateSkill: () => void;
  onScanLocal?: () => void;
  onOpenStore?: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  isScanning: boolean;
  emptyTitle: string;
  emptyHint: string;
  onSelectAllVisible: () => void;
  onBatchFavorite: () => void;
  onBatchTags: () => void;
  onBatchDeploy: () => void;
  onBatchDelete: () => void;
  allVisibleSelected: boolean;
  canDeploy: boolean;
}

function getLayoutMode(width: number): SplitLayoutMode {
  if (width >= 1280) return "wide";
  if (width >= 1024) return "collapsed";
  return "fallback";
}

function useWindowWidth(): number {
  const [width, setWidth] = useState(() =>
    typeof window === "undefined" ? 1280 : window.innerWidth,
  );

  useEffect(() => {
    const updateWidth = () => setWidth(window.innerWidth);
    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  return width;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable
  );
}

export function SkillSplitView({
  visibleSkills,
  allSkills,
  selectionMode,
  selectedSkillIds,
  selectedSkills,
  onToggleSelection,
  onEnterSelectionMode,
  onExitSelectionMode,
  onCreateSkill,
  onScanLocal,
  onOpenStore,
  onRefresh,
  isRefreshing,
  isScanning,
  emptyTitle,
  emptyHint,
  onSelectAllVisible,
  onBatchFavorite,
  onBatchTags,
  onBatchDeploy,
  onBatchDelete,
  allVisibleSelected,
  canDeploy,
}: SkillSplitViewProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const drawerButtonRef = useRef<HTMLButtonElement>(null);
  const pendingSelectionRef = useRef<string | null>(null);
  const windowWidth = useWindowWidth();
  const layoutMode = getLayoutMode(windowWidth);

  const selectedSkillId = useSkillStore((state) => state.selectedSkillId);
  const selectSkill = useSkillStore((state) => state.selectSkill);
  const splitFullscreen = useSkillStore((state) => state.splitFullscreen);
  const setSplitFullscreen =
    useSkillStore((state) => state.setSplitFullscreen) ?? (() => undefined);
  const splitDrawerOpen = useSkillStore((state) => state.splitDrawerOpen);
  const setSplitDrawerOpen =
    useSkillStore((state) => state.setSplitDrawerOpen) ?? (() => undefined);
  const previousSelectedSkillId = useSkillStore(
    (state) => state.previousSelectedSkillId,
  );
  const setPreviousSelectedSkillId =
    useSkillStore((state) => state.setPreviousSelectedSkillId) ??
    (() => undefined);
  const splitListWidth = useSettingsStore((state) => state.splitListWidth);
  const setSplitListWidth = useSettingsStore((state) => state.setSplitListWidth);
  const [detailDirty, setDetailDirty] = useState(false);
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);

  const debouncedSelectedId = useDebouncedValue(
    selectedSkillId,
    SELECTION_DEBOUNCE_MS,
  );

  const debouncedSelectedSkill = useMemo(
    () => allSkills.find((skill) => skill.id === debouncedSelectedId),
    [allSkills, debouncedSelectedId],
  );

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const settingsApi = window.api?.settings;
      if (settingsApi && typeof settingsApi.set === "function") {
        void settingsApi.set({ splitListWidth });
      }
    }, SPLIT_WIDTH_PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [splitListWidth]);

  useEffect(() => {
    if (visibleSkills.length === 0) {
      if (selectedSkillId !== null) selectSkill(null);
      return;
    }

    const stillVisible =
      selectedSkillId !== null &&
      visibleSkills.some((skill) => skill.id === selectedSkillId);

    if (!stillVisible) {
      selectSkill(visibleSkills[0].id);
    }
  }, [visibleSkills, selectedSkillId, selectSkill]);

  useEffect(() => {
    if (selectionMode && previousSelectedSkillId === null) {
      setPreviousSelectedSkillId(selectedSkillId);
      return;
    }

    if (!selectionMode && previousSelectedSkillId !== null) {
      const restored = visibleSkills.some(
        (skill) => skill.id === previousSelectedSkillId,
      )
        ? previousSelectedSkillId
        : (visibleSkills[0]?.id ?? null);
      selectSkill(restored);
      setPreviousSelectedSkillId(null);
    }
  }, [
    previousSelectedSkillId,
    selectSkill,
    selectedSkillId,
    selectionMode,
    setPreviousSelectedSkillId,
    visibleSkills,
  ]);

  useEffect(() => {
    if (!splitDrawerOpen) return;
    const handle = window.setTimeout(() => searchInputRef.current?.focus(), 0);
    return () => window.clearTimeout(handle);
  }, [splitDrawerOpen]);

  useEffect(() => {
    if (!splitDrawerOpen) {
      drawerButtonRef.current?.focus();
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        rootRef.current?.contains(target)
      ) {
        return;
      }
      setSplitDrawerOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [setSplitDrawerOpen, splitDrawerOpen]);

  const commitSelection = useCallback(
    (skillId: string | null) => {
      if (skillId === selectedSkillId) return;
      if (detailDirty) {
        pendingSelectionRef.current = skillId;
        setUnsavedDialogOpen(true);
        return;
      }
      selectSkill(skillId);
      setSplitDrawerOpen(false);
    },
    [detailDirty, selectSkill, selectedSkillId, setSplitDrawerOpen],
  );

  const moveSelection = useCallback(
    (direction: 1 | -1) => {
      if (visibleSkills.length === 0) return;
      const currentIndex = visibleSkills.findIndex(
        (skill) => skill.id === selectedSkillId,
      );
      const baseIndex = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex =
        (baseIndex + direction + visibleSkills.length) % visibleSkills.length;
      commitSelection(visibleSkills[nextIndex].id);
    },
    [commitSelection, selectedSkillId, visibleSkills],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveSelection(1);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveSelection(-1);
        return;
      }

      if (event.key === "Escape") {
        if (unsavedDialogOpen) return;
        if (splitDrawerOpen) {
          setSplitDrawerOpen(false);
          return;
        }
        if (splitFullscreen) {
          setSplitFullscreen(false);
          return;
        }
        if (selectionMode) {
          onExitSelectionMode();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    moveSelection,
    onExitSelectionMode,
    selectionMode,
    setSplitDrawerOpen,
    setSplitFullscreen,
    splitDrawerOpen,
    splitFullscreen,
    unsavedDialogOpen,
  ]);

  const startResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = splitListWidth;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.max(
        SPLIT_LIST_WIDTH_MIN,
        Math.min(
          SPLIT_LIST_WIDTH_MAX,
          Math.round(startWidth + moveEvent.clientX - startX),
        ),
      );
      setSplitListWidth(nextWidth);
    };

    const handlePointerUp = () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
  };

  const renderEmptyDetail = () => (
    <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-muted-foreground">
      <div className="mb-4 rounded-full bg-accent/30 p-6">
        <CuboidIcon className="h-12 w-12 opacity-30" />
      </div>
      <h3 className="mb-1 text-base font-semibold text-foreground">
        {t("skill.split.empty")}
      </h3>
      <p className="max-w-md text-xs opacity-70">
        {t("skill.split.noSkillsHint")}
      </p>
    </div>
  );

  const renderDetail = (embedded: boolean) => {
    if (!debouncedSelectedSkill) return renderEmptyDetail();

    return (
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        }
      >
        <SkillRenderBoundary
          resetKey={debouncedSelectedSkill.id}
          title={t("skill.detailRenderError")}
          description={t("skill.detailRenderErrorHint")}
          primaryActionLabel={embedded ? undefined : t("common.back")}
          onPrimaryAction={embedded ? undefined : () => commitSelection(null)}
          secondaryActionLabel={t("common.retry")}
          onSecondaryAction={onRefresh}
        >
          <SkillFullDetailPage
            embedded={embedded}
            skillId={debouncedSelectedSkill.id}
            isFullscreen={splitFullscreen}
            onToggleFullscreen={() => setSplitFullscreen(!splitFullscreen)}
            onDirtyStateChange={setDetailDirty}
          />
        </SkillRenderBoundary>
      </Suspense>
    );
  };

  const list = (
    <SkillSplitList
      skills={visibleSkills}
      allSkills={allSkills}
      selectedSkillId={selectedSkillId}
      onSelect={commitSelection}
      selectionMode={selectionMode}
      selectedSkillIds={selectedSkillIds}
      onToggleSelection={onToggleSelection}
      onEnterSelectionMode={onEnterSelectionMode}
      onCreateSkill={onCreateSkill}
      onScanLocal={onScanLocal}
      onOpenStore={onOpenStore}
      onRefresh={onRefresh}
      isRefreshing={isRefreshing}
      isScanning={isScanning}
      emptyTitle={emptyTitle}
      emptyHint={emptyHint}
      width={splitListWidth}
      compact={layoutMode === "collapsed"}
      searchInputRef={searchInputRef}
    />
  );

  if (layoutMode === "fallback") {
    return (
      <div className="flex h-full flex-1 overflow-hidden bg-background">
        {renderDetail(false)}
        <UnsavedChangesDialog
          isOpen={unsavedDialogOpen}
          onClose={() => setUnsavedDialogOpen(false)}
          onSave={() => setUnsavedDialogOpen(false)}
          onDiscard={() => {
            setUnsavedDialogOpen(false);
            selectSkill(pendingSelectionRef.current);
            pendingSelectionRef.current = null;
          }}
        />
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="relative flex h-full flex-1 flex-row overflow-hidden bg-background"
      data-split-layout={layoutMode}
    >
      {!splitFullscreen && layoutMode === "wide" ? (
        <div
          className="relative flex shrink-0 flex-col border-r border-border bg-card/40"
          style={{ width: `${splitListWidth}px` }}
        >
          {list}
          <button
            type="button"
            onPointerDown={startResize}
            onDoubleClick={() => setSplitListWidth(DEFAULT_SPLIT_LIST_WIDTH)}
            className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent transition-colors hover:bg-primary/40 focus:bg-primary/40 focus:outline-none"
            title={t("skill.split.resizeHandleTooltip")}
            aria-label={t("skill.split.resizeHandleTooltip")}
          />
        </div>
      ) : null}

      {!splitFullscreen && layoutMode === "collapsed" ? (
        <div className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-border bg-card/70 py-3">
          <button
            ref={drawerButtonRef}
            onClick={() => setSplitDrawerOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            title={t("skill.split.openListDrawer")}
            aria-label={t("skill.split.openListDrawer")}
          >
            <MenuIcon className="h-5 w-5" />
          </button>
          {!selectionMode ? (
            <button
              onClick={onEnterSelectionMode}
              className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              title={t("skill.batchManage")}
              aria-label={t("skill.batchManage")}
            >
              <CheckSquareIcon className="h-5 w-5" />
            </button>
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
            {visibleSkills.slice(0, 24).map((skill) => (
              <button
                key={skill.id}
                onClick={() => commitSelection(skill.id)}
                className={`rounded-md p-1.5 ${
                  selectedSkillId === skill.id
                    ? "bg-primary/10"
                    : "hover:bg-accent"
                }`}
                title={skill.name}
              >
                <SkillIcon
                  iconUrl={skill.icon_url}
                  iconEmoji={skill.icon_emoji}
                  backgroundColor={skill.icon_background}
                  name={skill.name}
                  size="sm"
                />
                <span className="sr-only">{skill.name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {selectionMode ? (
          <SkillBatchSummaryPanel
            selectedSkills={selectedSkills}
            onSelectAllVisible={onSelectAllVisible}
            onFavorite={onBatchFavorite}
            onTags={onBatchTags}
            onDeploy={onBatchDeploy}
            onDelete={onBatchDelete}
            onExit={onExitSelectionMode}
            allVisibleSelected={allVisibleSelected}
            canDeploy={canDeploy}
          />
        ) : (
          renderDetail(true)
        )}
      </div>

      {layoutMode === "collapsed" && splitDrawerOpen
        ? createPortal(
            <div className="fixed inset-0 z-40 bg-black/20">
              <div className="h-full w-[min(420px,calc(100vw-72px))] border-r border-border bg-card shadow-2xl">
                {list}
              </div>
            </div>,
            document.body,
          )
        : null}

      <UnsavedChangesDialog
        isOpen={unsavedDialogOpen}
        onClose={() => setUnsavedDialogOpen(false)}
        onSave={() => setUnsavedDialogOpen(false)}
        onDiscard={() => {
          setUnsavedDialogOpen(false);
          selectSkill(pendingSelectionRef.current);
          pendingSelectionRef.current = null;
          setSplitDrawerOpen(false);
        }}
      />
    </div>
  );
}
