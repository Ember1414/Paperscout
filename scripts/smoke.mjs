#!/usr/bin/env node
/**
 * G-09 冒烟：对目标站点跑 12 条金标准查询（REBUILD_PLAN 附录 F / ACCEPTANCE Q1）。
 * 通过标准（7.10）：全部 HTTP 200 且结果非空——除约定可为空的用例（q10 虚词、q11 乱码）。
 * v2/v3 兼容：结果字段取 `items`（v3）或 `papers`（v2）。
 * 用法：SMOKE_URL=https://<preview>.pages.dev npm run smoke   （缺省 http://localhost:8788）
 */
import { existsSync } from 'node:fs';

const BASE = process.env.SMOKE_URL ?? process.argv[2] ?? 'http://localhost:8788';
if (BASE.includes('localhost') && !existsSync('.wrangler')) {
  console.error('提示：本地冒烟请先 npm run dev（wrangler pages dev，端口 8788）');
}

// allowEmpty：约定可空的用例（仍要求 200 且不崩）
const CASES = [
  { id: 'q01', q: 'large language model hallucination', params: {} },
  { id: 'q02', q: '大语言模型 幻觉', params: { language: 'zh' } },
  { id: 'q03', q: '10.1038/s41586-023-06221-2', params: {} },
  { id: 'q04', q: 'CRISPR base editing', params: { src: 'pubmed,openalex' } },
  { id: 'q05', q: 'graph neural network', params: { type: 'conference' } },
  { id: 'q06', q: 'LoRA fine-tuning', params: { from: '2023' } },
  { id: 'q07', q: 'single cell RNA sequencing', params: { sort: 'cited' } },
  { id: 'q08', q: '量子计算 纠错', params: { language: 'zh' } },
  { id: 'q09', q: 'author:yoshuabengio', params: {} },
  { id: 'q10', q: 'the of and', params: {}, allowEmpty: true },
  { id: 'q11', q: 'asdfqwerzzz', params: {}, allowEmpty: true },
  { id: 'q12', q: "'; DROP TABLE favorites;--", params: {}, allowEmpty: true },
];

let failed = 0;
console.log(`# 冒烟目标：${BASE}\n`);
console.log('| # | 查询 | HTTP | 结果数 | 判定 |');
console.log('|---|------|------|--------|------|');
for (const c of CASES) {
  const qs = new URLSearchParams({ q: c.q, ...c.params });
  let status = 0;
  let n = null;
  let err = null;
  try {
    const res = await fetch(`${BASE}/api/search?${qs}`, {
      headers: { 'User-Agent': 'PaperScout/3.0-smoke' },
      signal: AbortSignal.timeout(30_000),
    });
    status = res.status;
    const body = await res.json();
    const items = body?.items ?? body?.papers ?? body?.data?.items;
    n = Array.isArray(items) ? items.length : null;
  } catch (e) {
    err = String(e?.cause?.message ?? e?.message ?? e).slice(0, 80);
  }
  const ok = status === 200 && (n === null ? false : n > 0 || c.allowEmpty);
  if (!ok) failed++;
  console.log(`| ${c.id} | ${c.q.slice(0, 30).replace(/\|/g, '\\|')} | ${status}${err ? ' ' + err : ''} | ${n ?? '—'} | ${ok ? 'PASS' : 'FAIL'} |`);
}
console.log(`\n冒烟${failed ? `FAIL：${failed} 条未达预期` : 'PASS：12/12'}`);
process.exit(failed ? 1 : 0);
