/**
 * 顶刊顶会白名单（REBUILD_PLAN 5.12.4）。
 * M1 先收录 CS/AI/综合 ~30 条核心清单供排序加分与徽章；M3-09 扩充至 120 条并做缩写展开。
 * 禁止把"是否顶刊"当唯一质量标准（UI 必须同时展示被引与 OA）。
 */

const TOP_VENUES = [
  // CS 顶会
  'neurips', 'nips', 'icml', 'iclr', 'cvpr', 'iccv', 'eccv', 'acl', 'emnlp', 'naacl',
  'aaai', 'ijcai', 'kdd', 'sigir', 'www', 'sigmod', 'vldb', 'osdi', 'sosp', 'sigcomm',
  'ccs', 'ieee symposium on security and privacy', 'usenix security', 'sp', 'ndss', 'micro', 'isca', 'dac',
  // 顶刊
  'nature', 'science', 'cell', 'pnas', 'nature medicine', 'nature biotechnology', 'nature machine intelligence',
  'jmlr', 'ieee transactions on pattern analysis and machine intelligence', 'tpami',
  'international journal of computer vision', 'ijcv', 'acm transactions on graphics', 'the lancet', 'new england journal of medicine',
  'physical review letters', 'annals of mathematics', 'inventiones mathematicae',
  // 中文核心
  '计算机学报', '软件学报', '自动化学报', '中国科学', '电子学报', '计算机研究与发展',
];

const SET = new Set(TOP_VENUES);

/** 归一化 venue 名是否命中白名单（比对用小写去前缀形式） */
export function isTopVenue(venue?: string): boolean {
  if (!venue) return false;
  const v = venue.toLowerCase().replace(/^proceedings\s+of\s+(the\s+)?/i, '').replace(/\s+/g, ' ').trim();
  if (SET.has(v)) return true;
  // 缩写/包含命中：白名单词组作为独立词出现在 venue 名中（避免误命中 "international conference on ..."）
  return [...SET].some((t) => t.length >= 4 && new RegExp(`(^|\\b)${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\b|$)`).test(v));
}
