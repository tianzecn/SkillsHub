## 1. Foundation: Store + Embedded Detail

- [x] 1.1 Add deprecated JSDoc to `viewMode` in `apps/desktop/src/renderer/stores/skill.store.ts` and add new fields: `splitListWidth: number` (default 320), `splitFullscreen: boolean`, `splitDrawerOpen: boolean`, `detailTabState: Map<string, { activeTab, scrollTop }>`, `previousSelectedSkillId: string | null` (for batch exit), with setters
- [x] 1.2 Persist `splitListWidth` via the existing settings IPC channel (`apps/desktop/src/renderer/stores/settings.store.ts` and `apps/desktop/src/main/ipc/settings.ipc.ts`); confirm that no SQLite migration is needed
- [x] 1.3 Add `embedded?: boolean` prop to `apps/desktop/src/renderer/components/skill/SkillFullDetailPage.tsx`; when true: hide back-arrow control, drop outer `max-w` clamp, allow parent to control container height
- [x] 1.4 Extract one inner sub-component from `SkillFullDetailPage.tsx` (candidate: action header strip) to a sibling file to keep total under 1300 lines after `embedded?` lands; verify no behavior change in non-embedded mode
- [x] 1.5 Add `react-window` and `@types/react-window` to `apps/desktop/package.json`; run `pnpm install`

## 2. Split View Shell

- [x] 2.1 Create `apps/desktop/src/renderer/components/skill/SkillSplitView.tsx` — the responsive container that renders three-column / two-column-collapsed / fullscreen-fallback states based on a `useMediaQuery`-style hook keyed off `window.innerWidth` (≥1280, 1024–1279, <1024)
- [x] 2.2 Create `apps/desktop/src/renderer/components/skill/SkillSplitList.tsx` — the left compact list using the existing row markup from `SkillListView.tsx` rescaled for 320 px (icon, name + favorite + safety, description, platform badge); accept `width: number` prop
- [x] 2.3 In `SkillSplitView`, render `<SkillFullDetailPage embedded />` in the right pane bound to a debounced `selectedSkillId` (see Task 4.1)
- [x] 2.4 Wire `SkillManager.tsx` to render `<SkillSplitView />` when `storeView ∈ {my-skills, favorites, distribution}` and the existing full-screen path otherwise (especially `store`)
- [x] 2.5 Remove the list / gallery toggle UI from `SkillManager.tsx` (current lines ~620–635); ensure `viewMode` is no longer read inside Split View

## 3. Top Bar Partition

- [x] 3.1 Move search input, filter chips (`filterType` + `filterTags`), batch toggle, and "+ new / scan / import" buttons into `SkillSplitList` top bar (sticky)
- [x] 3.2 Confirm `SkillFullDetailPage` action header (favorite / edit / delete / version history / open folder / `···`) renders sticky inside its scroll container in both `embedded` and full-screen modes
- [x] 3.3 Add a "Fullscreen reading" toggle to the right pane top bar that promotes the embedded detail to a temporary full-screen view (uses `splitFullscreen` store flag); Esc exits

## 4. Selection, Side Effects, and Tab Cache

- [x] 4.1 Add a `useDebouncedValue<T>(value: T, delayMs: number): T` hook (or reuse if it already exists) and apply with `delayMs=200` to the `selectedSkillId` consumed by `<SkillFullDetailPage embedded />`; the live value still drives left-list highlight
- [x] 4.2 Implement first-entry default selection logic in `SkillSplitView`: if persisted `selectedSkillId` is in `visibleSkills` keep it; else select first visible
- [x] 4.3 Implement "current selection no longer visible" fallback to first visible skill, triggered when `visibleSkills` changes (filter, delete, classification switch)
- [x] 4.4 Implement per-skill `detailTabState` cache: write `{ activeTab, scrollTop }` on tab change / scroll throttle in the embedded detail; restore on selection re-entry; LRU bound at 100 entries
- [x] 4.5 Hook into `selectedSkillId` change attempts to call into `SkillSplitView` guard — if the embedded detail or `EditSkillModal` reports `isDirty`, show `UnsavedChangesDialog` (Save / Discard / Cancel) before committing the change

## 5. Resizable Splitter

