import {
  CheckIcon,
  DownloadIcon,
  Loader2Icon,
  PlusIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { RegistrySkill } from "@prompthub/shared/types";
import { SkillIcon } from "./SkillIcon";
import { SkillInsightPanel } from "./SkillInsightPanel";
import type { SkillInsightCacheEntry } from "../../stores/skill.store";

const MAX_STAGGERED_STORE_CARDS = 12;

interface SkillStoreCardProps {
  skill: RegistrySkill;
  isInstalled: boolean;
  hasUpdate?: boolean;
  index: number;
  installingSlug?: string | null;
  insightEntry?: SkillInsightCacheEntry | null;
  insightEnabled?: boolean;
  onQuickInstall?: (skill: RegistrySkill, e: React.MouseEvent) => void;
  onRefreshInsight?: (skill: RegistrySkill, e: React.MouseEvent) => void;
  onClick: () => void;
}

export function SkillStoreCard({
  skill,
  isInstalled,
  hasUpdate = false,
  index,
  installingSlug,
  insightEntry,
  insightEnabled = false,
  onQuickInstall,
  onRefreshInsight,
  onClick,
}: SkillStoreCardProps) {
  const { t } = useTranslation();
  const isInstallingThis = installingSlug === skill.slug;

  return (
    <div
      onClick={onClick}
      style={{
        animationDelay: `${Math.min(index, MAX_STAGGERED_STORE_CARDS) * 30}ms`,
        contentVisibility: "auto",
        containIntrinsicSize: "196px",
      }}
      className="group relative flex flex-col gap-4 rounded-xl border border-border bg-card p-4 transition-all animate-in fade-in slide-in-from-bottom-2 hover:border-primary/40 hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        <SkillIcon
          iconUrl={skill.icon_url}
          iconEmoji={skill.icon_emoji}
          backgroundColor={skill.icon_background}
          name={skill.name}
          size="md"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
              {skill.name}
            </h4>
            {skill.weekly_installs && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                {skill.weekly_installs}/wk
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {skill.description}
          </p>
        </div>

        <div className="shrink-0">
          {hasUpdate ? (
            <div
              className="p-1.5 text-amber-500"
              title={t("skill.updateAvailable", "Update available")}
            >
              <DownloadIcon className="h-4 w-4" />
            </div>
          ) : isInstalled ? (
            <div
              className="p-1.5 text-green-500"
              title={t("skill.imported", "Imported")}
            >
              <CheckIcon className="h-4 w-4" />
            </div>
          ) : (
            <button
              onClick={(e) => onQuickInstall?.(skill, e)}
              disabled={isInstallingThis}
              className="rounded-lg p-1.5 text-muted-foreground transition-all hover:bg-primary/10 hover:text-primary active:scale-90 disabled:opacity-50"
              title={t("skill.install", "Install")}
            >
              {isInstallingThis ? (
                <Loader2Icon className="h-4 w-4 animate-spin text-primary" />
              ) : (
                <PlusIcon className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
      </div>

      <SkillInsightPanel
        skill={skill}
        insightEntry={insightEntry}
        insightEnabled={insightEnabled}
        onRefreshInsight={onRefreshInsight}
        showSupplementalDetails={false}
        className="rounded-lg border-border/70 bg-background/45 p-2.5"
      />
    </div>
  );
}
