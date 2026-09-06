# PaperScout · 全球论文检索

一站式检索国内外学术论文，聚合 **11 大学术数据源**（含爬虫源），部署于 **Cloudflare Pages**（`https://paperscout.pages.dev`），全球边缘加速。

## 功能特性

- **11 大数据源聚合**：并行检索、按 DOI 与标题智能去重合并、单源故障自动降级
- **覆盖全面**：
  | 数据源 | 领域 |
  |--------|------|
  | arXiv | 计算机 / 物理 / 数学预印本 |
  | OpenAlex | 综合学科，含大量中文期刊 |
  | Crossref | 全学科 DOI 正式出版物（含大量中文期刊） |
  | Semantic Scholar | 综合学科 + 引用分析 |
  | PubMed | 生物医学 / 生命科学 |
  | DBLP | 计算机科学权威文献库 |
  | DOAJ | 全球开放获取期刊（含中文核心期刊，全文免费） |
  | Europe PMC | 欧洲生物医学 + 预印本 |
  | OpenAIRE | 欧盟科研基础设施出版物 |
  | Zenodo | CERN 开放科学仓库（论文 / 预印本 / 数据集） |
  | **中文文献聚合** | 三重保障：百度学术爬虫 → OpenAlex 中文库 → Crossref 中文检索，永不空手而归 |
- **⭐ 智能质量排序（默认）**：综合被引次数（对数加权）、时效性、开放获取、PDF 可下载性评分排序
- **🌐 语言筛选**：一键只看中文 / 英文论文
- **🈶 英文论文一键翻译**：摘要自动出现「翻译为中文」按钮，四通道翻译（Google → MyMemory → Workers AI 专用翻译模型 → LLM），结果缓存 24 小时
- **📄 文献类型筛选**：期刊论文 / 会议论文 / 预印本（OpenAlex、Crossref 原生筛选，其余源智能标注）
- **⏱️ 年份快捷选择**：近 1 年 / 3 年 / 5 年一键设定并立即重新检索，或自定义区间
- **📥 可下载提示**：解析各源 OA PDF 直链，可下载的论文显示「下载 PDF」按钮
- **分页浏览**：每页 20 / 40 / 60 条可调
- **🔗 关键词高亮**：检索关键词在结果标题与摘要中以黄色高亮显示
- **⭐ 收藏夹**：收藏论文，支持导出 BibTeX / RIS（可导入 Zotero / EndNote）
- **🕘 检索历史**：最近 15 条检索记录一键回查（按浏览器隔离）
- **🔗 相关论文**：每篇论文一键查看 OpenAlex 关联推荐
- **👤 作者聚合**：点击作者名查看其高被引论文、h 指数、机构
- **🤖 AI 总结 / AI 问答**：Workers AI 生成研究现状速览；输入问题自动检索文献并生成带引用标注的回答
- **⚖️ 论文对比**：勾选最多 4 篇横向对比年份 / 来源 / 被引 / OA / PDF
- **📱 PWA**：可安装到手机 / 桌面，静态资源离线可用
- **⏰ Cron 预热**：paperscout-warmer Worker 每 30 分钟自动刷新雷达与热词缓存

### 未来可加入的权威数据源

以下数据源需要 API 密钥或 IP 白名单申请，暂未接入：
- **IEEE Xplore**（IEEE 官方 API，需免费申请 key）
- **Springer Nature**（需申请 key）
- **Elsevier Scopus**（机构申请）
- **CORE**（开放获取聚合，需申请 key）
- **BASE**（比勒费尔德学术搜索引擎，需 IP 白名单）
- **🕷️ 爬虫「最新论文雷达」**：实时抓取 arXiv 计算机类目最新提交（2 分钟缓存 + 手动「实时刷新」按钮，强制绕过缓存重新抓取）
- **点击直达原文**：每条结果附「打开原文」链接，开放获取论文有明确标识
- **界面体验**：明暗主题、来源彩色标签、摘要展开收起、一键复制引用、骨架屏动画、响应式
- **KV 双层缓存**：检索结果 10 分钟（空结果不缓存，部分源限流恢复后自动重试），雷达 2 分钟
- **可用性保障**：限流源（429/409/5xx/超时）自动指数退避重试 + **熔断器**——连续失败 3 次的源自动进入 5 分钟冷却（跳过网络调用、界面显示「冷却中」），冷却结束自动恢复探测，任一次成功立即复位

