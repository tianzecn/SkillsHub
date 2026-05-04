/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// 注意：import 会在 vi.mock 之后真正生效，所以这里得到的是 mock 对象
import { autoUpdater } from "electron-updater";

// Mock electron
vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  app: {
    getVersion: vi.fn(() => "1.0.0"),
    isPackaged: true,
    getAppPath: vi.fn(() => "/app"),
    getPath: vi.fn(() => "/tmp"),
  },
}));

// Mock electron-updater behavior
vi.mock("electron-updater", () => {
  const handlers: Record<string, Function> = {};
  return {
    autoUpdater: {
      on: vi.fn((event, handler) => {
        handlers[event] = handler;
      }),
      checkForUpdatesAndNotify: vi.fn(),
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      quitAndInstall: vi.fn(),
      setFeedURL: vi.fn(),
      autoDownload: true, // initial default
      autoInstallOnAppQuit: false, // initial default
      allowPrerelease: false,
      channel: "latest",
      // Helper to trigger events for testing
      _trigger: (event: string, ...args: any[]) => {
        if (handlers[event]) handlers[event](...args);
      },
    },
  };
});

import { initUpdater, registerUpdaterIPC } from "../../../src/main/updater";

type CheckHandlerResult = {
  success: boolean;
  status?: {
    status: string;
    info?: {
      version: string;
    };
  };
  error?: string;
};

