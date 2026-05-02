import {
  ArrowLeftIcon,
  ExpandIcon,
  GlobeIcon,
  HistoryIcon,
  PencilIcon,
  SaveIcon,
  ShrinkIcon,
  StarIcon,
  TrashIcon,
} from "lucide-react";
import type { TFunction } from "i18next";
import { SkillIcon } from "./SkillIcon";
import type { Skill } from "@prompthub/shared/types";

interface SkillDetailActionHeaderProps {
  selectedSkill: Skill;
  t: TFunction;
  // Visibility flags
  showBackButton: boolean;
  showFullscreenToggle: boolean;
  isFullscreen: boolean;
  // Action state
  isCreatingSnapshot: boolean;
  // Handlers
  onBack: () => void;
  onOpenSnapshot: () => void;
  onToggleFavorite: () => void;
  onOpenVersionHistory: () => void;
  onOpenEdit: () => void;
  onDelete: () => void;
  onToggleFullscreen?: () => void;
}

/**
 * Sticky action header for the Skill detail surface.
 * Used by both the standalone full-screen `SkillFullDetailPage` and the
 * embedded right pane of `SkillSplitView`.
 */
export function SkillDetailActionHeader({
  selectedSkill,
  t,
  showBackButton,
  showFullscreenToggle,
  isFullscreen,
  isCreatingSnapshot,
  onBack,
  onOpenSnapshot,
  onToggleFavorite,
  onOpenVersionHistory,
  onOpenEdit,
  onDelete,
  onToggleFullscreen,
}: SkillDetailActionHeaderProps) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-background/80 backdrop-blur-md z-10">
      <div className="flex items-center gap-4">
        {showBackButton && (
          <button
            onClick={onBack}
            className="p-2 -ml-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-all active:scale-95"
            title={t("common.back", "Back")}
          >
            <ArrowLeftIcon className="w-5 h-5" />
          </button>
        )}
        <SkillIcon
          iconUrl={selectedSkill.icon_url}
          iconEmoji={selectedSkill.icon_emoji}
          backgroundColor={selectedSkill.icon_background}
          name={selectedSkill.name}
          size="lg"
        />
        <div>
          <h2 className="font-bold text-xl text-foreground leading-tight">
            {selectedSkill.name}
          </h2>
          <div className="mt-1 flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-medium">
              <GlobeIcon className="w-3.5 h-3.5" />
              {selectedSkill.author || t("skill.localStorage")}
            </div>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              {t("skill.currentVersion", "Version")} v
              {selectedSkill.currentVersion || 0}
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {showFullscreenToggle && onToggleFullscreen && (
          <button
            onClick={onToggleFullscreen}
            className="p-2.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-full transition-all active:scale-95"
            title={
              isFullscreen
                ? t("skill.split.exitFullscreen", "Exit fullscreen")
                : t("skill.split.fullscreen", "Open in fullscreen")
            }
          >
            {isFullscreen ? (
              <ShrinkIcon className="w-5 h-5" />
            ) : (
              <ExpandIcon className="w-5 h-5" />
            )}
          </button>
        )}
        <button
          onClick={onOpenSnapshot}
          disabled={isCreatingSnapshot}
          className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-all hover:border-primary/30 hover:bg-primary/5 hover:text-primary disabled:opacity-50"
          title={t("skill.createSnapshot", "Create Snapshot")}
        >
          <SaveIcon className="h-4 w-4" />
          {t("skill.snapshot", "Snapshot")}
        </button>
        <button
          onClick={onToggleFavorite}
          className={`p-2.5 rounded-full transition-all active:scale-95 ${
            selectedSkill.is_favorite
              ? "text-yellow-500 hover:text-yellow-600"
              : "text-muted-foreground hover:text-yellow-500 hover:bg-yellow-500/10"
          }`}
          title={
            selectedSkill.is_favorite
              ? t("skill.removeFavorite", "Remove Favorite")
              : t("skill.addFavorite", "Add to Favorites")
          }
        >
          <StarIcon
            className={`w-5 h-5 ${selectedSkill.is_favorite ? "fill-current" : ""}`}
          />
        </button>
        <button
          onClick={onOpenVersionHistory}
          className="p-2.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-full transition-all active:scale-95"
          title={t("skill.versionHistory", "Version History")}
        >
          <HistoryIcon className="w-5 h-5" />
        </button>
        <button
          onClick={onOpenEdit}
          className="p-2.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-full transition-all active:scale-95"
          title={t("skill.edit", "Edit Skill")}
        >
          <PencilIcon className="w-5 h-5" />
        </button>
        <button
          onClick={onDelete}
          className="p-2.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full transition-all active:scale-95"
          title={t("common.delete", "Delete")}
        >
          <TrashIcon className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
