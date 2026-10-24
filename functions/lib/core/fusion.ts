import { SEARCH } from '../config';
import {
  authorKey,
  authorSurname,
  cleanAbstract,
  dice2,
  detectLang,
  normalizeDoi,
  parseYear,
  titleFingerprint,
  titleMainPart,
} from './normalize';
import type { Provenance, RawRecord, Work } from '../types';

/**
 * 记录融合（REBUILD_PLAN 5.2）：同一篇论文多源出现 → 唯一 Work，保留全部来源证据。
 * 算法（5.2.3）：证据强度排序 → 候选 key（k1=DOI, k2=标题指纹, k3=主标题|年份|一作姓）
 * → 并查集 → 簇内 DOI 一致性拆分 → 字段择优（5.2.4）→ 置信度分级（5.2.5）。
 */

/* ---------- 并查集 ---------- */
class DSU {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
  groups(): Map<number, number[]> {
    const g = new Map<number, number[]>();
    for (let i = 0; i < this.parent.length; i++) {
      const r = this.find(i);
      const arr = g.get(r) ?? [];
      arr.push(i);
      g.set(r, arr);
    }
    return g;
  }
}

/** 稳定 ID 的非加密 hash（FNV-1a；仅用于去重主键，非安全用途） */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const PDF_LOGIN_WALL = [/ieeexplore\.ieee\.org/i, /sciencedirect\.com/i, /jstor\.org/i, /tandfonline\.com\/doi\/(full|pdf)\/10\.[1-9]\d+\//i, /link\.springer\.com\/(article|book)\/10\.[1-9]\d+\/(?!978-3-031)/i];

/** 引文数口径优先级（5.2.4：不做 max） */
const CITATIONS_PRIORITY = ['openalex', 'semanticscholar', 'crossref'];

function selectTitle(recs: RawRecord[]): string {
  const candidates = recs.map((r) => r.title).filter(Boolean);
  if (!candidates.length) return '(无标题)';
  const notTruncated = candidates.filter((t) => !/[…]|\.\.\.$/.test(t));
  const pool = notTruncated.length ? notTruncated : candidates;
  const longest = pool.reduce((a, b) => (b.length > a.length ? b : a));
  const sameLen = pool.filter((t) => t.length === longest.length);
  return sameLen.find((t) => t !== t.toUpperCase()) ?? longest;
}

function selectYear(recs: RawRecord[]): number | undefined {
  const years = recs.map((r) => r.year).filter((y): y is number => typeof y === 'number');
  if (!years.length) return undefined;
  // 多源一致取一致值
  const counts = new Map<number, number>();
  for (const y of years) counts.set(y, (counts.get(y) ?? 0) + 1);
  const maxCount = Math.max(...counts.values());
  if (maxCount > 1) {
    const top = [...counts.entries()].filter(([, c]) => c === maxCount).map(([y]) => y);
    return top.length === 1 ? top[0] : Math.min(...top);
  }
  // 不一致：正式出版源优先 crossref > openalex > 其他
  for (const p of ['crossref', 'openalex']) {
    const r = recs.find((r) => r.source === p && typeof r.year === 'number');
    if (r) return r.year;
  }
  // 仅预印本：取最早
  return Math.min(...years);
}

function selectVenue(recs: RawRecord[]): string | undefined {
  const formal = recs
    .map((r) => r.venue)
    .filter((v): v is string => Boolean(v && v.trim()))
    .filter((v) => !/bioRxiv|arXiv|Preprint|预印本/i.test(v));
  const pool = formal.length ? formal : recs.map((r) => r.venue).filter((v): v is string => Boolean(v));
  if (!pool.length) return undefined;
  return pool.reduce((a, b) => (b.length > a.length ? b : a));
}

function selectVenueType(recs: RawRecord[]): Work['venueType'] {
  const types = recs.map((r) => r.venueType).filter((t): t is NonNullable<RawRecord['venueType']> => Boolean(t));
  if (types.includes('journal')) return 'journal';
  if (types.includes('conference')) return 'conference';
  if (types.includes('preprint')) return 'preprint';
  if (types.includes('repository')) return 'repository';
  return 'unknown';
}

function selectType(recs: RawRecord[]): Work['type'] {
  const types = recs.map((r) => r.type).filter((t): t is NonNullable<RawRecord['type']> => Boolean(t));
  // 最强主张：journal > conference > preprint；仅当全部为 preprint 才判 preprint（5.2.4）
  if (types.includes('journal')) return 'journal';
  if (types.includes('conference')) return 'conference';
  if (types.length && types.every((t) => t === 'preprint')) return 'preprint';
  return 'other';
}

function selectUrl(recs: RawRecord[]): string {
  const urls = recs.map((r) => r.url).filter((u): u is string => Boolean(u));
  const doiUrl = urls.find((u) => /^https?:\/\/doi\.org\//i.test(u));
  if (doiUrl) return doiUrl;
  const landing = urls.find((u) => /^https?:\/\//i.test(u) && !/utm_|fbclid|gclid/i.test(u));
  return landing ?? urls[0] ?? '';
}

function selectPdfUrl(recs: RawRecord[]): string | undefined {
  const urls = recs.map((r) => r.pdfUrl).filter((u): u is string => Boolean(u));
  const good = urls.find((u) => /^https:\/\//i.test(u) && !PDF_LOGIN_WALL.some((re) => re.test(u)));
  return good;
}

function selectCitations(recs: RawRecord[]): { citations?: number; bySource: Record<string, number> } {
  const bySource: Record<string, number> = {};
  for (const r of recs) {
    if (typeof r.citations === 'number') bySource[r.source] = r.citations;
  }
  for (const p of CITATIONS_PRIORITY) {
    if (typeof bySource[p] === 'number') return { citations: bySource[p], bySource };
  }
  const first = Object.values(bySource)[0];
  return { citations: first, bySource };
}

function confidenceOf(recs: RawRecord[], doi?: string): 'A' | 'B' | 'C' {
  const nSources = new Set(recs.map((r) => r.source)).size;
  const hasYear = recs.some((r) => typeof r.year === 'number');
  const hasVenue = Boolean(selectVenue(recs));
  if (doi && nSources >= 2 && hasYear && hasVenue) return 'A';
  if (doi && nSources >= 2) return 'A';
  if (doi) return 'B';
  if (nSources >= 2) return 'B';
  return 'C';
}

/** 簇内 DOI 一致性拆分（5.2.3）：>1 个不同 DOI 时按 DOI 组拆开 */
function splitByDoiConflict(members: RawRecord[]): RawRecord[][] {
  const byDoi = new Map<string, RawRecord[]>();
  const noDoi: RawRecord[] = [];
  for (const m of members) {
    const d = normalizeDoi(m.doi);
    if (d) {
      const arr = byDoi.get(d) ?? [];
      arr.push(m);
      byDoi.set(d, arr);
    } else noDoi.push(m);
  }
  if (byDoi.size <= 1) return [members]; // 一致，无需拆
  const groups = [...byDoi.values()];
  // 无 DOI 成员：按标题相似度归入最接近的 DOI 组（≥0.92），否则独立成簇
  const fpOf = (r: RawRecord) => titleFingerprint(r.title);
  for (const m of noDoi) {
    let best: { group: RawRecord[]; score: number } | null = null;
    for (const g of groups) {
      const score = Math.max(...g.map((g0) => dice2(fpOf(m), fpOf(g0))));
      if (!best || score > best.score) best = { group: g, score };
    }
    if (best && best.score >= 0.92) best.group.push(m);
    else groups.push([m]);
  }
  return groups;
}

export function fuseRecords(records: RawRecord[]): Work[] {
  if (!records.length) return [];
  // 清洗归一（摘要/DOI/年份在各源 fetchRaw 已做，这里兜底再清一次）
  const recs = records
    .filter((r) => r.title && r.title.trim())
    .map((r) => ({ ...r, abstract: cleanAbstract(r.abstract) }));

  // 1. 证据强度排序：有 DOI > 有年份+作者 > 仅标题（5.2.3 第 1 步）
  const strength = (r: RawRecord) => (normalizeDoi(r.doi) ? 0 : r.year && r.authors.length ? 1 : 2);
  const order = recs.map((_, i) => i).sort((a, b) => strength(recs[a]) - strength(recs[b]));

  // 2. 候选 key
  const doiIdx = new Map<string, number[]>();
  const fpIdx = new Map<string, number[]>();
  const k3Idx = new Map<string, number[]>();
  for (const i of order) {
    const r = recs[i];
    const d = normalizeDoi(r.doi);
    if (d) {
      const arr = doiIdx.get(d) ?? [];
      arr.push(i);
      doiIdx.set(d, arr);
    }
    const fp = titleFingerprint(r.title);
    if (fp.length >= 8) {
      const arr = fpIdx.get(fp) ?? [];
      arr.push(i);
      fpIdx.set(fp, arr);
    }
    const mainFp = titleFingerprint(titleMainPart(r.title));
    if (mainFp.length >= 8) {
      const arr = k3Idx.get(mainFp) ?? [];
      arr.push(i);
      k3Idx.set(mainFp, arr);
    }
  }

  // 3. 并查集合并
  const dsu = new DSU(recs.length);
  // k1：DOI 命中即合并（最高优先）
  for (const idxs of doiIdx.values()) for (let k = 1; k < idxs.length; k++) dsu.union(idxs[0], idxs[k]);

  const surnameOf = (i: number) => (recs[i].authors[0] ? authorSurname(recs[i].authors[0]) : '');
  const isMergeablePair = (a: number, b: number): boolean => {
    const da = normalizeDoi(recs[a].doi);
    const db = normalizeDoi(recs[b].doi);
    if (da && db && da !== db) return false; // 两个不同 DOI 永不合并（DOI 最强证据）
    return true;
  };
  // k3 复核：主标题相似（dice ≥ 0.92）+ 一作姓氏一致（均有时）+ 年份差 ≤1（均有时）
  const k3PairHit = (a: number, b: number): boolean => {
    const mainA = titleFingerprint(titleMainPart(recs[a].title));
    const mainB = titleFingerprint(titleMainPart(recs[b].title));
    if (dice2(mainA, mainB) < 0.92) return false;
    if (surnameOf(a) && surnameOf(b) && authorKey(surnameOf(a)) !== authorKey(surnameOf(b))) return false;
    const va = recs[a].year;
    const vb = recs[b].year;
    if (va && vb && Math.abs(va - vb) > 1) return false;
    return true;
  };
  // k2：标题指纹命中且年份差 ≤1；年份差 >1 或缺失时交给 k3 复核
  for (const idxs of fpIdx.values()) {
    for (let k = 1; k < idxs.length; k++) {
      const a = idxs[k - 1];
      const b = idxs[k];
      if (!isMergeablePair(a, b)) continue;
      const ya = recs[a].year;
      const yb = recs[b].year;
      if (ya && yb) {
        if (Math.abs(ya - yb) <= 1) dsu.union(a, b);
        else if (k3PairHit(a, b)) dsu.union(a, b);
      } else if (k3PairHit(a, b)) {
        dsu.union(a, b);
      }
    }
  }
  // k3 独立通道：主标题指纹相同（如带/不带副标题、arXiv 与正式版标题变体）但整串指纹不同
  for (const idxs of k3Idx.values()) {
    if (idxs.length < 2) continue;
    for (let a = 0; a < idxs.length; a++) {
      for (let b = a + 1; b < idxs.length; b++) {
        if (!isMergeablePair(idxs[a], idxs[b])) continue;
        if (k3PairHit(idxs[a], idxs[b])) dsu.union(idxs[a], idxs[b]);
      }
    }
  }

  // 4. 簇内 DOI 一致性校验与拆分（5.2.3 第 4 步）
  const clusters: RawRecord[][] = [];
  for (const members of dsu.groups().values()) {
    const recsIn = members.map((i) => recs[i]);
    const dois = new Set(recsIn.map((r) => normalizeDoi(r.doi)).filter(Boolean));
    if (dois.size > 1) clusters.push(...splitByDoiConflict(recsIn));
    else clusters.push(recsIn);
  }

  // 5. 字段择优 → Work
  const thisYear = new Date().getFullYear();
  const works: Work[] = clusters.map((members) => {
    const doi = normalizeDoi(members.map((m) => m.doi).find((d) => normalizeDoi(d)) ?? undefined);
    const { citations, bySource } = selectCitations(members);
    const provenance: Provenance[] = members.map((m) => ({
      source: m.source,
      sourceName: m.sourceName,
      fetchedAt: m.fetchedAt,
      raw: { url: m.url, doi: normalizeDoi(m.doi), citations: m.citations, type: m.type, nativeId: m.nativeId },
    }));
    const title = selectTitle(members);
    const abstract = members.map((m) => m.abstract).reduce<string | undefined>((a, b) => (b && b.length > (a?.length ?? 0) ? b : a), undefined);
    const work: Work = {
      id: doi ? `doi:${doi}` : `tf:${fnv1a(titleFingerprint(title))}`,
      title,
      authors: dedupeAuthors(members),
      year: selectYear(members),
      venue: selectVenue(members),
      venueType: selectVenueType(members),
      abstract,
      doi,
      url: selectUrl(members),
      pdfUrl: selectPdfUrl(members),
      citations,
      citationsBySource: bySource,
      type: selectType(members),
      openAccess: members.some((m) => m.openAccess === true),
      lang: detectLang(title, abstract),
      sources: provenance,
      confidence: confidenceOf(members, doi),
    };
    // 产出前的年份合法性兜底
    if (work.year && (work.year < 1800 || work.year > thisYear + 1)) work.year = undefined;
    if (!work.url) work.url = work.doi ? `https://doi.org/${work.doi}` : '';
    return work;
  });
  return works;
}

/** 作者合并：按 authorKey 去重，保留首次出现顺序（证据强度序），sourceRank = 出处数 */
function dedupeAuthors(members: RawRecord[]): Work['authors'] {
  const map = new Map<string, { name: string; sourceRank: number }>();
  for (const m of members) {
    for (const a of m.authors.slice(0, 25)) {
      const k = authorKey(a);
      if (!k) continue;
      const existing = map.get(k);
      if (existing) existing.sourceRank++;
      else map.set(k, { name: a, sourceRank: 1 });
    }
  }
  return [...map.values()];
}
