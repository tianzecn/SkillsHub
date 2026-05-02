## Context

PromptHub is a pnpm monorepo: `apps/desktop` is the Electron + React renderer, `apps/web` re-uses that renderer through `@desktop-renderer-app` (`apps/web/src/client/pages/DesktopWorkspace.tsx:2`), and `packages/shared` + `packages/db` host shared types and the SQLite layer. Today the Skills surface (`apps/desktop/src/renderer/components/skill/SkillManager.tsx`, 933 lines) renders either a `gallery` grid or a `list` view, and the moment the user clicks a row it replaces the entire main area with the 1203-line `SkillFullDetailPage` (lines 354–382). The prompts module's "card view" (`apps/desktop/src/renderer/components/layout/MainContent.tsx:1334-1378`) already pairs a 320 px list with a flex-1 detail pane, demonstrating the desired pattern.

Constraints we have to honor:

- File-size guidelines: `>700` lines = warn, `>1000` lines = red line. `SkillManager` is over 700; `SkillFullDetailPage` is over 1000. Doing nothing about either while adding new logic would worsen technical debt.
- The skill detail page already triggers `syncSkillFromRepo`, `getMdInstallStatusBatch`, safety scanning, and translation auto-load on every `selectedSkillId` change. Quickly cycling through skills via keyboard would otherwise stampede these calls.
- All renderer text must go through `t()` and ship in 7 locale files (`en`, `zh`, `zh-TW`, `ja`, `fr`, `de`, `es`).
- Anything we change in the renderer ships to both Electron desktop and the browser SPA — there is no per-surface fork.
- The skill data model is owned by `packages/db` and is unaffected by this change.

## Goals / Non-Goals

**Goals:**
- Eliminate the "click → full-screen → back" loop for personal skills and provide an at-a-glance pane of all skills with their detail visible side-by-side.
- Reuse the existing `SkillFullDetailPage` rather than write a parallel detail renderer; introduce only the seams (`embedded?`) needed to host it inside a narrower container.
- Keep the desktop and browser experience identical (identical breakpoints, persisted widths, keyboard shortcuts).
- Stay performant for libraries with hundreds of skills (virtualization, side-effect debouncing).
- Protect users' in-progress edits via the existing `UnsavedChangesDialog`.

**Non-Goals:**
- Redesigning the marketplace (`store`) view — it remains full-screen.
- Introducing mobile / touch optimizations beyond the `<1024 px` fallback.
- Modifying the SQLite schema or the skill domain model in `packages/db`.
- Reworking how Skill metadata syncs between SKILL.md and the DB (the existing `syncSkillFromRepo` / `syncFrontmatterToRepo` flows are reused as-is).
- Renaming or splitting `viewMode` users elsewhere — only the Skills consumers stop honoring it inside Split View.

## Decisions

### Decision 1 — Merge `list` and `gallery` into a single compact list

The single-column `gallery` cards from `SkillGalleryCard.tsx` were designed to read well at ≥250 px wide; at 320 px they look almost identical to the list rows but with more padding. Maintaining two left-pane variants would double the styling work for the splitter, virtualization, and keyboard navigation without giving the user meaningfully different information. Removing the toggle simplifies the top bar and the store shape.

**Alternatives considered:**
- Keep both modes and pick the renderer based on width — rejected: doubles complexity for negligible UX gain in a 320 px column.
- Keep `gallery` as 2 small icons in the column — rejected: 2 columns at 320 px collapse to ~150 px each, too small to show description and platform badges.

### Decision 2 — Embed `SkillFullDetailPage` via an `embedded?` prop instead of writing a new panel

The detail page already encapsulates preview/code/files tabs, the platform deployment panel, the safety report, version history, translation, edit, and delete. Forking it for Split View would mean duplicating 1200 lines and forking every future change. Instead the page receives an `embedded?: boolean`. When `true` it skips its back-arrow and outer `max-w` clamp and otherwise behaves identically. The full-screen entry point continues to mount the same component with `embedded={false}` (or omitted).

