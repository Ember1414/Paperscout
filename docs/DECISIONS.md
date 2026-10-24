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
| D-007 | 2026-10-24 | 站点 origin 读取环境变量 `SITE_ORIGIN`（preview 可覆盖），缺省值仅作为构造上游自述（User-Agent / 礼貌池）的最后兜底；功能逻辑不依赖该常量做路由判断。红线"不写死域名"指功能绑定，UA 自述必须有值（5.1.3），与 Warmer 的 `TARGET_ORIGIN` 同一模式 | ⏳ M0 验收 |
| D-008 | 2026-10-24 | `typecheck:web`（G-03）范围排除 `public/sw.js`：Service Worker 运行在独立上下文需 WebWorker lib，且 sw 将在 M8-02 重写（A-21）；届时用独立 tsconfig 纳管。主应用 JS 仍全量 checkJs | 已定 |
| D-009 | 2026-10-24 | v2 适配器的 `search()` 实现冻结不动（保护生产行为），v3 走各 adapter 文件内新增的并行 `fetchRaw()` 层（统一 RawRecord）；8.5 说的"改为返回 RawRecord"按此解释——M7 删除清单时连同 legacy 路径一起移除重复 | ⏳ M1 验收 |
| D-010 | 2026-10-24 | PubMed 能力矩阵的"返回摘要"冻结为 false：esummary 不含摘要，补齐需第三次 efetch 调用；生医摘要覆盖由 Europe PMC（M1-03）承担。若 M3 评测显示 PubMed 相关性受损再评估 | ⏳ M1 验收 |
| D-011 | 2026-10-24 | G-10 在 M1 档强制后，legacy 翻译路径的 4 处静默 catch 以补日志方式消除（行为不变，走备用通道的逻辑保留）；M6-05 重构 translate 时彻底收敛为单通道+规范错误对象 | 已定 |
| D-012 | 2026-10-24 | A-01（检索历史从未写入）拆两段关闭：服务端统计（search_log，含 query_sample）M1 已落；**用户侧检索历史改本地优先**（IndexedDB，D-05/D-11），M2-11 由前端实现并关闭缺陷本体——不再恢复 v2 的 D1 history 写入。A-03（热词未累加）同口径：search_log M1 真实写入，keyword_daily 聚合由 M7-01 Warmer 完成，/api/stats 热词在 M7 切到 D1 派生 | ⏳ M1 验收 |
| D-013 | 2026-10-24 | Pages 的 wrangler.jsonc `env.preview` 块会使顶层绑定**不继承**（实测：preview 部署丢失 KV/D1/AI，legacy /api/favorites 报"数据库不可用"）→ env.preview 内完整重声明 CACHE/DB/AI 绑定。**改动顶层绑定时必须同步 env.preview**（M8 上线检查项） | 已定 |