describe("Updater Service (Main Process)", () => {
  let mockWindow: any;
  const originalPlatform = process.platform;
  const originalArch = process.arch;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset properties on the mock object
    // @ts-ignore
    autoUpdater.autoDownload = true;
    // @ts-ignore
    autoUpdater.autoInstallOnAppQuit = false;
    // @ts-ignore
    autoUpdater.channel = "latest";
    // @ts-ignore
    autoUpdater.allowPrerelease = false;
    vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({
      updateInfo: { version: "1.0.0" },
    });

    mockWindow = {
      webContents: {
        send: vi.fn(),
      },
      isDestroyed: () => false,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(process, "platform", { value: originalPlatform });
    Object.defineProperty(process, "arch", { value: originalArch });
  });

  it("should configure autoUpdater defaults", () => {
    initUpdater(mockWindow);

    expect(autoUpdater.autoDownload).toBe(false);
    expect(autoUpdater.autoInstallOnAppQuit).toBe(
      process.platform !== "darwin",
    );
  });

  it("should set architecture specific channel on Windows x64", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    Object.defineProperty(process, "arch", { value: "x64" });

    initUpdater(mockWindow);

    expect(autoUpdater.channel).toBe("latest");
  });

  it("should set architecture specific channel on Windows arm64", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    Object.defineProperty(process, "arch", { value: "arm64" });

    initUpdater(mockWindow);

    expect(autoUpdater.channel).toBe("arm64");
  });

  it("should NOT change channel on macOS", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });

    // Reset channel first
    // @ts-ignore
    autoUpdater.channel = "latest";

    initUpdater(mockWindow);

    // Should remain default or whatever it was (initUpdater logic only touches channel on win32)
    expect(autoUpdater.channel).toBe("latest");
  });

  it('should send "available" status to window when update found', () => {
    initUpdater(mockWindow);

    const info = { version: "1.0.1", releaseNotes: "Fixes" };

    // Trigger event
    // @ts-ignore
    if (autoUpdater._trigger) {
      // @ts-ignore
      autoUpdater._trigger("update-available", info);
    }

    expect(mockWindow.webContents.send).toHaveBeenCalledWith(
      "updater:status",
      expect.objectContaining({
        status: "available",
        info: info,
      }),
    );
  });

  it('should send "downloading" status with progress', () => {
    initUpdater(mockWindow);

    const progressObj = {
      percent: 50,
      bytesPerSecond: 1024,
      transferred: 500,
      total: 1000,
    };

    // @ts-ignore
    if (autoUpdater._trigger) {
      // @ts-ignore
      autoUpdater._trigger("download-progress", progressObj);
    }

    expect(mockWindow.webContents.send).toHaveBeenCalledWith(
      "updater:status",
      expect.objectContaining({
        status: "downloading",
        progress: progressObj,
      }),
    );
  });

  it("uses the stable release feed by default when checking for updates", async () => {
    registerUpdaterIPC();
    const checkHandler = vi
      .mocked((await import("electron")).ipcMain.handle)
      .mock.calls.find(([channel]) => channel === "updater:check")?.[1] as (
      _event: unknown,
      options?: unknown,
    ) => Promise<unknown>;

    await checkHandler({}, { useMirror: false, channel: "stable" });

    expect(autoUpdater.allowPrerelease).toBe(false);
    expect(autoUpdater.channel).toBe("latest");
    expect(autoUpdater.setFeedURL).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "github", releaseType: "release" }),
    );
  });

  it("returns an actionable error when the GitHub release source is private", async () => {
    vi.mocked(autoUpdater.checkForUpdates).mockRejectedValueOnce(
      new Error(
        'Update check failed: 404 "method: GET url: https://github.com/tianzecn/SkillsHub/releases.atom"',
      ),
    );
    registerUpdaterIPC();
    const checkHandler = vi
      .mocked((await import("electron")).ipcMain.handle)
      .mock.calls.find(([channel]) => channel === "updater:check")?.[1] as (
      _event: unknown,
      options?: unknown,
    ) => Promise<{ success: boolean; error?: string }>;

    const result = await checkHandler(
      {},
      { useMirror: false, channel: "stable" },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("release source is not publicly accessible");
    expect(result.error).toContain("private or inaccessible repositories");
  });

  it("returns a final not-available status when check result arrives without updater event", async () => {
    vi.mocked(autoUpdater.checkForUpdates).mockResolvedValueOnce({
      updateInfo: { version: "1.0.0", releaseDate: "2026-05-04T00:00:00.000Z" },
    });
    registerUpdaterIPC();
    const checkHandler = vi
      .mocked((await import("electron")).ipcMain.handle)
      .mock.calls.find(([channel]) => channel === "updater:check")?.[1] as (
      _event: unknown,
      options?: unknown,
    ) => Promise<CheckHandlerResult>;

    const result = await checkHandler(
      {},
      { useMirror: false, channel: "stable" },
    );

    expect(result.success).toBe(true);
    expect(result.status).toMatchObject({
      status: "not-available",
      info: { version: "1.0.0" },
    });
  });

  it("returns a timeout error when update check never settles", async () => {
    vi.useFakeTimers();
    vi.mocked(autoUpdater.checkForUpdates).mockReturnValueOnce(
      new Promise(() => {}),
    );
    registerUpdaterIPC();
    const checkHandler = vi
      .mocked((await import("electron")).ipcMain.handle)
      .mock.calls.find(([channel]) => channel === "updater:check")?.[1] as (
      _event: unknown,
      options?: unknown,
    ) => Promise<CheckHandlerResult>;

    const pendingResult = checkHandler(
      {},
      { useMirror: false, channel: "stable" },
    );

    await vi.advanceTimersByTimeAsync(30_000);
    const result = await pendingResult;

    expect(result.success).toBe(false);
    expect(result.error).toContain("Update check timed out");
  });

  it("uses the preview prerelease feed only after joining preview channel", async () => {
    registerUpdaterIPC();
    const checkHandler = vi
      .mocked((await import("electron")).ipcMain.handle)
      .mock.calls.find(([channel]) => channel === "updater:check")?.[1] as (
      _event: unknown,
      options?: unknown,
    ) => Promise<unknown>;

    await checkHandler({}, { useMirror: false, channel: "preview" });

    expect(autoUpdater.allowPrerelease).toBe(true);
    expect(autoUpdater.channel).toBe("preview");
    expect(autoUpdater.setFeedURL).toHaveBeenCalledWith({
      provider: "generic",
      url: "https://github.com/tianzecn/SkillsHub/releases/download/preview",
    });
  });
});
