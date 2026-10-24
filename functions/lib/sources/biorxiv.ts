import type { FetchRawFn, RawFetchResult, RawRecord, SearchParams } from '../types';
import { fetchUpstream } from '../infra/http';

/**
 * bioRxiv / medRxiv 数据源（M1-03）—— 生医预印本，仅"最新前沿"按日期区间
 * （mode='recent'：不参与关键词检索，供 M7 今日前沿 / Warmer 使用；附录 A）
 * API: https://api.biorxiv.org/details/{server}/{from}/{to}/{cursor} （M1-02 探测通过）
 */

const SOURCE_NAME = 'bioRxiv';

export const fetchRaw: FetchRawFn = async (params, opts): Promise<RawFetchResult> => {
  // recent 模式：忽略 query，按最近 N 天窗口返回新增
  const days = 7;
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const server = params.field === 'med' ? 'medrxiv' : 'biorxiv';
  const cursor = Math.floor((opts?.offset ?? 0) / 30);

  const res = await fetchUpstream<any>(`https://api.biorxiv.org/details/${server}/${fmt(from)}/${fmt(to)}/${cursor}`, { source: 'bioRxiv', timeoutMs: 8000 });
  if (!res.ok) return { records: [], error: res.error, elapsedMs: res.elapsedMs, httpStatus: res.status };

  const items = (res.data?.collection ?? []) as any[];
  const fetchedAt = Date.now();
  const records: RawRecord[] = items.map((it) => {
    const doi = String(it.doi ?? '').toLowerCase() || undefined;
    return {
      source: 'biorxiv' as const,
      sourceName: SOURCE_NAME,
      fetchedAt,
      title: String(it.title ?? ''),
      authors: String(it.authors ?? '').split(/;\s*/).filter(Boolean).slice(0, 25),
      year: it.date ? Number(String(it.date).slice(0, 4)) || undefined : undefined,
      venue: `${server === 'medrxiv' ? 'medRxiv' : 'bioRxiv'}`,
      venueType: 'preprint' as const,
      abstract: String(it.abstract ?? '') || undefined,
      doi,
      url: `https://doi.org/${doi ?? ''}` || undefined,
      pdfUrl: undefined,
      type: 'preprint' as const,
      openAccess: true,
      nativeId: doi,
    };
  });
  return { records, elapsedMs: res.elapsedMs, httpStatus: res.status };
};
