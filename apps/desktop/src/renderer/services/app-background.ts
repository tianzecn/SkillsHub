interface WebDAVSyncSettings {
  webdavEnabled: boolean;
  webdavUrl: string;
  webdavUsername: string;
  webdavPassword: string;
  webdavSyncOnStartup: boolean;
  webdavAutoSyncInterval: number;
}

interface SelfHostedSyncSettings {
  selfHostedSyncEnabled: boolean;
  selfHostedSyncUrl: string;
  selfHostedSyncUsername: string;
  selfHostedSyncPassword: string;
  selfHostedSyncOnStartup: boolean;
  selfHostedAutoSyncInterval: number;
}

interface BackgroundTaskState {
  isVisible: boolean;
  isOnline: boolean;
  isRunning: boolean;
  isUserUpdateFlowActive?: boolean;
}

export function hasValidWebDAVConfig(settings: WebDAVSyncSettings): boolean {
  return Boolean(
    settings.webdavEnabled &&
      settings.webdavUrl?.trim() &&
      settings.webdavUsername?.trim() &&
      settings.webdavPassword?.trim(),
  );
}

export function shouldRunBackgroundUpdateCheck(
  autoCheckUpdate: boolean,
  state: BackgroundTaskState,
): boolean {
  return Boolean(
    autoCheckUpdate &&
      state.isVisible &&
      state.isOnline &&
      !state.isRunning &&
      !state.isUserUpdateFlowActive,
  );
}

export function shouldRunStartupWebDAVSync(
  settings: WebDAVSyncSettings,
  state: BackgroundTaskState,
): boolean {
  return Boolean(
    settings.webdavSyncOnStartup &&
      hasValidWebDAVConfig(settings) &&
      state.isVisible &&
      state.isOnline &&
      !state.isRunning,
  );
}

export function shouldRunPeriodicWebDAVSync(
  settings: WebDAVSyncSettings,
  state: BackgroundTaskState,
): boolean {
  return Boolean(
    settings.webdavAutoSyncInterval > 0 &&
      hasValidWebDAVConfig(settings) &&
      state.isVisible &&
      state.isOnline &&
      !state.isRunning,
  );
}

export function hasValidSelfHostedConfig(
  settings: SelfHostedSyncSettings,
): boolean {
  return Boolean(
    settings.selfHostedSyncEnabled &&
      settings.selfHostedSyncUrl?.trim() &&
      settings.selfHostedSyncUsername?.trim() &&
      settings.selfHostedSyncPassword?.trim(),
  );
}

export function shouldRunStartupSelfHostedSync(
  settings: SelfHostedSyncSettings,
  state: BackgroundTaskState,
): boolean {
  return Boolean(
    settings.selfHostedSyncOnStartup &&
      hasValidSelfHostedConfig(settings) &&
      state.isVisible &&
      state.isOnline &&
      !state.isRunning,
  );
}

export function shouldRunPeriodicSelfHostedSync(
  settings: SelfHostedSyncSettings,
  state: BackgroundTaskState,
): boolean {
  return Boolean(
    settings.selfHostedAutoSyncInterval > 0 &&
      hasValidSelfHostedConfig(settings) &&
      state.isVisible &&
      state.isOnline &&
      !state.isRunning,
  );
}
