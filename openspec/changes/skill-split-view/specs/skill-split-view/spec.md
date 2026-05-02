## ADDED Requirements

### Requirement: Split View Activation Scope

The system SHALL render the My Skills workspace using a Split View layout (compact list left + embedded detail right) when, and only when, the active `storeView` is one of `my-skills`, `favorites`, or `distribution`. When `storeView` equals `store`, the system SHALL keep the existing full-screen marketplace experience unchanged.

#### Scenario: Entering my-skills loads the Split View
- **WHEN** the user navigates to the Skills workspace with `storeView = "my-skills"` on a window ≥1280 px wide
- **THEN** the system SHALL render the left compact list and the right embedded detail simultaneously, without a separate "open detail" click

#### Scenario: Marketplace view stays full-screen
- **WHEN** the user navigates to `storeView = "store"`
- **THEN** the system SHALL render the existing full-screen marketplace UI and SHALL NOT render the Split View shell

#### Scenario: Switching between split-enabled views preserves selection
- **WHEN** the user switches from `my-skills` to `distribution` and the previously selected skill is still visible under the new filter
- **THEN** the system SHALL keep the same `selectedSkillId` and the right pane SHALL render the detail for that skill

### Requirement: Compact Left List Rendering

The system SHALL render every visible skill in the left pane as a single compact row containing the skill icon, the skill name, the favorite star, the safety-level icon, a one-line description, and a deployed-platforms badge. The legacy `list` / `gallery` view-mode toggle SHALL be removed from the UI; the `viewMode` store field is deprecated and MUST NOT influence rendering inside Split View.

#### Scenario: A skill appears in the compact row layout
- **WHEN** the Split View is active and `visibleSkills` contains a skill with name, description, favorite=true, and 3 of 5 deployed platforms
- **THEN** the system SHALL render exactly one row that displays the icon, the name with a favorite star, the description (single-line truncated), and a `3/5` platform badge

#### Scenario: Legacy view toggle is no longer offered
- **WHEN** the Split View top bar renders
- **THEN** the system SHALL NOT show the list/gallery view switcher buttons, and SHALL NOT honor stored `viewMode` values for Split View rendering

### Requirement: Left List Virtualization at Scale

The system SHALL switch the left list rendering to a windowed implementation (`react-window` `FixedSizeList`, item height 84 px) whenever `visibleSkills.length >= 200`. Below the threshold the system MAY use the lightweight `contentVisibility: auto` rendering already in `SkillListView`.

#### Scenario: Threshold crossed activates virtualization
- **WHEN** filtering produces a `visibleSkills` array of length 250
- **THEN** the system SHALL render the left list via `FixedSizeList` so that scrolling 1000 px produces no more than 30 mounted row components at any time

#### Scenario: Below threshold avoids virtualization overhead
- **WHEN** filtering produces a `visibleSkills` array of length 50
- **THEN** the system MAY render every row eagerly without `FixedSizeList`

### Requirement: Embedded Detail Pane via SkillFullDetailPage

The system SHALL render the right pane by reusing `SkillFullDetailPage` with a new `embedded` prop set to `true`. In embedded mode the component SHALL hide the back-arrow control and remove the page-level width clamp, but SHALL preserve every other capability of the full-screen detail page (preview / code / files tabs, platform panel, safety report, version history, translation, edit and delete actions).

#### Scenario: Embedded mode hides the back arrow
- **WHEN** the right pane mounts `SkillFullDetailPage` with `embedded={true}`
- **THEN** the rendered DOM SHALL NOT contain the back-arrow control that exists in the standalone full-screen render

#### Scenario: Embedded mode preserves all detail capabilities
- **WHEN** a skill is selected in embedded mode
- **THEN** the user SHALL still be able to switch among the preview / code / files tabs, open the platform deployment panel, view the safety report, open version history, trigger translation, and invoke edit / delete

### Requirement: Three-Step Responsive Layout

The system SHALL respond to the renderer window width with three discrete layouts:

