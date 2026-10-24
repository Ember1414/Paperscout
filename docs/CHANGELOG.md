# CHANGELOG — PaperScout v3

> 模板见 REBUILD_PLAN 附录 E。每个里程碑合并 main 前更新。

## [M0] 2026-10-24 · 地基与预算（分支 `v3/m0`）

### 新增
- `docs/BASELINE.md`：v2 线上基线（12 金标准查询：冷查询最慢 14.4s、标题重复 3.2%、少源组合 502、无 DSL）
- `docs/BUDGET.md`：2026-10-24 官方免费额度对照（全达标）+ 新增 3 条平台约束（CPU 10ms/请求、子请求 50/请求、同时出站连接 6/请求）+ KV 写 ≤300/天核算
- 门禁脚手架：`scripts/{verify,check-tokens,a11y-audit,budget,check-silent-catch,smoke,baseline}.mjs`；`npm run verify` 按里程碑分级强制（DECISIONS D-002），M0 门 = ALL GREEN
- `functions/lib/config.ts`（常量唯一来源，含 CONTACT_EMAIL）、`functions/lib/errors.ts`（9 错误码 + 响应信封）、`functions/lib/infra/log.ts`（结构化日志 + requestId）
- 测试框架：vitest 5.0.1（devDependency），**44 例单测全绿**；`jsconfig.front.json` + `npm run typecheck:web`（D-008：暂排除 sw.js，M8 重写时纳管）
- preview 部署链路：`npx wrangler pages deploy public --project-name paperscout --branch v3-m0` → https://v3-m0.paperscout.pages.dev
- OpenAlex 礼貌池真实邮箱（A-24 修复）：`mailto=2669788267@qq.com` + UA 升级 3.0 规范格式，附 5 例回归测试

### 修复
- A-24（部分）：OpenAlex `mailto` 占位邮箱 → 真实邮箱（速率上限提升需按天观察）

### 破坏性变更
- 无（M0 为纯增量，v2 行为未动）

### 决策
- DECISIONS.md D-001~D-008（KV 预算核算修正、verify 分级、CORS 预览子域、分支命名、基线口径、邮箱接入、SITE_ORIGIN、sw.js 类型检查范围）——D-001/D-002/D-003/D-007 待 owner M0 验收裁决

### 预算
- KV 写/日：M0 无新增写入路径（0，预算 300）；M1 起按 kv_write_log 实测
