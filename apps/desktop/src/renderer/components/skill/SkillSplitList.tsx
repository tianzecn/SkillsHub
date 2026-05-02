import {
  type AriaAttributes,
  type CSSProperties,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useTranslation } from "react-i18next";
import { List, type ListImperativeAPI } from "react-window";
import {
  CheckSquareIcon,
  CuboidIcon,
  FolderInputIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldIcon,
  SquareIcon,
  StarIcon,
  StoreIcon,
  TagsIcon,
  XIcon,
  PlusIcon,
} from "lucide-react";
import { SkillIcon } from "./SkillIcon";
import {
  type SkillFilterType,
  useSkillStore,
} from "../../stores/skill.store";
import type { Skill, SkillSafetyLevel } from "@prompthub/shared/types";
import { getRuntimeCapabilities } from "../../runtime";

const VIRTUALIZATION_THRESHOLD = 200;
const ROW_HEIGHT = 84;

interface SkillSplitListProps {
  skills: Skill[];
  allSkills: Skill[];
  selectedSkillId: string | null;
  onSelect: (skillId: string) => void;
  selectionMode?: boolean;
  selectedSkillIds?: Set<string>;
  onToggleSelection?: (skillId: string) => void;
  onEnterSelectionMode: () => void;
  onCreateSkill: () => void;
  onScanLocal?: () => void;
  onOpenStore?: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  isScanning: boolean;
  emptyTitle: string;
  emptyHint: string;
  width: number;
  compact?: boolean;
  searchInputRef?: RefObject<HTMLInputElement>;
}

interface SkillRowData {
  skills: Skill[];
  selectedSkillId: string | null;
  selectionMode: boolean;
  selectedSkillIds: Set<string>;
  onSelect: (skillId: string) => void;
  onToggleSelection?: (skillId: string) => void;
}

type SkillRowProps = SkillRowData & {
  ariaAttributes?: AriaAttributes & { role?: string };
  index: number;
  style?: CSSProperties;
};

function getSafetyIconProps(level: SkillSafetyLevel): {
  Icon: typeof ShieldCheckIcon;
  className: string;
} {
  switch (level) {
    case "safe":
      return { Icon: ShieldCheckIcon, className: "text-emerald-500" };
    case "warn":
      return { Icon: ShieldAlertIcon, className: "text-yellow-500" };
    case "high-risk":
      return { Icon: ShieldAlertIcon, className: "text-orange-500" };
    case "blocked":
      return { Icon: ShieldAlertIcon, className: "text-destructive" };
  }
}

function getSkillTags(skill: Skill): string[] {
  return Array.isArray(skill.tags)
    ? skill.tags.filter((tag): tag is string => typeof tag === "string")
    : [];
}

