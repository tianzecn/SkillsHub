# 我的 Skills 三列布局改造规格说明（Skill Split View Spec）

> 规格作者：哈雷酱（Claude Code）
> 决策来源：与项目维护者的结构化访谈
> 目标版本：下一次特性发布
> 文件路径标注：路径基于 monorepo 结构（`apps/desktop/src/...`）

---

## 1. 背景与问题陈述

### 1.1 现状
- `apps/desktop/src/renderer/components/skill/SkillManager.tsx` 是 skill 管理的总入口（930 行，已超 700 行结构阈值）。
- 现有交互：用户在 `gallery` / `list` 视图下点击任一 skill 卡片或行 → `selectedSkillId` 被设置 → SkillManager 第 354–382 行立刻把整个主区域替换为全屏的 `SkillFullDetailPage`（1203 行）。返回需点击左上角 ArrowLeft。
- Prompts 模块的"卡片视图"在主区域内部维持 **左 320px 列表 + 右 flex-1 详情** 的双栏布局（`MainContent.tsx` 第 1334–1378 行），加上外层 `Sidebar` 形成视觉上的三列。这种布局无须二次点击即可浏览详情。

### 1.2 痛点
1. 每查看一个 skill 都要进入全屏详情，再点返回 → 二次点击。
2. 浏览多个 skill 对比时上下文切换成本高。
3. 与 prompts 模块的体验不一致，违反产品内部一致性原则。

### 1.3 目标
将"我的 skills"列表升级为 **左侧紧凑列表 + 右侧详情** 的双栏布局，复用项目已有的 prompts 卡片视图思想，消除二次点击，保持 `SkillFullDetailPage` 全部能力。

### 1.4 关键事实
- **Web 端复用**：`apps/web/src/client/pages/DesktopWorkspace.tsx` 第 2 行通过 `@desktop-renderer-app` 直接复用 desktop 的整个 React 应用，因此本次改造**自动同时生效于 desktop 与 web**。响应式断点必须从一开始就考虑两端兼容。

---

## 2. 整体决策摘要

| 维度 | 决策 |
| --- | --- |
| 视图模式 | **合并 `list` 与 `gallery` 为单一紧凑列表**，删除两者切换按钮 |
| 启用范围 | `storeView ∈ { my-skills, favorites（filterType）, distribution }`；`store`（商店）保持全屏现状 |
| 左列样式 | 单一紧凑行：icon + 名称 + 描述（二行截断）+ 平台徽标 + 收藏星标 |
| 左列宽度 | 初始 320px，可拖拽 280–480px，双击手柄复位 320，全局单一持久化值 |
| 左列虚拟化 | 当 `visibleSkills.length >= 200` 时启用 `react-window` |
| 右栏内容 | **完整搬入** `SkillFullDetailPage`，通过新增 `embedded?: boolean` prop 控制边距与返回按钮 |
| 右栏底层组件复用 | distribution 与 my-skills 共用同一个详情面板（不为 distribution 单独写） |
| 响应式 | 三阈值：`>= 1280` 三列 / `1024–1279` 双列（左列折叠为图标条/汉堡） / `< 1024` 维持全屏（现状） |
| 顶栏 | 左栏上方：搜索 + 过滤 + 批量 + 新建/扫描/导入；右栏上方：详情 actions（收藏/编辑/删除/版本历史/打开文件夹/全屏阅读） |
| 初始选中 | **仅当 `selectedSkillId` 无持久化值时**才默认选中第一项；持久化值仍可见时直接恢复 |
| selectedSkillId | 跨 storeView **共享**，在视图切换时不重置 |
| 失效选中 | 当 `selectedSkillId` 不在 `visibleSkills` 中（被搜索/筛选/删除）→ 自动选中第一项 |
| 批量模式 | 进入 `isSelectionMode` 后右栏变为**批量摘要面板**：N selected + 缩略列表 + 批量动作；退出后恢复之前的 selectedSkillId |
| 编辑形态 | `EditSkillModal` 与全屏的 `SkillFileEditor` 入口仍保持 modal/全屏，不内联到右栏 |
| 切换 skill 时未保存保护 | 复用 `UnsavedChangesDialog`；**仅 SkillFileEditor / EditSkillModal 处于 isDirty 时**才拦截，否则 ↑/↓ 流畅切换 |
| 副作用控制 | ↑/↓ 快速连按时：`syncSkillFromRepo` + `getMdInstallStatusBatch` + safety 加载 **debounce 200ms**，仅在最终停靠的 skill 上触发 |
| Tab 状态缓存 | `Map<skillId, { activeTab, scrollTop }>` 记忆每个 skill 的 detail 状态，回到该 skill 时恢复 |
| 键盘交互 | `↑/↓` 左列切换；`Esc` 退出全屏阅读 / 退出批量 / 关闭 modal；`Cmd/Ctrl+F` 聚焦顶栏搜索（**不**绑定 Enter） |
| 视图切换器 UI | 删除 list/gallery 切换按钮；保留"全屏阅读"快捷按钮放右栏顶部 |

