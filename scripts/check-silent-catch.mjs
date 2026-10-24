#!/usr/bin/env node
/**
 * G-10 静默吞错检查：catch 块为空、或只有注释且无任何日志/错误记录，视为违规
 * （REBUILD_PLAN 1.5 第 1 条：每个 catch 必须 log 或返回带 code 的错误对象）。
 * 零依赖。用法：node scripts/check-silent-catch.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['functions', 'warmer'];
const ALLOW_HINTS = ['log', 'console', 'reportError', 'logWarn', 'logError', 'recordError', 'metrics'];

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|js|mjs)$/.test(name) && !name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

function findMatchingBrace(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const files = ROOTS.flatMap((r) => walk(r));
let violations = 0;
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const re = /catch\s*(?:\([^)]*\))?\s*\{/g;
  for (const m of src.matchAll(re)) {
    const close = findMatchingBrace(src, m.index + m[0].length - 1);
    if (close < 0) continue;
    let body = src.slice(m.index + m[0].length, close);
    const lineNo = src.slice(0, m.index).split('\n').length;
    const withoutComments = body
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .trim();
    const hasLog = ALLOW_HINTS.some((h) => body.toLowerCase().includes(h.toLowerCase()));
    if (withoutComments === '' && !hasLog) {
      violations++;
      if (violations <= 20) {
        const preview = lines[lineNo - 1]?.trim().slice(0, 60) ?? '';
        console.log(`${relative('.', file)}:${lineNo}: 静默 catch（无日志/无错误码）→ ${preview}`);
      }
    }
  }
}

if (violations) {
  console.log(`\ncheck-silent-catch FAIL：${violations} 处静默 catch（须 log 或返回带 code 的错误对象）`);
  process.exit(1);
}
console.log('check-silent-catch PASS：0 处静默 catch');