To prevent the file from growing further, this change also extracts at least one inner sub-component (a candidate is the action header strip — currently inline in `SkillFullDetailPage`) into a sibling file. The exact extraction is left to implementation, but the component MUST not exceed 1300 lines after the change.

**Alternatives considered:**
- Extract a `SkillDetailPanel` and reduce `SkillFullDetailPage` to a wrapper — preferable long-term but a larger refactor; we leave that as a follow-up and do the minimal extraction now.
- Write a new `SkillSplitDetail` from scratch reusing only the leaf panes (`SkillPreviewPane`, `SkillCodePane`, `SkillPlatformPanel`) — rejected: duplicates orchestration code (translation, safety load, sync) and risks divergence.

### Decision 3 — Three-step responsive breakpoints (1280 / 1024)

We need a graceful experience across modern desktop sizes (≥1440), small laptops and split-screen browser windows (1024–1366), and the existing fallback path (<1024) where the full-screen detail page is still acceptable.

- `≥1280`: three columns. The right pane gets at least 720 px (1280 − Sidebar 240 − list 320), comfortable for the existing detail layout.
- `1024–1279`: two columns. The left list collapses to a 56 px icon strip + a `☰` drawer overlay so users can still pick a skill without sacrificing the detail pane width.
- `<1024`: fall back to today's full-screen `SkillFullDetailPage`. This keeps the change small for users on narrow windows.

**Alternatives considered:**
- Single threshold (e.g., 1100 px) — rejected: produces a noticeable jump and loses the icon-strip middle state.
- Always three-column without responsive collapse — rejected: at 900 px the right pane drops below 600 px and the platform panel becomes unreadable.

### Decision 4 — Resizable splitter (280–480 / default 320 / global persisted)

A fixed 320 px column matches prompts but limits power users; a fully open splitter risks people pulling the right pane below the platform panel's minimum. We bound the range, persist a single global value (`splitListWidth`) so users don't need to re-set it per storeView, and use double-click to reset.

- The persisted value lives in the existing settings store; no new SQLite migration is required (`Settings` is a key-value table consumed via existing IPC).
- The handle is rendered inside the renderer (no native window-controller required); width changes are written synchronously to component state and debounced (200 ms) before persisting via the settings IPC channel.

**Alternatives considered:**
- Per-storeView width memory — rejected: complicates state without a strong product reason; users almost always want the same balance.
- No splitter, just two presets — rejected: power users on ultrawide monitors want more list space.

### Decision 5 — Selection model: shared across views + first-visible fallback + first-entry default

`selectedSkillId` already lives in `useSkillStore`. We deliberately keep it as a single global value (rather than `Record<storeView, skillId>`) so switching from `my-skills` to `distribution` keeps users on the same skill — a common workflow ("see this skill's deployment status"). Cross-storeView visibility is checked on switch; if the skill is filtered out by the new view, fall back to the first-visible item.

The "default-select first item" behavior fires only when there is no persisted `selectedSkillId` *or* when the persisted id is no longer visible. This avoids accidentally triggering side-effects (`syncSkillFromRepo`, etc.) for a freshly opened workspace where the user hadn't yet committed to a skill.

**Alternatives considered:**
- Always default-select on entry — rejected: fires `syncSkillFromRepo` on the first item on every entry, wasteful.
- Per-storeView selection memory — rejected: violates the "same skill across views" workflow.

### Decision 6 — Side-effect debounce (200 ms) on `selectedSkillId`

Without debouncing, holding `ArrowDown` to scan 30 skills would fire 30 sequential `syncSkillFromRepo` + `getMdInstallStatusBatch` + safety load triplets. With a 200 ms debounce, only the final settled skill incurs side effects.

