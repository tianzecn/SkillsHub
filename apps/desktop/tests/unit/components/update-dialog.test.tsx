import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  UpdateDialog,
  type UpdateStatus,
} from "../../../src/renderer/components/UpdateDialog";
import { renderWithI18n } from "../../helpers/i18n";
import { installWindowMocks } from "../../helpers/window";

const useSettingsStoreMock = vi.fn();
const downloadCompressedBackupMock = vi.fn();
const getManualBackupStatusMock = vi.fn();
const recordManualBackupMock = vi.fn();
type SettingsStoreState = {
  useUpdateMirror: boolean;
  updateChannel: "stable" | "preview";
};

vi.mock("../../../src/renderer/stores/settings.store", () => ({
  useSettingsStore: (selector: (state: SettingsStoreState) => unknown) =>
    selector(useSettingsStoreMock()),
}));

vi.mock("../../../src/renderer/services/database-backup", () => ({
  downloadCompressedBackup: () => downloadCompressedBackupMock(),
}));

vi.mock("../../../src/renderer/services/backup-status", () => ({
  getManualBackupStatus: () => getManualBackupStatusMock(),
  recordManualBackup: (version: string) => recordManualBackupMock(version),
}));

describe("UpdateDialog", () => {
  const availableStatus: UpdateStatus = {
    status: "available",
    info: {
      version: "0.5.2",
      releaseNotes: "## Fixes",
    },
  };
  const downloadedStatus: UpdateStatus = {
    status: "downloaded",
    info: {
      version: "0.5.2",
      releaseNotes: "## Fixes",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStoreMock.mockReturnValue({
      useUpdateMirror: false,
      updateChannel: "stable",
    });
    getManualBackupStatusMock.mockResolvedValue({
      lastManualBackupAt: null,
      lastManualBackupVersion: null,
    });
    recordManualBackupMock.mockResolvedValue({
      lastManualBackupAt: "2026-04-13T10:00:00.000Z",
      lastManualBackupVersion: "0.5.1",
    });

    installWindowMocks({
      electron: {
        updater: {
          check: vi.fn().mockResolvedValue({ success: true }),
          download: vi.fn().mockResolvedValue(undefined),
          install: vi.fn().mockResolvedValue({ success: true }),
          getVersion: vi.fn().mockResolvedValue("0.5.1"),
          getPlatform: vi.fn().mockResolvedValue("win32"),
          onStatus: vi.fn((callback: (status: UpdateStatus) => void) => {
            callback(availableStatus);
            return vi.fn();
          }),
        },
      },
    });
  });

  it("uses the check response status when the updater event is not delivered", async () => {
    const checkMock = vi.fn().mockResolvedValue({
      success: true,
      status: {
        status: "not-available",
        info: { version: "0.5.1" },
      },
    });
    installWindowMocks({
      electron: {
        updater: {
          check: checkMock,
          download: vi.fn().mockResolvedValue(undefined),
          install: vi.fn().mockResolvedValue({ success: true }),
          getVersion: vi.fn().mockResolvedValue("0.5.1"),
          getPlatform: vi.fn().mockResolvedValue("win32"),
          onStatus: vi.fn(() => vi.fn()),
        },
      },
    });

    await act(async () => {
      await renderWithI18n(<UpdateDialog isOpen={true} onClose={vi.fn()} />, {
        language: "en",
      });
    });

    expect(await screen.findByText("Up to Date")).toBeInTheDocument();
    expect(screen.queryByText("Checking...")).not.toBeInTheDocument();
    expect(checkMock).toHaveBeenCalledWith({
      useMirror: false,
      channel: "stable",
    });
  });

  it("keeps download enabled because install creates an automatic data snapshot", async () => {
    await act(async () => {
      await renderWithI18n(
        <UpdateDialog
          isOpen={true}
          onClose={vi.fn()}
          initialStatus={availableStatus}
        />,
        { language: "en" },
      );
    });

    const downloadButton = await screen.findByRole("button", {
      name: "Download Update",
    });
    expect(downloadButton).not.toBeDisabled();
    expect(
      screen.getByText("Manual backup is required before in-app upgrade"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Create Extra Backup",
      }),
    );

    await waitFor(() => {
      expect(downloadCompressedBackupMock).toHaveBeenCalledTimes(1);
      expect(recordManualBackupMock).toHaveBeenCalledWith("0.5.1");
    });

    await waitFor(() => {
      expect(downloadButton).not.toBeDisabled();
    });
  });

  it("requires a current-version manual backup and acknowledgement before allowing install", async () => {
    installWindowMocks({
      electron: {
        updater: {
          check: vi.fn().mockResolvedValue({ success: true }),
          download: vi.fn().mockResolvedValue(undefined),
          install: vi.fn().mockResolvedValue({ success: true }),
          getVersion: vi.fn().mockResolvedValue("0.5.1"),
          getPlatform: vi.fn().mockResolvedValue("win32"),
          onStatus: vi.fn((callback: (status: UpdateStatus) => void) => {
            callback(downloadedStatus);
            return vi.fn();
          }),
        },
      },
    });

    await act(async () => {
      await renderWithI18n(
        <UpdateDialog
          isOpen={true}
          onClose={vi.fn()}
          initialStatus={downloadedStatus}
        />,
        { language: "en" },
      );
    });

    const installButton = await screen.findByRole("button", {
      name: "Install Now",
    });
    expect(installButton).toBeDisabled();
    expect(
      screen.getByText(
        "Confirm the backup acknowledgement before continuing with the upgrade.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "A manual backup for version 0.5.1 is required before installation. PromptHub will also create an automatic local snapshot once installation starts.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByLabelText(
        "I have backed up the relevant data and understand the app will close during installation.",
      ),
    );

    await waitFor(() => {
      expect(installButton).toBeDisabled();
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Create Extra Backup",
      }),
    );

    await waitFor(() => {
      expect(downloadCompressedBackupMock).toHaveBeenCalledTimes(1);
      expect(recordManualBackupMock).toHaveBeenCalledWith("0.5.1");
    });

    await waitFor(() => {
      expect(installButton).not.toBeDisabled();
    });

    fireEvent.click(installButton);

    await waitFor(() => {
      expect(window.electron.updater.install).toHaveBeenCalledTimes(1);
    });
  });
});
