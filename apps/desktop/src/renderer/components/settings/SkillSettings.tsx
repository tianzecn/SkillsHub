import { useMemo, useState } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  InfoIcon,
  PlusIcon,
  RotateCcwIcon,
  TrashIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { SKILL_PLATFORMS } from "@prompthub/shared/constants/platforms";
import { useSettingsStore } from "../../stores/settings.store";
import { useSkillStore } from "../../stores/skill.store";
import { PlatformIcon } from "../ui/PlatformIcon";
import { PasswordInput, SettingSection } from "./shared";
import { useToast } from "../ui/Toast";
import { getSafetyScanAIConfig } from "../skill/detail-utils";
import { isWebRuntime } from "../../runtime";

interface SkillSettingsProps {
  onNavigate: (section: string) => void;
}

function getCurrentPlatformKey(): "darwin" | "win32" | "linux" {
  const platform = navigator.userAgent.toLowerCase();
  if (platform.includes("win")) return "win32";
  if (platform.includes("mac")) return "darwin";
  return "linux";
}

export function SkillSettings({ onNavigate }: SkillSettingsProps) {
  const { t } = useTranslation();
  const webRuntime = isWebRuntime();
  const settings = useSettingsStore();
  const scanInstalledSkillSafety = useSkillStore(
    (state) => state.scanInstalledSkillSafety,
  );
  const aiModels = settings.aiModels;
  const { showToast } = useToast();
  const [newScanPath, setNewScanPath] = useState("");
  const [isBatchScanning, setIsBatchScanning] = useState(false);
  const currentPlatformKey = getCurrentPlatformKey();
  const orderedPlatforms = useMemo(() => {
    const preferredIndex = new Map(
      (settings.skillPlatformOrder ?? []).map((platformId, index) => [
        platformId,
        index,
      ]),
    );

    return [...SKILL_PLATFORMS].sort((left, right) => {
      const leftIndex = preferredIndex.get(left.id);
      const rightIndex = preferredIndex.get(right.id);

      if (leftIndex != null && rightIndex != null) {
        return leftIndex - rightIndex;
      }
      if (leftIndex != null) {
        return -1;
      }
      if (rightIndex != null) {
        return 1;
      }
      return 0;
    });
  }, [settings.skillPlatformOrder]);
  const movePlatformOrder = (platformId: string, direction: "up" | "down") => {
    const nextOrder = orderedPlatforms.map((platform) => platform.id);
    const currentIndex = nextOrder.indexOf(platformId);
    if (currentIndex === -1) {
      return;
    }

    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= nextOrder.length) {
      return;
    }

    [nextOrder[currentIndex], nextOrder[targetIndex]] = [
      nextOrder[targetIndex],
      nextOrder[currentIndex],
    ];
    settings.setSkillPlatformOrder(nextOrder);
  };

  if (webRuntime) {
    return (
      <div className="space-y-6">
        <SettingSection title={t("settings.skill", "Skill")}>
          <div className="p-4 space-y-3">
            <p className="text-sm text-foreground">
              {t("settings.selfHostedWebDesc")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t(
                "settings.webSkillSettingsDesc",
                "The self-hosted web workspace keeps Skill content in the same backup dataset, but does not manage local platform directories, symlinks, or desktop-only distribution flows.",
              )}
            </p>
          </div>
        </SettingSection>

        <div className="flex items-start gap-2.5 p-4 rounded-xl bg-muted/50 border border-border/50">
          <InfoIcon className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            {t(
              "settings.skillBackupHint",
              "For Skill backup and restore, go to the Data panel",
            )}{" "}
            <button
              onClick={() => onNavigate("data")}
              className="text-primary hover:underline font-medium"
            >
              {t("settings.skillBackupHintLink", "Go to Data Panel")}
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SettingSection
        title={t("settings.skillInstallMethod", "Skill Install Method")}
      >
        <div className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            {t(
              "settings.skillInstallMethodDesc",
              "Choose how Skills are installed from PromptHub to AI tool platforms.",
            )}
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => settings.setSkillInstallMethod("symlink")}
              className={`flex-1 p-3 rounded-xl border-2 transition-all text-left ${
                settings.skillInstallMethod === "symlink"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/30"
              }`}
            >
              <div className="text-sm font-semibold">
                {t("settings.skillInstallSymlink", "Symlink")}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {t(
                  "settings.skillInstallSymlinkDesc",
                  "Create symlinks in platform directories pointing to PromptHub's Skills folder for efficient syncing",
                )}
              </p>
            </button>
            <button
              onClick={() => settings.setSkillInstallMethod("copy")}
              className={`flex-1 p-3 rounded-xl border-2 transition-all text-left ${
                settings.skillInstallMethod === "copy"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/30"
              }`}
            >
              <div className="text-sm font-semibold">
                {t("settings.skillInstallCopy", "Copy Files")}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {t(
                  "settings.skillInstallCopyDesc",
                  "Copy SKILL.md files directly to platform directories, independent of PromptHub",
                )}
              </p>
            </button>
          </div>
        </div>
      </SettingSection>

      <SettingSection
        title={t("settings.skillsShCommunitySource", "skills.sh Community Source")}
      >
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-sm font-semibold mb-2">
              {t("settings.skillsShApiKey", "skills.sh API Key")}
            </label>
            <PasswordInput
              value={settings.skillsShApiKey || ""}
              onChange={settings.setSkillsShApiKey}
              placeholder={t(
                "settings.skillsShApiKeyPlaceholder",
                "Optional API key, e.g. sk_live_...",
              )}
            />
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t(
              "settings.skillsShApiKeyDesc",
              "Optional. Used only when loading the built-in skills.sh community source. It is stored with your local PromptHub settings, the same way local model API keys are stored.",
            )}
          </p>
        </div>
      </SettingSection>

      <SettingSection
        title={t("settings.platformDisplayOrder", "Platform Display Order")}
      >
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {t(
                "settings.platformDisplayOrderDesc",
                "Control the platform order shown in Skill detail and batch deployment panels.",
              )}
            </p>
            <button
              onClick={() => settings.resetSkillPlatformOrder()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <RotateCcwIcon className="h-3.5 w-3.5" />
              {t("settings.resetPlatformDisplayOrder", "Reset")}
            </button>
          </div>
          <div className="space-y-2 rounded-xl border border-border/70 bg-card/70 p-3">
            {orderedPlatforms.map((platform, index) => (
              <div
                key={platform.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/80 px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <PlatformIcon platformId={platform.id} size={20} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">
                      {platform.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {settings.customSkillPlatformPaths[platform.id] ||
                        platform.skillsDir[currentPlatformKey]}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => movePlatformOrder(platform.id, "up")}
                    disabled={index === 0}
                    className="rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    title={t("settings.movePlatformUp", "Move Up")}
                  >
                    <ArrowUpIcon className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => movePlatformOrder(platform.id, "down")}
                    disabled={index === orderedPlatforms.length - 1}
                    className="rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    title={t("settings.movePlatformDown", "Move Down")}
                  >
                    <ArrowDownIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </SettingSection>

      <SettingSection
        title={t("settings.skillSafetyChecks", "Skill Safety Checks")}
      >
        <div className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            {t(
              "settings.skillSafetyChecksDesc",
              "Control automatic safety scans for installed Skills and pre-install checks from the store.",
            )}
          </p>
          <button
            onClick={() =>
              settings.setAutoScanInstalledSkills(
                !settings.autoScanInstalledSkills,
              )
            }
            className={`w-full p-3 rounded-xl border-2 transition-all text-left ${
              settings.autoScanInstalledSkills
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/30"
            }`}
          >
            <div className="text-sm font-semibold">
              {t(
                "settings.autoScanInstalledSkills",
                "Auto-scan Installed Skills",
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {t(
                "settings.autoScanInstalledSkillsDesc",
                "Automatically run a safety scan when opening a Skill's detail page to detect high-risk changes.",
              )}
            </p>
          </button>
          <button
            onClick={() =>
              settings.setAutoScanStoreSkillsBeforeInstall(
                !settings.autoScanStoreSkillsBeforeInstall,
              )
            }
            className={`w-full p-3 rounded-xl border-2 transition-all text-left ${
              settings.autoScanStoreSkillsBeforeInstall
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/30"
            }`}
          >
            <div className="text-sm font-semibold">
              {t(
                "settings.autoScanStoreSkillsBeforeInstall",
                "Pre-install Safety Scan",
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {t(
                "settings.autoScanStoreSkillsBeforeInstallDesc",
                "Off by default. When enabled, a safety scan runs before adding a Skill from the store, blocking obviously dangerous entries.",
              )}
            </p>
          </button>
          <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">
                  {t(
                    "settings.batchScanInstalledSkills",
                    "Scan All Installed Skills Now",
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t(
                    "settings.batchScanInstalledSkillsDesc",
                    "Manually run a safety scan on all Skills in your library to quickly find high-risk content.",
                  )}
                </p>
              </div>
              <button
                onClick={() => {
                  const run = async () => {
                    setIsBatchScanning(true);
                    try {
                      const summary = await scanInstalledSkillSafety(
                        undefined,
                        getSafetyScanAIConfig(aiModels),
                      );
                      showToast(
                        t("settings.batchScanInstalledSkillsResult", {
                          total: summary.total,
                          blocked: summary.blocked,
                          highRisk: summary.highRisk,
                          warn: summary.warn,
                          defaultValue: `Checked ${summary.total} skills · blocked ${summary.blocked} · high risk ${summary.highRisk} · warn ${summary.warn}`,
                        }),
                        summary.blocked > 0 || summary.highRisk > 0
                          ? "error"
                          : summary.warn > 0
                            ? "warning"
                            : "success",
                      );
                    } catch (error) {
                      showToast(String(error), "error");
                    } finally {
                      setIsBatchScanning(false);
                    }
                  };
                  void run();
                }}
                disabled={isBatchScanning}
                className="shrink-0 h-9 px-4 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {isBatchScanning
                  ? t("skill.safetyScanning", "Scanning...")
                  : t("skill.runSafetyAssessment", "Run Scan")}
              </button>
            </div>
          </div>
        </div>
      </SettingSection>

      <SettingSection
        title={t("settings.platformSkillPaths", "Platform Target Directories")}
      >
        <div className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            {t(
              "settings.platformSkillPathsDesc",
              "Override default Skill directories for each AI tool. Affects scanning, distribution, uninstall, and install detection.",
            )}
          </p>
          <div className="rounded-lg border border-border overflow-hidden">
            {SKILL_PLATFORMS.map((platform) => {
              const overridePath =
                settings.customSkillPlatformPaths[platform.id] || "";

              return (
                <div
                  key={platform.id}
                  className="px-3 py-3 border-b border-border/70 last:border-0 space-y-3"
                >
                  <div className="flex items-center gap-2">
                    <PlatformIcon platformId={platform.id} size={16} />
                    <span className="text-sm font-medium text-foreground">
                      {platform.name}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {t("settings.defaultPathLabel", "Default path")}:
                    <span className="ml-1 font-mono">
                      {platform.skillsDir[currentPlatformKey]}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={overridePath}
                      onChange={(e) =>
                        settings.setCustomSkillPlatformPath(
                          platform.id,
                          e.target.value,
                        )
                      }
                      placeholder={t(
                        "settings.platformSkillPathPlaceholder",
                        "Leave empty to use default, e.g. ~/.trae-cn/skills",
                      )}
                      className="flex-1 h-9 px-3 rounded-lg bg-muted border-0 text-sm placeholder:text-muted-foreground/50"
                    />
                    <button
                      onClick={() =>
                        settings.resetCustomSkillPlatformPath(platform.id)
                      }
                      disabled={!overridePath}
                      className="h-9 px-3 rounded-lg border border-border text-sm text-muted-foreground hover:border-primary/30 hover:text-foreground disabled:opacity-50 disabled:hover:border-border disabled:hover:text-muted-foreground transition-colors"
                    >
                      {t("settings.resetPlatformSkillPath", "Reset")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </SettingSection>

      <SettingSection
        title={t("settings.extraSkillScanPaths", "Extra Scan Directories")}
      >
        <div className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            {t(
              "settings.extraSkillScanPathsDesc",
              "Add extra Skill directories for import and discovery. These do not override platform defaults.",
            )}
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newScanPath}
              onChange={(e) => setNewScanPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newScanPath.trim()) {
                  settings.addCustomSkillScanPath(newScanPath.trim());
                  setNewScanPath("");
                }
              }}
              placeholder={t(
                "settings.customSkillScanPathPlaceholder",
                "Enter path, e.g. ~/myskills",
              )}
              className="flex-1 h-9 px-3 rounded-lg bg-muted border-0 text-sm placeholder:text-muted-foreground/50"
            />
            <button
              onClick={() => {
                if (newScanPath.trim()) {
                  settings.addCustomSkillScanPath(newScanPath.trim());
                  setNewScanPath("");
                }
              }}
              className="h-9 px-4 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors flex items-center gap-1.5"
            >
              <PlusIcon className="w-4 h-4" />
              {t("common.add", "Add")}
            </button>
          </div>
          {settings.customSkillScanPaths.length > 0 ? (
            <div className="rounded-lg border border-border overflow-hidden">
              {settings.customSkillScanPaths.map((path, idx) => (
                <div
                  key={`${path}-${idx}`}
                  className="flex items-center justify-between px-3 py-2.5 border-b border-border/70 last:border-0 hover:bg-muted/20 transition-colors"
                >
                  <span className="text-sm font-mono text-foreground truncate flex-1 mr-3">
                    {path}
                  </span>
                  <button
                    onClick={() => settings.removeCustomSkillScanPath(path)}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0"
                    title={t("common.delete", "Delete")}
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/60 italic">
              {t("settings.noCustomPaths", "No custom paths added yet")}
            </p>
          )}
        </div>
      </SettingSection>

      <div className="flex items-start gap-2.5 p-4 rounded-xl bg-muted/50 border border-border/50">
        <InfoIcon className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground">
          {t(
            "settings.skillBackupHint",
            "For Skill backup and restore, go to the Data panel",
          )}{" "}
          <button
            onClick={() => onNavigate("data")}
            className="text-primary hover:underline font-medium"
          >
            {t("settings.skillBackupHintLink", "Go to Data Panel")}
          </button>
        </p>
      </div>
    </div>
  );
}
