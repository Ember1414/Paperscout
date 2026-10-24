/**
 * 查询扩展词典（M2-14 / 功能全景"中英关键词互译扩展"P0；M2-16 并入同义词/相关词召回）。
 * 原则：只收录高置信、无歧义的学术词对——宁缺毋滥（错误扩展比不扩展更伤准确性）。
 */
import { RELATED, SYNONYMS } from '../core/suggest';

/** 中英互译（双向）：key 为归一化小写词 */
const BILINGUAL: Record<string, string> = {
  // AI / ML
  '大语言模型': 'large language model',
  '大模型': 'large language model',
  '语言模型': 'language model',
  '深度学习': 'deep learning',
  '机器学习': 'machine learning',
  '强化学习': 'reinforcement learning',
  '神经网络': 'neural network',
  '图神经网络': 'graph neural network',
  '卷积神经网络': 'convolutional neural network',
  '生成对抗网络': 'generative adversarial network',
  '自然语言处理': 'natural language processing',
  '计算机视觉': 'computer vision',
  '知识图谱': 'knowledge graph',
  '提示词': 'prompt',
  '微调': 'fine-tuning',
  '预训练': 'pre-training',
  '幻觉': 'hallucination',
  '多模态': 'multimodal',
  '智能体': 'agent',
  '迁移学习': 'transfer learning',
  '联邦学习': 'federated learning',
  '异常检测': 'anomaly detection',
  '推荐系统': 'recommender system',
  '自动驾驶': 'autonomous driving',
  // 系统 / 安全 / 网络
  '分布式系统': 'distributed system',
  '操作系统': 'operating system',
  '数据库': 'database',
  '云计算': 'cloud computing',
  '边缘计算': 'edge computing',
  '区块链': 'blockchain',
  '网络安全': 'network security',
  '隐私保护': 'privacy preserving',
  '密码学': 'cryptography',
  // 理论 / 数学 / 物理
  '量子计算': 'quantum computing',
  '量子纠错': 'quantum error correction',
  '纠错': 'error correction',
  '优化算法': 'optimization algorithm',
  '图论': 'graph theory',
  '概率论': 'probability theory',
  '数值分析': 'numerical analysis',
  // 生物 / 医学
  '基因编辑': 'gene editing',
  '单细胞测序': 'single cell sequencing',
  '免疫治疗': 'immunotherapy',
  '临床试验': 'clinical trial',
  '基因组学': 'genomics',
  '蛋白质结构': 'protein structure',
  '流行病学': 'epidemiology',
  '药物发现': 'drug discovery',
  // 反向：英文 → 中文
  'large language model': '大语言模型',
  'deep learning': '深度学习',
  'machine learning': '机器学习',
  'reinforcement learning': '强化学习',
  'neural network': '神经网络',
  'graph neural network': '图神经网络',
  'natural language processing': '自然语言处理',
  'computer vision': '计算机视觉',
  'knowledge graph': '知识图谱',
  'hallucination': '幻觉',
  'quantum computing': '量子计算',
  'quantum error correction': '量子纠错',
  'error correction': '纠错',
  'gene editing': '基因编辑',
  'single cell sequencing': '单细胞测序',
  'clinical trial': '临床试验',
  'drug discovery': '药物发现',
  'fine-tuning': '微调',
  'pre-training': '预训练',
  'multimodal': '多模态',
  'federated learning': '联邦学习',
};

/** 单词级双向索引（查询分词后逐词查） */
const WORD_INDEX: Readonly<Record<string, string>> = (() => {
  const idx: Record<string, string> = {};
  for (const [zh, en] of Object.entries(BILINGUAL)) {
    idx[zh] = en;
    // 英文词条整串已在表中；补充单词级（如 "hallucination" 单词查）
    if (!idx[en]) idx[en] = zh;
  }
  return idx;
})();

/**
 * 扩展查询：中文查询补英文等价、英文查询补中文等价（附录 B"整串"口径优先，单词级兜底）。
 * @param {string} rawQuery 原始查询
 * @param {string[]} terms 已分词的查询词（parse.ts 输出）
 * @param {string | undefined} cjkWhole 中文整串
 * @returns {{ recallSuffix: string, scoreTerms: string[] }} recallSuffix=召回追加串（仅 openalex/crossref 使用）；scoreTerms=打分扩展词
 */
export function expandQuery(rawQuery: string, terms: string[], cjkWhole?: string): { recallSuffix: string; scoreTerms: string[] } {
  const q = rawQuery.trim().toLowerCase();
  /** @type {Set<string>} */
  const score = new Set();
  /** @type {string[]} */
  const recall = [];

  // 1. 整串互译（最准）
  const whole = (cjkWhole ?? q).toLowerCase();
  const wholeMap = BILINGUAL[whole];
  if (wholeMap) {
    recall.push(wholeMap);
    for (const w of wholeMap.split(/[\s-]+/)) if (w.length >= 2) score.add(w);
  }

  // 2. 词级互译（跳过 2-gram 碎片：仅原样词命中）
  for (const t of terms) {
    const mapped: string | undefined = WORD_INDEX[t];
    if (mapped && !recall.includes(mapped)) {
      recall.push(mapped);
      for (const w of mapped.split(/[\s-]+/)) if (w.length >= 2) score.add(w);
    }
  }

  // 3. 同义词/缩写与相关术语（M2-16：复用 suggest 词典，扩展召回广度；上限 2 条防查询膨胀）
  const syn = SYNONYMS[q];
  if (syn && !recall.includes(syn)) {
    recall.push(syn);
    for (const w of syn.split(/[\s-]+/)) if (w.length >= 2) score.add(w);
  }
  for (const [key, rels] of Object.entries(RELATED)) {
    if (q.includes(key)) {
      for (const r of rels.slice(0, 2)) {
        if (!q.includes(r) && !recall.includes(r)) recall.push(r);
      }
      break;
    }
  }

  return { recallSuffix: recall.slice(0, 3).join(' '), scoreTerms: ([...score] as string[]).filter((t) => !terms.includes(t)) };
}

/** 词典只读视图（测试用） */
export const DICT_SIZE = Object.keys(BILINGUAL).length;
