## Why

The current "My Skills" workspace forces users into a "click-to-fullscreen-detail, click-back-to-list" loop: selecting any skill row replaces the entire main area with the 1203-line `SkillFullDetailPage`, and returning requires the back arrow. Browsing or comparing multiple skills is therefore painful and inconsistent with the prompts module, which already offers a 320 px list + flex detail two-pane layout (combined with the outer Sidebar this reads as three columns). We need to bring the same friction-free three-column experience to skills so users can scan their library and inspect any skill without losing context.

## What Changes

- Add a Split View renderer for `storeView ∈ { my-skills, favorites, distribution }` that pairs a 320 px compact list on the left with the existing skill detail on the right (Sidebar = visual third column). `store` (marketplace) keeps the current full-screen view.
- **BREAKING (UX)**: Remove the `list` / `gallery` view-mode toggle. They merge into a single compact list. The store field `viewMode` is deprecated.
- Embed `SkillFullDetailPage` in the right pane via a new `embedded?: boolean` prop (hides the back arrow and width clamp). The fullscreen path remains for the responsive fallback and an explicit "Open in fullscreen" action.
- Add three responsive breakpoints: ≥1280 px → three columns; 1024–1279 px → two columns with the left list collapsed to an icon strip + drawer; <1024 px → keep today's full-screen detail.
- Add a draggable splitter for the left pane (min 280 / max 480 / default 320, double-click resets to 320, single global persisted value `splitListWidth`).
- Add `react-window` virtualization for the left list once `visibleSkills.length >= 200`.
- Add keyboard navigation: `↑/↓` cycle selection in the left list (with 200 ms debounce on side-effects like `syncSkillFromRepo`, `getMdInstallStatusBatch`, safety load); `Esc` exits fullscreen reading / batch / modals; `Cmd|Ctrl+F` focuses the left top-bar search.
- Add a per-skill detail-state cache (`Map<skillId, { activeTab, scrollTop }>`, LRU bounded at 100) so re-selecting a skill restores its tab + scroll.
- Reuse `UnsavedChangesDialog` to intercept skill switching only when `SkillFileEditor` or `EditSkillModal` is dirty; clean state lets `↑/↓` flow through.
- Selection rules: on first entry, default-select the first visible skill only when no persisted `selectedSkillId` is still visible. When the current selection is filtered out, deleted, or hidden, fall back to the first visible item. `selectedSkillId` is shared across `my-skills` ↔ `favorites` ↔ `distribution`.
- Batch selection mode (`isSelectionMode`) replaces the right pane with a batch summary panel; exiting batch restores the previously selected skill and its cached detail state.
- Top-bar split: left pane top owns search / filter / batch toggle / new-import-scan; right pane top owns the detail actions (favorite, edit, delete, version history, open folder, fullscreen reading).
- Add i18n keys for all new strings across all 7 locales (`en`, `zh`, `zh-TW`, `ja`, `fr`, `de`, `es`).

## Capabilities

### New Capabilities
- `skill-split-view`: Three-column ("Sidebar | compact list | embedded detail") workspace for browsing and managing personal skills, including responsive collapse, draggable splitter, keyboard navigation, dirty-state protection, batch summary panel, virtualization, and per-skill detail-state cache.

### Modified Capabilities
<!-- No existing specs in openspec/specs/ — nothing to modify. The legacy list/gallery toggle behaviour was never spec'd. -->

## Impact

- **Renderer code**:
  - `apps/desktop/src/renderer/components/skill/SkillManager.tsx` (933 lines, refactored — split-view branch added, list/gallery toggle removed; expected to drop below the 700-line guideline once `SkillSplitView`, `SkillSplitList`, `SkillBatchSummaryPanel` are extracted).
  - `apps/desktop/src/renderer/components/skill/SkillFullDetailPage.tsx` (1203 lines, gains `embedded?` prop; at least one inner sub-component extracted to keep total complexity from growing).
  - `apps/desktop/src/renderer/components/skill/SkillListView.tsx` (re-skinned for 320 px column).
  - `apps/desktop/src/renderer/components/layout/MainContent.tsx` (no functional change; SkillManager still mounted via the `uiViewMode === 'skill'` branch).
- **State / persistence**:
  - `apps/desktop/src/renderer/stores/skill.store.ts`: deprecate `viewMode`; add `splitListWidth`, `splitFullscreen`, `detailTabState: Map<string, …>`, `splitDrawerOpen`, batch entry/exit memo.
  - `apps/desktop/src/renderer/stores/settings.store.ts`: persist `splitListWidth` (single global value, written via existing settings IPC channel — no new SQLite migration required).
- **Web mirror**: `apps/web/src/client/pages/DesktopWorkspace.tsx` re-exports `@desktop-renderer-app`, so the change ships automatically to `@prompthub/web`. Responsive breakpoints must therefore be validated in both Electron and the browser.
- **Dependencies**: add `react-window` (and `@types/react-window`) to `apps/desktop`. No removals.
- **i18n**: add ~10 new keys to each of 7 locale files; existing key-presence regression tests must stay green.
- **Tests**: extend Vitest, Playwright `test:e2e:smoke`, and `test:perf` budgets (see `tasks.md`).
- **Risk**: medium. `SkillFullDetailPage` is large and already over the 1000-line red line — adding `embedded?` without extracting a sub-component would worsen technical debt; mitigated by also splitting at least one sub-component in this change.
- **Out of scope**: redesigning the marketplace (`store`) layout, mobile/touch support, switching the SQLite skill schema, or refactoring the platform deployment workflow.
