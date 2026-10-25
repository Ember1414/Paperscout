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
  '检索': 'retrieval',
  '排序': 'ranking',
  '推荐': 'recommendation',
  '分类': 'classification',
  '聚类': 'clustering',
  '回归': 'regression',
  '特征': 'feature',
  '嵌入': 'embedding',
  '注意力': 'attention',
  '生成模型': 'generative model',
  '扩散模型': 'diffusion model',
  '自然语言生成': 'natural language generation',
  '机器翻译': 'machine translation',
  '语音识别': 'speech recognition',
  '图像分类': 'image classification',
  '目标检测': 'object detection',
  '语义分割': 'semantic segmentation',
  '图像生成': 'image generation',
  '视觉语言模型': 'vision language model',
  '知识蒸馏': 'knowledge distillation',
  '模型压缩': 'model compression',
  '量化': 'quantization',
  '剪枝': 'pruning',
  '分布式训练': 'distributed training',
  '模型推理': 'model inference',
  '差分隐私': 'differential privacy',
  '安全多方计算': 'secure multi-party computation',
  '智能合约': 'smart contract',
  '共识算法': 'consensus algorithm',
  '量子通信': 'quantum communication',
  '量子密码': 'quantum cryptography',
  '拓扑绝缘体': 'topological insulator',
  '超导': 'superconductivity',
  '纳米材料': 'nanomaterial',
  '催化剂': 'catalyst',
  '电化学': 'electrochemistry',
  '电池': 'battery',
  '储能': 'energy storage',
  '太阳能': 'solar energy',
  '碳捕集': 'carbon capture',
  '碳中和': 'carbon neutrality',
  '气候变化': 'climate change',
  '水处理': 'water treatment',
  '精准农业': 'precision agriculture',
  '基因治疗': 'gene therapy',
  '细胞治疗': 'cell therapy',
  '免疫检查点': 'immune checkpoint',
  '肿瘤微环境': 'tumor microenvironment',
  '代谢组学': 'metabolomics',
  '转录组学': 'transcriptomics',
  '蛋白质组学': 'proteomics',
  '微生物组': 'microbiome',
  '肠道菌群': 'gut microbiota',
  '抗生素耐药': 'antibiotic resistance',
  '病毒感染': 'viral infection',
  '疫苗': 'vaccine',
  '药物靶点': 'drug target',
  '循证医学': 'evidence-based medicine',
  '公共卫生': 'public health',
  '医疗影像': 'medical imaging',
  '生物信息学': 'bioinformatics',
  '计算生物学': 'computational biology',
  '系统生物学': 'systems biology',
  '合成生物学': 'synthetic biology',
  '脑科学': 'brain science',
  '神经科学': 'neuroscience',
  '认知科学': 'cognitive science',
  '博弈论': 'game theory',
  '计量经济学': 'econometrics',
  '金融科技': 'fintech',
  '供应链': 'supply chain',
  '运筹学': 'operations research',
  '图论算法': 'graph theory algorithm',
  '组合优化': 'combinatorial optimization',
  '近似算法': 'approximation algorithm',
  '并行计算': 'parallel computing',
  '高性能计算': 'high performance computing',
  '量子算法': 'quantum algorithm',
  '形式化验证': 'formal verification',
  '程序分析': 'program analysis',
  '编译器': 'compiler',
  '操作系统内核': 'operating system kernel',
  '数据库系统': 'database system',
  '事务处理': 'transaction processing',
  '并发控制': 'concurrency control',
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
  'retrieval': '检索',
  'ranking': '排序',
  'embedding': '嵌入',
  'attention mechanism': '注意力机制',
  'knowledge distillation': '知识蒸馏',
  'model compression': '模型压缩',
  'edge computing': '边缘计算',
  'differential privacy': '差分隐私',
  'blockchain': '区块链',
  'smart contract': '智能合约',
  'quantum communication': '量子通信',
  'topological insulator': '拓扑绝缘体',
  'superconductivity': '超导',
  'nanomaterial': '纳米材料',
  'catalyst': '催化剂',
  'battery': '电池',
  'energy storage': '储能',
  'solar energy': '太阳能',
  'carbon capture': '碳捕集',
  'climate change': '气候变化',
  'gene therapy': '基因治疗',
  'cell therapy': '细胞治疗',
  'immune checkpoint': '免疫检查点',
  'tumor microenvironment': '肿瘤微环境',
  'metabolomics': '代谢组学',
  'microbiome': '微生物组',
  'antibiotic resistance': '抗生素耐药',
  'vaccine': '疫苗',
  'drug target': '药物靶点',
  'public health': '公共卫生',
  'medical imaging': '医疗影像',
  'bioinformatics': '生物信息学',
  'neuroscience': '神经科学',
  'cognitive science': '认知科学',
  'game theory': '博弈论',
  'econometrics': '计量经济学',
  'fintech': '金融科技',
  'supply chain': '供应链',
  'operations research': '运筹学',
  'graph theory': '图论',
  'combinatorial optimization': '组合优化',
  'parallel computing': '并行计算',
  'quantum algorithm': '量子算法',
  'formal verification': '形式化验证',
  'compiler': '编译器',
  'operating system': '操作系统',
  'database system': '数据库系统',
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
