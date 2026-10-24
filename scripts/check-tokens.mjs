#!/usr/bin/env node
/**
 * G-06 设计 token 检查：组件 CSS 只允许引用 var(--token)，
 * 出现裸 hex 视为违规（REBUILD_PLAN 6.2）。tokens.css 是唯一例外。
 * 零依赖。用法：node scripts/check-tokens.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = 'public';
const SKIP = /tokens\.css$/;
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.css')) out.push(p);
  }
  return out;
}

const files = walk(ROOT).filter((f) => !SKIP.test(f));
let violations = 0;
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const noComment = line.replace(/\/\*.*?\*\//g, '');
    for (const m of noComment.matchAll(HEX_RE)) {
      violations++;
      if (violations <= 20) console.log(`${relative(ROOT, file)}:${i + 1}: 裸 hex ${m[0]} → ${line.trim().slice(0, 70)}`);
    }
  });
}

if (violations) {
  console.log(`\nlint:tokens FAIL：${violations} 处裸 hex（组件 CSS 必须引用 tokens.css 的变量）`);
  process.exit(1);
}
console.log('lint:tokens PASS：0 处裸 hex');
