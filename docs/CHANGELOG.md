# CHANGELOG — PaperScout v3

> 模板见 REBUILD_PLAN 附录 E。每个里程碑合并 main 前更新。

## [M8] 2026-10-24 · 打磨 / 性能 / 验收（分支 `v3/m8`）——v3 全量完成

### 变更
- PWA 版本化缓存（paperscout-v3 + stale-while-revalidate，跳过 /api/）
- /api/diag 路由 + handleDiag 删除（8.5 删除清单）
- A11y 0 违规 / budget 18.4KB / 90KB / G-10 0 处静默 catch
- 金标准 12 查询冒烟 11/12 PASS（q04 R-01 瞬断）
- BASELINE 对比：v2 冷查询 14.4s → v3 ~5-6.5s（-55%）；v2 标题重复 3.2% → v3 0%

### 预算
- 首屏 gzip 18.4KB / 90KB（P-01 PASS）

## [M6] 2026-10-24 · AI 与配额（分支 `v3/m6`）

### 新增
- 零幻觉架构：prompts.ts（SYSTEM_PROMPT 5 条规则/EXTRACT/DSL + buildEvidence 600字截断6000总预算）+ verifyCitations（[n] 校验含 [1-3] 范围/INSUFFICIENT 拒答/越界剔除）
- AI 三端点：/api/ai/summarize（研究现状 300 字）/ ask（SSE 流式 + 逐句推送 + 停止 + 拒答）/ extract（四维度精读）
- /api/ai/dsl：自然语言 → 检索式
- 配额：D1 原子 upsert 全局(summarize 120/ask 80/extract 150) + 单 client(8/5/20)，超限 429 AI_QUOTA_EXCEEDED
- KV 缓存 ai:{kind}:{PROMPT_VERSION}:{hash} 24h
- SSE 流式：逐句 delta + done(citations,verified) + refusal 拒答
- verifyCitations 10 例单测

### 修复
- 模型返回类型 cast（Workers AI union type）

### 预算
- AI neuron 消耗由配额上限控制（全局 350/天 ≈ 6000 Neurons 预算 60%）

## [M5] 2026-10-24 · 文库 / 工作区 / 产出（分支 `v3/m5`）

### 新增
- IndexedDB 完整层：6 stores（works/collections/notes/searches/settings/trash）+ workspaceId 过滤（多工作区隔离）+ 全量 JSON 导出/导入
- `/library` 文库页：列表（本地搜索过滤）/笔记（Markdown 子集 textarea + 保存/回显）/标签 chip/回收站（7 天自动清理 + 恢复）/导出 7 种格式（BibTeX/RIS/CSL/CSV/MD/Word/JSON）/导入 JSON 回灌（幂等）
- `/compare?ids=` 对比矩阵（≤4 篇 × 7 行，URL 可分享）
- `/settings` 页面：密度/语言/排序/隐私（停止热词入库）/清除数据跳转
- 收藏从 localStorage 迁移到 IndexedDB works store
- 单测 209 → 212 例

### 修复
- card.js 收藏底层从 localStorage 换 db.js
- importAll data 类型补齐

### 预算
- /library 和 /settings 均为懒加载视图，首屏 gzip 不变

## [M3] 2026-10-24 · 论文详情与引文（分支 `v3/m3`）

### 新增
- `/api/work`：单篇详情（OpenAlex 单篇 + referenced_works 水合 20 + cites: 反查 20 + related 10 去重；Crossref 兜底）+ L1 24h 缓存防坏守卫
- `/p/:id` 详情页：面包屑/衬线标题/作者/venue·DOI·类型徽章/指标条（被引·置信度·OA·来源与日期标注 D-12）/原文 PDF/摘要折叠零请求/机构行/三列表可跳转（参考文献 20/被引 20/相似 ≥3 去重）
- `/api/availability`：正版全文探测链 OpenAlex→Unpaywall→Europe PMC，kind/version 徽章 + 无 OA 三路建议；KV avail:doi 24h
- `/api/citations?dir=contexts`：S2 引用上下文（"谁在哪句话引用"），限流降级不影响主流程
- 引文网络 canvas 图（力导向 30 节点/hover/拖拽/点击跳转 + 列表替身 a11y）
- 被引趋势（counts_by_year 柱图 + 5.11.3 三档标签 + 口径标注）
- `public/js/cite-format.js`：BibTeX/RIS/CSL-JSON 纯前端格式化 + 详情页三键复制（2s 已复制反馈）
- 顶刊白名单扩至 130 条（CS 顶会/顶刊/自然科学/数理经社/中文核心），抽样准确率 ≥90%
- `/api/status` + `/status` 视图：版本/源健康 24h（D1 聚合）/今日检索·缓存命中·KV 写·AI 配额（预算对照）
- `/about`：方法/来源许可表/中文局限常驻声明/AI 局限/隐私/免责/联系 + 清除数据（历史/全部，confirm+toast）
- 单测 209 → 212 例

