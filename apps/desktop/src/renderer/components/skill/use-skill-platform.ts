import { useCallback, useEffect, useMemo, useState } from "react";
import type { Skill } from "@prompthub/shared/types";
import type { SkillPlatform } from "@prompthub/shared/constants/platforms";
import { useSkillStore } from "../../stores/skill.store";
import { useSettingsStore } from "../../stores/settings.store";
import { getRuntimeCapabilities } from "../../runtime";
import { dispatchSkillPlatformStatusChange } from "./skill-platform-status-events";

export type SkillInstallMode = "copy" | "symlink";

export interface BatchInstallResult {
  successCount: number;
  totalCount: number;
}

export function sortSkillPlatformsByPreference(
  platforms: SkillPlatform[],
  preferredOrder: string[],
): SkillPlatform[] {
  if (preferredOrder.length === 0) {
    return platforms;
  }

  const preferredIndex = new Map(
    preferredOrder.map((platformId, index) => [platformId, index]),
  );

  return [...platforms].sort((left, right) => {
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
}

export function useSkillPlatform(
  skill: Skill | null | undefined,
  installMode: SkillInstallMode,
) {
  const loadDeployedStatus = useSkillStore((state) => state.loadDeployedStatus);
  const skillPlatformOrder = useSettingsStore(
    (state) => state.skillPlatformOrder,
  ) ?? [];
  const runtimeCapabilities = getRuntimeCapabilities();
  const [supportedPlatforms, setSupportedPlatforms] = useState<SkillPlatform[]>(
    [],
  );
  const [detectedPlatforms, setDetectedPlatforms] = useState<string[]>([]);
  const [installStatus, setInstallStatus] = useState<Record<string, boolean>>(
    {},
  );
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(
    new Set(),
  );
  const [isBatchInstalling, setIsBatchInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

  const loadPlatforms = useCallback(async () => {
    if (!runtimeCapabilities.skillPlatformIntegration) {
      setSupportedPlatforms([]);
      setDetectedPlatforms([]);
      return;
    }

    const [platforms, detected] = await Promise.all([
      window.api.skill.getSupportedPlatforms(),
      window.api.skill.detectPlatforms(),
    ]);
    setSupportedPlatforms(platforms);
    setDetectedPlatforms(detected);
  }, [runtimeCapabilities.skillPlatformIntegration]);

  const refreshInstallStatus = useCallback(async () => {
    if (!skill || !runtimeCapabilities.skillPlatformIntegration) {
      setInstallStatus({});
      setSelectedPlatforms(new Set());
      return;
    }
    const status = await window.api.skill.getMdInstallStatus(skill.name);
    setInstallStatus(status);
    setSelectedPlatforms(new Set());
    await loadDeployedStatus();
  }, [loadDeployedStatus, runtimeCapabilities.skillPlatformIntegration, skill]);

  useEffect(() => {
    void loadPlatforms();
  }, [loadPlatforms]);

  useEffect(() => {
    if (!skill) return;
    void refreshInstallStatus();
  }, [refreshInstallStatus, skill]);

  const availablePlatforms = useMemo(
    () =>
      sortSkillPlatformsByPreference(
        supportedPlatforms.filter((platform) =>
          detectedPlatforms.includes(platform.id),
        ),
        skillPlatformOrder,
      ),
    [detectedPlatforms, skillPlatformOrder, supportedPlatforms],
  );

  const uninstalledPlatforms = useMemo(
    () => availablePlatforms.filter((platform) => !installStatus[platform.id]),
    [availablePlatforms, installStatus],
  );

  const togglePlatformSelection = useCallback((platformId: string) => {
    setSelectedPlatforms((previous) => {
      const next = new Set(previous);
      if (next.has(platformId)) {
        next.delete(platformId);
      } else {
        next.add(platformId);
      }
      return next;
    });
  }, []);

  const selectAllPlatforms = useCallback(() => {
    setSelectedPlatforms(new Set(uninstalledPlatforms.map((platform) => platform.id)));
  }, [uninstalledPlatforms]);

  const deselectAllPlatforms = useCallback(() => {
    setSelectedPlatforms(new Set());
  }, []);

  const batchInstall = useCallback(async (): Promise<BatchInstallResult> => {
    if (
      !runtimeCapabilities.skillPlatformIntegration ||
      !skill ||
      selectedPlatforms.size === 0
    ) {
      return { successCount: 0, totalCount: 0 };
    }

    setIsBatchInstalling(true);
    const platformIds = Array.from(selectedPlatforms);
    setInstallProgress({ current: 0, total: platformIds.length });

    try {
      const skillMdContent = await window.api.skill.export(skill.id, "skillmd");
      let successCount = 0;

      for (let index = 0; index < platformIds.length; index++) {
        const platformId = platformIds[index];
        setInstallProgress({ current: index + 1, total: platformIds.length });

        try {
          if (installMode === "symlink") {
            await window.api.skill.installMdSymlink(
              skill.name,
              skillMdContent,
              platformId,
            );
          } else {
            await window.api.skill.installMd(skill.name, skillMdContent, platformId);
          }
          successCount++;
        } catch (error) {
          console.error(`Failed to install "${skill.name}" to ${platformId}:`, error);
        }
      }

      await refreshInstallStatus();
      dispatchSkillPlatformStatusChange(skill.name);
      return { successCount, totalCount: platformIds.length };
    } finally {
      setIsBatchInstalling(false);
      setInstallProgress(null);
    }
  }, [
    installMode,
    refreshInstallStatus,
    runtimeCapabilities.skillPlatformIntegration,
    selectedPlatforms,
    skill,
  ]);

  const uninstallFromPlatform = useCallback(
    async (platformId: string) => {
      if (!runtimeCapabilities.skillPlatformIntegration || !skill) return;
      await window.api.skill.uninstallMd(skill.name, platformId);
      await refreshInstallStatus();
      dispatchSkillPlatformStatusChange(skill.name);
    },
    [refreshInstallStatus, runtimeCapabilities.skillPlatformIntegration, skill],
  );

  return {
    availablePlatforms,
    installProgress,
    installStatus,
    isBatchInstalling,
    refreshInstallStatus,
    selectedPlatforms,
    togglePlatformSelection,
    selectAllPlatforms,
    deselectAllPlatforms,
    batchInstall,
    uninstallFromPlatform,
    uninstalledPlatforms,
  };
}
