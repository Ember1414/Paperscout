import type { Work } from '../types';

/**
 * 结果多样性（M2-15）：智能排序下，同 venue 在列表中最多连续出现 maxInARow 条，
 * 超出顺延到列表后部（稳定贪心：不改变条目总分与 chips 推导，只调相对位置）。
 * 仅 sort=smart 应用；newest/cited/relevance 是用户显式排序，不做多样性调整。
 */

/**
 * @param {Work[]} items 已排序结果
 * @param {{ maxInARow?: number }} [opts]
 * @returns {Work[]} 重排后的新数组
 */
export function diversifyByVenue(items: Work[], opts?: { maxInARow?: number }): Work[] {
  const max = opts?.maxInARow ?? 2;
  if (items.length <= max + 1) return items;

  /** @type {Work[]} */
  const kept: Work[] = [];
  /** @type {Work[]} */
  const deferred: Work[] = [];
  let prevVenue = '';
  let runLen = 0;

  for (const w of items) {
    const venue = (w.venue ?? '∅').toLowerCase();
    if (venue === prevVenue && runLen >= max) {
      deferred.push(w);
    } else {
      kept.push(w);
      runLen = venue === prevVenue ? runLen + 1 : 1;
      prevVenue = venue;
    }
  }
  return [...kept, ...deferred];
}
