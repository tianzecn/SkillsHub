import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

const GIT_CLONE_FAST_TIMEOUT_MS = 120_000;
const MAX_CLONED_TEXT_FILE_BYTES = 1_048_576;
const MAX_CLONED_FILES = 500;

const CLONED_TEXT_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".html",
  ".css",
  ".svg",
  ".xml",
  ".sql",
  ".r",
  ".lua",
  ".php",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".lock",
  ".gitignore",
]);

export interface ClonedGitHubFile {
  path: string;
  content: string;
}

function assertSafeGitSegment(value: string, label: string): void {
  if (
    !value ||
    value.length > 200 ||
    value.startsWith("-") ||
    value.includes("..") ||
    !/^[A-Za-z0-9._/-]+$/.test(value)
  ) {
    throw new Error(`Invalid GitHub ${label}`);
  }
}

function assertSafeDirectoryPath(value: string): void {
  if (
    value.startsWith("/") ||
    value.startsWith("-") ||
    value.split("/").some((part) => part === "..")
  ) {
    throw new Error("Invalid GitHub directory path");
  }
}

function runGit(args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args, {
      cwd,
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGKILL");
      reject(
        new Error(
          `Git command timed out after ${GIT_CLONE_FAST_TIMEOUT_MS / 1000}s: git ${args.join(" ")}`,
        ),
      );
    }, GIT_CLONE_FAST_TIMEOUT_MS);

    proc.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`Git command failed to start: ${error.message}`));
    });

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `Git command failed with code ${code}: git ${args.join(" ")}\n${stderr}`,
          ),
        );
      }
    });
  });
}

function shouldReadClonedFile(relativePath: string): boolean {
  const ext = relativePath.includes(".")
    ? relativePath.slice(relativePath.lastIndexOf(".")).toLowerCase()
    : "";
  return ext === "" || CLONED_TEXT_EXTENSIONS.has(ext);
}

async function readClonedDirectoryFiles(
  baseDir: string,
): Promise<ClonedGitHubFile[]> {
  const realBasePath = await fs.realpath(baseDir);
  const results: ClonedGitHubFile[] = [];

  const walk = async (dir: string): Promise<void> => {
    if (results.length >= MAX_CLONED_FILES) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= MAX_CLONED_FILES) return;
      if (entry.name === ".git" || entry.isSymbolicLink()) continue;

      const fullPath = path.join(dir, entry.name);
      const realPath = await fs.realpath(fullPath).catch(() => fullPath);
      if (!realPath.startsWith(`${realBasePath}${path.sep}`) && realPath !== realBasePath) {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      const relativePath = path.relative(baseDir, fullPath).split(path.sep).join("/");
      if (!shouldReadClonedFile(relativePath)) continue;

      const stat = await fs.stat(fullPath);
      if (stat.size > MAX_CLONED_TEXT_FILE_BYTES) continue;
      results.push({
        path: relativePath,
        content: await fs.readFile(fullPath, "utf-8"),
      });
    }
  };

  await walk(baseDir);
  return results;
}

export async function cloneGitHubDirectoryFiles(
  owner: string,
  repo: string,
  branch: string,
  directoryPath: string,
): Promise<ClonedGitHubFile[]> {
  assertSafeGitSegment(owner, "owner");
  assertSafeGitSegment(repo, "repo");
  assertSafeGitSegment(branch, "branch");
  assertSafeDirectoryPath(directoryPath);

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "prompthub-skill-"));
  const repoDir = path.join(tempRoot, "repo");
  const repoUrl = `https://github.com/${owner}/${repo}.git`;

  try {
    await runGit([
      "clone",
      "--depth",
      "1",
      "--filter=blob:none",
      "--sparse",
      "--branch",
      branch,
      "--",
      repoUrl,
      repoDir,
    ]);

    if (directoryPath.trim()) {
      await runGit(["sparse-checkout", "set", "--", directoryPath], repoDir);
    }

    const targetDir = directoryPath.trim()
      ? path.join(repoDir, directoryPath)
      : repoDir;
    const targetStat = await fs.stat(targetDir).catch(() => null);
    if (!targetStat?.isDirectory()) {
      throw new Error(`GitHub directory not found: ${directoryPath || "/"}`);
    }

    return await readClonedDirectoryFiles(targetDir);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}
