---
name: release-publish
description: Project-level PromptHub release workflow. Use when the user asks to commit and push all changes, publish a formal version, tag a release, build installers, publish to GitHub Releases, or uses trigger phrases such as "提交推送", "帮我提交所有修改并推送", "发版", "发布正式版本", "发布到 GitHub Releases", "打包发布", or "确认发布". This skill commits all allowed workspace changes in one Chinese Conventional Commit, chooses and syncs the next version, pushes code and tag to tianzecn/SkillsHub, waits for GitHub Actions, repairs release asset upload failures when needed, promotes the release to latest, and verifies auto-update feeds.
---

# Release Publish

## Operating Contract

Treat this as a full formal release workflow, not a plain `git push`.

When triggered, complete the whole path unless blocked:

1. Inspect all workspace changes.
2. Choose the next version.
3. Sync versions, changelog, README/localized docs, and website release metadata.
4. Run required validation and fix failures before tagging.
5. Commit all allowed changes in one Chinese Conventional Commit.
6. Push code and `vX.Y.Z` tag to `tianzecn/SkillsHub`.
7. Wait for the public GitHub Actions release workflow.
8. Repair GitHub Release asset/upload failures if the build artifacts are valid.
9. Promote the verified release to non-draft latest.
10. Verify updater feeds and key installer URLs.

Do not stop for routine confirmations. Ask the user only when an operation would delete or rewrite an already public tag/release, expose uncertain sensitive data, or publish somewhere other than `tianzecn/SkillsHub`.

## Repository Rules

- Use repository `tianzecn/SkillsHub` for GitHub Release and updater verification.
- Push to the public repository backing `tianzecn/SkillsHub`; do not publish to another remote.
- If `origin` does not point to `tianzecn/SkillsHub`, report the mismatch and use an explicit safe push target for this repo rather than silently publishing elsewhere.
- Use the current branch for the code push, normally `main`.

## Scope And Safety

Commit all allowed modified and untracked files, including code, docs, `.github/workflows`, and project-level `.codex/skills`.

Automatically exclude and continue when files are sensitive or local-only:

- `.env`, `.env.*`, secret files, tokens, private keys, certificates, API keys
- local databases: `*.db`, `*.sqlite`, `*.sqlite3`
- caches, logs, coverage, test reports, local app data, user private data
- `dist/`, `build/`, `out/`, `release/`, `node_modules/`, `.pnpm-store/`
- temporary files such as `*.tmp`, `*.temp`, `*.tsbuildinfo`

Before committing, inspect:

```bash
git status --short
git diff --stat
git diff --check
git diff -- . ':(exclude)pnpm-lock.yaml' | rg -n "BEGIN .*PRIVATE KEY|api[_-]?key|secret|token|password|AKIA|sk-[A-Za-z0-9]" -i
```

If a suspected sensitive file is staged or tracked, unstage/exclude it and continue. If it is already tracked and cannot be excluded safely, stop and report the exact path.

## Version Decision

Codex decides the next version.

Use SemVer:

- bug fixes, release flow fixes, docs, metadata, i18n, build, and CI maintenance: patch
- new user-visible features or capability expansion: minor
- breaking data migrations, incompatible config changes, or required manual migration: major

For `0.x` versions, prefer `minor` for breaking changes unless the user explicitly asks to move to `1.0.0`.

Before tagging, update every version surface that applies:

- root `package.json`
- `apps/desktop/package.json`
- `CHANGELOG.md` with Chinese main description plus English explanation
- root README and localized README files
- website release metadata and generated release links
- any established generated docs by running repo scripts such as:

```bash
node website/scripts/sync-release.mjs
```

Search for stale version strings and stale latest-download links after syncing:

```bash
rg "0\\.5\\.[0-9]+|latest/download/.*0\\.5\\." README* docs website apps packages CHANGELOG.md
```

Adjust the search pattern to the previous version.

## Validation Gate

Never tag or publish if validation is failing.

Run at least:

