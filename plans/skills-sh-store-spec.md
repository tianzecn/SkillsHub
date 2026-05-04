# PromptHub skills.sh 社区商店接入 Spec

## Summary

- 目标：把现有 HTML 抓取型 skills.sh 社区源升级为 API-backed 内置社区源，丰富 PromptHub Desktop Skill Store 的可安装来源。
- 交付物：`plans/skills-sh-store-spec.md` 记录最终规格，并按本 spec 落地桌面端实现。
- 参考：[skills.sh API Reference](https://skills.sh/docs/api)。官方文档说明无 key 可用但限流更严；实现仍对 401/429/503 采用“新 API 优先 + 明示降级”。
- 范围：仅桌面端先行；Web 端当前 `runtimeCapabilities.skillStore=false`，不纳入本次 UI 交付。

## Key Changes

- 新增专用 skills.sh main-process 服务和 typed IPC，不扩展通用 `fetchRemoteContent` headers；服务只允许 skills.sh 白名单端点，并注入可选 `Authorization: Bearer <key>`。
- API 策略：优先 `/api/v1/skills`、`/search`、`/curated`、`/skills/{id}`、`/audit/{id}`；遇到 401/429/503 或无 key 时降级到旧 `/api/search` 与现有 HTML parser，并在社区源顶部显示降级横幅。
- 设置：在 Skill 设置页增加 masked `skills.sh API Key`；社区源降级横幅提供“去设置”CTA。按现有 settings 模式持久化，文案说明安全等级与当前本地 API Key 配置一致。
- 数据类型：扩展 `RegistrySkill` 支持 `source_id`、`source_type`、`install_url`、`remote_hash`、`is_duplicate`、`audit_results`；安装后用 `installed_content_hash` 保存 API `hash` 或本地计算 hash。
- 商店 UI：skills.sh 作为内置“社区源”；默认 Trending 榜单，支持 All-time/Hot、搜索、Official curated；搜索 >=2 字符远程调用 API，空搜索展示榜单。
- 质量控制：默认隐藏 `isDuplicate=true` 和缺少可安装内容的条目，提供“显示重复/不完整条目”开关。
- 隐私与缓存：社区源说明提示搜索会请求 skills.sh；不持久化搜索词；尊重 `Cache-Control`、`Retry-After` 和 rate-limit headers；429 显示等待/重试提示。

## Install & Safety

- 安装优先使用 `/api/v1/skills/{id}` 返回的 `files`，完整写入 PromptHub 管理的本地 skill repo，保留 `SKILL.md`、examples、scripts、assets。
- API detail 不可用时，GitHub 来源回退到现有 GitHub tarball/clone/raw 流程；well-known/domain 来源只有在 API 返回 `files` 时支持安装。
- 同名处理：按 `registry_slug/source_id` 和 name 双重识别；同名默认视为已安装，详情页提供更新/覆盖确认，不自动生成冗长命名。
- 更新检测：优先比较 `remote_hash` 与 `installed_content_hash`；无 remote hash 时回退内容 hash；hash 变化提示可更新。
- 安全策略：安装前扫描全量文本文件和高危扩展名，叠加 skills.sh audit；audit fail/high-risk 做软拦截，需要二次确认，AI 扫描 high-risk 仍按现有阻断策略执行。

## Test Plan

- Service tests：覆盖 `/api/v1` 正常响应、401 降级、429 Retry-After、curated/search/list/detail/audit 映射、duplicate 过滤、hash 更新判断。
- Main IPC tests：校验端点白名单、参数校验、Authorization 不进日志、SSRF 保护、错误归一化。
- Renderer tests：社区源默认榜单、远程搜索、降级横幅、API Key CTA、重复项开关、Official curated 切换、audit badge 和软拦截。
- Install tests：API files 完整落盘、GitHub fallback、well-known 无 files 禁止安装、同名识别、hash 变化更新。
- i18n：新增所有用户可见文案同步更新 7 个 locale。

## Assumptions

- 开发阶段先无真实 skills.sh API Key 验证，使用 mock/fixture 覆盖完整路径；真实 key 后续只做手动端到端验收。
- 不引入 `npx skills add` 执行路径，避免把第三方安装命令直接带入 PromptHub 安全边界。
- 保留现有 `skills-sh-store.ts` HTML parser 作为降级能力，但主路径迁移到 API client。
