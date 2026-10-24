#!/usr/bin/env node
/**
 * 总门禁 `npm run verify`（REBUILD_PLAN 7.10 / ACCEPTANCE G-01）。
 * 分级强制（DECISIONS D-002）：自动探测 git 分支 v3/mX 得当前里程碑；
 * enforceFrom 晚于当前里程碑的检查只 WARN 不阻断，到点自动转 ERROR。
 * 退出码 0 且末行打印 ALL GREEN 才算通过。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

function currentMilestone() {
  for (const a of process.argv) {
    if (a.startsWith('--milestone=')) return a.split('=')[1];
  }
  if (process.env.MILESTONE) return process.env.MILESTONE;
  try {
    const branch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    const m = branch.match(/^v3\/(m\d+)$/);
    if (m) return m[1];
  } catch {
    /* 分支探测失败则回退 m0（最宽松档），并在结果表标注 */
  }
  return 'm0';
}

const ORDER = (s) => Number(String(s).replace(/^m/, '')) || 0;
const MILESTONE = currentMilestone();
const DETECTED = !process.argv.some((a) => a.startsWith('--milestone=')) && !process.env.MILESTONE;

// enforceFrom：该检查自哪个里程碑起强制。缺失脚本按 SKIP（WARN）处理，不阻断。
const CHECKS = [
  { id: 'G-02', name: 'typecheck（后端）', cmd: ['npx', 'tsc', '--noEmit'], enforceFrom: 'm0' },
  { id: 'G-04', name: 'test（单测）', cmd: ['npm', 'run', 'test'], enforceFrom: 'm0' },
  { id: 'G-03', name: 'typecheck:web（前端 checkJs）', cmd: ['npm', 'run', 'typecheck:web'], enforceFrom: 'm2' },
  { id: 'G-06', name: 'lint:tokens（裸 hex）', cmd: ['node', 'scripts/check-tokens.mjs'], enforceFrom: 'm2' },
  { id: 'G-07', name: 'a11y（静态无障碍）', cmd: ['node', 'scripts/a11y-audit.mjs'], enforceFrom: 'm2' },
  { id: 'G-08', name: 'budget（体积预算）', cmd: ['node', 'scripts/budget.mjs'], enforceFrom: 'm2' },
  { id: 'G-10', name: 'silent-catch（静默吞错）', cmd: ['node', 'scripts/check-silent-catch.mjs'], enforceFrom: 'm1' },
];

function scriptExists(cmd) {
  if (cmd[0] === 'npm') {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const script = pkg.scripts?.[cmd[2]];
    if (!script) return false;
    // 脚本存在但底层工具未安装（如 M0-05 前的 vitest）视为未就绪
    const bin = script.trim().split(/\s+/)[0];
    if (bin === 'node') return existsSync(script.trim().split(/\s+/)[1] ?? '');
    if (existsSync(`node_modules/.bin/${bin}`) || existsSync(`node_modules/.bin/${bin}.cmd`)) return true;
    return existsSync(bin); // 纯 node 路径或其他可执行
  }
  return existsSync(cmd[1]) || cmd[0] === 'npx';
}

console.log(`# PaperScout v3 门禁 · 里程碑 ${MILESTONE}${DETECTED ? '（git 分支自动探测）' : '（手动指定）'}\n`);

let failed = 0;
const rows = [];
for (const c of CHECKS) {
  const enforced = ORDER(MILESTONE) >= ORDER(c.enforceFrom);
  if (!scriptExists(c.cmd)) {
    rows.push({ id: c.id, name: c.name, verdict: 'SKIP', note: '脚本未就绪' });
    continue;
  }
  const r = spawnSync(c.cmd.join(' '), { shell: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.trim();
  const ok = r.status === 0;
  const tail = out.split('\n').slice(-6).join('\n');
  if (ok) {
    rows.push({ id: c.id, name: c.name, verdict: 'PASS', note: tail.split('\n').pop().slice(0, 80) });
  } else if (enforced) {
    failed++;
    rows.push({ id: c.id, name: c.name, verdict: 'FAIL', note: tail.slice(-300) });
  } else {
    rows.push({ id: c.id, name: c.name, verdict: 'WARN', note: tail.slice(-200) });
  }
}

console.log('| ID | 检查 | 结果 | 说明 |');
console.log('|----|------|------|------|');
for (const r of rows) {
  const note = (r.note ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ⏎ ');
  console.log(`| ${r.id} | ${r.name} | ${r.verdict} | ${note} |`);
}

const enforcedFails = rows.filter((r) => r.verdict === 'FAIL');
const warns = rows.filter((r) => r.verdict === 'WARN');
console.log(`\n强制失败 ${enforcedFails.length}；WARN（尚未到强制里程碑，见 DECISIONS D-002）${warns.length}`);
if (enforcedFails.length) {
  console.log('VERIFY FAILED');
  process.exit(1);
}
console.log('ALL GREEN');
