# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

PromptHub is a **pnpm monorepo** (workspaces declared in `pnpm-workspace.yaml`). The four publishable units live in `apps/*` and `packages/*`; the marketing site `website/` has its own isolated pnpm lockfile and is **not** part of the workspace.

| Workspace | Package name | Role |
| --- | --- | --- |
| `apps/desktop` | `@prompthub/desktop` | Electron 33 + React 18 + Vite 6 desktop app (also produces the `prompthub` CLI bundle) |
| `apps/web` | `@prompthub/web` | Self-hosted Hono server + React SPA, Docker-deployable mirror of the desktop workspace |
| `packages/db` | `@prompthub/db` | SQLite schema + adapter + CRUD classes shared by desktop and web (uses `node-sqlite3-wasm`) |
| `packages/shared` | `@prompthub/shared` | TypeScript types and constants (`ipc-channels`, skill registry, platform config) consumed by every other workspace |
| `website/` | `prompthub-website` | Astro marketing site; release metadata is generated via `node website/scripts/sync-release.mjs` |

> **Important:** `AGENTS.md` and `README.md` still reference the pre-monorepo paths `src/main/...` and `src/renderer/...`. The actual code lives under `apps/desktop/src/main/...` and `apps/desktop/src/renderer/...`. The conventions in `AGENTS.md` still apply — only the paths have moved.

## Common Commands

All scripts at the repo root delegate into `apps/desktop` or `apps/web`. Use `pnpm --filter <pkg>` to target a specific workspace directly.

### Root scripts (most common)

```bash
pnpm install                      # bootstrap entire workspace
pnpm dev                          # desktop renderer (Vite) only
pnpm electron:dev                 # full desktop dev (Vite + Electron main process)
pnpm build                        # build desktop main + renderer + CLI bundle
pnpm electron:build[:mac|:win|:linux]   # package distributable installers
pnpm dev:web                      # web SPA dev only
pnpm verify:web                   # lint + typecheck + test --run + build for @prompthub/web
pnpm docker:web:build             # build the prompthub-web:local Docker image
```

### Tests

```bash
pnpm test -- --run                     # full desktop unit suite (Vitest, jsdom)
pnpm test -- <path> --run              # single test file
pnpm test:unit                         # tests/unit only
pnpm test:integration                  # tests/integration only
pnpm test:e2e                          # builds desktop, then runs Playwright
pnpm test:e2e:smoke                    # minimal Playwright smoke (app + self-hosted-sync)
pnpm test:release                      # full pre-release gate: lint + typecheck + unit + integration + build + e2e:smoke
pnpm test:perf                         # large-data performance budget check
pnpm test:web                          # @prompthub/web Vitest suite
```

### Quality gates

```bash
pnpm lint            # desktop ESLint (must report 0 warnings — `--max-warnings 0`)
pnpm lint:web        # web ESLint
pnpm typecheck       # desktop tsc --noEmit
pnpm typecheck:web   # web tsc --noEmit
pnpm format          # Prettier on src/**/*.{ts,tsx,css}
```

`pnpm test:release` is the canonical pre-release gate — run it before tagging a version.

### CLI development

The desktop workspace also produces the `prompthub` CLI:

```bash
pnpm --filter @prompthub/desktop cli:dev -- prompt list
pnpm --filter @prompthub/desktop cli:build       # bundles to apps/desktop/out/cli/prompthub.cjs
node apps/desktop/out/cli/prompthub.cjs --help   # run the built bundle directly
```

CLI source lives at `apps/desktop/src/cli/`; the bin shim is `apps/desktop/bin/prompthub.cjs`.

## Architecture

### Three-tier process model (desktop)

```
renderer (React SPA)  ──IPC via window.api──▶  preload (contextBridge)  ──▶  main (Electron + SQLite + fs)
                                                                              │
                                                                              ▼
                                                                  @prompthub/db (shared SQLite layer)
```

- **Renderer** (`apps/desktop/src/renderer/`): React 18 SPA, Zustand stores in `stores/`, frontend services (AI client, WebDAV, skill platform sync) in `services/`, Tailwind-only styling using design tokens (`bg-card`, `text-muted-foreground`).
- **Preload** (`apps/desktop/src/preload/`): exposes the typed `window.api` surface via `contextBridge.exposeInMainWorld`. Every IPC channel passes through here.
- **Main** (`apps/desktop/src/main/`): Electron entry, IPC handlers under `ipc/` (split into per-domain files plus a `skill/` subfolder for sub-handlers), business services under `services/`, encryption in `security.ts`, WebDAV in `webdav.ts`, auto-updater in `updater.ts`. Local SQLite tables are also redeclared in `main/database/` for desktop-only schema (this is parallel to `@prompthub/db`).

### Web mirror

`apps/web/` re-uses `@prompthub/db` and `@prompthub/shared` to expose the same data model through HTTP routes (`apps/web/src/routes/`) instead of IPC. Server entry is `apps/web/src/index.ts` (Hono on `@hono/node-server`); the SPA client lives in `apps/web/src/client/`. JWT auth is via `jose`, password hashing via `bcryptjs`. Initial setup happens at `/setup`; `ALLOW_REGISTRATION` defaults to false.

### Shared data layer

`packages/db/src/` defines the SQLite schema (`schema.ts`), the `DatabaseAdapter` wrapper around `node-sqlite3-wasm` (`adapter.ts`), per-domain CRUD classes (`prompt.ts`, `folder.ts`, `skill.ts`), and the schema-versioning init logic (`init.ts`). Both `apps/desktop` (main process) and `apps/web` (server) instantiate `DatabaseAdapter` and use the same CRUD classes — keep this layer free of platform-specific code.