## 关于中国知网（CNKI）

知网无公开 API，且反爬严格（需登录/验证码，抓取违反其服务条款），无法稳定直连。
PaperScout 的中文论文覆盖方案：
1. **百度学术爬虫源** —— 百度学术聚合了知网、万方、维普的论文元数据
2. **Crossref / DOAJ / OpenAlex** 均收录大量中文期刊
3. **语言筛选**（仅中文）一键过滤出中文论文

## 快速开始

```bash
npm install
npm run dev      # 本地开发（wrangler pages dev）
npm run deploy   # 部署到 Cloudflare Pages
```

首次部署前需登录：`npx wrangler login`，并创建 Pages 项目：
`npx wrangler pages project create paperscout --production-branch main`

> 提示：将 `functions/lib/sources/openalex.ts` 中的 `CONTACT_EMAIL` 改为真实邮箱，
> 可加入 OpenAlex「礼貌池」获得更高速率上限（共享出口 IP 偶发 429 限流时的有效缓解手段）。

## API

| 端点 | 说明 |
|------|------|
| `GET /api/search` | 多源聚合检索（参数见下） |
| `GET /api/sources` | 列出可用数据源 |
| `GET /api/trending` | 爬虫抓取的 arXiv 最新论文（`?refresh=1` 强制实时抓取） |
| `GET /api/translate` | 翻译接口（`?q=<文本>&tl=zh-CN`，四通道 + KV 缓存 24h） |
| `GET /api/diag` | 数据源诊断：实时探测各上游从边缘节点的可达性与耗时 |
| `GET/POST/DELETE /api/history` | 检索历史（需 `X-Client-Id` 头） |
| `GET/POST /api/favorites` | 收藏夹（支持 BibTeX/RIS 导出） |
| `GET /api/related?doi=&title=` | 相关论文推荐（OpenAlex related_works） |
| `GET /api/author?name=` | 作者聚合（h 指数 / 高被引论文） |
| `POST /api/summarize` | AI 研究现状总结（POST 论文列表） |
| `GET /api/ask?q=` | AI 问答（自动检索文献 + 带引用回答） |
| `GET /api/stats` | 热门检索关键词统计 |
| `GET /api/health` | 健康检查 |

### `/api/search` 参数

| 参数 | 说明 | 示例 |
|------|------|------|
| `q` | 主题关键词（与 `author` 至少一个） | `大语言模型` |
| `author` | 作者 | `Yoshua Bengio` |
| `sources` | 逗号分隔的数据源，缺省全部 | `arxiv,dblp,baiduxueshu` |
| `yearFrom` / `yearTo` | 年份区间 | `2020` / `2026` |
| `sort` | `smart`（质量综合，默认）\| `relevance` \| `newest` \| `citations` | `smart` |
| `language` | `all` \| `zh` \| `en` | `zh` |
| `paperType` | `all` \| `journal` \| `conference` \| `preprint` | `journal` |
| `page` | 页码（1–20） | `2` |
| `limit` | 每源返回条数（1–50） | `10` |

## 项目结构

```
functions/
  api/[[route]].ts          # Pages Functions API 路由（全部 API 入口）
  lib/
    adapters.ts             # 数据源注册表（11 源）
    aggregate.ts            # 参数解析、语言/类型筛选、去重合并、智能质量排序
    crawler.ts              # 爬虫：arXiv 最新论文（HTML 解析 + API 降级 + 2 分钟缓存）
    http.ts                 # 带重试的 fetch（状态码与超时均可重试）
    services.ts             # 历史/收藏/相关/作者/AI 总结/AI 问答/热词统计
    types.ts                # 共享类型
    sources/                # 11 个数据源适配器（含中文文献聚合）
public/
  index.html / style.css / app.js   # 前端 SPA（无构建步骤）
  manifest.webmanifest / sw.js      # PWA
schema.sql                  # D1 数据库结构（history / favorites）
warmer/                     # Cron 预热 Worker（每 30 分钟刷新缓存）
wrangler.jsonc              # Pages 项目配置（KV + Workers AI + D1）
```