### 修复
- DOI 含 `/` 破坏 /p/:id 路径分段 → 详情链接整体 encodeURIComponent
- `MAILTO` 常量拼接错误 → /api/work 引文列表全 0
- 坏结果被 L1 缓存 24h → substantial 守卫（部分失败不缓存）
- status/work/availability 共 6 处静默 catch 补日志（G-10）

### 决策
- cite-format 纯前端定位（5.7 本意）；S2 recommendations 未接入（R-01 限流，OpenAlex 单源满足 ≥3）

### 预算
- 首屏 gzip 不变（详情页/状态页/关于页均为懒加载视图）

## [M2] 2026-10-24 · 检索与结果体验（分支 `v3/m2`）

### 新增
- 设计系统（6.2 token 全量 + 暗/亮双主题 + SVG 图标 13 枚，emoji 清零）与 AppShell
- History 路由（滚动记忆/后退还原/`_redirects` SPA 回退/`_routes.json` Functions 分流）+ 404 视图
- store/api/url 状态层：requestId 竞态保护 + AbortController + URL 契约编解码（4.2 全字段）
- 首页（Hero 检索 + 六区块诚实空态）、结果页三栏（筛选 300ms 防抖合并/结果卡 chips 真实推导/骨架/空态三放宽按钮/部分失败条/分页）
- 详情抽屉（桌面右栏/移动抽屉/sel 深链 replaceState/焦点陷阱与归还/Esc）
- 高级检索构建器（AND/OR/NOT 条件组 + DSL 实时预览）
- 表格视图（列自定义 localStorage 持久化 + 列头排序）、结果分组（年/venue/源，details 零请求折叠）
- `/api/suggest`（拼写纠正/前缀/同义词/相关术语）+ 搜索联想下拉（↑↓⏎Esc）
- IndexedDB 检索历史（A-01 用户侧闭环）+ 结果内二次检索（池内过滤零请求）
- 命令面板（⌘K/模糊匹配/焦点陷阱）+ 全键盘（`/` `j` `k` `⏎` `g h`）
- 移动端（筛选 bottom sheet 下滑关闭/44px 触控/无横滚）+ A11y 第一轮 0 违规
- `legacy.html`：v2 单文件冻结回退版（7 天，M8-04 删）

### 修复
- A-18（URL 状态可分享/刷新还原基础）、A-19（html 模板转义单点 → 全组件 escapeHtml）、A-20（requestId 竞态 + AbortController）
- A-22 第一轮（emoji→SVG、aria-label、focus-visible、跳级标题）
- 375px 双处横向溢出（grid minmax + 工具栏 wrap）；Work.authors 对象渲染 [object Object]

### 破坏性变更
- `public/` 完全替换为 v3 前端（v2 入口保留于 legacy.html）；旧 `app.js/style.css/sw.js` 删除

### 决策
- 新增 D-014（暂无——M2 按文档执行；group 参数为 4.2 契约 additive 扩展）

### 预算
- 首屏 gzip **17.4KB / 90KB**（P-01）；单文件最大 gzip 2.3KB / 40KB

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

### 增补（M2-14/M2-15，验收前 owner 增补包）
- M2-14 检索准确性/广泛性：中英互译扩展词典（76 对，`dict.ts`）、`author:`/`year:` 意图落地、OpenAlex 作者名回退、`npm run eval` 自动评测（v2 vs v3：跑题 -33%、冗余 -72%+、DOI/author 质变）、空池缓存防投毒（60s 防抖）
- M2-15 稳定性与可读性：源级 429 isolate 内存冷却（D-015）、全源失败 stale 兜底（7.7 预案）、venue 多样性（Top10 同源连续 ≤2）、关键词高亮（B 组 P0 补齐，XSS 安全断言）、eval 多样性指标
- M2-16 弱查询容错：同义词/相关词并入召回（llm→large language model 实测 20/20）、空结果自动拼写纠正重试（retriedFrom）、结果池 sessionStorage 快照 SWR 秒开（10min TTL）
- 单测 152 → 201 例

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
