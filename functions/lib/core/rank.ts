import { isTopVenue } from './venues';
import { scoreRelevance } from './bm25';
import type { ParsedQuery } from '../query/parse';
import type { Work } from '../types';

/**
 * 可解释排序（REBUILD_PLAN 5.3）：
 * total = 1.00×relevance + 0.55×quality + 0.20×recency + 0.10×availability + 0.05×agreement
 * 用户切换 sort=cited|newest 时只按该键排序（所见即所得）；sort=relevance 只用 relevance。
 * 每个 parts 分项必填——explain 的 chip 只允许从 parts 推导（禁止写死）。
 */

export const SORT_WEIGHTS = { relevance: 1.0, quality: 0.55, recency: 0.2, availability: 0.1, agreement: 0.05 } as const;

function qualityOf(w: Work): number {
  const c = typeof w.citations === 'number' ? w.citations : 0;
  let q = Math.min(Math.log10(c + 1) / 3, 1);
  if (isTopVenue(w.venue)) q = Math.min(q + 0.15, 1.15);
  return q;
}

function recencyOf(w: Work): number {
  if (!w.year) return 0.05; // 无年份轻微放后，不惩罚新论文（5.3.1）
  const age = Math.max(0, new Date().getFullYear() - w.year);
  return Math.exp(-age / 6);
}

function availabilityOf(w: Work): number {
  return (w.openAccess ? 0.5 : 0) + (w.pdfUrl ? 0.5 : 0);
}

function agreementOf(w: Work): number {
  return Math.min(w.sources.length, 3) / 3;
}

/** 为每条 Work 填充 score（parts + total），并按 sort 返回排序后的数组（不改变入参） */
export function rankWorks(works: Work[], parsed: ParsedQuery, sort: 'smart' | 'relevance' | 'newest' | 'citations'): Work[] {
  const relevance = scoreRelevance(works, parsed);

  const scored = works.map((w, i) => {
    const parts: Record<string, number> = {
      relevance: relevance[i],
      quality: qualityOf(w),
      recency: recencyOf(w),
      availability: availabilityOf(w),
      agreement: agreementOf(w),
    };
    const total =
      SORT_WEIGHTS.relevance * parts.relevance +
      SORT_WEIGHTS.quality * parts.quality +
      SORT_WEIGHTS.recency * parts.recency +
      SORT_WEIGHTS.availability * parts.availability +
      SORT_WEIGHTS.agreement * parts.agreement;
    const out: Work = { ...w, score: { total, parts } };
    return out;
  });

  const relByWork = new Map<Work, number>();
  scored.forEach((w, i) => relByWork.set(w, relevance[i]));
  if (sort === 'smart') {
    scored.sort((a, b) => b.score!.total - a.score!.total);
  } else if (sort === 'relevance') {
    scored.sort((a, b) => relByWork.get(b)! - relByWork.get(a)!);
  } else if (sort === 'newest') {
    scored.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  } else if (sort === 'citations') {
    scored.sort((a, b) => (b.citations ?? 0) - (a.citations ?? 0));
  }
  return scored;
}
