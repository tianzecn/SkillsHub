/**
 * @vitest-environment node
 */
import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("https", () => ({
  request: vi.fn(),
}));

vi.mock("../../../src/main/services/skill-installer-remote", () => ({
  resolvePublicAddress: vi.fn().mockResolvedValue({
    address: "203.0.113.10",
    family: 4,
  }),
}));

import * as https from "https";
import { loadSkillsShStore } from "../../../src/main/services/skills-sh-api";

interface MockResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: unknown;
}

function mockSkillsShResponses(routes: Record<string, MockResponse>): void {
  vi.mocked(https.request).mockImplementation((options, callback) => {
    const path = typeof options === "string" ? options : options.path || "/";
    const route = routes[String(path)];
    if (!route) {
      throw new Error(`Unexpected skills.sh request: ${String(path)}`);
    }

    const response = new EventEmitter() as EventEmitter & {
      statusCode: number;
      headers: Record<string, string>;
      destroy: (error: Error) => void;
    };
    response.statusCode = route.statusCode;
    response.headers = route.headers || {};
    response.destroy = (error: Error) => response.emit("error", error);

    const request = new EventEmitter() as EventEmitter & {
      end: () => void;
      destroy: (error: Error) => void;
    };
    request.end = () => {
      queueMicrotask(() => {
        callback(response as never);
        response.emit("data", Buffer.from(JSON.stringify(route.body)));
        response.emit("end");
      });
    };
    request.destroy = (error: Error) => request.emit("error", error);
    return request as never;
  });
}

describe("skills-sh-api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps list, detail, files, audits, hashes, and cache headers into registry skills", async () => {
    mockSkillsShResponses({
      "/api/v1/skills?view=trending&page=0&per_page=2": {
        statusCode: 200,
        headers: {
          "cache-control": "public, max-age=45",
          "x-ratelimit-limit": "60",
          "x-ratelimit-remaining": "57",
          "x-ratelimit-reset": "30",
        },
        body: {
          data: [
            {
              id: "demo/repo/demo-skill",
              slug: "demo-skill",
              name: "Demo Skill",
              source: "demo/repo",
              installs: 1200,
              sourceType: "github",
              installUrl: "https://github.com/demo/repo",
              url: "https://skills.sh/demo/repo/demo-skill",
            },
          ],
        },
      },
      "/api/v1/skills/demo/repo/demo-skill": {
        statusCode: 200,
        body: {
          id: "demo/repo/demo-skill",
          source: "demo/repo",
          slug: "demo-skill",
          installs: 1200,
          hash: "abcdef1234567890",
          files: [
            {
              path: "SKILL.md",
              contents:
                "---\nname: Demo Skill\ndescription: API detail skill\ntags: [demo, api]\n---\n# Demo",
            },
            { path: "examples/demo.md", contents: "# Example" },
          ],
        },
      },
      "/api/v1/skills/audit/demo/repo/demo-skill": {
        statusCode: 200,
        body: {
          audits: [
            {
              provider: "Socket",
              slug: "socket",
              status: "pass",
              summary: "No alerts",
              auditedAt: "2026-04-15T12:05:00.000Z",
              riskLevel: "LOW",
            },
          ],
        },
      },
    });

    const response = await loadSkillsShStore({
      apiKey: "sk_test",
      view: "trending",
      limit: 2,
    });

    expect(response).toEqual(
      expect.objectContaining({
        mode: "api",
        source: "api-v1",
        cacheMaxAgeSeconds: 45,
        rateLimit: { limit: 60, remaining: 57, reset: 30 },
      }),
    );
    expect(response.skills).toHaveLength(1);
    expect(response.skills[0]).toEqual(
      expect.objectContaining({
        slug: "demo-repo-demo-skill",
        source_id: "demo/repo/demo-skill",
        source_type: "github",
        content: expect.stringContaining("# Demo"),
        remote_hash: "abcdef1234567890",
        weekly_installs: "1.2K",
        audit_results: [expect.objectContaining({ provider: "Socket" })],
      }),
    );
    expect(response.skills[0].files).toHaveLength(2);
    expect(vi.mocked(https.request).mock.calls[0][0]).toEqual(
      expect.objectContaining({
        hostname: "203.0.113.10",
        servername: "skills.sh",
        headers: expect.objectContaining({
          Authorization: "Bearer sk_test",
        }),
      }),
    );
  });

  it("returns fallback metadata with Retry-After and rate limit headers on 429", async () => {
    mockSkillsShResponses({
      "/api/v1/skills?view=trending&page=0&per_page=24": {
        statusCode: 429,
        headers: {
          "retry-after": "9",
          "x-ratelimit-limit": "60",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "9",
        },
        body: {
          error: "rate_limited",
          message: "Rate limit exceeded",
        },
      },
    });

    await expect(loadSkillsShStore({ view: "trending" })).resolves.toEqual(
      expect.objectContaining({
        skills: [],
        mode: "fallback",
        source: "html",
        fallbackReason: "Rate limit exceeded",
        retryAfterSeconds: 9,
        rateLimit: { limit: 60, remaining: 0, reset: 9 },
      }),
    );
  });
});
