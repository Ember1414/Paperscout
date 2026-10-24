/**
 * 查询建议（REBUILD_PLAN M2-10）：拼写纠正（编辑距离 ≤2）/前缀匹配/同义词/相关术语。
 * 纯函数——热词池由调用方注入（D1 search_log 聚合），无外部网络依赖。
 */

/** 常用学术缩写与中英对照（内置小词典；仅高置信映射） */
/** 同义词/缩写映射（M2-16 起同时供查询扩展召回使用） */
export const SYNONYMS: Record<string, string> = {
  llm: 'large language model',
  llms: 'large language model',
  gpt: 'large language model',
  cnn: 'convolutional neural network',
  rnn: 'recurrent neural network',
  gan: 'generative adversarial network',
  rl: 'reinforcement learning',
  nlp: 'natural language processing',
  cv: 'computer vision',
  qa: 'question answering',
  kg: 'knowledge graph',
  大模型: 'large language model',
  大语言模型: 'large language model',
  神经网络: 'neural network',
  深度学习: 'deep learning',
  机器学习: 'machine learning',
  强化学习: 'reinforcement learning',
  知识图谱: 'knowledge graph',
  量子计算: 'quantum computing',
  基因编辑: 'gene editing',
  幻觉: 'hallucination',
};

/** 相关术语扩展（主题 → 邻近词） */
/** 相关术语扩展（M2-16 起同时供查询扩展召回使用） */
export const RELATED: Record<string, string[]> = {
  transformer: ['attention', 'bert', 'gpt'],
  'neural network': ['deep learning', 'backpropagation'],
  'graph neural network': ['graph convolutional network', 'node embedding'],
  'quantum computing': ['quantum error correction', 'qubit'],
  crispr: ['base editing', 'cas9'],
  hallucination: ['factuality', 'retrieval augmented generation'],
  'large language model': ['instruction tuning', 'scaling laws'],
};

/** @param {string} a @param {string} b */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[m][n];
}

export interface Suggestion {
  text: string;
  kind: 'spell' | 'prefix' | 'synonym' | 'related';
}

/**
 * @param {string} rawQ 原始输入（≤60 字）
 * @param {{ hotKeywords: string[] }} pool 热词池（近 7 天，≤200 词）
 * @returns {Suggestion[]}
 */
export function suggestFrom(rawQ: string, pool: { hotKeywords: string[] }) {
  const q = rawQ.trim().toLowerCase();
  if (q.length < 2 || q.length > 60) return [];
  /** @type {Suggestion[]} */
  const out = [];
  const seen = new Set([q]);

  // 1. 前缀匹配热词
  for (const k of pool.hotKeywords) {
    const kl = k.toLowerCase();
    if (kl !== q && kl.startsWith(q) && !seen.has(kl)) {
      out.push({ text: k, kind: 'prefix' });
      seen.add(kl);
    }
    if (out.length >= 4) break;
  }

  // 2. 拼写纠正：编辑距离 1..2 的最近热词
  const lastWord = q.split(/\s+/).pop() ?? q;
  if (lastWord.length >= 3) {
    let best = { w: '', d: 3 };
    for (const k of pool.hotKeywords) {
      const words = k.toLowerCase().split(/\s+/);
      // 多词热词逐词比对（任一词距离 ≤2 即候选）；单词热词全词比对
      const d = Math.min(...words.map((wd) => editDistance(lastWord, wd)), words.length === 1 ? editDistance(lastWord, words[0]) : 3);
      if (d >= 1 && d <= 2 && d < best.d) best = { w: k, d };
    }
    if (best.w && !seen.has(best.w.toLowerCase())) {
      out.push({ text: best.w, kind: 'spell' });
      seen.add(best.w.toLowerCase());
    }
  }

  // 3. 同义词 / 缩写展开（整词或整串命中）
  const syn = SYNONYMS[q];
  if (syn && !seen.has(syn)) {
    out.push({ text: syn, kind: 'synonym' });
    seen.add(syn);
  }

  // 4. 相关术语（完整短语命中）
  for (const [k, rels] of Object.entries(RELATED)) {
    if (q.includes(k)) {
      for (const r of rels) {
        if (!q.includes(r) && !seen.has(r)) {
          out.push({ text: r, kind: 'related' });
          seen.add(r);
        }
      }
      break;
    }
  }

  return out.slice(0, 6);
}