function SkillSplitRow({
  ariaAttributes,
  index,
  style,
  skills,
  selectedSkillId,
  selectionMode,
  selectedSkillIds,
  onSelect,
  onToggleSelection,
}: SkillRowProps) {
  const { t } = useTranslation();
  const toggleFavorite = useSkillStore((state) => state.toggleFavorite);
  const deployedSkillNames = useSkillStore((state) => state.deployedSkillNames);
  const skill = skills[index];
  if (!skill) return null;

  const isSelected = selectedSkillId === skill.id;
  const isChecked = selectedSkillIds.has(skill.id);
  const safety = skill.safetyReport?.level
    ? getSafetyIconProps(skill.safetyReport.level)
    : null;
  const deployedCount = deployedSkillNames.has(skill.name) ? 1 : 0;

  return (
    <div
      {...ariaAttributes}
      key={skill.id}
      data-skill-id={skill.id}
      onClick={() => {
        if (selectionMode) {
          onToggleSelection?.(skill.id);
          return;
        }
        onSelect(skill.id);
      }}
      style={{
        ...style,
        contentVisibility: "auto",
        containIntrinsicSize: `${ROW_HEIGHT}px`,
      }}
      className={`group flex h-[84px] items-start gap-3 border-b border-border px-3 py-3 cursor-pointer transition-colors ${
        selectionMode && isChecked
          ? "bg-primary/[0.08]"
          : isSelected
            ? "bg-primary/[0.06] shadow-[inset_2px_0_0_hsl(var(--primary))]"
            : "hover:bg-accent/40"
      }`}
    >
      {selectionMode && (
        <input
          type="checkbox"
          checked={isChecked}
          onChange={(event) => {
            event.stopPropagation();
            onToggleSelection?.(skill.id);
          }}
          className="mt-1 shrink-0"
          aria-label={t("skill.split.toggleSelection")}
        />
      )}
      <SkillIcon
        iconUrl={skill.icon_url}
        iconEmoji={skill.icon_emoji}
        backgroundColor={skill.icon_background}
        name={skill.name}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <h4
            className={`truncate text-sm font-medium ${
              isSelected ? "text-primary" : "text-foreground"
            }`}
          >
            {skill.name}
          </h4>
          {skill.is_favorite && (
            <StarIcon className="h-3 w-3 shrink-0 fill-yellow-400 text-yellow-400" />
          )}
          {safety ? (
            <safety.Icon className={`h-3 w-3 shrink-0 ${safety.className}`} />
          ) : (
            <ShieldIcon className="h-3 w-3 shrink-0 text-muted-foreground/40" />
          )}
        </div>
        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
          {skill.description || t("skill.noDescription", "No description")}
        </p>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {deployedCount}/5
          </span>
          {getSkillTags(skill)
            .slice(0, 1)
            .map((tag) => (
              <span
                key={tag}
                className="truncate rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
              >
                {tag}
              </span>
            ))}
        </div>
      </div>
      {!selectionMode && (
        <button
          onClick={(event) => {
            event.stopPropagation();
            void toggleFavorite(skill.id);
          }}
          className={`shrink-0 rounded p-1 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 ${
            skill.is_favorite
              ? "text-yellow-500 opacity-100"
              : "text-muted-foreground hover:text-foreground"
          }`}
          title={
            skill.is_favorite
              ? t("skill.removeFavorite")
              : t("skill.addFavorite")
          }
        >
          <StarIcon
            className={`h-3.5 w-3.5 ${skill.is_favorite ? "fill-current" : ""}`}
          />
        </button>
      )}
    </div>
  );
}

function filterLabel(filter: SkillFilterType): string {
  return `filter.${filter}`;
}

