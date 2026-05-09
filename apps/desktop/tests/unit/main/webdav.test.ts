import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

describe("WebDAV main process helpers", () => {
  it("does not treat redirects as successful WebDAV responses", async () => {
    const { isSuccessfulWebDAVStatus } = await import(
      "../../../src/main/webdav"
    );

    expect(isSuccessfulWebDAVStatus(200)).toBe(true);
    expect(isSuccessfulWebDAVStatus(207)).toBe(true);
    expect(isSuccessfulWebDAVStatus(302)).toBe(false);
    expect(isSuccessfulWebDAVStatus(403)).toBe(false);
  });
});