- **`width >= 1280 px`**: Three-column ("Sidebar | left list 320 px (resizable) | right detail flex")
- **`1024 px <= width < 1280 px`**: Two-column with the left list collapsed to a 56 px icon-strip; a top-bar `☰` button SHALL toggle a drawer overlay containing the full left list
- **`width < 1024 px`**: The system SHALL fall back to the existing full-screen `SkillFullDetailPage` (current behavior)

The system SHALL apply the same breakpoints in both Electron (desktop) and browser (`apps/web`) renderers.

#### Scenario: Resizing window to 1100 px collapses the list
- **WHEN** the renderer window is resized from 1500 px down to 1100 px while Split View is active
- **THEN** the system SHALL collapse the left pane to the 56 px icon-strip and SHALL hide the resize handle until the window grows back to ≥1280 px

#### Scenario: Resizing below 1024 px restores full-screen detail
- **WHEN** the renderer window is resized to 900 px while a skill is selected
- **THEN** the system SHALL render the existing full-screen `SkillFullDetailPage` (with the back-arrow visible) and SHALL hide the Split View shell

#### Scenario: Drawer toggle in two-column mode
- **WHEN** the layout is two-column-collapsed and the user clicks the `☰` button in the icon-strip
- **THEN** the system SHALL open a drawer overlay containing the full compact list, and the drawer SHALL close after a skill is selected

### Requirement: Resizable Left Pane

The system SHALL render a 4 px-wide draggable handle on the right edge of the left pane in three-column mode. Dragging the handle SHALL resize the left pane within the inclusive range `[280 px, 480 px]`. Double-clicking the handle SHALL reset the width to 320 px. The system SHALL persist the chosen width as a single global value `splitListWidth` shared across `my-skills`, `favorites`, and `distribution`, surviving renderer reloads.

#### Scenario: Drag clamps to maximum
- **WHEN** the user drags the handle past 480 px
- **THEN** the system SHALL clamp the left pane width at 480 px

#### Scenario: Double-click resets to default
- **WHEN** the user double-clicks the handle while the left pane width is 410 px
- **THEN** the system SHALL set the left pane width to 320 px and persist that value

#### Scenario: Width persists across reloads
- **WHEN** the user sets the width to 360 px and then reloads the renderer
- **THEN** the system SHALL restore the left pane width to 360 px on next entry to the Split View

### Requirement: Initial Selection and Selection Invariants

On first entry to a Split View, if a persisted `selectedSkillId` exists AND that skill appears in the current `visibleSkills`, the system SHALL restore that selection. Otherwise the system SHALL select the first item of `visibleSkills`. Whenever the current `selectedSkillId` no longer appears in `visibleSkills` (because the user changed search, tag filter, classification, or deleted that skill), the system SHALL fall back to selecting the first item of `visibleSkills`. The `selectedSkillId` is shared across `my-skills`, `favorites`, and `distribution` (single value, not per-storeView).

#### Scenario: Persisted selection still visible
- **WHEN** the user opens Split View and the persisted `selectedSkillId` is still present in `visibleSkills`
- **THEN** the system SHALL restore that selection without altering it

#### Scenario: Persisted selection no longer visible
- **WHEN** the user opens Split View but the persisted `selectedSkillId` is filtered out by the current `searchQuery` or `filterTags`
- **THEN** the system SHALL select the first item of `visibleSkills`

#### Scenario: Selected skill is deleted
- **WHEN** the user deletes the currently selected skill via the right pane action
- **THEN** the system SHALL select the first remaining item of `visibleSkills`

#### Scenario: Empty visible list
- **WHEN** `visibleSkills` is empty (no skills match the filter)
- **THEN** the system SHALL set `selectedSkillId` to `null` and the right pane SHALL render an empty-state message keyed by i18n

### Requirement: Keyboard Navigation

The system SHALL support the following keyboard shortcuts whenever a Split View is active and the focus is not inside an input element:

