import { describe, expect, it, vi } from "vitest";

import {
  loadGitHubSkillRepo,
  parseGithubRepo,
  type SkillFetchFailure,
} from "../../../src/renderer/services/github-skill-store";

interface RouteHandler {
  (url: string): Promise<string>;
}

function buildFakeFetcher(routes: Record<string, string | RouteHandler>) {
  return async (url: string): Promise<string> => {
    const handler = routes[url];
    if (handler === undefined) {
      throw new Error(`Unmocked URL: ${url}`);
    }
    return typeof handler === "function" ? await handler(url) : handler;
  };
}

const repoMetaJson = JSON.stringify({
  default_branch: "main",
  owner: { login: "demo" },
});

function buildTreeJson(skillPaths: string[]) {
  return JSON.stringify({
    tree: [
      ...skillPaths.map((path) => ({ path, type: "blob", mode: "100644" })),
      { path: "README.md", type: "blob", mode: "100644" },
    ],
  });
}

function rawSkillBody(name: string, description: string) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nBody`;
}

describe("parseGithubRepo", () => {
  it("normalizes ssh and .git suffixes into a canonical owner/repo", () => {
    expect(parseGithubRepo("git@github.com:demo/skills.git")).toMatchObject({
      owner: "demo",
      repo: "skills",
      repositoryUrl: "https://github.com/demo/skills",
    });
  });

  it("parses GitHub tree URLs into branch and subdirectory", () => {
    expect(
      parseGithubRepo("https://github.com/demo/skills/tree/main/skills/.curated"),
    ).toMatchObject({
      owner: "demo",
      repo: "skills",
      branch: "main",
      subdir: "skills/.curated",
    });
  });

  it("returns null for non-GitHub urls", () => {
    expect(parseGithubRepo("https://gitlab.com/demo/skills")).toBeNull();
  });
});

describe("loadGitHubSkillRepo concurrency + retry", () => {
  const repoUrl = "https://github.com/demo/skills";
  const skillPaths = [
    "alpha/SKILL.md",
    "beta/SKILL.md",
    "gamma/SKILL.md",
    "delta/SKILL.md",
    "epsilon/SKILL.md",
    "zeta/SKILL.md",
  ];

  function buildBaseRoutes(): Record<string, string | RouteHandler> {
    const routes: Record<string, string | RouteHandler> = {
      "https://api.github.com/repos/demo/skills": repoMetaJson,
      "https://api.github.com/repos/demo/skills/git/trees/main?recursive=1":
        buildTreeJson(skillPaths),
    };
    for (const path of skillPaths) {
      routes[`https://raw.githubusercontent.com/demo/skills/main/${path}`] =
        rawSkillBody(path.split("/")[0], `${path} desc`);
    }
    return routes;
  }

  it("respects the configured concurrency cap", async () => {
    const routes = buildBaseRoutes();
    let inFlight = 0;
    let observedMax = 0;

    const baseFetcher = buildFakeFetcher(routes);
    const fetchRemoteContent = async (url: string): Promise<string> => {
      const isRaw = url.startsWith("https://raw.githubusercontent.com/");
      if (isRaw) {
        inFlight += 1;
        observedMax = Math.max(observedMax, inFlight);
      }
      try {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return await baseFetcher(url);
      } finally {
        if (isRaw) inFlight -= 1;
      }
    };

    const skills = await loadGitHubSkillRepo(repoUrl, {
      fetchRemoteContent,
      registrySkills: [],
      rateLimitMessage: "rate limited",
      concurrency: 2,
    });

    expect(skills).toHaveLength(skillPaths.length);
    expect(observedMax).toBeLessThanOrEqual(2);
    expect(observedMax).toBeGreaterThan(0);
  });

  it("retries transient raw-content failures and recovers", async () => {
    const routes = buildBaseRoutes();
    const failingPath = "beta/SKILL.md";
    const failingUrl = `https://raw.githubusercontent.com/demo/skills/main/${failingPath}`;
    const successBody = rawSkillBody("beta", "Recovered after retries");

    let attempts = 0;
    routes[failingUrl] = async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error("ECONNRESET");
      }
      return successBody;
    };

    const onPartialFailure = vi.fn();
    const skills = await loadGitHubSkillRepo(repoUrl, {
      fetchRemoteContent: buildFakeFetcher(routes),
      registrySkills: [],
      rateLimitMessage: "rate limited",
      retries: 2,
      sleep: () => Promise.resolve(),
      onPartialFailure,
    });

    expect(attempts).toBe(3);
    expect(skills).toHaveLength(skillPaths.length);
    expect(onPartialFailure).not.toHaveBeenCalled();
  });

  it("reports partial failures via callback without throwing away successes", async () => {
    const routes = buildBaseRoutes();
    const failingPath = "gamma/SKILL.md";
    routes[`https://raw.githubusercontent.com/demo/skills/main/${failingPath}`] =
      async () => {
        throw new Error("HTTP 500 fetching remote content");
      };

    const failures: SkillFetchFailure[] = [];
    const skills = await loadGitHubSkillRepo(repoUrl, {
      fetchRemoteContent: buildFakeFetcher(routes),
      registrySkills: [],
      rateLimitMessage: "rate limited",
      retries: 1,
      sleep: () => Promise.resolve(),
      onPartialFailure: (items) => failures.push(...items),
    });

    expect(skills).toHaveLength(skillPaths.length - 1);
    expect(skills.find((skill) => skill.slug === "gamma")).toBeUndefined();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      path: failingPath,
      message: expect.stringContaining("HTTP 500"),
    });
  });

  it("does not retry when GitHub returns a hard rate-limit error", async () => {
    const routes = buildBaseRoutes();
    const failingPath = "delta/SKILL.md";
    let attempts = 0;
    routes[`https://raw.githubusercontent.com/demo/skills/main/${failingPath}`] =
      async () => {
        attempts += 1;
        throw new Error("GitHub API rate limit reached");
      };

    const failures: SkillFetchFailure[] = [];
    await loadGitHubSkillRepo(repoUrl, {
      fetchRemoteContent: buildFakeFetcher(routes),
      registrySkills: [],
      rateLimitMessage: "rate limited",
      retries: 5,
      sleep: () => Promise.resolve(),
      onPartialFailure: (items) => failures.push(...items),
    });

    // Rate-limit errors short-circuit retries.
    expect(attempts).toBe(1);
    expect(failures).toHaveLength(1);
  });

  it("uses the tarball fast path when provided and skips per-file fetches", async () => {
    const routes = buildBaseRoutes();
    let rawFetchCount = 0;
    let treeFetchCount = 0;
    const fetchRemoteContent = async (url: string): Promise<string> => {
      if (url.startsWith("https://raw.githubusercontent.com/")) {
        rawFetchCount += 1;
      }
      if (url.includes("/git/trees/")) {
        treeFetchCount += 1;
      }
      return buildFakeFetcher(routes)(url);
    };

    const tarballFiles = skillPaths.map((path) => ({
      path,
      content: rawSkillBody(path.split("/")[0], `${path} desc (tarball)`),
    }));

    const fetchGithubTarball = vi
      .fn()
      .mockResolvedValueOnce(tarballFiles);

    const skills = await loadGitHubSkillRepo(repoUrl, {
      fetchRemoteContent,
      fetchGithubTarball,
      registrySkills: [],
      rateLimitMessage: "rate limited",
      sleep: () => Promise.resolve(),
    });

    expect(fetchGithubTarball).toHaveBeenCalledWith("demo", "skills", "main");
    expect(skills).toHaveLength(skillPaths.length);
    expect(rawFetchCount).toBe(0); // ← key invariant: zero per-file fetches
    expect(treeFetchCount).toBe(0); // ← also no tree-API call
  });

  it("loads only SKILL.md files under a GitHub tree subdirectory", async () => {
    const routes: Record<string, string | RouteHandler> = {
      "https://api.github.com/repos/demo/skills": repoMetaJson,
      "https://api.github.com/repos/demo/skills/git/trees/main?recursive=1":
        buildTreeJson([
          "skills/bundled/SKILL.md",
          "optional-skills/optional/SKILL.md",
          "tests/fixtures/SKILL.md",
        ]),
      "https://raw.githubusercontent.com/demo/skills/main/skills/bundled/SKILL.md":
        rawSkillBody("bundled", "Bundled skill"),
    };

    const skills = await loadGitHubSkillRepo(
      "https://github.com/demo/skills/tree/main/skills",
      {
        fetchRemoteContent: buildFakeFetcher(routes),
        registrySkills: [],
        rateLimitMessage: "rate limited",
      },
    );

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      slug: "bundled",
      source_url: "https://github.com/demo/skills/tree/main/skills/bundled",
      content_url:
        "https://raw.githubusercontent.com/demo/skills/main/skills/bundled/SKILL.md",
    });
  });

  it("filters tarball fast-path files to the selected subdirectory", async () => {
    let rawFetchCount = 0;
    let treeFetchCount = 0;
    const fetchRemoteContent = async (url: string): Promise<string> => {
      if (url.startsWith("https://raw.githubusercontent.com/")) {
        rawFetchCount += 1;
      }
      if (url.includes("/git/trees/")) {
        treeFetchCount += 1;
      }
      return buildFakeFetcher({
        "https://api.github.com/repos/demo/skills": repoMetaJson,
      })(url);
    };

    const fetchGithubTarball = vi.fn().mockResolvedValueOnce([
      {
        path: "skills/bundled/SKILL.md",
        content: rawSkillBody("bundled", "Bundled skill"),
      },
      {
        path: "optional-skills/optional/SKILL.md",
        content: rawSkillBody("optional", "Optional skill"),
      },
    ]);

    const skills = await loadGitHubSkillRepo(
      "https://github.com/demo/skills/tree/main/skills",
      {
        fetchRemoteContent,
        fetchGithubTarball,
        registrySkills: [],
        rateLimitMessage: "rate limited",
      },
    );

    expect(fetchGithubTarball).toHaveBeenCalledWith("demo", "skills", "main");
    expect(skills).toHaveLength(1);
    expect(skills[0]?.slug).toBe("bundled");
    expect(rawFetchCount).toBe(0);
    expect(treeFetchCount).toBe(0);
  });

  it("does not fall back to the repository root README for a subdirectory source", async () => {
    const fetchRemoteContent = vi.fn(
      buildFakeFetcher({
        "https://api.github.com/repos/demo/skills": repoMetaJson,
        "https://api.github.com/repos/demo/skills/git/trees/main?recursive=1":
          JSON.stringify({
            tree: [{ path: "README.md", type: "blob", mode: "100644" }],
          }),
      }),
    );

    const skills = await loadGitHubSkillRepo(
      "https://github.com/demo/skills/tree/main/skills",
      {
        fetchRemoteContent,
        registrySkills: [],
        rateLimitMessage: "rate limited",
      },
    );

    expect(skills).toEqual([]);
    expect(fetchRemoteContent).not.toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/demo/skills/main/README.md",
    );
  });

  it("falls back to per-file raw fetches when tarball download fails", async () => {
    const routes = buildBaseRoutes();
    let rawFetchCount = 0;
    const fetchRemoteContent = async (url: string): Promise<string> => {
      if (url.startsWith("https://raw.githubusercontent.com/")) {
        rawFetchCount += 1;
      }
      return buildFakeFetcher(routes)(url);
    };

    const fetchGithubTarball = vi
      .fn()
      .mockRejectedValueOnce(new Error("codeload unreachable"));

    const skills = await loadGitHubSkillRepo(repoUrl, {
      fetchRemoteContent,
      fetchGithubTarball,
      registrySkills: [],
      rateLimitMessage: "rate limited",
      sleep: () => Promise.resolve(),
    });

    expect(fetchGithubTarball).toHaveBeenCalledTimes(1);
    expect(skills).toHaveLength(skillPaths.length);
    expect(rawFetchCount).toBe(skillPaths.length); // fallback ran
  });

  it("propagates a rate-limit error when *every* file fails with rate-limit", async () => {
    const routes = buildBaseRoutes();
    for (const path of skillPaths) {
      routes[`https://raw.githubusercontent.com/demo/skills/main/${path}`] =
        async () => {
          throw new Error("GitHub API rate limit reached");
        };
    }

    await expect(
      loadGitHubSkillRepo(repoUrl, {
        fetchRemoteContent: buildFakeFetcher(routes),
        registrySkills: [],
        rateLimitMessage: "rate limited — try again later",
        retries: 0,
        sleep: () => Promise.resolve(),
      }),
    ).rejects.toThrow("rate limited — try again later");
  });
});