---

## 3. UI 与 UX 设计

### 3.1 三种断点的形态

```
≥ 1280px (三列):
┌ Sidebar ──┬ List 320 ───────┬ Detail (flex-1) ─────┐
│ folders   │ ┌ search ─────┐ │ ┌ actions ─────────┐│
│ tags      │ ├─────────────┤ │ ├──────────────────┤│
│ filters   │ │ ◼ skill-A   │ │ │ Tabs: Pre Code Fl││
│           │ ├─────────────┤ │ ├──────────────────┤│
│           │ │ ◼ skill-B ✓ │ │ │ skill content    ││
│           │ ├─────────────┤ │ │                  ││
│           │ │ ◼ skill-C   │ │ │                  ││
│           │ └─────────────┘ │ └──────────────────┘│
└───────────┴─────────────────┴──────────────────────┘

1024–1279px (双列, 左列折叠为图标条):
┌ Sidebar ──┬─ Bar 56 ─┬ Detail ───────────────────┐
│           │ [☰][↕]   │ actions / detail content  │
│           │ ●        │                            │
│           │ ○        │ (点击 ☰ 弹出列表抽屉)      │
│           │ ○        │                            │
└───────────┴──────────┴────────────────────────────┘

< 1024px (维持现状):
┌ Sidebar ──┬─ 全屏 SkillFullDetailPage ──────────┐
│           │ ← back │ skill detail               │
└───────────┴────────────────────────────────────┘
```

### 3.2 左列紧凑行设计

每行 ~84px，垂直滚动：
- 左 40×40 SkillIcon
- 中：第一行 = 名称 + 收藏星 + 安全级别图标；第二行 = 描述（单行省略）
- 右上：平台徽标 `[3/5]`（已部署/总平台），可点开 quick install
- hover：背景高亮；selected：左侧 2px primary 色边 + 浅色背景
- 批量模式下行首插入 checkbox（48px 宽）

### 3.3 顶栏分配

| 区域 | 元素 |
| --- | --- |
| 左栏顶（sticky） | 搜索框、过滤 chip（filterType + tags）、批量选择 toggle、"新建/扫描/导入"按钮组 |
| 右栏顶（sticky in detail container） | 标题 + icon、收藏切换、全屏阅读按钮、`···` 更多动作（编辑/版本历史/翻译/打开文件夹/删除） |

### 3.4 拖拽手柄

- 左栏右边缘 4px 宽 hit area，hover 显示 2px 高亮
- 拖拽：实时 resize，不做节流（Tailwind 内联 style）
- 双击手柄：复位到 320
- 持久化键：`settings.skillSplitListWidth`（global，不分 storeView）

### 3.5 批量模式右栏

```
┌ batch-summary panel ─────────────────┐
│ 3 skills selected           [Cancel] │
│ ────────────────────────────────────  │
│ ◼ skill-A    │ favorite │ delete     │
│ ◼ skill-B    │          │            │
│ ◼ skill-C    │          │            │
│ ────────────────────────────────────  │
│ [批量收藏] [批量打标签] [批量部署]    │
│ [批量取消收藏] [批量删除]             │
└──────────────────────────────────────┘
```
退出批量模式后，恢复进入前的 selectedSkillId 与 detail 状态。

---

## 4. 技术实现要点

### 4.1 文件改动清单