Implementation: wrap the `selectedSkillId` consumed by `SkillFullDetailPage embedded` with a `useDebouncedValue(id, 200)` hook. The left list's selected highlight binds to the live (un-debounced) value so the user gets immediate visual feedback; only the right pane's data fetching follows the debounced value. Brief visual lag (≤200 ms) between selection and detail is acceptable and signals settling.

**Alternatives considered:**
- Cancellable in-flight requests — rejected: requires propagating `AbortSignal` through every IPC call, much larger surface area.
- Throttle instead of debounce — rejected: still fires multiple times during rapid cycling.

### Decision 7 — Per-skill `Map<skillId, { activeTab, scrollTop }>` cache (LRU 100, in-memory)

When users go A → B → A, returning to A's previously selected tab and scroll position is a polished touch. The cache lives in `useSkillStore` (or a small dedicated store) and is bounded at 100 entries with LRU eviction so unbounded browsing doesn't leak. The cache is renderer-session-scoped (not persisted to disk) — for now we don't see value in restoring tab choices across sessions, and persisting would require schema change.

**Alternatives considered:**
- Persist to settings — rejected: schema churn, low value, and users rarely resume in the exact same skill cross-session.
- Cache only `activeTab` (not scroll) — rejected: scroll position is the more frustrating loss for power users.

### Decision 8 — Reuse `UnsavedChangesDialog` and intercept only when the right pane is dirty

`UnsavedChangesDialog` already exists in `apps/desktop/src/renderer/components/ui/UnsavedChangesDialog.tsx`. The right pane only has dirty state when the user is actively in `SkillFileEditor` (Files tab) or `EditSkillModal`. We expose a small "isDirty" subscription from the embedded detail to the parent Split View; selection-change attempts call into the parent guard, which decides whether to show the dialog. Clean state lets `↑/↓` flow without prompting — the most common case.

**Alternatives considered:**
- Auto-save on switch — rejected: silent data mutation is the worst kind of surprise for power users.
- Always intercept switching — rejected: makes `↑/↓` unbearable; users would disable the feature.

### Decision 9 — Top bar split along the column boundary

Two independent top bars — left for search/filter/batch/new-import-scan, right for detail actions — keep semantic ownership clean. Each top bar sticks to the top of its own scroll container. The right pane uses the existing detail action UI from `SkillFullDetailPage`; the left pane reuses the existing search and filter UI from `SkillManager`'s top bar.

**Alternatives considered:**
- Single top bar across both columns — rejected: forces awkward gluing of two semantic clusters and breaks visual scanning.
- Detail actions inline at the top of the detail body (no sticky) — rejected: power users want favorite/edit always reachable while scrolling the body.

### Decision 10 — `react-window` for virtualization, threshold at 200 items

`SkillListView` currently relies on `contentVisibility: auto` + `containIntrinsicSize: 84px` (lines 259–264) which avoids painting off-screen rows but still mounts every component. At 500+ skills this becomes painful, especially for the splitter resize loop (every drag re-flows the column). `react-window`'s `FixedSizeList` provides DOM-level windowing.

We pick the threshold at 200 because below it the lightweight existing strategy is faster to mount and avoids `react-window`'s known quirks (focus loss during keyboard navigation, scroll-into-view after item insertions). Above 200, the cost of windowing is well-justified.

**Alternatives considered:**
- Always virtualize — rejected: smaller libraries pay the complexity tax for no win.
- `react-virtuoso` — rejected: heavier dependency than `react-window` for our flat-list case.

### Decision 11 — Deprecate `viewMode` in store but don't remove it yet

The `viewMode` field on `useSkillStore` controls list/gallery elsewhere it might still be referenced. We mark it `@deprecated` and stop honoring it inside Split View; a follow-up change can remove it after a release of telemetry confirms no orphan callers.

**Alternatives considered:**
- Remove now — rejected: out-of-scope changes can break peripheral callers; do it surgically later.

## Risks / Trade-offs

