# DECISIONS — v3 决策记录

> 规则：文档没写的细节，按最合理方案执行并在此记一行；标注 ⏳ 的条目待 owner 在对应里程碑验收时裁决，反对则按回滚方案撤销。

| # | 日期 | 决策 | 状态 |
|---|------|------|------|
| D-001 | 2026-10-24 | KV 写预算以 **300/天为硬上限**；Warmer Cron 定为 60 分钟/轮、每轮 **≤8 个 key**（≈192/天）+ 在线翻译/AI 首次写 ≤108/天（M0-02 核算修正：原 7.4 的 Warmer 20key/时方案与 1.2 的 300/天目标冲突）。REBUILD_PLAN 7.1（"15min"）与 5.13.1（"60min"）矛盾，取保守值 | ⏳ M0 验收 |
| D-002 | 2026-10-24 | `npm run verify` 按里程碑分级强制（自动读 git 分支）：**M0 只强制 typecheck + 单测**；check-tokens、a11y、budget、typecheck:web、check-silent-catch 在 M0 为 WARN，分别自 M1（silent-catch）/M2（其余）起转 ERROR。原因：ACCEPTANCE G-06~G-08 针对 v3 新前端，v2 代码（emoji 图标、裸 hex、无类型标注）不可能达标 | ⏳ M0 验收 |
| D-003 | 2026-10-24 | CORS Origin 白名单含 `*.paperscout.pages.dev`（预览子域）+ 生产域 + `http://localhost:8788`。原因：7.9 字面白名单会把 preview 验收流程挡死；不违反 C-05（生产域名不变） | ⏳ M0 验收 |
| D-004 | 2026-10-24 | 分支命名：git 用 `v3/<milestone>`（如 `v3/m0`），wrangler pages deploy 的分支别名用 `v3-<milestone>`（如 `v3-m0`）。8.1 与 8.6 写法不一致，各取所需 | 已定 |
| D-005 | 2026-10-24 | M0-01 基线重复率口径：响应内按"归一化 DOI"与"标题指纹（去标点、小写）"双口径统计重复条数。v2 无去重统计接口，由 `scripts/baseline.mjs` 独立计算 | 已定 |
| D-006 | 2026-10-24 | M0-07 邮箱 `2669788267@qq.com`（owner 提供）写入 `functions/lib/config.ts` 的 `CONTACT_EMAIL`，OpenAlex 请求与 User-Agent 接入；Crossref 的 mailto 接入留待 M1（M0-07 DoD 仅要求 OpenAlex） | 已定 |