### Shared types and constants

`packages/shared/types/` holds the data-model interfaces (Prompt, Folder, Skill, Settings, AI). `packages/shared/constants/` holds the IPC channel string registry (`ipc-channels`), the skill-platform registry, and other cross-process constants. **All IPC channel strings must be defined here, never hardcoded in handlers.**

### Skill system

Skills are SKILL.md files with YAML frontmatter (required `name`, plus `description`, `version`, `tags`, `author`, `model`). The DB owns UI metadata; the SKILL.md file owns instructional content. Sync flows in both directions:

- `syncFrontmatterToRepo()` writes DB → SKILL.md when the user edits metadata in `EditSkillModal`.
- `syncSkillFromRepo()` reads SKILL.md → DB when the file changes on disk (and on detail-page mount).

Skill names must match `/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/`. Service code is intentionally split (see `apps/desktop/src/main/services/skill-installer*.ts` — installer is a facade over repo, platform, internal, export, remote, and utils submodules) to keep each capability under the structural thresholds in `docs/architecture/code-structure-guidelines.md`.

## Conventions That Are Easy to Get Wrong

- **i18n is mandatory.** All renderer-visible strings go through `t()` from `react-i18next`. Hardcoded Chinese is forbidden in source (regression-tested). Adding a key requires updating **all 7 locale files**: `en`, `zh`, `zh-TW`, `ja`, `fr`, `de`, `es` (under `apps/desktop/src/renderer/i18n/locales/`). Backend error messages stay in English — they are logged, not displayed.
- **No `any`, no `@ts-ignore`.** ESLint enforces this; lint runs with `--max-warnings 0`. Use `unknown` + type guards or proper generics.
- **IPC channels live in `packages/shared/constants/ipc-channels.ts`.** Adding a new IPC endpoint = define channel constant → add types in `packages/shared/types/` → implement handler in `apps/desktop/src/main/ipc/` → expose in `apps/desktop/src/preload/index.ts` → call via `window.api` → add tests for valid + invalid + error paths.
- **SQLite null-byte truncation.** `node-sqlite3-wasm` (and `better-sqlite3`) silently truncates strings at `\x00`. Strip null bytes from user input before writes.
- **Parameterized SQL only.** No string concatenation for SQL values. Multi-statement operations must wrap in `db.transaction()`. Schema changes go through the migration system in `packages/db/src/init.ts` — never edit `schema.ts` without a corresponding migration.
- **FTS5 operators in user input.** Search queries containing `AND`, `OR`, `NOT`, `NEAR`, `*`, `^`, `"`, or `column:` are interpreted as FTS5 operators and need escaping.
- **Encryption.** AES-256-GCM with a fresh random IV every time. Master password derived via scrypt. Never log secrets.
- **SSRF protection.** `image.ipc.ts` validates URLs against internal IPs and `file://`. Path inputs (skill installs, backups) must be guarded against `../`, absolute paths, and symlink escapes.
- **No commits without explicit user request.** Conventional Commits format (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `perf:`, `style:`). `pnpm test -- --run` and `pnpm lint` must pass first.
- **Path aliases (desktop):** `@/` → `apps/desktop/src/main/`, `@renderer/` → `apps/desktop/src/renderer/`, `@shared/` → `packages/shared/` (or local shared). Main ↔ renderer must never import each other directly — go through preload + IPC.

## Testing Standards (Highlights)

The full standards live in `AGENTS.md` §7. Three rules to internalize:

1. **Test behavior, not implementation.** Assert on observable outcomes (return values, DB state, side effects). Avoid `expect(x).toBeDefined()` when the actual value matters.
2. **Database tests use real SQLite.** `new DatabaseAdapter(":memory:")` with the real schema — never mock the DB. Mocked DBs cannot catch SQL syntax errors, FK violations, or trigger behavior.
3. **Adversarial inputs are required for new modules.** SQL injection payloads, XSS-like content, CJK + emoji + RTL + zero-width, null bytes, 10KB+ strings, FTS5 operators, path traversal — all must round-trip safely.

Coverage targets: `packages/db` 80%+, `apps/desktop/src/main/security.ts` 90%+, services 70%+, IPC handlers 60%+, renderer services 80%+.

## Release Workflow

Release housekeeping (version bump, README/CHANGELOG sync, website regen, multilingual docs, locale updates) follows the checklist in `.agents/rules/release-sync.md`. Key invariants:

- `package.json` version + newest `CHANGELOG.md` section are the source of truth.
- After a version bump, run `node website/scripts/sync-release.mjs` and verify `website/src/generated/release.ts` and `website/src/content/docs/changelog.md`.
- Update README badge version, download links, and **all 6 multilingual READMEs** under `docs/README.*.md`.
- Final verification: `pnpm exec tsc --noEmit --pretty false`.

## Reference Documents

- `AGENTS.md` — detailed code-quality, testing, security, and IPC rules (paths predate the monorepo move; mentally remap `src/...` → `apps/desktop/src/...`).
- `docs/architecture/code-structure-guidelines.md` — file-size thresholds (>400 / >700 / >1000 lines) and split-by-concern playbook.
- `docs/architecture/refactor-regression-checklist.md` — required checks when extracting modules from large files.
- `docs/architecture/skill-system-design.md` (and `-zh.md`) — skill installer / sync architecture.
- `docs/architecture/skill-store-requirements.md` (and `-zh.md`) — skill store + multi-platform install requirements.
- `docs/architecture/data-layout-v0.5.5-zh.md` — current on-disk data layout.
- `.agents/rules/release-sync.md` — release-sync workflow detail.
