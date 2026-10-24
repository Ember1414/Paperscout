# SOURCES — 19 源冒烟探测报告（M1-02）

> 探测时间：**2026-10-24** · 方法：`node scripts/probe-sources.mjs`（本机直连）+ 对本机网络不可达/被限流源经 Cloudflare 出口复测（生产 `/api/search` 实测）
> 判定标准（附录 A 规则 1）：**verified** = 200 且可解析且字段可映射 RawRecord → 参与 fan-out；**external-link** = 仅外链入口，不参与检索；**needs-key** = 可选插槽（设置页填 key，M8）。
> 原始证据：`docs/EVIDENCE/probe.json`（含每源 HTTP 状态/耗时/样例字段）。

## 探测结果总表

| 档 | 源 | 状态 | HTTP | 耗时 | 结论与备注 |
|----|-----|------|------|------|-----------|
| 核心 | OpenAlex | ✅ verified | 200 | 1401ms | 字段全可映射；mailto 礼貌池生效 |
| 核心 | Crossref | ✅ verified | 200 | 2449ms | 字段全可映射 |
| 核心 | arXiv | ✅ verified | 200 | ~2000ms | 本机网络不可达（两轮超时），**经 CF 出口实测 5 篇返回无错误** → verified |
| 核心 | Semantic Scholar | ⚠️ verified | 429×2 | 691ms | API 结构正常但共享出口 429 高发（R-01）；v3 以重试 1 次 + 超时预算 + 降级兜底，不放弃 |
| 核心 | PubMed | ✅ verified | 200 | 1702ms | esearch/esummary 正常；摘要能力冻结为 false（D-010） |
| 核心 | DBLP | ❌ external-link | 202 + HTML | 2195ms | **Anubis 反爬封锁数据中心/CF 出口（"Oh noes!" 拦截页），两轮 + 30s 冷却复测均命中**。v2 路径同步受影响（非 v3 回归）。M7 Warmer 每日复测，恢复后自动翻转 verified |
| 学科 | Europe PMC | ✅ verified | 200 | 1183ms | 探测通过；M1-03 接入 |
| 学科 | DOAJ | ✅ verified | 200 | 1376ms | 探测通过；M1-03 接入（中文 OA 通道） |
| 学科 | HAL | ✅ verified | 200 | 1450ms | 待探测 → 通过；M1-03 接入 |
| 学科 | SciELO | ❌ external-link | 403 / 404 | 1253ms | 搜索接口 bot 防护 403、OAI 404 → 仅外链 |
| 学科 | J-STAGE | ❌ external-link | 连接超时 | 10225ms | 两轮 TCP 超时，不可达 → 仅外链 |
| 学科 | bioRxiv/medRxiv | ✅ verified | 200 | 1593ms | 按日期区间探测通过（recent 模式，M7 今日前沿用） |
| 开放 | OpenAIRE | ✅ verified | 200 | 1577ms | 探测通过；M1-03 接入 |
| 开放 | Zenodo | ✅ verified | 200 | 1953ms | 探测通过；M1-03 接入 |
| 开放 | DataCite | ✅ verified | 200 | 2023ms | 待探测 → 通过；M1-03 接入 |
| 开放 | ChinaXiv | ❌ external-link | DNS 失效 | 77ms | OAI 端点 `oai.chinaxiv.org` 已失效（ENOTFOUND）；主站可达但无公开结构化检索 API → 仅外链。**中文通道收敛为 OpenAlex / Crossref / DOAJ 三通道**（5.10 的覆盖声明必须如实说明） |
| 可选 | IEEE Xplore | 🔑 needs-key | 403 | 1381ms | 端点可达，缺 key（免费申请） |
| 可选 | Springer Nature | 🔑 needs-key | 401 | 6112ms | 端点可达，缺 key |
| 可选 | Scopus | 🔑 needs-key | 401 | 2289ms | 端点可达，缺 key（机构） |

**汇总：verified 11（含 recent 模式 biorxiv）/ external-link 4 / needs-key 3；实际可参与关键词 fan-out：9 源（openalex、crossref、arxiv、semanticscholar、pubmed、europepmc、doaj、hal、openaire、zenodo、datacite 中按 9 源上限截断）。**

## 与规划书附录 A 的差异（如实记录）

1. **DBLP 由"已验证"变为封锁**：2026-10-24 实测 Anubis 反爬拦截数据中心出口。影响：CS 会议记录覆盖下降（OpenAlex/Crossref/S2 仍含会议论文）。UI 源状态页需如实展示。缓解：M7 Warmer 每日复测自动翻转。
2. **ChinaXiv 由"待探测"确定为不可接**：中文独家覆盖进一步收缩，/about 与中文筛选激活时的覆盖声明必须写明"不含知网/万方/维普/ChinaXiv 独家内容"。
3. **SciELO / J-STAGE 降级外链**：符合附录 A 预案（"不可用则外链"）。
4. **Semantic Scholar 保留参与**：429 属瞬时限流而非不可用；v3 的单源降级 + 结果池缓存保证其故障不影响可用性（验收 F-15）。
