/**
 * 顶刊顶会白名单（REBUILD_PLAN 5.12.4）。
 * M1 先收录 CS/AI/综合 ~30 条核心清单供排序加分与徽章；M3-09 扩充至 120 条并做缩写展开。
 * 禁止把"是否顶刊"当唯一质量标准（UI 必须同时展示被引与 OA）。
 */

const TOP_VENUES = [
  // CS 顶会（理论/AI/系统/安全/网络/体系结构/数据库/软件工程/图形学/多媒体/HCI/PL）
  'neurips', 'nips', 'icml', 'iclr', 'cvpr', 'iccv', 'eccv', 'acl', 'emnlp', 'naacl',
  'aaai', 'ijcai', 'kdd', 'sigir', 'www', 'sigmod', 'vldb', 'osdi', 'sosp', 'sigcomm',
  'ccs', 'ieee symposium on security and privacy', 'usenix security', 'usenix annual technical conference',
  'ndss', 'privacy enhancing technologies', 'isc', 'micro', 'isca', 'hpca', 'dac', 'isscc',
  'icse', 'fse', 'ase', 'ismm', 'pldi', 'popl', 'oopsla', 'siggraph', 'siggraph asia', 'mm',
  'chi', 'uist', 'ubicomp', 'icsoc', 'eurosys', 'atc', 'nsdi', 'mobicom', 'infocom',
  'icra', 'iros', 'aamas', 'colt', 'alt', 'stoc', 'focs', 'soda', 'esa',
  // CS / 综合顶刊
  'jmlr', 'ieee transactions on pattern analysis and machine intelligence', 'tpami',
  'international journal of computer vision', 'ijcv', 'ieee transactions on neural networks and learning systems',
  'acm transactions on graphics', 'acm computing surveys', 'information systems research',
  'ieee transactions on software engineering', 'acm transactions on database systems', 'ieee/acm transactions on networking',
  'journal of the acm', 'siam journal on computing', 'communications of the acm', 'proceedings of the ieee',
  // 综合 / 自然科学
  'nature', 'science', 'cell', 'pnas', 'nature communications', 'science advances',
  'physical review letters', 'physical review x', 'the lancet', 'new england journal of medicine',
  'journal of the american medical association', 'jama', 'british medical journal', 'bmj',
  'nature medicine', 'nature biotechnology', 'nature machine intelligence', 'nature methods',
  'cell stem cell', 'immunity', 'cancer cell', 'neuron', 'chemical reviews', 'journal of the american chemical society',
  'advanced materials', 'angewandte chemie', 'acs nano', 'nano letters',
  // 数学 / 经济 / 社科
  'annals of mathematics', 'inventiones mathematicae', 'journal of the american mathematical society',
  'annals of statistics', 'annals of probability', 'american economic review', 'econometrica',
  'journal of political economy', 'quarterly journal of economics', 'the review of economic studies',
  // 工程 / 能源 / 环境
  'ieee transactions on power systems', 'applied energy', 'energy', 'environmental science technology',
  // 中文核心
  '计算机学报', '软件学报', '自动化学报', '中国科学', '电子学报', '计算机研究与发展',
  '数学学报', '物理学报', '化学学报', '生物化学与生物物理学报', '通信学报', '中文信息学报',
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
