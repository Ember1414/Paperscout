#!/usr/bin/env node
/**
 * M0-01 冻结基线：对 v2 线上站跑 12 条金标准查询（REBUILD_PLAN 附录 F），
 * 记录结果数 / 耗时 / 重复数（D-005 口径），原始 JSON 存 docs/EVIDENCE/baseline/。
 * 零依赖。用法：node scripts/baseline.mjs [baseURL]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'https://paperscout.pages.dev';
const OUT_DIR = 'docs/EVIDENCE/baseline';

const QUERIES = [
  { id: 'q01', q: 'large language model hallucination' },
  { id: 'q02', q: '大语言模型 幻觉', language: 'zh' },
  { id: 'q03', q: '10.1038/s41586-023-06221-2' },
  { id: 'q04', q: 'CRISPR base editing', sources: 'pubmed,openalex' },
  { id: 'q05', q: 'graph neural network', paperType: 'conference' },
  { id: 'q06', q: 'LoRA fine-tuning', yearFrom: '2023' },
  { id: 'q07', q: 'single cell RNA sequencing', sort: 'citations' },
  { id: 'q08', q: '量子计算 纠错', language: 'zh' },
  { id: 'q09', q: 'author:yoshuabengio' },
  { id: 'q10', q: 'the of and' },
  { id: 'q11', q: 'asdfqwerzzz' },
  { id: 'q12', q: "'; DROP TABLE favorites;--" },
];

const normDoi = (doi) =>
  String(doi ?? '').replace(/^https?:\/\/doi\.org\//i, '').trim().toLowerCase().replace(/[.,;\s]+$/, '');
const titleFp = (t) => String(t ?? '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');

/** 冗余条数：出现 n 次的 key 贡献 n-1 条重复 */
function redundantCount(papers, keyFn) {
  const seen = new Map();
  for (const p of papers) {
    const k = keyFn(p);
    if (!k) continue;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  let dup = 0;
  for (const n of seen.values()) if (n > 1) dup += n - 1;
  return dup;
}

async function runOne(spec) {
  const qs = new URLSearchParams({ q: spec.q, limit: '20' });
  for (const [k, v] of Object.entries(spec)) {
    if (k !== 'id' && k !== 'q') qs.set(k, String(v));
  }
  const url = `${BASE}/api/search?${qs}`;
  const t0 = Date.now();
  let status = 0;
  let body = null;
  let fetchError = null;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'PaperScout/3.0-baseline (M0-01)' },
      signal: AbortSignal.timeout(90_000),
    });
    status = res.status;
    body = await res.json();
  } catch (e) {
    fetchError = String(e?.cause?.message ?? e?.message ?? e).slice(0, 120);
  }
  const ms = Date.now() - t0;

  const papers = Array.isArray(body?.papers) ? body.papers : [];
  const metrics = {
    id: spec.id,
    query: spec.q,
    params: Object.fromEntries(Object.entries(spec).filter(([k]) => !['id', 'q'].includes(k))),
    httpStatus: status,
    elapsedMs: ms,
    total: body?.total ?? null,
    papersLen: papers.length,
    sourcesOk: body?.sourcesOk ?? null,
    sourcesTotal: body?.sourcesTotal ?? null,
    cooldownCount: Array.isArray(body?.cooldown) ? body.cooldown.length : null,
    upstreamErrors: Array.isArray(body?.errors) ? body.errors : [],
    dupByDoi: redundantCount(papers, (p) => (p.doi ? normDoi(p.doi) : null)),
    dupByTitle: redundantCount(papers, (p) => titleFp(p.title) || null),
    cached: body?.cached ?? null,
    fetchError,
  };
  if (body) {
    await writeFile(join(OUT_DIR, `${spec.id}.json`), JSON.stringify({ requestUrl: url, response: body }, null, 2));
  }
  return metrics;
}

await mkdir(OUT_DIR, { recursive: true });
console.log(`# PaperScout v2 基线 · ${new Date().toISOString()} · ${BASE}\n`);
console.log('| # | 查询 | 参数 | HTTP | 耗时ms | total | papers | 重复(DOI) | 重复(标题) | 源OK/总 | 上游错误 |');
console.log('|---|------|------|------|--------|-------|--------|-----------|------------|---------|----------|');
const all = [];
for (const spec of QUERIES) {
  const m = await runOne(spec);
  all.push(m);
  const paramStr = Object.entries(m.params).map(([k, v]) => `${k}=${v}`).join(' ') || '默认';
  const errStr = m.upstreamErrors.length ? `${m.upstreamErrors.length}条` : m.fetchError ? 'fetch失败' : '0';
  console.log(
    `| ${m.id} | ${m.query.replace(/\|/g, '\\|').slice(0, 36)} | ${paramStr} | ${m.httpStatus} | ${m.elapsedMs} | ${m.total} | ${m.papersLen} | ${m.dupByDoi} | ${m.dupByTitle} | ${m.sourcesOk}/${m.sourcesTotal} | ${errStr} |`,
  );
}
await writeFile(join(OUT_DIR, 'summary.json'), JSON.stringify({ base: BASE, capturedAt: new Date().toISOString(), queries: all }, null, 2));
const dupTotal = all.reduce((s, m) => s + m.dupByDoi + m.dupByTitle, 0);
const okQueries = all.filter((m) => m.httpStatus === 200 && (m.papersLen ?? 0) > 0).length;
console.log(`\n汇总：${okQueries}/12 条查询有结果；全部查询冗余条目合计 ${dupTotal}；原始 JSON 在 ${OUT_DIR}/`);