- `ArrowUp` / `ArrowDown`: Move selection within the visible left list (wrap around at boundaries)
- `Escape`: Close the topmost modal first; if none, exit fullscreen-reading mode if active; if neither, exit batch-selection mode if active; otherwise no-op
- `Cmd+F` (macOS) / `Ctrl+F` (other platforms): Move keyboard focus to the search input in the left top bar

The system SHALL NOT bind `Enter` for entering edit mode (avoiding conflict with native form behaviors).

#### Scenario: Arrow keys move selection
- **WHEN** the user presses `ArrowDown` in Split View while skill #2 of `visibleSkills` is selected
- **THEN** the system SHALL move selection to skill #3 of `visibleSkills`

#### Scenario: Wrap-around at end of list
- **WHEN** the user presses `ArrowDown` while the last visible skill is selected
- **THEN** the system SHALL wrap selection to the first visible skill

#### Scenario: Cmd/Ctrl+F focuses search
- **WHEN** the user presses `Cmd+F` (or `Ctrl+F`) anywhere in the Split View other than inside an input element
- **THEN** the system SHALL move keyboard focus to the search input in the left top bar

#### Scenario: Escape priority order
- **WHEN** the user presses `Escape` while an `EditSkillModal` is open AND batch mode is active
- **THEN** the system SHALL close the modal first and SHALL NOT exit batch mode in the same keystroke

### Requirement: Side-Effect Debouncing on Selection Change

The system SHALL debounce all detail-loading side effects (`syncSkillFromRepo`, `getMdInstallStatusBatch`, safety report load, translation auto-load) so that they fire at most once per "settling" of `selectedSkillId`. The debounce window SHALL be 200 ms; rapid arrow-key cycling SHALL only trigger side effects on the final settled selection.

#### Scenario: Rapid arrow keys produce one sync call
- **WHEN** the user presses `ArrowDown` ten times within 1 second across ten distinct skills
- **THEN** the system SHALL invoke `syncSkillFromRepo` no more than once, on the final settled skill, after a 200 ms idle period

#### Scenario: Settled selection triggers full load
- **WHEN** `selectedSkillId` remains stable for at least 200 ms
- **THEN** the system SHALL invoke the same side effects that the standalone `SkillFullDetailPage` invokes today

### Requirement: Per-Skill Detail State Cache

The system SHALL maintain an in-memory cache `Map<skillId, { activeTab, scrollTop }>` of the right pane's tab and scroll position per skill. Re-selecting a previously viewed skill SHALL restore its cached `activeTab` and `scrollTop`. The cache SHALL be bounded at 100 entries with LRU eviction. The cache is renderer-session-scoped and SHALL NOT be persisted to disk.

#### Scenario: Restore previous tab on re-selection
- **WHEN** the user selects skill A, switches the right pane to the `code` tab, selects skill B, then re-selects skill A
- **THEN** the system SHALL render skill A's detail with `activeTab = "code"` and SHALL restore the scroll position last seen on skill A

#### Scenario: LRU eviction at capacity
- **WHEN** the cache contains 100 entries and the user selects a 101st distinct skill
- **THEN** the system SHALL evict the least-recently-used entry to keep the cache bounded at 100

### Requirement: Unsaved-Changes Interception on Selection Change

When the user attempts to change `selectedSkillId` (via mouse click, keyboard, drawer pick) AND the right pane has dirty content from `SkillFileEditor` or `EditSkillModal`, the system SHALL display the existing `UnsavedChangesDialog` offering Save / Discard / Cancel. The system SHALL NOT block selection changes when no dirty editor is mounted.

#### Scenario: Dirty file editor blocks selection
- **WHEN** the user has unsaved edits in `SkillFileEditor` and clicks a different skill in the left list
- **THEN** the system SHALL show `UnsavedChangesDialog`, and selection SHALL change only after the user picks Save or Discard

#### Scenario: Clean state allows arrow-key flow
- **WHEN** the right pane is on the preview tab with no dirty editor and the user presses `ArrowDown`
- **THEN** the system SHALL change selection without showing any dialog

