import { useTranslation } from "react-i18next";
import {
  CheckSquareIcon,
  SendIcon,
  StarIcon,
  TagsIcon,
  TrashIcon,
  XIcon,
} from "lucide-react";
import { SkillIcon } from "./SkillIcon";
import type { Skill } from "@prompthub/shared/types";

interface SkillBatchSummaryPanelProps {
  selectedSkills: Skill[];
  onSelectAllVisible: () => void;
  onFavorite: () => void;
  onTags: () => void;
  onDeploy: () => void;
  onDelete: () => void;
  onExit: () => void;
  allVisibleSelected: boolean;
  canDeploy: boolean;
}

export function SkillBatchSummaryPanel({
  selectedSkills,
  onSelectAllVisible,
  onFavorite,
  onTags,
  onDeploy,
  onDelete,
  onExit,
  allVisibleSelected,
  canDeploy,
}: SkillBatchSummaryPanelProps) {
  const { t } = useTranslation();
  const selectedCount = selectedSkills.length;
  const shouldFavorite = selectedSkills.some((skill) => !skill.is_favorite);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-background/90 px-6 py-4 backdrop-blur">
        <div>
          <div className="text-[11px] font-medium uppercase text-primary/80">
            {t("skill.selectionMode")}
          </div>
          <h3 className="text-lg font-semibold text-foreground">
            {t("skill.split.batchSummary", { count: selectedCount })}
          </h3>
        </div>
        <button
          onClick={onExit}
          className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          title={t("common.cancel")}
        >
          <XIcon className="h-5 w-5" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={onSelectAllVisible}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            <CheckSquareIcon className="h-4 w-4 text-primary" />
            {allVisibleSelected ? t("common.clear") : t("common.selectAll")}
          </button>
          <button
            onClick={onFavorite}
            disabled={selectedCount === 0}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            <StarIcon className="h-4 w-4 text-amber-500" />
            {shouldFavorite ? t("skill.addFavorite") : t("skill.removeFavorite")}
          </button>
          <button
            onClick={onTags}
            disabled={selectedCount === 0}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            <TagsIcon className="h-4 w-4 text-primary" />
            {t("skill.batchTags")}
          </button>
          {canDeploy ? (
            <button
              onClick={onDeploy}
              disabled={selectedCount === 0}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <SendIcon className="h-4 w-4" />
              {t("skill.batchDeploy")}
            </button>
          ) : null}
          <button
            onClick={onDelete}
            disabled={selectedCount === 0}
            className="inline-flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/15 disabled:opacity-50"
          >
            <TrashIcon className="h-4 w-4" />
            {t("common.delete")}
          </button>
        </div>

        {selectedCount === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {t("skill.split.noBatchSelection", "No skills selected yet")}
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {selectedSkills.map((skill) => (
              <div
                key={skill.id}
                className="flex min-w-0 items-center gap-3 rounded-md border border-border bg-card p-3"
              >
                <SkillIcon
                  iconUrl={skill.icon_url}
                  iconEmoji={skill.icon_emoji}
                  backgroundColor={skill.icon_background}
                  name={skill.name}
                  size="sm"
                />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">
                    {skill.name}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {skill.description || t("skill.noDescription")}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
