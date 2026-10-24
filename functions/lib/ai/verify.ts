/**
 * 引用校验器（REBUILD_PLAN 5.9.3 / M6-01，纯函数，必须单测）
 * 提取 AI 回答中的 [n] 引用编号，校验是否都在 evidence 范围内。
 */

export interface VerifyResult {
  ok: boolean;
  /** 引用到的编号集合 */
  citedIds: number[];
  /** 越界编号（不在 [1..sources.length] 内） */
  invalidIds: number[];
  reason?: 'no_citation' | 'invalid_citation' | 'insufficient';
}

/**
 * @param {string} answer AI 生成的回答
 * @param {number} sourceCount evidence 条数
 * @returns {VerifyResult}
 */
export function verifyCitations(answer: string, sourceCount: number): VerifyResult {
  if (!answer || typeof answer !== 'string') {
    return { ok: false, citedIds: [], invalidIds: [], reason: 'no_citation' };
  }

  // INSUFFICIENT_EVIDENCE → 拒答
  if (answer.includes('INSUFFICIENT_EVIDENCE')) {
    return { ok: false, citedIds: [], invalidIds: [], reason: 'insufficient' };
  }

  // 提取 [n]（含范围 [1-3] → 1,2,3）
  /** @type {Set<number>} */
  const cited = new Set<number>();
  const matches = answer.matchAll(/\[(\d+)(?:-(\d+))?\]/g);
  for (const m of matches) {
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : start;
    for (let i = start; i <= end; i++) cited.add(i);
  }

  if (!cited.size) {
    return { ok: false, citedIds: [], invalidIds: [], reason: 'no_citation' };
  }

  const ids = [...cited].sort((a: number, b: number) => a - b);
  const invalid = ids.filter((n: number) => n < 1 || n > sourceCount);
  if (invalid.length) {
    return { ok: false, citedIds: ids, invalidIds: invalid, reason: 'invalid_citation' };
  }

  return { ok: true, citedIds: ids, invalidIds: [] };
}

/**
 * 剔除含越界引用的句子
 * @param {string} answer
 * @param {number[]} invalidIds
 * @returns {string}
 */
export function stripInvalidSentences(answer: string, invalidIds: number[]): string {
  if (!invalidIds.length) return answer;
  const sentences = answer.split(/(?<=[。！？.!?])\s*/);
  return sentences
    .filter((s: string) => !invalidIds.some((id: number) => s.includes(`[${id}]`)))
    .join(' ');
}