| 文件 | 改动类型 | 说明 |
| --- | --- | --- |
| `apps/desktop/src/renderer/components/skill/SkillManager.tsx` | 重构 | 当前 933 行已超阈值，本次重构后**必须拆分**。建议抽出：`SkillSplitView.tsx`（容器 + 响应式）、`SkillSplitList.tsx`（左栏列表 + 虚拟化）、`SkillBatchSummaryPanel.tsx`（批量摘要面板） |
| `apps/desktop/src/renderer/components/skill/SkillFullDetailPage.tsx` | 增 prop | 新增 `embedded?: boolean`，true 时隐藏返回箭头与 `max-w` 容器限制；外层不强制 `h-screen` 等。**不要复制粘贴现有逻辑**——单一组件双形态 |
| `apps/desktop/src/renderer/components/skill/SkillListView.tsx` | 渐进保留 | 保留作为左栏紧凑列表的实现基底，调整为 320px 宽下的样式 |
| `apps/desktop/src/renderer/components/skill/SkillGalleryCard.tsx` | 不再使用 | 在 split 视图中不再调用，但保留组件以备后续 store 视图使用 |
| `apps/desktop/src/renderer/stores/skill.store.ts` | 状态扩展 | 删除/废弃 `viewMode`；新增 `splitListWidth: number`、`splitFullscreen: boolean`、`detailTabState: Map<string, { activeTab, scrollTop }>`、`splitDrawerOpen: boolean`（窄屏汉堡） |
| `apps/desktop/src/renderer/stores/settings.store.ts` | 持久化 | `splitListWidth` 写入 settings 持久化（已有 sqlite settings 表） |
| `apps/desktop/src/renderer/components/ui/UnsavedChangesDialog.tsx` | 复用 | 现有组件直接拿来用 |
| `apps/desktop/src/renderer/i18n/locales/{en,zh,zh-TW,ja,fr,de,es}/translation.json` | i18n 同步 | 7 个 locale 文件全部同步新增 key |

### 4.2 状态机要点

```ts
// SkillSplitView 内部状态机（伪代码）
type SplitState =
  | { kind: 'three-column'; selectedId: string | null; tabState: Map<...> }
  | { kind: 'two-column-collapsed'; drawerOpen: boolean; selectedId: string | null }
  | { kind: 'fullscreen-fallback' }
  | { kind: 'batch'; selectedIds: Set<string>; previousSelectedId: string | null }

// 转移规则
// initialMount + selectedSkillId in visibleSkills => 维持 selectedSkillId
// initialMount + selectedSkillId 缺失 => selectFirstVisible()
// onSelectFromList(id) + (currentDetailIsDirty) => UnsavedChangesDialog
// onSelectFromList(id) + (no dirty) => debounce(200ms) syncFromRepo + load platform/safety
// visibleSkills 变化且 selectedId 不在其中 => selectFirstVisible()
// resize: width >= 1280 => three-column; 1024–1279 => two-column-collapsed (drawer 关闭); < 1024 => fullscreen-fallback
```

### 4.3 副作用 debounce

`SkillFullDetailPage` 现有副作用（`syncSkillFromRepo`、`getMdInstallStatusBatch`、safety 检测、translation auto-load）由 `useEffect([selectedSkillId])` 触发。三列下需在 SkillSplitView 内 wrap 一层 `useDebounceValue(selectedSkillId, 200)`，把 debounced id 作为 prop 传给 `SkillFullDetailPage embedded` 实例。这样 ↑/↓ 连按时副作用只在停靠时执行一次。

### 4.4 虚拟化

- 现有 `SkillListView` 使用 `contentVisibility: 'auto' + containIntrinsicSize: '84px'` 实现轻量级懒渲染。
- `visibleSkills.length >= 200` 时切换到 `react-window` 的 `FixedSizeList`（item height = 84）。
- 阈值 200 选择理由：用户常见 skill 数量在 50–150 之间，超过 200 才有显著卡顿；引入虚拟化也增加测试与拖拽手柄复杂度。

### 4.5 键盘交互

| 键 | 作用 | 上下文 |
| --- | --- | --- |
| `↑` / `↓` | 在左列 visibleSkills 中切换 selectedId | split view 激活、未在输入框内 |
| `Esc` | 优先级：modal > 全屏阅读 > 批量模式 > 无操作 | 全局 |
| `Cmd/Ctrl + F` | 聚焦左栏顶部搜索框 | split view 激活 |

不实现 `Enter`、`J/K`，避免与现有 prompts 视图的快捷键产生冲突。

### 4.6 i18n key 新增（示例）

```json
{
  "skill.split.empty": "Select a skill from the list",
  "skill.split.noSkillsHint": "Create or import a skill to get started",
  "skill.split.unsavedTitle": "You have unsaved changes",
  "skill.split.unsavedDescription": "Save before switching to another skill?",
  "skill.split.fullscreen": "Open in fullscreen",
  "skill.split.exitFullscreen": "Exit fullscreen",
  "skill.split.batchSummary": "{{count}} skills selected",
  "skill.split.openListDrawer": "Show skill list",
  "skill.split.resizeHandleTooltip": "Drag to resize. Double-click to reset."
}
```
所有 key 必须在 7 种 locale 中同步翻译；后端错误信息保持英文（项目惯例）。

---

