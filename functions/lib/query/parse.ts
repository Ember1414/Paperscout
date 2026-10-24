import { STOPWORDS } from './stopwords';

/**
 * 查询解析（REBUILD_PLAN 5.1.1）：原始字符串 → ParsedQuery。
 * - 裸 DOI（10.xxxx/...）→ intent='doi'，跳过 fan-out 走直查
 * - 引号短语、-排除词、author:/year:/venue:/type:/doi: 字段标签
 * - 中文 2-gram 分词（零词典）；整串保留用于短语加权（附录 B）
 * - question 意图：含 ?/如何/为什么 且长度 >12
 */

export interface ParsedQuery {
  raw: string;
  /** 归一化检索词（去停用词、小写；CJK 串输出 2-gram） */
  terms: string[];
  /** 引号短语（原样小写） */
  phrases: string[];
  /** -排除词 */
  excluded: string[];
  /** 显式字段过滤 */
  fieldTags: { key: 'author' | 'year' | 'venue' | 'type' | 'doi'; value: string }[];
  /** 中文检索整串（BM25 精确加权 ×2，附录 B） */
  cjkWhole?: string;
  /** 剥离短语/字段标签/排除词后的自由文本（供源检索用，保留原词形；M2-14） */
  cleanQuery: string;
  intent: 'topic' | 'author' | 'doi' | 'title' | 'question';
  lang: 'zh' | 'en' | 'mixed' | 'unknown';
}

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/;
const DOI_RE = /^\s*(10\.\d{2,}\s*\/\s*\S+)\s*$/;

/** CJK 串 → 2-gram（`大语言模型` → 大语/语言/言模/模型） */
export function cjkBigrams(s: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    if (CJK_RE.test(s[i])) {
      let j = i;
      while (j < s.length && CJK_RE.test(s[j])) j++;
      const run = s.slice(i, j);
      if (run.length === 1) out.push(run);
      else for (let k = 0; k < run.length - 1; k++) out.push(run.slice(k, k + 2));
      i = j;
    } else i++;
  }
  return out;
}

export function parseQuery(raw: string): ParsedQuery {
  const input = String(raw ?? '').trim();
  const fieldTags: ParsedQuery['fieldTags'] = [];
  const phrases: string[] = [];
  const excluded: string[] = [];
  const wordTokens: string[] = [];

  // 1. 提取引号短语
  const phraseRe = /"([^"]{1,120})"/g;
  let m: RegExpExecArray | null;
  let rest = input.replace(phraseRe, (_all, p) => {
    phrases.push(p.toLowerCase().trim());
    return ' ';
  });

  // 2. 提取字段标签 author:/year:/venue:/type:/doi:
  const fieldRe = /\b(author|year|venue|type|doi):\s*([^\s]+)/gi;
  rest = rest.replace(fieldRe, (_all, key: string, value: string) => {
    fieldTags.push({ key: key.toLowerCase() as 'author', value: value.trim() });
    return ' ';
  });

  // 3. 提取排除词 -term（不是负数字面量）
  rest = rest.replace(/(^|\s)-([A-Za-z0-9\u4e00-\u9fff][^\s]{0,40})/g, (_all, pre, term) => {
    excluded.push(term.toLowerCase());
    return pre ? ' ' : '';
  });

  // 4. 剩余词：停用词过滤 + CJK 2-gram
  const words = rest.toLowerCase().split(/\s+/).filter(Boolean);
  const kept = words.filter((w) => !STOPWORDS.has(w));
  for (const w of kept) {
    if (CJK_RE.test(w)) {
      for (const g of cjkBigrams(w)) wordTokens.push(g);
    } else wordTokens.push(w);
  }
  const terms = [...new Set(wordTokens)];

  // 中文整串（去停用词后的连续 CJK 片段，用于精确加权）
  const cjkRuns = rest.toLowerCase().match(/[\u3400-\u4dbf\u4e00-\u9fff]{2,}/g) ?? [];
  const cjkWhole = cjkRuns[0];

  // 5. 意图
  const bareDoi = input.match(DOI_RE);
  let intent: ParsedQuery['intent'] = 'topic';
  if (bareDoi || fieldTags.some((t) => t.key === 'doi')) intent = 'doi';
  else if (fieldTags.some((t) => t.key === 'author')) intent = 'author';
  else if (/(?:\?|如何|为什么|怎么)/.test(input) && input.length > 12) intent = 'question';

  // 6. 语言
  const hasCjk = CJK_RE.test(input);
  const hasLatin = /[a-z]/i.test(input);
  const lang: ParsedQuery['lang'] = hasCjk && hasLatin ? 'mixed' : hasCjk ? 'zh' : hasLatin ? 'en' : 'unknown';

  return { raw: input, terms, phrases, excluded, fieldTags, cjkWhole, cleanQuery: rest.replace(/s+/g, ' ').trim(), intent, lang };
}

/** 提取裸 DOI（intent=doi 时用于直查） */
export function extractDoi(raw: string): string | undefined {
  const bare = raw.match(DOI_RE);
  if (bare) return bare[1].replace(/\s/g, '').toLowerCase();
  const tagged = raw.match(/\bdoi:\s*([^\s]+)/i);
  if (tagged) return tagged[1].toLowerCase();
  return undefined;
}
