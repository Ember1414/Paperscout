# PaperScout · 证据可溯源的学术研究工作台

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

一站式检索国内外学术论文，聚合 **12 个开放学术数据源**，部署于 **Cloudflare Pages**（`https://paperscout.pages.dev`），全球边缘加速。

> 零幻觉 AI · 排序可解释 · 融合去重 · 免费 · 无登录 · 无追踪

## 功能

### 检索
- **多源并行聚合**：OpenAlex / Crossref / arXiv / Semantic Scholar / PubMed / Europe PMC / DOAJ / HAL / OpenAIRE / Zenodo / DataCite（12 源活跃）
- **智能去重**：DOI 优先 + 标题指纹 + 并查集（重复率 ≤ 1%）
- **排序可解释**：BM25 + 质量 + 时效 + OA + 多源一致 → 每条结果给出理由标签
- **检索式 DSL**：`author:` `year:` `venue:` `type:` `doi:` `"短语"` `-排除`
- **自动纠正**：无结果时自动拼写纠正重试；同义词/中英互译召回扩展
- **高级检索**：条件组 AND/OR/NOT 构建器

### 论文详情
- 被引趋势（按年柱图 + 三档标签）· 引文网络 canvas 图 · 参考文献/被引列表
- 全文探测（OpenAlex → Unpaywall → Europe PMC）+ kind/version 徽章
- 引用格式一键复制（BibTeX / RIS / CSL-JSON）
- S2 引用上下文（"谁在哪句话引用了它"）
- 相似论文 · 顶会/顶刊徽章

### AI（零幻觉）
- **AI 总结**：300 字研究现状，每个论断标注 [n] 引用
- **AI 问答**：SSE 流式 + 拒答（不可校验即不编造）
- **AI 精读**：贡献/方法/证据强度/局限 四维度分析
- **配额**：全局 + 单 client（D1 原子 upsert），每日 00:00 UTC 重置

### 文库
- 收藏（IndexedDB 持久化）· 标签 · 笔记（Markdown 子集）
- 导出 7 格式（BibTeX/RIS/CSL/CSV/Markdown/Word/JSON）· 导入回灌
- 回收站（7 天自动清理）· 对比矩阵（≤4 篇）

### 其他
- 命令面板（⌘K）· 全键盘操作 · 命令面板
- /status 源健康 + 今日用量 · /about 方法/隐私/免责
- 暗色/亮色主题 · PWA · 移动端适配 · 无障碍

## 技术架构

```
Cloudflare Pages + Functions（零构建）
├── 前端：原生 ES Modules（无框架，无打包器）
│   ├── 设计系统（tokens 双主题）
│   ├── History 路由 + SPA 回退
│   ├── store + api + url 状态层（requestId 竞态保护）
│   └── IndexedDB 文库（6 stores + 多工作区）
├── 后端：Pages Functions
│   ├── 检索编排器（并发 6 / 软超时 4.5s / 硬截止 6.5s / 降级不失败）
│   ├── 融合去重（并查集 + DOI 冲突拆分 + 置信度 A/B/C）
│   ├── 缓存三层（L0 内存 / L1 Cache API / L2 KV 只读）
│   ├── AI 零幻觉（verifyCitations + 配额 + SSE + 拒答）
│   └── D1（配额/统计/分享/反馈/健康）
└── Warmer：Cron Worker（预热 + 源健康聚合）
```

## 快速开始

```bash
npm install
npx wrangler pages dev public --port 8788
# 打开 http://localhost:8788
```

## 测试

```bash
npm run verify        # 类型检查 + 单测 + token/a11y/budget/silent-catch 全门禁
npm run test          # 222 例单测
npm run smoke         # 金标准 12 查询冒烟（需本地 dev 运行）
npm run eval          # 检索质量评测（需指定 SMOKE_URL）
```

## 免费额度

Cloudflare Free tier 全覆盖：Pages Functions 100k/天 · KV 读 100k/写 1k · D1 读 5M/写 100k · Workers AI 10k Neurons/天。详见 `docs/BUDGET.md`。

## 数据来源

OpenAlex (CC0) · Crossref · arXiv · Semantic Scholar · PubMed · Europe PMC · DOAJ · HAL · OpenAIRE · Zenodo · DataCite。中文文献来自开放元数据，不含知网/万方独家内容。

## 许可

MIT