## 5. 风险与权衡

| 风险 | 等级 | 缓解 |
| --- | --- | --- |
| `SkillFullDetailPage` 1203 行已超 1000 行红线，加 `embedded` prop 后更复杂 | 中 | 本次至少拆出一个内部组件如 `SkillDetailHeader` 或 `SkillDetailTabs`，让总体结构不再增厚；若条件成熟在后续 PR 完整重构 |
| 副作用 debounce 与 stale 状态：debounced selectedId 与 store 中 selectedSkillId 不一致时如何渲染左栏高亮 vs 右栏内容 | 中 | 左栏 selected 视觉绑定 store 实时值；右栏内容渲染 debounced 值；用户感知是"立即看到选中态变化，详情稍后跟上" |
| 虚拟化在 `react-window` 下 selected 行 scroll-into-view 与拖拽宽度变化时 item width 同步 | 低 | 用 `FixedSizeList` 的 `scrollToItem`，width 变化时通过 ResizeObserver 触发 `forceUpdate` |
| 1024–1279 双列模式的"汉堡抽屉"是新增 UI，可能与现有移动端浏览体验冲突 | 低 | desktop 与 web 桌面端为主，移动端目前未在产品矩阵中，此抽屉为渐进增强 |
| Tab 状态缓存 Map 长期累积可能内存泄漏（用户浏览数千个 skill） | 低 | 缓存上限 100 条，使用 LRU 淘汰；切换 storeView 不清空（共享 selectedId 决策） |
| 批量模式退出后恢复 previousSelectedId 时，若该 skill 已被批量删除，需回退 | 低 | 退出批量时检查 visibleSkills，缺失则 fallback 到 first |

---

## 6. 实施步骤建议（小步迭代）

> Make it work → Make it right → Make it fast

### Step 1 · 基础结构（make it work）
1. 在 `skill.store.ts` 中加 `splitListWidth: 320`、`detailTabState: Map<>`、相关 setter。
2. 抽出 `SkillSplitView.tsx`：包含响应式断点判断、左栏（直接复用 `SkillListView` 调样式）、右栏（直接 `<SkillFullDetailPage embedded />`）。
3. 在 `SkillManager.tsx` 中根据 `storeView` 决定渲染 `SkillSplitView` 还是现有全屏路径，删除 `viewMode` 相关 list/gallery 切换 UI。
4. 给 `SkillFullDetailPage` 加 `embedded?: boolean` prop，处理边距与返回按钮。
5. 验证：手动 e2e 跑通 my-skills、favorites、distribution 三种 storeView。

### Step 2 · 交互与保护（make it right）
1. 加 ↑/↓、Esc、Cmd+F 键盘交互。
2. UnsavedChangesDialog 接入 SkillFileEditor / EditModal 的 isDirty 拦截。
3. selectedId 失效自动 fallback、首次进入默认选中逻辑。
4. 副作用 debounce(200ms)。
5. tab 状态 Map 缓存。
6. 批量摘要面板。

### Step 3 · 响应式与性能（make it fast）
1. 三阈值断点：1280 / 1024。
2. 1024–1279 折叠为图标条 + 抽屉。
3. 拖拽手柄 + 双击复位 + 持久化。
4. ≥200 项时启用 react-window 虚拟化。

### Step 4 · 质量保障
1. **Vitest 单测**：
   - `SkillSplitView` 状态机：默认选中策略、失效 fallback、resize 状态切换。
   - 拖拽 width clamp（min/max）、双击复位。
   - 未保存拦截：dirty 时弹窗、非 dirty 时直通。
   - tab 状态缓存：切换 → 切回，恢复 activeTab + scrollTop。
2. **Playwright e2e**（加入 `test:e2e:smoke`）：
   - 进入 split view → 默认选中第一个 → 点击别的 → 详情切换。
   - 编辑 → 切换 → UnsavedChangesDialog 弹出。
   - 删除当前选中 → 自动跳到下一个。
   - 批量模式进入 → 摘要面板 → 退出恢复。
3. **i18n 7 语言**：在 7 个 locale 文件中同步新增 key，并跑现有的 i18n key 一致性测试。
4. **性能预算**（`pnpm test:perf`）：
   - 500 skills 下首屏渲染 < 500ms。
   - 拖拽 resize 期间 60fps（`performance.now()` 采样 ≥ 16ms 帧 < 5%）。

### Step 5 · 上线前检查
- `pnpm lint` 0 warnings、`pnpm typecheck` 通过。
- `pnpm test:release` 全绿。
- README / CHANGELOG / 多语言 README 同步（`.agents/rules/release-sync.md`）。
- 截图更新到 docs 与 website（如 README badge 中有 skill 截图）。

