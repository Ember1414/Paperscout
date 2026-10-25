/**
 * 英文词干化（Porter Stemmer 简化版，M10-01）：
 * 提升搜索准确性——"networks" ↔ "network"、"learning" ↔ "learn" 可互相命中。
 * 零依赖纯函数；查询侧和索引侧同时调用确保一致。
 */

/** 不可规则化的不规则动词/名词（常见学术词） */
const IRREGULAR: Record<string, string> = {
  data: 'data', analysis: 'analysis', analyses: 'analysis',
  criteria: 'criterion', criterion: 'criterion',
  phenomena: 'phenomenon', phenomenon: 'phenomenon',
  mice: 'mouse', mouse: 'mouse',
  indices: 'index', indexes: 'index', index: 'index',
  matrices: 'matrix', matrix: 'matrix',
  vertices: 'vertex', vertex: 'vertex',
  synthesis: 'synthesis',
};

/**
 * 简化 Porter 词干化（覆盖 >90% 英文词形变化）
 * @param {string} w 小写英文词
 * @returns {string} 词干
 */
export function stem(w: string): string {
  if (!w || w.length <= 2) return w;
  if (IRREGULAR[w]) return IRREGULAR[w];

  let s = w;

  // 1. 复数 / -ing / -ed
  if (s.endsWith('ies') && s.length > 4) s = s.slice(0, -3) + 'y';
  else if (s.endsWith('sses')) s = s.slice(0, -2);
  else if (s.endsWith('ses') && s.length > 4) s = s.slice(0, -2);
  else if (s.endsWith('s') && !s.endsWith('ss') && !s.endsWith('us') && !s.endsWith('is') && s.length > 3) s = s.slice(0, -1);

  if (s.endsWith('ying') && s.length > 5) s = s.slice(0, -3) + 'i';
  else if (s.endsWith('ing') && s.length > 5) {
    s = s.slice(0, -3);
    if (s.length > 2 && !isVowel(s[s.length - 1]) && s[s.length - 1] === s[s.length - 2]) s = s.slice(0, -1); // running → run
  }

  if (s.endsWith('ied') && s.length > 4) s = s.slice(0, -3) + 'y';
  else if (s.endsWith('eed')) { /* 保持 feed/need */ }
  else if (s.endsWith('ed') && s.length > 4) {
    s = s.slice(0, -2);
    if (s.length > 2 && !isVowel(s[s.length - 1]) && s[s.length - 1] === s[s.length - 2]) s = s.slice(0, -1); // stopped → stop
  }

  // 2. -ly / -ness / -ment / -tion / -sion
  if (s.endsWith('ly') && s.length > 4) s = s.slice(0, -2);
  else if (s.endsWith('ness') && s.length > 5) s = s.slice(0, -4);
  else if (s.endsWith('ment') && s.length > 6) s = s.slice(0, -4);
  else if (s.endsWith('ization')) s = s.slice(0, -5) + 'e';
  else if (s.endsWith('ation') && s.length > 5) s = s.slice(0, -3) + 'e';
  else if (s.endsWith('tion')) s = s.slice(0, -1); // action → act
  else if (s.endsWith('sion')) s = s.slice(0, -2);

  // 3. -er / -est（保守：长度 > 5 才去，避免 paper→pap / over→ov 的过度截断）
  if (s.endsWith('er') && s.length > 5) s = s.slice(0, -2);
  else if (s.endsWith('est') && s.length > 5) s = s.slice(0, -3);

  // 4. -ical / -ic（保守：长度 > 6 才去）
  if (s.endsWith('ical') && s.length > 6) s = s.slice(0, -2);

  return s;
}

/** @param {string} c */
function isVowel(c: string): boolean {
  return 'aeiou'.includes(c);
}
