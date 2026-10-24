import type { FetchRawFn, RawFetchResult, RawRecord, SearchParams } from '../types';
import { fetchUpstream } from '../infra/http';

/**
 * DataCite 数据源（M1-03）—— 数据集/软件/预印本 DOI 注册机构
 * API: https://api.datacite.org/dois （M1-02 探测通过）
 */

const SOURCE_NAME = 'DataCite';

export const fetchRaw: FetchRawFn = async (params, opts): Promise<RawFetchResult> => {
  if (!params.query) return { records: [], elapsedMs: 0 };
  const limit = Math.min(opts?.limit ?? params.limit, 20);
  const offset = opts?.offset ?? (params.page - 1) * limit;

  const sp = new URLSearchParams({
    query: params.author ? `${params.query} AND creators.name:${params.author}` : params.query,
    'page[size]': String(limit),
    'page[number]': String(Math.floor(offset / limit) + 1),
  });

  const res = await fetchUpstream<any>(`https://api.datacite.org/dois?${sp}`, { source: 'DataCite' });
  if (!res.ok) return { records: [], error: res.error, elapsedMs: res.elapsedMs, httpStatus: res.status };

  const items = (res.data?.data ?? []) as any[];
  const fetchedAt = Date.now();
  const records = items
    .map((it): RawRecord | null => {
      const a = it.attributes ?? {};
      const title = a.titles?.[0]?.title;
      if (!title) return null;
      const doi = String(a.doi ?? '').toLowerCase() || undefined;
      const pubYear = a.publicationYear ?? a.publication_year;
      const resourceType = String(a.resourceTypeGeneral ?? '').toLowerCase();
      const isPreprint = /preprint/i.test(resourceType);
      const authors = (a.creators ?? []).map((c: any) => c?.name).filter(Boolean);
      return {
        source: 'datacite' as const,
        sourceName: SOURCE_NAME,
        fetchedAt,
        title: String(title),
        authors: authors.slice(0, 25),
        year: typeof pubYear === 'number' ? pubYear : undefined,
        venue: a.publisher || undefined,
        venueType: /dataset|software/i.test(resourceType) ? 'repository' : isPreprint ? 'preprint' : 'unknown',
        abstract: (a.descriptions ?? []).find((d: any) => d.descriptionType === 'Abstract')?.description || undefined,
        doi,
        url: a.url || (doi ? `https://doi.org/${doi}` : undefined),
        pdfUrl: undefined,
        type: isPreprint ? 'preprint' : 'other',
        openAccess: a.isOpenAccess === true ? true : undefined,
        nativeId: doi,
      };
    })
    .filter((r): r is RawRecord => r !== null && Boolean(r.url));
  return { records, elapsedMs: res.elapsedMs, httpStatus: res.status };
};