---

## 7. 验收标准（成功条件）

1. 在 1440×900 屏幕下进入 my-skills，无须二次点击即可浏览任意 skill 详情。
2. 调整窗口宽度从 1500 → 1100 → 900，自动平滑切换为三列 → 双列折叠 → 全屏。
3. 拖拽左列宽度，可在 280–480px 范围内变化；双击复位 320；下次进入恢复上次宽度。
4. 在 SkillFileEditor 中编辑后未保存，按 ↑ 切换其他 skill 时弹出 UnsavedChangesDialog。
5. 连续按 ↑↓ 10 次，控制台仅观察到一次 `syncSkillFromRepo`（停靠后 200ms 触发）。
6. 输入"不存在的搜索词"导致 visibleSkills 为空 → 右栏显示空态文案；清除搜索后 selectedId 自动恢复或选第一项。
7. 进入批量模式 → 选 3 个 → 右栏显示批量摘要 → 取消 → selectedId 与详情 tab 状态完整恢复。
8. distribution 视图与 my-skills 切换时，selectedSkillId 保留；右栏内容随之更新。
9. ≥200 个 skill 时虚拟化生效，列表滚动 60fps（DevTools Performance 面板验证）。
10. 7 种 locale 全部覆盖新增 i18n key；`pnpm lint --max-warnings 0` + `pnpm typecheck` + `pnpm test -- --run` + `pnpm test:e2e:smoke` 全绿。

---

## 附录 A · 关键源代码参考点

- 现状：SkillManager 全屏切换逻辑：`apps/desktop/src/renderer/components/skill/SkillManager.tsx:354-382`
- 现状：list/gallery 切换按钮：`apps/desktop/src/renderer/components/skill/SkillManager.tsx:620-635`
- 现状：list/gallery 渲染分支：`apps/desktop/src/renderer/components/skill/SkillManager.tsx:763-839`
- 参考：prompts 卡片视图双栏布局：`apps/desktop/src/renderer/components/layout/MainContent.tsx:1334-1378`
- 参考：UnsavedChangesDialog：`apps/desktop/src/renderer/components/ui/UnsavedChangesDialog.tsx`
- 参考：现有未使用列表项虚拟化技巧：`apps/desktop/src/renderer/components/skill/SkillListView.tsx:259-264`（contentVisibility）
- Web 入口（自动复用 desktop）：`apps/web/src/client/pages/DesktopWorkspace.tsx:2`

## 附录 B · 决策追溯（访谈回答存档）

| # | 问题 | 决策 |
| --- | --- | --- |
| 1 | list/gallery 在 320px 下区分？ | 合并为单一紧凑列表 |
| 2 | 右栏承载范围？ | 完整搬入 + 宽度阈值降级 |
| 3 | 编辑形态？ | 仍以 modal 开启 |
| 4 | 初始选中 / 空态？ | 默认选中第一个 + 持久化 |
| 5 | 宽度阈值？ | 双阈值：≥1280 三列 / 1024–1279 双列 / <1024 全屏 |
| 6 | 切换 skill 时未保存与副作用？ | UnsavedChangesDialog + tab 状态缓存 |
| 7 | selectedId 失效？ | 自动选中可见列表中第一项 |
| 8 | 顶栏调整？ | 删除视图切换按钮 + 拖拽宽度 + 顶栏锁定左列上方 |
| 9 | storeView 范围？ | store 保持现状，my-skills/favorites/distribution 启用 |
| 10 | 批量模式右栏？ | 批量摘要面板 |
| 11 | 键盘交互？ | ↑↓ 切换 / Esc 退出 / Cmd+F 聚焦搜索 |
| 12 | 默认选中的副作用？ | 仅首次进入且无持久化选中时才默认选中 |
| 13 | distribution 右栏？ | 复用同一详情面板 |
| 14 | 虚拟化？ | ≥200 项时启用 react-window |
| 15 | 顶栏分配？ | 左：搜索/过滤/批量/新建；右：详情 actions |
| 16 | 组件复用策略？ | 加 embedded?: boolean 渐进改造 |
| 17 | 拖拽参数？ | min 280 / max 480 / 初始 320 / 双击复位 |
| 18 | 键盘 + 未保存？ | 仅 SkillFileEditor / EditModal 拦截 |
| 19 | 跨视图选中？ | 共用同一 selectedSkillId |
| 20 | 质量保障？ | Vitest + Playwright + i18n 7 语言 + 性能测试 |
