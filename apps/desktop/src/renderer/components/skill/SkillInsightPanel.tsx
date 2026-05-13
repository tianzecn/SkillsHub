import { useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import {
  AlertTriangleIcon,
  BrainIcon,
  CheckIcon,
  CheckCircleIcon,
  CopyIcon,
  FileTextIcon,
  InfoIcon,
  Loader2Icon,
  MessageSquareIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
  XCircleIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { RegistrySkill, SkillInsightVerdict } from "@prompthub/shared/types";
import type { SkillInsightCacheEntry } from "../../stores/skill.store";

interface SkillInsightPanelProps {
  skill: RegistrySkill;
  insightEntry?: SkillInsightCacheEntry | null;
  insightEnabled?: boolean;
  onRefreshInsight?: (skill: RegistrySkill, event: MouseEvent) => void;
  showSupplementalDetails?: boolean;
  className?: string;
}

function getVerdictClass(verdict: SkillInsightVerdict): string {
  if (verdict === "recommended") {
    return "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20";
  }
  if (verdict === "not-recommended") {
    return "bg-destructive/10 text-destructive border-destructive/20";
  }
  return "bg-amber-500/10 text-amber-600 dark:text-amber-300 border-amber-500/20";
}

function InsightList({ items }: { items: string[] }) {
  const values = items.length ? items : ["-"];

  return (
    <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-foreground/80">
      {values.map((item) => (
        <li key={item} className="flex gap-2">
          <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function InlineInsightSection({
  title,
  items,
  icon,
}: {
  title: string;
  items: string[];
  icon: ReactNode;
}) {
  const values = items.length ? items : ["-"];

  return (
    <div className="min-w-0">
      <SectionTitle icon={icon} title={title} />
      <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-xs leading-relaxed text-foreground/80">
        {values.map((item) => (
          <span key={item} className="inline-flex min-w-0 items-start gap-1.5">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
            <span>{item}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function SectionTitle({
  icon,
  title,
}: {
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
      <span className="text-muted-foreground/80">{icon}</span>
      {title}
    </div>
  );
}

export function SkillInsightPanel({
  skill,
  insightEntry,
  insightEnabled = false,
  onRefreshInsight,
  showSupplementalDetails = true,
  className = "",
}: SkillInsightPanelProps) {
  const { t } = useTranslation();
  const [copiedExample, setCopiedExample] = useState<string | null>(null);
  const insight = insightEntry?.insight;
  const handleCollapsibleClick = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  };
  const copyPromptExample = async (
    item: string,
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    event.stopPropagation();
    await navigator.clipboard.writeText(item);
    setCopiedExample(item);
    window.setTimeout(() => {
      setCopiedExample((current) => (current === item ? null : current));
    }, 1500);
  };

  const renderPromptExamples = (items: string[]) => {
    const values = items.length ? items : ["-"];

    return (
      <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-foreground/80">
        {values.map((item) => {
          const canCopy = item !== "-";
          const copied = copiedExample === item;

          return (
            <li key={item}>
              {canCopy ? (
                <button
                  type="button"
                  onClick={(event) => void copyPromptExample(item, event)}
                  className="group/example relative flex w-full items-start gap-2 rounded-md px-1.5 py-1 pr-7 text-left text-xs leading-relaxed text-foreground/80 transition-colors hover:bg-accent/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  aria-label={`${t("prompt.copy", "Copy")}: ${item}`}
                  title={
                    copied
                      ? t("skill.copied", "Copied")
                      : t("prompt.copy", "Copy")
                  }
                >
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                  <span className="min-w-0 flex-1">{item}</span>
                  <span
                    className={`pointer-events-none absolute right-2 top-1.5 rounded-md p-1 transition-opacity ${
                      copied
                        ? "opacity-100 text-green-500"
                        : "opacity-0 text-muted-foreground group-hover/example:opacity-100 group-focus-visible/example:opacity-100"
                    }`}
                  >
                    {copied ? (
                      <CheckIcon className="h-3.5 w-3.5" />
                    ) : (
                      <CopyIcon className="h-3.5 w-3.5" />
                    )}
                  </span>
                </button>
              ) : (
                <div className="flex items-start gap-2 rounded-md px-1.5 py-1">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                  <span className="min-w-0 flex-1">{item}</span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div
      className={`rounded-xl border border-border bg-background/50 p-3 ${className}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <BrainIcon className="h-3.5 w-3.5" />
          {t("skill.insightPanelTitle", "AI import insight")}
        </h3>
        {onRefreshInsight && insightEnabled && (
          <button
            onClick={(event) => onRefreshInsight(skill, event)}
            className="inline-flex items-center gap-1 rounded-md bg-accent/50 px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <RefreshCwIcon className="h-3 w-3" />
            {t("skill.refreshInsight", "Refresh insight")}
          </button>
        )}
      </div>

      {!insightEnabled ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <BrainIcon className="h-4 w-4" />
          {t(
            "skill.insightDisabledCard",
            "Enable AI insight to see import guidance for this skill.",
          )}
        </div>
      ) : insightEntry?.status === "loading" ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2Icon className="h-4 w-4 animate-spin" />
          {t("skill.insightGenerating", "Generating AI insight...")}
        </div>
      ) : insightEntry?.status === "insufficient" ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <InfoIcon className="h-4 w-4" />
          {t(
            "skill.insightInsufficient",
            "Full SKILL.md content is required before AI insight can be generated.",
          )}
        </div>
      ) : insightEntry?.status === "error" ? (
        <div className="flex items-center gap-2 text-xs text-destructive">
          <AlertTriangleIcon className="h-4 w-4" />
          {t("skill.insightFailed", "AI insight failed")}
        </div>
      ) : insight ? (
        <div className="space-y-2.5">
          <div className="rounded-lg bg-muted/20 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${getVerdictClass(
                  insight.verdict,
                )}`}
              >
                {t(`skill.insightVerdict.${insight.verdict}`)}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {t("skill.insightConfidence", "Confidence")}:{" "}
                {t(`skill.insightConfidenceValue.${insight.confidence}`)}
              </span>
            </div>

            <p className="mt-2 text-sm leading-relaxed text-foreground/90">
              {insight.capabilitySummary}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {insight.verdictReason}
            </p>
          </div>

          <div className="grid gap-3 border-t border-border/60 pt-2 md:grid-cols-2">
            <InlineInsightSection
              title={t("skill.insightBestFor", "Best for")}
              items={insight.bestFor}
              icon={<CheckCircleIcon className="h-3.5 w-3.5" />}
            />
            <InlineInsightSection
              title={t("skill.insightNotFor", "Not for")}
              items={insight.notFor}
              icon={<XCircleIcon className="h-3.5 w-3.5" />}
            />
          </div>

          <div className="border-t border-border/60 pt-2">
            <SectionTitle
              icon={<MessageSquareIcon className="h-3.5 w-3.5" />}
              title={t("skill.insightPromptExamples", "Ask like this")}
            />
            <div className="mt-2 grid gap-2.5 md:grid-cols-3">
              <div>
                <div className="text-[11px] font-medium text-foreground/75">
                  {t("skill.insightExampleExplicit", "Explicit mention")}
                </div>
                {renderPromptExamples(insight.promptExamples.explicit)}
              </div>
              <div>
                <div className="text-[11px] font-medium text-foreground/75">
                  {t("skill.insightExampleNatural", "Natural intent")}
                </div>
                {renderPromptExamples(insight.promptExamples.natural)}
              </div>
              <div>
                <div className="text-[11px] font-medium text-foreground/75">
                  {t("skill.insightExampleBoundary", "Boundary")}
                </div>
                {renderPromptExamples(insight.promptExamples.boundary)}
              </div>
            </div>
          </div>

          {showSupplementalDetails && (
            <>
              <details
                className="rounded-lg border border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground"
                onClick={handleCollapsibleClick}
              >
                <summary className="cursor-pointer font-medium text-foreground/75">
                  <span className="inline-flex items-center gap-2">
                    <ShieldAlertIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    {t("skill.insightRisks", "Notes")}
                  </span>
                </summary>
                <InsightList
                  items={[...insight.riskNotes, ...insight.prerequisites]}
                />
              </details>

              {insight.evidence.length > 0 && (
                <details
                  className="rounded-lg border border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground"
                  onClick={handleCollapsibleClick}
                >
                  <summary className="cursor-pointer font-medium text-foreground/75">
                    <span className="inline-flex items-center gap-2">
                      <FileTextIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      {t("skill.insightEvidence", "Evidence")}
                    </span>
                  </summary>
                  <div className="mt-2 space-y-2">
                    {insight.evidence.map((item, index) => (
                      <div
                        key={`${item.label}-${index}`}
                        className="rounded-lg border border-border bg-muted/30 p-2"
                      >
                        <div className="font-medium text-foreground/75">
                          {item.label}
                        </div>
                        <div className="mt-1">{item.quote}</div>
                        {item.source && (
                          <div className="mt-1 text-[10px]">{item.source}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <BrainIcon className="h-4 w-4" />
          {t("skill.insightPending", "AI insight is queued for this skill.")}
        </div>
      )}
    </div>
  );
}
