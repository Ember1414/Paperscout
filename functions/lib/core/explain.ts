import { isTopVenue } from './venues';
import type { ParsedQuery } from '../query/parse';
import type { Work } from '../types';

/**
 * 排序理由 chip（REBUILD_PLAN 5.3.2）：由 score.parts 与 Work 数据真实推导，1–3 个，
 * 按触发优先级取前三。禁止写死或随机——单测断言 chip 与分值/数据一致。
 */

export interface ExplainContext {
  /** 池内被引 Top 10% 阈值（由编排器从池内统计后传入） */
  citationsTopDecile: number;
}

function formatCitations(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

const CHIP_TEXT = {
  exactTitle: '标题完全匹配',
  highlyCited: (n: number) => `高被引 ${formatCitations(n)}`,
  topDecile: '本主题高影响',
  recent: '近 12 个月',
  oaPdf: '可下载 PDF',
  multiSource: (n: number) => `${n} 源一致收录`,
  topVenue: '顶会/顶刊',
  freshPreprint: '最新预印本',
} as const;

export function explainChips(work: Work, parsed: ParsedQuery, ctx: ExplainContext): string[] {
  const chips: { key: string; weight: number; text: string }[] = [];
  const parts = work.score?.parts;
  const citations = typeof work.citations === 'number' ? work.citations : 0;
  const age = work.year ? Math.max(0, new Date().getFullYear() - work.year) : undefined;

  // 触发条件与 5.3.2 表一一对应；weight = 该 chip 对应的排序分项权重（按贡献度取前三）
  if (parts && parts.relevance > 0.8 && work.title.toLowerCase().includes((parsed.phrases[0] ?? parsed.raw).toLowerCase())) {
    chips.push({ key: 'exactTitle', weight: 1.0, text: CHIP_TEXT.exactTitle });
  }
  if (citations >= 100) chips.push({ key: 'highlyCited', weight: 0.55, text: CHIP_TEXT.highlyCited(citations) });
  if (isTopVenue(work.venue)) chips.push({ key: 'topVenue', weight: 0.54, text: CHIP_TEXT.topVenue });
  if (citations > 0 && citations >= ctx.citationsTopDecile) chips.push({ key: 'topDecile', weight: 0.53, text: CHIP_TEXT.topDecile });
  if (work.type === 'preprint' && age !== undefined && age <= 1) chips.push({ key: 'freshPreprint', weight: 0.2, text: CHIP_TEXT.freshPreprint });
  else if (age !== undefined && age <= 1) chips.push({ key: 'recent', weight: 0.19, text: CHIP_TEXT.recent });
  if (work.openAccess && work.pdfUrl) chips.push({ key: 'oaPdf', weight: 0.1, text: CHIP_TEXT.oaPdf });
  if (work.sources.length >= 3) chips.push({ key: 'multiSource', weight: 0.05, text: CHIP_TEXT.multiSource(work.sources.length) });

  return chips
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((c) => c.text);
}
