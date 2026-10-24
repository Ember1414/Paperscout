import type { FetchRawFn, RawFetchResult, RawRecord, SearchParams } from '../types';
import { fetchUpstream } from '../infra/http';

/**
 * HAL 数据源（M1-03）—— 法国/欧洲开放档案（含 CNRS/INRIA 等机构仓储）
 * API: https://api.archives-ouvertes.fr/search/ （M1-02 探测通过）
 */

const SOURCE_NAME = 'HAL';

function halType(typelabel?: string, domain?: string): RawRecord['type'] {
  if (!typelabel) return undefined;
  const t = String(typelabel).toLowerCase();
  if (/proceedings|comm/.test(t) || /conf/i.test(String(domain ?? ''))) return 'conference';
  if (/preprint|unpublished/.test(t)) return 'preprint';
  if (/article|journal/.test(t)) return 'journal';
  return 'other';
}

export const fetchRaw: FetchRawFn = async (params, opts): Promise<RawFetchResult> => {
  if (!params.query) return { records: [], elapsedMs: 0 };
  const limit = Math.min(opts?.limit ?? params.limit, 30);
  const offset = opts?.offset ?? (params.page - 1) * limit;

  const fq: string[] = [];
  if (params.yearFrom) fq.push(`producedDateY_i:[${params.yearFrom} TO 2100]`);
  if (params.yearTo) fq.push(`producedDateY_i:[1000 TO ${params.yearTo}]`);

  const sp = new URLSearchParams({
    q: params.author ? `${params.query} auth_t:${params.author}` : params.query,
    wt: 'json',
    rows: String(limit),
    start: String(offset),
    fl: 'label_s,authFullName_s,producedDateY_i,venue_s,doiId_s,files_mainFile_s,abstract_s,docType_s,halId_s,domain_s',
  });
  if (fq.length) sp.set('fq', fq.join(' AND '));

  const res = await fetchUpstream<any>(`https://api.archives-ouvertes.fr/search/?${sp}`, { source: 'HAL' });
  if (!res.ok) return { records: [], error: res.error, elapsedMs: res.elapsedMs, httpStatus: res.status };

  const docs = (res.data?.response?.docs ?? []) as any[];
  const fetchedAt = Date.now();
  const records: RawRecord[] = docs
    .filter((d) => d.label_s)
    .map((d) => {
      const type = halType(d.docType_s, d.domain_s);
      const pdf = Array.isArray(d.files_mainFile_s) ? d.files_mainFile_s[0] : d.files_mainFile_s;
      const doi = d.doiId_s || undefined;
      return {
        source: 'hal' as const,
        sourceName: SOURCE_NAME,
        fetchedAt,
        title: String(d.label_s),
        authors: (Array.isArray(d.authFullName_s) ? d.authFullName_s : d.authFullName_s ? [d.authFullName_s] : []).slice(0, 25),
        year: d.producedDateY_i ? Number(d.producedDateY_i) : undefined,
        venue: d.venue_s || (type === 'preprint' ? 'HAL' : undefined),
        venueType: type === 'preprint' ? 'preprint' : type === 'conference' ? 'conference' : type === 'journal' ? 'journal' : 'repository',
        abstract: d.abstract_s || undefined,
        doi,
        url: doi ? `https://doi.org/${doi}` : d.halId_s ? `https://hal.science/${d.halId_s}` : undefined,
        pdfUrl: pdf || undefined,
        type,
        openAccess: pdf ? true : undefined,
        nativeId: d.halId_s || undefined,
      };
    });
  return { records, elapsedMs: res.elapsedMs, httpStatus: res.status };
};
