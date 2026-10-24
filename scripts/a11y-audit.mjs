#!/usr/bin/env node
/**
 * G-07 无障碍静态检查（REBUILD_PLAN 6.6 的可静态化子集）：
 *  1) <img> 必须有 alt
 *  2) <button>/<a> 无文字且无 aria-label → 违规
 *  3) 标题层级不跳级（h1 → h2 → h3 …）
 *  4) CSS 禁止 outline: none 且无 :focus-visible 替代
 *  5) emoji 不得作为功能标识（🔭⭐🤖🕷️ 等黑名单）
 * 零依赖。用法：node scripts/a11y-audit.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = 'public';
const EMOJI_BLACKLIST = ['🔭', '⭐', '🤖', '🕷️', '🔍', '📚', '⚙️'];

function walk(dir, exts) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

let errors = 0;
const report = (msg) => {
  errors++;
  if (errors <= 30) console.log(msg);
};

for (const file of walk(ROOT, ['.html'])) {
  const rel = relative('.', file);
  if (rel.replaceAll('\\', '/').endsWith('legacy.html')) {
    continue; // v2 冻结回退版（8.5.3），M8-04 删除
  }
  const src = readFileSync(file, 'utf8');
  const lineOf = (idx) => src.slice(0, idx).split('\n').length;

  for (const m of src.matchAll(/<img\b[^>]*>/g)) {
    if (!/\balt=/.test(m[0])) report(`${rel}:${lineOf(m.index)}: <img> 缺 alt`);
  }
  for (const m of src.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const tag = m[1];
    const attrs = m[2];
    const inner = m[3];
    const text = inner.replace(/<[^>]*>/g, '').trim();
    const svgOnly = /<svg[\s\S]*<\/svg>/.test(inner) && !text;
    if (!text && !/aria-label=/.test(attrs) && (svgOnly || inner.trim() === '')) {
      report(`${rel}:${lineOf(m.index)}: <${tag}> 无文字且无 aria-label`);
    }
  }
  const headings = [...src.matchAll(/<h([1-6])\b/g)].map((m) => ({ level: Number(m[1]), line: lineOf(m.index) }));
  let prev = 0;
  for (const h of headings) {
    if (prev && h.level > prev + 1) report(`${rel}:${h.line}: 标题跳级 h${prev} → h${h.level}`);
    prev = h.level;
  }
  for (const e of EMOJI_BLACKLIST) {
    if (src.includes(e)) report(`${rel}: 功能性 emoji ${e} 须替换为 SVG 图标或文字（REBUILD_PLAN 6.8）`);
  }
}

for (const file of walk(ROOT, ['.css'])) {
  const src = readFileSync(file, 'utf8');
  if (/outline:\s*none/.test(src) && !/:focus-visible/.test(src)) {
    report(`${relative('.', file)}: outline:none 但无 :focus-visible 替代`);
  }
}

if (errors) {
  console.log(`\na11y FAIL：${errors} 处静态无障碍违规`);
  process.exit(1);
}
console.log('a11y PASS：0 违规');