- **Risk: `SkillFullDetailPage` exceeds the 1000-line red line and adding `embedded?` makes it heavier.**
  Mitigation: extract at least one inner sub-component (e.g., the action header strip) into a sibling file in the same change; cap total at 1300 lines; flag the residual debt for a follow-up "extract `SkillDetailPanel`" change.

- **Risk: Selection-change race when the user clicks rapidly while side effects are debounced.**
  Mitigation: the live store `selectedSkillId` is the source of truth for highlight; only the debounced id drives data fetching. If the user settles on skill X, `useDebouncedValue` returns X exactly once after 200 ms idle, so we get one fetch; clicks during the debounce window are coalesced.

- **Risk: `UnsavedChangesDialog` interception loop on rapid `↑/↓` while a file editor is dirty.**
  Mitigation: the dialog is modal — once shown, focus moves to the dialog and further `↑/↓` are ignored until the user picks an action. The `useDebouncedValue` for side effects is independent of the dirty check, but dirty-check happens on the *intent* to change selection (immediate), so each dialog corresponds to exactly one click/keystroke.

- **Risk: `react-window` breaks `scrollToItem` after insertions/deletions.**
  Mitigation: we only call `scrollToItem` when selection changes via keyboard; new inserts come from `loadSkills` which currently fires once at mount. Add a regression test asserting the selected row stays visible after `↑/↓` past a list edge.

- **Risk: `splitListWidth` IPC writes flood when users wiggle the handle.**
  Mitigation: persist the value with a 200 ms trailing debounce; the in-memory value updates synchronously so visuals don't lag.

- **Risk: 1024–1279 px drawer overlay overlaps the detail pane in unexpected ways with autofill / context menus.**
  Mitigation: render the drawer in a portal anchored to the SkillManager root with a click-outside handler; close on selection.

- **Risk: web (`apps/web`) and desktop diverge if breakpoint logic uses `window.electron` checks instead of pure CSS / window-size hooks.**
  Mitigation: implement breakpoints via `useMediaQuery` against `window.innerWidth` only — no Electron-specific branches. Tests cover both surfaces (Vitest with jsdom resize events; Playwright on the built renderer).

- **Trade-off: 200 ms debounce means the right pane lags the left highlight by up to 200 ms during `↑/↓` scanning.**
  Decision: accept this as feedback that the user is "scanning, not committing." Lower values risk request stampedes; higher values feel sluggish.

- **Trade-off: deprecating `viewMode` without removing it leaves dead state.**
  Decision: surgical removal in a follow-up change keeps this PR focused.

## Migration Plan

This is a renderer-only feature change with no schema migration. Rollout:

1. Feature lands behind no flag (the new behavior is the default the moment the build ships).
2. The deprecated `viewMode` field stays in the store with a `@deprecated` JSDoc tag; existing reads still return the persisted value but inside Split View it is ignored.
3. Persisted `splitListWidth` defaults to 320 when absent; no migration step is required.
4. Per-skill detail-state cache is in-memory only; no persistence to clean up.
5. Rollback strategy: revert the renderer commits — no DB writes, no IPC channel additions that would orphan data.

## Open Questions

1. **Drawer overlay z-index and accessibility**: should the 1024–1279 drawer trap focus and announce itself as a dialog (ARIA), or behave as a non-modal overlay? Default plan: non-modal (close-on-click-outside), but revisit if accessibility audit objects.
2. **`splitFullscreen` button placement on the right pane top bar**: as the leftmost icon next to favorite, or in the `···` overflow menu? Default plan: leftmost icon for discoverability; reconsider after design review.
3. **Whether to surface a "I have unsaved changes" indicator on the row icon in the left list**: useful for users who arrow away and come back, but adds visual noise. Default plan: skip in this change; consider follow-up.
4. **Long-term plan for `viewMode` removal**: schedule a follow-up change to fully remove the field after one release cycle, contingent on telemetry showing no peripheral callers.
