#!/usr/bin/env node
/**
 * G-08 体积预算（REBUILD_PLAN 7.2）：首屏传输 ≤ 90KB gzip；单文件 ≤ 40KB gzip。
 * FIRST_SCREEN 清单随前端演进而更新（v2 现状 = index.html + style.css + app.js；
 * v3 落地后改为 index.html + css/tokens.css + css/base.css + js/app.js + js/router.js + js/store.js）。
 * 零依赖。用法：node scripts/budget.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const FIRST_SCREEN = [
  'public/index.html',
  'public/css/tokens.css',
  'public/css/base.css',
  'public/css/layout.css',
  'public/css/components.css',
  'public/js/app.js',
  'public/js/icons.js',
  'public/js/router.js',
  'public/js/store.js',
  'public/js/api.js',
  'public/js/url.js',
];

const TOTAL_BUDGET = 90 * 1024;
const FILE_BUDGET = 40 * 1024;

let total = 0;
let fail = false;
const rows = [];
for (const f of FIRST_SCREEN) {
  if (!existsSync(f)) continue; // 清单容忍未落地的 v3 文件
  const raw = readFileSync(f);
  const gz = gzipSync(raw).length;
  total += gz;
  const over = gz > FILE_BUDGET;
  if (over) fail = true;
  rows.push({ f, raw: raw.length, gz, over });
}

console.log('| 文件 | 原始 | gzip | 状态 |');
console.log('|------|------|------|------|');
for (const r of rows) {
  console.log(`| ${r.f} | ${(r.raw / 1024).toFixed(1)}KB | ${(r.gz / 1024).toFixed(1)}KB | ${r.over ? '超单文件预算' : 'OK'} |`);
}
console.log(`\n首屏合计 gzip：${(total / 1024).toFixed(1)}KB / 预算 ${(TOTAL_BUDGET / 1024).toFixed(0)}KB`);

if (fail || total > TOTAL_BUDGET) {
  console.log('budget FAIL');
  process.exit(1);
}
console.log('budget PASS');