```bash
git diff --check
pnpm lint
pnpm --filter @prompthub/desktop typecheck
pnpm --filter @prompthub/desktop build
```

Run targeted unit tests for touched behavior. For release-sensitive or broad changes, prefer:

```bash
pnpm test:release
```

If a check fails, fix it and rerun the failed check. Continue only after the chosen release gate is green. Warnings are acceptable only when they are known non-blocking warnings and the command exits successfully.

## Commit And Tag

Use one total commit, even when changes span code, docs, and release metadata.

Use a Chinese Conventional Commit message:

- `fix: 修复xxx问题`
- `feat: 新增xxx能力`
- `chore(release): 发布 vX.Y.Z`

When the release includes real product changes, prefer `fix:` or `feat:` over a pure release chore.

Then push code and tag:

```bash
git add -A
git restore --staged <excluded-sensitive-paths>
git commit -m "<中文 Conventional Commit>"
git tag "vX.Y.Z"
git push origin main
git push origin "vX.Y.Z"
```

If the local or remote tag already exists:

- If it is unpublished and points to the intended commit, reuse it.
- If it points elsewhere, do not rewrite it without explicit user approval.
- Never delete or rewrite an already public tag or non-draft Release without explicit user approval.

## GitHub Actions And Release

After pushing the tag, locate and watch the release workflow:

```bash
gh run list --repo tianzecn/SkillsHub --workflow "Desktop Build and Release" --limit 5
gh run watch <run-id> --repo tianzecn/SkillsHub --exit-status
```

The workflow creates a Draft Release first. After all assets and updater feeds are verified, promote it:

```bash
gh release edit "vX.Y.Z" --repo tianzecn/SkillsHub --draft=false --latest
```

If build/test jobs fail, fix the code and release again with a newer version unless the tag has not been published and can be safely corrected.

If build artifacts succeed but Release creation/upload fails, Codex is authorized to repair automatically:

- download Actions artifacts
- collect the expected release assets
- merge/fix/verify updater manifests with existing repo scripts
- delete a bad Draft Release or bad draft assets
- upload/overwrite assets with `--clobber` or GitHub upload API retries
- promote the verified Release to latest

Allowed without asking: overwrite Release assets, delete a bad Draft Release, delete bad draft assets.

Not allowed without asking: delete or rewrite a public tag, delete a non-draft Release, or replace already public Release assets after publication.

## Required Release Assets

Expect 19 assets:

```text
PromptHub-X.Y.Z-amd64.deb
PromptHub-X.Y.Z-arm64.dmg
PromptHub-X.Y.Z-arm64.dmg.blockmap
PromptHub-X.Y.Z-arm64.zip
PromptHub-X.Y.Z-arm64.zip.blockmap
PromptHub-X.Y.Z-x64.AppImage
PromptHub-X.Y.Z-x64.dmg
PromptHub-X.Y.Z-x64.dmg.blockmap
PromptHub-X.Y.Z-x64.zip
PromptHub-X.Y.Z-x64.zip.blockmap
PromptHub-Setup-X.Y.Z-arm64.exe
PromptHub-Setup-X.Y.Z-x64.exe
latest-arm64.yml
latest-linux.yml
latest-mac-arm64.yml
latest-mac-x64.yml
latest-mac.yml
latest-x64.yml
latest.yml
```

Use `scripts/verify_release.sh` after publishing:

```bash
.codex/skills/release-publish/scripts/verify_release.sh vX.Y.Z
```

If local repaired assets are available, pass the directory to also compare GitHub asset digests:

```bash
.codex/skills/release-publish/scripts/verify_release.sh vX.Y.Z /path/to/release_assets
```

## Final Report

On success, report:

- version
- commit hash and tag
- GitHub Actions URL
- GitHub Release URL
- asset count
- updater feed versions
- key installer URL HTTP status results
- local `git status --short`

On failure, report:

- failed stage
- root cause
- automatic repair already attempted
- exact remaining blocker
- whether any tag, draft release, or asset was created
