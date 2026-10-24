#!/usr/bin/env node
/**
 * M2-14 检索质量评测（检查机制升级）：
 * 对目标站跑金标准 12 查询，自动量化四类指标——
 *   广泛性：结果数、参与源数
 *   准确性：Top-10 查询词覆盖率（人工 Q-20 的自动化代理）、跑题占比（覆盖率=0）
 *   一致性：重复率（DOI/标题指纹）
 *   稳定性：HTTP 状态、耗时
 * 输出 docs/EVIDENCE/eval-<标签>.json + 终端对比表。零依赖。
 * 用法：EVAL_LABEL=v3-m2 SMOKE_URL=https://v3-m2.paperscout.pages.dev node scripts/eval-relevance.mjs
 */
import { writeFile, mkdir } from 'node:fs/promises';

const BASE = process.env.SMOKE_URL ?? 'https://paperscout.pages.dev';
const LABEL = process.env.EVAL_LABEL ?? 'run';

const CASES = [
  { id: 'q01', q: 'large language model hallucination', params: {} },
  { id: 'q02', q: '大语言模型 幻觉', params: { lang: 'zh' }, altTerms: ['large', 'language', 'model', 'hallucination'] }, // M2-14 互译扩展后中英合集口径
  { id: 'q03', q: '10.1038/s41586-023-06221-2', params: {}, intent: 'doi' }, // DOI 直查：coverage 为伪指标
  { id: 'q04', q: 'CRISPR base editing', params: { src: 'pubmed,openalex' } },
  { id: 'q05', q: 'graph neural network', params: { type: 'conference' } },
  { id: 'q06', q: 'LoRA fine-tuning', params: { from: '2023' } },
  { id: 'q07', q: 'single cell RNA sequencing', params: { sort: 'cited' }, weakCoverage: true }, // sort=cited 非相关性排序
  { id: 'q08', q: '量子计算 纠错', params: { lang: 'zh' }, altTerms: ['quantum', 'computing', 'error', 'correction'] },
  { id: 'q09', q: 'author:yoshuabengio', params: {}, intent: 'author' }, // 作者过滤：作者名出现在 metadata 而非 title/abstract
  { id: 'q10', q: 'the of and', params: {}, allowEmpty: true, noContentTerms: true }, // 全停用词
  { id: 'q11', q: 'asdfqwerzzz', params: {}, allowEmpty: true },
  { id: 'q12', q: "'; DROP TABLE favorites;--", params: {}, allowEmpty: true },
];

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'for', 'in', 'on', 'to', 'with', '的', '和', '与', '在']);
/** 查询内容词（长度≥2，去停用词） */
function queryTerms(q) {
  const raw = q.startsWith('author:') ? q.slice(7) : q;
  return raw.toLowerCase().split(/[\s,;]+/).map((w) => w.replace(/["'()`]/g, '')).filter((w) => w.length >= 2 && !STOP.has(w));
}
const normDoi = (d) => String(d ?? '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase().replace(/[.,;\s]+$/, '');
const titleFp = (t) => String(t ?? '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');

/** 单条结果的相关性代理：查询词在 标题+摘要 的覆盖比例（CJK 按子串，拉丁按词边界） */
function coverage(w, terms) {
  if (!terms.length) return 1;
  const hay = `${w.title ?? ''} ${w.abstract ?? ''}`.toLowerCase();
  let hit = 0;
  for (const t of terms) {
    if (/^[\x20-\x7e]+$/.test(t)) {
      if (new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(hay)) hit++;
    } else if (hay.includes(t)) hit++;
  }
  return hit / terms.length;
}

async function evalOne(c) {
  const qs = new URLSearchParams({ q: c.q, limit: '20', ...c.params });
  const t0 = Date.now();
  let status = 0, body = null, err = null;
  try {
    const res = await fetch(`${BASE}/api/search?${qs}`, { headers: { 'User-Agent': 'PaperScout/3.0-eval' }, signal: AbortSignal.timeout(90_000) });
    status = res.status;
    body = await res.json();
  } catch (e) {
    err = String(e?.cause?.message ?? e?.message ?? e).slice(0, 80);
  }
  const ms = Date.now() - t0;
  const data = body?.data ?? body ?? {};
  const items = Array.isArray(data.items) ? data.items : Array.isArray(data.papers) ? data.papers : [];
  const terms = queryTerms(c.q);
  const skipCoverage = c.intent === 'doi' || c.noContentTerms || (!c.weakCoverage && Boolean(c.params?.sort && c.params.sort !== 'smart')) === false && false;
  const isWeak = c.weakCoverage || Boolean(c.params?.sort && c.params.sort !== 'smart');
  // 覆盖词 = 查询词 + zh 查询的互译扩展词（altTerms，与 functions/lib/query/dict.ts 一致）
  const allTerms = [...terms, ...(c.altTerms ?? [])];
  const top = items.slice(0, 10);
  const covs = top.map((w) => {
    if (c.intent === 'author') {
      const name = c.q.slice('author:'.length).toLowerCase().replace(/s+/g, '');
      const hay = JSON.stringify([w.authors ?? [], w.title ?? '', w.venue ?? '']).toLowerCase().replace(/s+/g, '');
      return hay.includes(name) ? 1 : 0;
    }
    return allTerms.length ? coverage(w, allTerms) : 1;
  });
  const effectiveSkip = skipCoverage || allTerms.length === 0;
  const offTopic = covs.filter((cv) => cv === 0).length;
  const venueCount = new Map();
  for (const w of items.slice(0, 10)) {
    const v = String(w.venue ?? '—').toLowerCase();
    venueCount.set(v, (venueCount.get(v) ?? 0) + 1);
  }
  const topVenueShare = top.length ? Math.max(...venueCount.values()) / top.length : null; // 多样性：Top10 最大同 venue 占比
  const dois = items.map((w) => normDoi(w.doi)).filter(Boolean);
  const fps = items.map((w) => titleFp(w.title)).filter(Boolean);
  const dupDoi = dois.length - new Set(dois).size;
  const dupTitle = fps.length - new Set(fps).size;
  const sources = Array.isArray(data.sources) ? data.sources : [];
  const okSources = sources.filter((s) => (s.status ?? 'ok') === 'ok').length;
  return {
    id: c.id, q: c.q, httpStatus: status, ms, err,
    resultCount: items.length,
    sourcesOk: okSources, sourcesTotal: sources.length,
    top10Coverage: effectiveSkip ? null : covs.length ? +(covs.reduce((a, b) => a + b, 0) / covs.length).toFixed(3) : null,
    offTopicRatio: effectiveSkip ? null : covs.length ? +(offTopic / covs.length).toFixed(3) : null,
    coverageNote: effectiveSkip ? 'skipped' : isWeak ? 'weak(sort!=smart)' : '',
    dupByDoi: dupDoi, dupByTitle: dupTitle,
    topVenueShare: topVenueShare === null ? null : +topVenueShare.toFixed(2),
    sampleTitles: items.slice(0, 3).map((w) => String(w.title).slice(0, 50)),
  };
}

const rows = [];
for (const c of CASES) rows.push(await evalOne(c));

await mkdir('docs/EVIDENCE', { recursive: true });
const outFile = `docs/EVIDENCE/eval-${LABEL}.json`;
await writeFile(outFile, JSON.stringify({ base: BASE, label: LABEL, at: new Date().toISOString(), rows }, null, 2));

console.log(`# 检索质量评测 · ${LABEL} · ${BASE}\n`);
console.log('| # | 查询 | HTTP | ms | 结果数 | 源OK | Top10覆盖 | 跑题占比 | 重复(D+T) | Top Venue 占比 |');
console.log('|---|------|------|----|--------|------|-----------|----------|-----------|----------------|');
for (const r of rows) {
  console.log(`| ${r.id} | ${r.q.slice(0, 26).replace(/\|/g, '\\|')} | ${r.httpStatus}${r.err ? ' ' + r.err : ''} | ${r.ms} | ${r.resultCount} | ${r.sourcesOk}/${r.sourcesTotal} | ${r.top10Coverage ?? '—'} | ${r.offTopicRatio ?? '—'} | ${r.dupByDoi}+${r.dupByTitle} |`);
}
const valid = rows.filter((r) => r.top10Coverage !== null);
const avgCov = valid.length ? (valid.reduce((a, r) => a + (r.top10Coverage ?? 0), 0) / valid.length).toFixed(3) : '—';
const totalOff = rows.reduce((a, r) => a + (r.offTopicRatio ?? 0), 0);
const totalDup = rows.reduce((a, r) => a + (r.dupByDoi + r.dupByTitle), 0);
const withResults = rows.filter((r) => r.resultCount > 0).length;
console.log(`\n汇总：有结果 ${withResults}/12 · 平均 Top10 覆盖 ${avgCov} · 跑题占比合计 ${totalOff.toFixed(3)} · 冗余条目 ${totalDup} · 报告 ${outFile}`);
