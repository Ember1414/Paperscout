# CHANGELOG — PaperScout v3

> 模板见 REBUILD_PLAN 附录 E。每个里程碑合并 main 前更新。

## [M1] 2026-10-24 · 数据核心（分支 `v3/m1`）

### 新增
- RawRecord 统一层 + 12 源 fetchRaw（核心 6 + 学科/开放 6；legacy search() 冻结，D-009）
- 19 源注册表（能力矩阵/四档/9 源上限截断）与 19 源冒烟探测（docs/SOURCES.md）
- 归一化（DOI/标题指纹/作者/年份/venue/摘要/语言对称）、融合去重（并查集 + k1/k2/k3 + DOI 冲突拆分 + 置信度 A/B/C）
- BM25 池内相关性 + 可解释排序（五分项）+ reason chip 按贡献度推导
- 结果池（切片互斥/幂等追加/≤3 轮追加召回）、编排器（并发 6/4.5s 软超时/6.5s 硬截止/降级不失败/DOI 直查）
- 缓存 L0/L1/L2（KV 在线只读、waitUntil 写入、canonical hash 不含分页、X-Cache 头）
- D1 migrations 10 表（远程已应用）+ 原子配额 upsert + search_log/kv_write_log 统计
- `/api/search` v3 信封（feature flag `SEARCH_V3=1`，preview 环境默认开启，生产暂保持 v2）
- 单测 152 例（fixture 13 组 / 锚点对账 / 并发原子性）

### 修复
- A-02 跨源分页错位（池切片）/ A-04 类型筛选失效（严格过滤）/ A-05 语言判定不对称 / A-06 熔断 KV 写（在线 0 写）/ A-07 缓存写挂 waitUntil / A-08 缓存 key 含分页
- A-24 续：Crossref mailto 接真实邮箱
- A-09 合并单链 Map → 并查集 + DOI 冲突拆分；A-10 被引取数改单一口径（不再 max）
- A-01/A-03 按 D-012 两段式：服务端 search_log M1 落地，用户侧历史 M2-11 本地实现

### 破坏性变更
- 移除百度学术源（D-03）：v2 响应的 `sources` 列表 11 → 10
- `/api/search` 在 SEARCH_V3=1 时响应改为 7.5 信封（`data.items` + `data.papers` 兼容字段并存）

### 决策
- D-009~D-012（legacy 冻结、PubMed 摘要冻结、G-10 补日志、A-01/A-03 两段式）

### 预算
- v3 在线路径 KV 写 = 0（实测代码路径 + kv_write_log 表就位）；search_log 1 行/未命中检索（D1 写预算内）

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
