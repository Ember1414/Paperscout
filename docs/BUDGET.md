# BUDGET — Cloudflare 免费额度预算（M0-02）

> 核对日期：**2026-10-24** · 依据：Cloudflare 官方文档当日页面（链接见文末）
> 规则（REBUILD_PLAN 1.2）：若实际额度低于下表假设的 50%，需回到规划书调整功能优先级。
> **结论：全部资源实际额度 ≥ 规划书假设的 100%，无触发调整条款。另发现 3 条规划书未列的平台硬约束，已纳入设计。**

## 1. 额度对照表

| 资源 | 规划书 1.2 假设 | 官方当日数值 | 差异 | 本项目设计上限 |
|------|----------------|--------------|------|----------------|
| Pages 构建 | 500 次/月 | 500 次/月；本项目直接上传不走构建 → 实际 0 | 一致 | 0 |
| Functions 请求 | 100,000/天 | 100,000/天（Pages Functions 计入 Workers 免费请求额度） | 一致 | ≤ 20,000/天 |
| Workers CPU | （未列） | **10 ms/请求**（免费版） | **新增约束** | 融合/排序对 200 条池打分须 ≤10ms |
| 子请求 | （未列） | **50 次/请求** | **新增约束** | 9 源 ×(1 调用+1 重试)+KV/D1 ≈ 26 < 50 ✓；`MAX_ACTIVE_SOURCES=9` 是硬保障 |
| 同时出站连接 | （未列） | **6 个/请求** | **新增约束** | `MAX_CONCURRENCY=6` 与平台限制精确吻合，不可调高 |
| KV 读 | 100,000/天 | 100,000/天 | 一致 | ≤ 10,000/天 |
| KV 写 | 1,000/天 | 1,000/天；同 key 另限 1 写/秒 | 一致 | **≤ 300/天**（核算见第 2 节） |
| D1 行读 | 5,000,000/天 | 5,000,000/天 | 一致 | ≤ 300,000/天 |
| D1 行写 | 100,000/天 | 100,000/天 | 一致 | ≤ 5,000/天 |
| D1 存储 | （未列） | 库 ≤ 500 MB，账号 ≤ 5 GB | 充裕 | — |
| Workers AI | 10,000 Neurons/天 | 10,000 Neurons/天（00:00 UTC 重置；免费版不可用付费 frontier 模型，llama-3.3-70b-fp8-fast 与 m2m100-1.2b 可用） | 一致 | ≤ 6,000/天（留 40% 余量） |
| Analytics Engine | 100,000 数据点/天 | 当日页面未明确免费写入限额（M6 启用前必须重新核对） | 待核对 | ≤ 20,000/天（默认不启用，用 D1 search_log 替代） |
| Cron（Warmer） | （未列） | 单次最长 15 分钟 | 充裕 | 每轮任务秒级完成 |

## 2. KV 写 ≤ 300/天 的核算（对 DECISIONS D-001 的修正）

REBUILD_PLAN 7.4 原核算（Warmer 20 key/时 × 24 = 480 + 在线 < 150 ≈ 650）会突破 1.2 的 ≤ 300/天 设计目标，也与 ACCEPTANCE P-20（≤300/天）冲突。修正为：

| 来源 | 预算 |
|------|------|
| Warmer 预热：60 分钟/轮 × **≤ 8 key**（热词池 Top 7 + `stats:hot`） | ≤ 192/天 |
| 在线翻译/AI **首次**写入（先查后写，同输入只写一次） | ≤ 108/天 |
| **合计** | **≤ 300/天** |

在线侧超限降级（M6 落地，M1 起由 `kv_write_log` 实测驱动）：日写超 108 时，AI/翻译缓存 TTL 24h→48h，或下调全局 AI 配额。

## 3. 由额度推导的设计铁律（重申 + 新增）

1. KV 热路径只读不写；响应缓存放 L1 Cache API（无写配额）。
2. AI 调用必须先查缓存 → 再查配额 → 最后才调模型，可降级为非 AI 结果。
3. **新增：CPU 10ms/请求**——池内 BM25/融合必须 O(n) 或 O(n·terms)，禁止在请求路径做 >10ms 的同步重计算（引文网络布局等全部推给前端 canvas）。
4. **新增：同时出站连接 6**——信号量 `MAX_CONCURRENCY=6` 不可调高；19 源 fan-out 必须分波。

## 4. 核对链接

- Workers 限额：https://developers.cloudflare.com/workers/platform/limits/
- KV 限额：https://developers.cloudflare.com/kv/platform/limits/
- D1 限额：https://developers.cloudflare.com/d1/platform/limits/
- D1 定价（免费额度）：https://developers.cloudflare.com/d1/platform/pricing/
- Workers AI 定价：https://developers.cloudflare.com/workers-ai/platform/pricing/
- Pages 限额：https://developers.cloudflare.com/pages/platform/limits/

> 下次核对时点：M6 开工前（Analytics Engine）；M8 上线前全表复核一次。
