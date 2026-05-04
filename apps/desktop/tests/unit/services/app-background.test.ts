import { describe, expect, it } from "vitest";
import {
  hasValidSelfHostedConfig,
  hasValidWebDAVConfig,
  shouldRunPeriodicSelfHostedSync,
  shouldRunBackgroundUpdateCheck,
  shouldRunStartupSelfHostedSync,
  shouldRunPeriodicWebDAVSync,
  shouldRunStartupWebDAVSync,
} from "../../../src/renderer/services/app-background";

const baseSettings = {
  webdavEnabled: true,
  webdavUrl: "https://example.com/dav",
  webdavUsername: "user",
  webdavPassword: "pass",
  webdavSyncOnStartup: true,
  webdavAutoSyncInterval: 15,
};

const baseSelfHostedSettings = {
  selfHostedSyncEnabled: true,
  selfHostedSyncUrl: "https://backup.example.com",
  selfHostedSyncUsername: "owner",
  selfHostedSyncPassword: "secret",
  selfHostedSyncOnStartup: true,
  selfHostedAutoSyncInterval: 15,
};

describe("app-background", () => {
  it("validates required WebDAV configuration", () => {
    expect(hasValidWebDAVConfig(baseSettings)).toBe(true);
    expect(
      hasValidWebDAVConfig({
        ...baseSettings,
        webdavPassword: "",
      }),
    ).toBe(false);
  });

  it("runs update checks only when visible, online, and idle", () => {
    expect(
      shouldRunBackgroundUpdateCheck(true, {
        isVisible: true,
        isOnline: true,
        isRunning: false,
      }),
    ).toBe(true);

    expect(
      shouldRunBackgroundUpdateCheck(true, {
        isVisible: false,
        isOnline: true,
        isRunning: false,
      }),
    ).toBe(false);

    expect(
      shouldRunBackgroundUpdateCheck(true, {
        isVisible: true,
        isOnline: false,
        isRunning: false,
      }),
    ).toBe(false);

    expect(
      shouldRunBackgroundUpdateCheck(true, {
        isVisible: true,
        isOnline: true,
        isRunning: false,
        isUserUpdateFlowActive: true,
      }),
    ).toBe(false);
  });

  it("blocks WebDAV sync while hidden or already running", () => {
    expect(
      shouldRunStartupWebDAVSync(baseSettings, {
        isVisible: true,
        isOnline: true,
        isRunning: false,
      }),
    ).toBe(true);

    expect(
      shouldRunStartupWebDAVSync(baseSettings, {
        isVisible: false,
        isOnline: true,
        isRunning: false,
      }),
    ).toBe(false);

    expect(
      shouldRunPeriodicWebDAVSync(baseSettings, {
        isVisible: true,
        isOnline: true,
        isRunning: true,
      }),
    ).toBe(false);
  });

  it("requires a positive interval for periodic WebDAV sync", () => {
    expect(
      shouldRunPeriodicWebDAVSync(
        {
          ...baseSettings,
          webdavAutoSyncInterval: 0,
        },
        {
          isVisible: true,
          isOnline: true,
          isRunning: false,
        },
      ),
    ).toBe(false);
  });

  it("validates required self-hosted configuration", () => {
    expect(hasValidSelfHostedConfig(baseSelfHostedSettings)).toBe(true);
    expect(
      hasValidSelfHostedConfig({
        ...baseSelfHostedSettings,
        selfHostedSyncPassword: "",
      }),
    ).toBe(false);
  });

  it("blocks self-hosted startup sync while hidden or already running", () => {
    expect(
      shouldRunStartupSelfHostedSync(baseSelfHostedSettings, {
        isVisible: true,
        isOnline: true,
        isRunning: false,
      }),
    ).toBe(true);

    expect(
      shouldRunStartupSelfHostedSync(baseSelfHostedSettings, {
        isVisible: false,
        isOnline: true,
        isRunning: false,
      }),
    ).toBe(false);

    expect(
      shouldRunPeriodicSelfHostedSync(baseSelfHostedSettings, {
        isVisible: true,
        isOnline: true,
        isRunning: true,
      }),
    ).toBe(false);
  });

  it("requires a positive interval for periodic self-hosted sync", () => {
    expect(
      shouldRunPeriodicSelfHostedSync(
        {
          ...baseSelfHostedSettings,
          selfHostedAutoSyncInterval: 0,
        },
        {
          isVisible: true,
          isOnline: true,
          isRunning: false,
        },
      ),
    ).toBe(false);
  });
});