### Requirement: Batch Selection Mode Replaces Right Pane

When `isSelectionMode` becomes `true` the system SHALL:

1. Remember the current `selectedSkillId` as `previousSelectedId`
2. Replace the right pane with a Batch Summary Panel showing: a header `N skills selected`, a thumbnail list of selected skills, and the existing batch action buttons (favorite, tag, deploy, delete)
3. Restore `selectedSkillId` to `previousSelectedId` (and the cached detail state) when batch mode exits

If `previousSelectedId` is no longer in `visibleSkills` after exit, the system SHALL fall back to the first visible skill.

#### Scenario: Entering batch mode swaps right pane
- **WHEN** the user toggles batch mode while skill A is selected
- **THEN** the system SHALL render the Batch Summary Panel in the right pane and SHALL keep skill A's detail state cached

#### Scenario: Exiting batch restores previous selection
- **WHEN** the user exits batch mode and skill A is still in `visibleSkills`
- **THEN** the system SHALL re-select skill A and SHALL restore its cached `activeTab` and `scrollTop`

#### Scenario: Exit when previous selection deleted
- **WHEN** the user exits batch mode after deleting skill A as part of a batch operation
- **THEN** the system SHALL select the first item of `visibleSkills`

### Requirement: Top-Bar Partition

The system SHALL split top-bar controls between the two panes:

- **Left pane top bar (sticky)**: search input, filter chips (`filterType` + `filterTags`), batch-selection toggle, and the new-skill / scan / import action buttons
- **Right pane top bar (sticky inside the detail container)**: detail actions — favorite toggle, edit, delete, version history, open folder, fullscreen-reading toggle, more (`···`) menu

The two top bars SHALL be independent — neither pane's top bar SHALL extend across the column boundary.

#### Scenario: Left top bar holds search and filters
- **WHEN** the Split View renders
- **THEN** the search input, filter chips, batch toggle, and "+ new" button SHALL all live in the left pane top bar

#### Scenario: Right top bar holds detail actions
- **WHEN** a skill is selected
- **THEN** favorite, edit, delete, version history, open-folder, and fullscreen-reading buttons SHALL render in the right pane top bar (which stays sticky to the top of the detail scroll container)

### Requirement: i18n Coverage Across All Locales

For every user-facing string introduced by the Split View (empty-state, drawer toggle, splitter tooltip, batch summary, fullscreen toggle, unsaved-changes prompt, etc.), the system SHALL define an i18n key and translate it across all 7 locale files (`en`, `zh`, `zh-TW`, `ja`, `fr`, `de`, `es`). The repository's existing i18n key-presence regression test SHALL stay green.

#### Scenario: New i18n key has all 7 translations
- **WHEN** a new i18n key such as `skill.split.empty` is added
- **THEN** the key SHALL exist with a non-empty translation in each of the 7 locale files

#### Scenario: No hard-coded user-facing string
- **WHEN** any new component renders text visible to the user
- **THEN** that text SHALL be produced via `t()` from `react-i18next` and SHALL NOT be hard-coded in source

### Requirement: Web Renderer Compatibility

Because `apps/web/src/client/pages/DesktopWorkspace.tsx` re-exports the desktop renderer as `@desktop-renderer-app`, the Split View SHALL be operable in both the Electron desktop and the `apps/web` browser context. All responsive breakpoints, keyboard shortcuts, and persistence (`splitListWidth`) SHALL behave identically across the two surfaces.

#### Scenario: Browser at 1440 px renders three-column
- **WHEN** the user opens the `apps/web` SPA in a browser window 1440 px wide and navigates to My Skills
- **THEN** the system SHALL render the three-column Split View identically to the Electron desktop at the same width

#### Scenario: Width persistence works in the browser
- **WHEN** the user resizes the splitter in `apps/web` and reloads
- **THEN** the system SHALL restore the same `splitListWidth` (persisted via the existing settings mechanism)