- [x] 5.1 Add a 4 px-wide drag handle on the right edge of `SkillSplitList` that updates `splitListWidth` in the store on drag (clamped 280–480)
- [x] 5.2 Implement double-click on the handle to reset `splitListWidth` to 320
- [x] 5.3 Persist `splitListWidth` to settings with a 200 ms trailing debounce (in-memory updates remain synchronous so visuals don't lag)
- [x] 5.4 Hide the drag handle in two-column-collapsed and fullscreen-fallback modes

## 6. Responsive Two-Column Drawer

- [x] 6.1 In 1024–1279 px mode, render the left pane as a 56 px icon strip with a `☰` button that toggles `splitDrawerOpen`
- [x] 6.2 Render the drawer via React portal anchored to the SkillManager root, positioned over the icon strip; auto-close on selection or click-outside
- [x] 6.3 Verify focus management: opening the drawer moves keyboard focus to the search input within it; closing returns focus to the `☰` button

## 7. Keyboard Navigation

- [x] 7.1 Implement global keyboard listener (scoped to Split View mount) supporting `ArrowUp` / `ArrowDown` to cycle `selectedSkillId` through `visibleSkills` (wrap at boundaries); ignore when focus is inside an input element
- [ ] 7.2 Implement `Escape` priority: close topmost modal → exit `splitFullscreen` → exit `isSelectionMode` (batch) → no-op
- [x] 7.3 Implement `Cmd/Ctrl + F` to focus the left top-bar search input
- [x] 7.4 Ensure that `↑/↓` triggers `scrollIntoView({ block: "nearest" })` on the newly selected row in both virtualized and non-virtualized list paths

## 8. Batch Selection Mode

- [x] 8.1 Create `apps/desktop/src/renderer/components/skill/SkillBatchSummaryPanel.tsx` showing `N selected` header, thumbnail list of selected skills (from `selectedSkillIds`), and the existing batch action buttons (favorite / tag / deploy / delete)
- [x] 8.2 In `SkillSplitView`, on `isSelectionMode = true`: snapshot current `selectedSkillId` to `previousSelectedSkillId`; replace right pane with `SkillBatchSummaryPanel`
- [x] 8.3 On `isSelectionMode = false`: restore `selectedSkillId` from `previousSelectedSkillId` if still in `visibleSkills`, else select first visible; restore cached tab state

## 9. Virtualization

- [x] 9.1 In `SkillSplitList`, when `visibleSkills.length >= 200`, render rows via `react-window` `FixedSizeList` with `itemSize={84}`; below 200 keep the existing eager `contentVisibility: auto` rendering
- [x] 9.2 Wire `scrollToItem` on the virtualized list when keyboard navigation moves selection past the visible window
- [x] 9.3 Handle splitter width changes: re-mount or `forceUpdate` the windowed list so its internal width stays in sync with the column

## 10. i18n

- [x] 10.1 Define new i18n keys: `skill.split.empty`, `skill.split.noSkillsHint`, `skill.split.unsavedTitle`, `skill.split.unsavedDescription`, `skill.split.fullscreen`, `skill.split.exitFullscreen`, `skill.split.batchSummary` (with `{{count}}` interpolation), `skill.split.openListDrawer`, `skill.split.resizeHandleTooltip` (and any others discovered during implementation)
- [x] 10.2 Add translations to all 7 locale files under `apps/desktop/src/renderer/i18n/locales/`: `en`, `zh`, `zh-TW`, `ja`, `fr`, `de`, `es`
- [x] 10.3 Verify the existing i18n key-presence regression test passes for all new keys

## 11. Tests

- [ ] 11.1 Vitest unit test for `SkillSplitView` state machine: default-select on first entry, fallback on filter, fallback on delete, cross-storeView shared selection
- [ ] 11.2 Vitest unit test for splitter: width clamps to [280, 480]; double-click resets to 320; debounced persistence triggers exactly one settings write per drag rest
- [ ] 11.3 Vitest unit test for unsaved-changes interception: dirty `SkillFileEditor` blocks selection and shows dialog; clean state lets selection through
- [ ] 11.4 Vitest unit test for tab-state cache: A → tab=code → B → A restores tab=code and previous scrollTop; LRU evicts oldest at 101st entry
- [ ] 11.5 Vitest unit test for keyboard: `ArrowDown` wraps at boundary; `Cmd+F` focuses search; `Escape` priority order honored
- [ ] 11.6 Vitest unit test for side-effect debounce: 10 rapid `selectedSkillId` changes within 1 s produce exactly one `syncSkillFromRepo` call after the 200 ms idle period
- [ ] 11.7 Vitest unit test for responsive breakpoints: jsdom resize events at 1500/1100/900 px produce three-column / two-column-collapsed / fullscreen-fallback states
- [ ] 11.8 Vitest unit test for batch mode: enter snapshots `previousSelectedSkillId`; exit restores; if previous skill deleted, fall back to first visible
- [ ] 11.9 Playwright e2e in `test:e2e:smoke`: open Skills workspace → verify three-column → click second skill → right pane updates → trigger edit → switch skill → UnsavedChangesDialog → save → switch succeeds
- [ ] 11.10 Playwright e2e: enter batch mode → select 2 skills → verify `SkillBatchSummaryPanel` → cancel batch → previous selection restored
- [ ] 11.11 Performance test in `test:perf`: 500-skill seed → first paint < 500 ms; splitter drag samples ≥95% of frames under 16 ms

## 12. Verification & Pre-Release

- [x] 12.1 Run `pnpm lint` (must pass with `--max-warnings 0`)
- [x] 12.2 Run `pnpm typecheck` (no errors)
- [x] 12.3 Run `pnpm test -- --run` (full unit suite green)
- [ ] 12.4 Run `pnpm test:e2e:smoke` (smoke green)
- [x] 12.5 Run `pnpm test:perf` (budget honored)
- [ ] 12.6 Manual verification on `apps/web` (`pnpm dev:web`) at viewport widths 1500 / 1280 / 1100 / 900 px
- [ ] 12.7 Manual verification on Electron at the same viewport widths
- [ ] 12.8 Manual verification of fallback path: <1024 px width still renders the existing full-screen `SkillFullDetailPage` with back arrow
- [x] 12.9 Confirm `SkillFullDetailPage` line count ≤ 1300 after extraction (Task 1.4); if not, plan follow-up extraction issue
- [x] 12.10 Update CHANGELOG.md and any user-facing release notes (no version bump or website regen — those are release-time concerns governed by `.agents/rules/release-sync.md`)