export function SkillSplitList({
  skills,
  allSkills,
  selectedSkillId,
  onSelect,
  selectionMode = false,
  selectedSkillIds = new Set<string>(),
  onToggleSelection,
  onEnterSelectionMode,
  onCreateSkill,
  onScanLocal,
  onOpenStore,
  onRefresh,
  isRefreshing,
  isScanning,
  emptyTitle,
  emptyHint,
  width,
  compact = false,
  searchInputRef,
}: SkillSplitListProps) {
  const { t } = useTranslation();
  const runtimeCapabilities = getRuntimeCapabilities();
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<ListImperativeAPI>(null);
  const internalSearchRef = useRef<HTMLInputElement>(null);
  const resolvedSearchRef = searchInputRef ?? internalSearchRef;
  const searchQuery = useSkillStore((state) => state.searchQuery);
  const setSearchQuery = useSkillStore((state) => state.setSearchQuery);
  const filterType = useSkillStore((state) => state.filterType);
  const setFilterType = useSkillStore((state) => state.setFilterType);
  const filterTags = useSkillStore((state) => state.filterTags);
  const toggleFilterTag = useSkillStore((state) => state.toggleFilterTag);
  const clearFilterTags = useSkillStore((state) => state.clearFilterTags);
  const storeView = useSkillStore((state) => state.storeView);

  const availableTags = useMemo(
    () =>
      Array.from(new Set(allSkills.flatMap(getSkillTags)))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 12),
    [allSkills],
  );

  useEffect(() => {
    if (!selectedSkillId) return;
    const index = skills.findIndex((skill) => skill.id === selectedSkillId);
    if (index < 0) return;
    if (skills.length >= VIRTUALIZATION_THRESHOLD) {
      listRef.current?.scrollToRow({ index, align: "smart" });
      return;
    }
    const node = containerRef.current?.querySelector<HTMLElement>(
      `[data-skill-id="${CSS.escape(selectedSkillId)}"]`,
    );
    node?.scrollIntoView({ block: "nearest" });
  }, [selectedSkillId, skills]);

  const filterOptions: SkillFilterType[] = [
    "all",
    "favorites",
    ...(runtimeCapabilities.skillDistribution
      ? (["installed", "deployed", "pending"] as SkillFilterType[])
      : []),
  ];
  const useVirtualRows = skills.length >= VIRTUALIZATION_THRESHOLD;

  return (
    <div className="flex h-full min-h-0 flex-col bg-card/40">
      <div className="sticky top-0 z-10 border-b border-border bg-card/95 p-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={resolvedSearchRef}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t("common.search", "Search")}
              className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-8 text-sm outline-none transition-colors focus:border-primary"
            />
            {searchQuery ? (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                title={t("common.clear")}
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          <button
            onClick={onCreateSkill}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
            title={t("header.new", "New")}
          >
            <PlusIcon className="h-4 w-4" />
          </button>
          {runtimeCapabilities.skillLocalScan && onScanLocal ? (
            <button
              onClick={onScanLocal}
              disabled={isScanning}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
              title={t("skill.scanLocal")}
            >
              <FolderInputIcon
                className={`h-4 w-4 ${isScanning ? "animate-spin" : ""}`}
              />
            </button>
          ) : null}
        </div>

        <div className="mt-2 flex items-center gap-1 overflow-x-auto pb-1">
          {filterOptions.map((option) => (
            <button
              key={option}
              onClick={() => setFilterType(option)}
              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                filterType === option
                  ? "bg-primary text-primary-foreground"
                  : "bg-accent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(filterLabel(option), option)}
            </button>
          ))}
        </div>

        {availableTags.length > 0 || filterTags.length > 0 ? (
          <div className="mt-1 flex items-center gap-1 overflow-x-auto pb-1">
            {filterTags.length > 0 ? (
              <button
                onClick={clearFilterTags}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                title={t("common.clear")}
              >
                <XIcon className="h-3 w-3" />
                {t("common.clear")}
              </button>
            ) : null}
            {availableTags.map((tag) => {
              const active = filterTags.includes(tag);
              return (
                <button
                  key={tag}
                  onClick={() => toggleFilterTag(tag)}
                  className={`inline-flex max-w-[9rem] shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium transition-colors ${
                    active
                      ? "bg-primary/15 text-primary"
                      : "bg-accent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <TagsIcon className="h-3 w-3" />
                  <span className="truncate">{tag}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            {t("skill.split.listCount", {
              count: skills.length,
              defaultValue: "{{count}} skills",
            })}
          </span>
          <div className="flex items-center gap-1">
            {!selectionMode ? (
              <button
                onClick={onEnterSelectionMode}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                title={t("skill.batchManage")}
              >
                <CheckSquareIcon className="h-4 w-4" />
              </button>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
                <SquareIcon className="h-3 w-3" />
                {selectedSkillIds.size}
              </span>
            )}
            {runtimeCapabilities.skillStore && storeView !== "store" ? (
              <button
                onClick={onOpenStore}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                title={t("nav.skillStore")}
              >
                <StoreIcon className="h-4 w-4" />
              </button>
            ) : null}
            <button
              onClick={onRefresh}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
              title={t("common.refresh")}
            >
              <RefreshCwIcon
                className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        </div>
      </div>

      {skills.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center p-8 text-center text-muted-foreground">
          <div className="mb-4 rounded-full bg-accent/30 p-6">
            <CuboidIcon className="h-12 w-12 opacity-30" />
          </div>
          <h3 className="mb-1 text-base font-semibold text-foreground">
            {emptyTitle}
          </h3>
          <p className="max-w-xs text-xs opacity-70">{emptyHint}</p>
        </div>
      ) : (
        <div ref={containerRef} className="min-h-0 flex-1 overflow-y-auto">
          {useVirtualRows ? (
            <List<SkillRowData>
              listRef={listRef}
              className="h-full"
              defaultHeight={640}
              rowComponent={SkillSplitRow}
              rowCount={skills.length}
              rowHeight={ROW_HEIGHT}
              rowProps={{
                skills,
                selectedSkillId,
                selectionMode,
                selectedSkillIds,
                onSelect,
                onToggleSelection,
              }}
              overscanCount={6}
              style={{ height: "100%" }}
            />
          ) : (
            <div className="divide-y divide-border">
              {skills.map((_, index) => (
                <SkillSplitRow
                  key={skills[index].id}
                  index={index}
                  skills={skills}
                  selectedSkillId={selectedSkillId}
                  selectionMode={selectionMode}
                  selectedSkillIds={selectedSkillIds}
                  onSelect={onSelect}
                  onToggleSelection={onToggleSelection}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {compact ? (
        <div className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
          {t("skill.split.compactHint", "List drawer")}
        </div>
      ) : null}
    </div>
  );
}
