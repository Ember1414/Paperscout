import { dice2, titleFingerprint } from './normalize';
import { stem } from '../query/stemmer';
import type { ParsedQuery } from '../query/parse';
import type { Work } from '../types';

/**
 * BM25 池内相关性（REBUILD_PLAN 5.3.1）：语料 = 本次结果池（≤200 条），IDF 池内计算。
 * 字段权重 title×2.2 / abstract×1.0 / venue×0.3；短语命中 +1.5；标题完全匹配置顶 +5；
 * 中文整串命中权重 ×2（附录 B）。
 */

export const BM25_K1 = 1.2;
export const BM25_B = 0.75;
export const FIELD_WEIGHTS = { title: 2.2, abstract: 1.0, venue: 0.3 } as const;

interface FieldDoc {
  tf: Map<string, number>;
  len: number;
}

function tokenizeForIndex(text: string, isCjkField: boolean): string[] {
  const lower = text.toLowerCase();
  if (!isCjkField) return lower.split(/[^a-z0-9]+/).filter(Boolean).map(stem);
  // CJK：按 2-gram + latin 词混合
  const tokens: string[] = [];
  const latin = lower.split(/[^a-z0-9]+/).filter(Boolean).map(stem);
  const cjkRuns = lower.match(/[\u3400-\u4dbf\u4e00-\u9fff]+/g) ?? [];
  for (const run of cjkRuns) {
    for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2));
  }
  tokens.push(...latin);
  return tokens;
}

function buildFieldDoc(text: string, isCjk: boolean): FieldDoc {
  const tokens = tokenizeForIndex(text, isCjk);
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return { tf, len: tokens.length };
}

/** 相关性评分：为每条 Work 填充 score.parts.relevance（0..~10 区间，归一化后参与加权） */
export function scoreRelevance(works: Work[], parsed: ParsedQuery): number[] {
  const n = works.length;
  const docs = works.map((w) => ({
    title: buildFieldDoc(w.title, /[\u3400-\u4dbf\u4e00-\u9fff]/.test(w.title)),
    abstract: buildFieldDoc(w.abstract ?? '', /[\u3400-\u4dbf\u4e00-\u9fff]/.test(w.abstract ?? '')),
    venue: buildFieldDoc(w.venue ?? '', /[\u3400-\u4dbf\u4e00-\u9fff]/.test(w.venue ?? '')),
  }));

  const terms = parsed.terms.filter(Boolean).map((t) => /^[a-z0-9-]+$/.test(t) ? stem(t) : t);
  if (!terms.length) return works.map(() => 0);

  // 池内 IDF（按字段语料）
  const idf = (field: FieldDoc[], term: string): number => {
    let df = 0;
    for (const d of field) if (d.tf.has(term)) df++;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  };

  const rawScores = works.map((_, i) => {
    let score = 0;
    const fieldSpecs: [FieldDoc, number, keyof typeof FIELD_WEIGHTS][] = [
      [docs[i].title, FIELD_WEIGHTS.title, 'title'],
      [docs[i].abstract, FIELD_WEIGHTS.abstract, 'abstract'],
      [docs[i].venue, FIELD_WEIGHTS.venue, 'venue'],
    ];
    for (const [doc, weight] of fieldSpecs) {
      if (!doc.len) continue;
      let fieldScore = 0;
      for (const term of terms) {
        const tf = doc.tf.get(term) ?? 0;
        if (!tf) continue;
        fieldScore += idf(fieldSpecs.map(([d]) => d), term) * ((tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (doc.len / 120))));
      }
      score += fieldScore * weight;
    }
    return score;
  });

  // 归一化到 0..1（池内最大值），再叠加短语/整串/完全匹配加成（M10-02 调优）
  const max = Math.max(...rawScores, 1e-9);
  return works.map((w, i) => {
    let rel = rawScores[i] / max;
    const titleLc = w.title.toLowerCase();
    const absLc = (w.abstract ?? '').toLowerCase();
    const titleFp = titleFingerprint(w.title);
    // 标题完全匹配 → 置顶（5.3.1）
    const queryFp = titleFingerprint(parsed.phrases[0] ?? parsed.raw);
    if (titleFp && queryFp && titleFp === queryFp) rel += 5;
    // M10-02 引号短语：标题命中 +2.0；摘要命中 +0.8（标题远强于摘要）
    for (const p of parsed.phrases) {
      if (titleLc.includes(p)) rel += 2.0;
      else if (absLc.includes(p)) rel += 0.8;
    }
    // M10-02 中文整串：标题 +1.0；摘要 +0.3（附录 B ×2 语义 → 标题/摘要分级）
    if (parsed.cjkWhole) {
      if (titleLc.includes(parsed.cjkWhole)) rel += 1.0;
      else if (absLc.includes(parsed.cjkWhole)) rel += 0.3;
    }
    // M10-04 标题含全部查询词（英文 ≥2 词）→ +1.5（强信号：标题完整覆盖）
    const queryEnTerms = parsed.terms.filter((t) => /^[a-z0-9-]+$/.test(t));
    if (queryEnTerms.length >= 2) {
      const allInTitle = queryEnTerms.every((t) => titleLc.includes(t) || titleLc.includes(stem(t)));
      if (allInTitle) rel += 1.5;
    }
    // M10-04 中文：标题含全部 2-gram → +1.0
    const cjkTerms = parsed.terms.filter((t) => /[\u4e00-\u9fff]/.test(t));
    if (cjkTerms.length >= 2) {
      const allCjkInTitle = cjkTerms.every((g) => titleLc.includes(g));
      if (allCjkInTitle) rel += 1.0;
    }
    return rel;
  });
}

/** 字段存在性给 二次检索/分组 复用的相似度工具（池内） */
export function similarityToFingerprint(a: string, b: string): number {
  return dice2(titleFingerprint(a), titleFingerprint(b));
}
