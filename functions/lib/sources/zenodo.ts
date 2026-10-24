import type { FetchRawFn, Paper, RawFetchResult, RawRecord, SearchParams, SourceAdapter } from '../types';
import { fetchUpstream } from '../infra/http';
import { fetchWithRetry } from '../http';

/**
 * Zenodo 数据源 —— CERN 运营的开放科学仓库（4000 万+ 论文/预印本/数据集）
 * API: https://developers.zenodo.org/ (免费，无需密钥)
 */

const SOURCE_NAME = 'Zenodo';

function stripHtml(s?: string): string | undefined {
  if (!s) return undefined;
  const text = s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > 400 ? text.slice(0, 400) + '…' : text || undefined;
}

export const zenodo: SourceAdapter = {
  id: 'zenodo',
  name: SOURCE_NAME,

  async search(params: SearchParams): Promise<Paper[]> {
    if (!params.query) return [];

    const qParts: string[] = [params.query];
    if (params.author) qParts.push(`creators.name:"${params.author}"`);

    const sp = new URLSearchParams({
      q: qParts.join(' AND '),
      // Zenodo size 上限为 25，超出会返回 400
      size: String(Math.min(params.limit, 25)),
      page: String(params.page),
      sort: params.sort === 'newest' ? 'mostrecent' : 'bestmatch',
    });

    const res = await fetchWithRetry(`https://zenodo.org/api/records?${sp}`, {
      headers: { 'User-Agent': 'PaperScout/2.0 (https://paperscout.pages.dev)' },
    });
    if (!res.ok) throw new Error(`Zenodo HTTP ${res.status}`);

    const data = (await res.json()) as any;
    const hits = (data?.hits?.hits ?? []) as any[];

    let papers: Paper[] = hits
      .map((h): Paper => {
        const m = h.metadata ?? {};
        const doi: string | undefined = m.doi;
        const url: string = h.links?.self_html || h.links?.latest_html || (doi ? `https://doi.org/${doi}` : '');

        // 开放获取时提供 PDF 文件直链
        let pdfUrl: string | undefined;
        if (m.access_right === 'open' && Array.isArray(h.files)) {
          const pdf = h.files.find((f: any) => f.key?.toLowerCase().endsWith('.pdf'));
          if (pdf?.links?.self) pdfUrl = pdf.links.self;
        }

        // 类型：publication 细分 / 数据集等归为 other
        const rType = m.resource_type?.type;
        const subType = m.resource_type?.id ?? m.resource_type?.subtype;
        let type: Paper['type'] = 'other';
        if (rType === 'publication') {
          if (/journal-article|article/.test(String(subType))) type = 'journal';
          else if (/conference/.test(String(subType))) type = 'conference';
          else if (subType === 'preprint' || subType === 'working-paper') type = 'preprint';
        }

        return {
          title: m.title ?? '(无标题)',
          authors: (m.creators ?? []).map((c: any) => c.name).filter(Boolean).slice(0, 12),
          year: m.publication_date ? Number(String(m.publication_date).slice(0, 4)) || undefined : undefined,
          venue: m.journal?.title || 'Zenodo 开放科学仓库',
          abstract: stripHtml(m.description),
          url,
          pdfUrl,
          doi,
          type,
          source: 'zenodo',
          sourceName: SOURCE_NAME,
          openAccess: m.access_right === 'open',
        };
      })
      .filter((p) => p.url);

    if (params.yearFrom) papers = papers.filter((p) => !p.year || p.year >= params.yearFrom!);
    if (params.yearTo) papers = papers.filter((p) => !p.year || p.year <= params.yearTo!);

    return papers;
  },
};

/* ==================== v3 fetchRaw 层（M1-03）==================== */

/**
 * Zenodo 数据源（M1-03）—— CERN 开放科学仓库（论文/数据/软件）
 * API: https://zenodo.org/api/records （M1-02 探测通过）
 */

export const fetchRaw: FetchRawFn = async (params, opts): Promise<RawFetchResult> => {
  if (!params.query) return { records: [], elapsedMs: 0 };
  const limit = Math.min(opts?.limit ?? params.limit, 25);
  const offset = opts?.offset ?? (params.page - 1) * limit;

  const sp = new URLSearchParams({
    q: params.author ? `${params.query} creators.name:"${params.author}"` : params.query,
    size: String(limit),
    page: String(Math.floor(offset / limit) + 1),
  });
  if (params.yearFrom || params.yearTo) {
    const from = params.yearFrom ? `${params.yearFrom}-01-01` : '1000-01-01';
    const to = params.yearTo ? `${params.yearTo}-12-31` : '9999-12-31';
    sp.set('q', `${sp.get('q')} AND publication_date:[${from} TO ${to}]`);
  }

  const res = await fetchUpstream<any>(`https://zenodo.org/api/records?${sp}`, { source: 'Zenodo' });
  if (!res.ok) return { records: [], error: res.error, elapsedMs: res.elapsedMs, httpStatus: res.status };

  const hits = (res.data?.hits?.hits ?? []) as any[];
  const fetchedAt = Date.now();
  const records: RawRecord[] = hits
    .filter((h) => h.metadata?.title)
    .map((h) => {
      const m = h.metadata ?? {};
      const doi = h.doi || m.doi || undefined;
      const pdf = (h.files ?? []).find((f: any) => /pdf$/i.test(String(f.key ?? '')))?.links?.self;
      const pubType = String(m.resource_type?.type ?? '');
      return {
        source: 'zenodo' as const,
        sourceName: SOURCE_NAME,
        fetchedAt,
        title: String(m.title),
        authors: (m.creators ?? []).map((c: any) => c?.name).filter(Boolean).slice(0, 25),
        year: m.publication_date ? Number(String(m.publication_date).slice(0, 4)) || undefined : undefined,
        venue: m.journal?.title || `${SOURCE_NAME} 开放科学仓库`,
        venueType: 'repository' as const,
        abstract: (m.description ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() || undefined,
        doi,
        url: h.links?.self_html || h.links?.latest_html || (doi ? `https://doi.org/${doi}` : undefined),
        pdfUrl: pdf || undefined,
        type: /preprint|workingpaper/i.test(pubType) ? 'preprint' : 'other',
        openAccess: h.metadata?.access_right === 'open' ? true : undefined,
        nativeId: String(h.id ?? ''),
      };
    });
  return { records, elapsedMs: res.elapsedMs, httpStatus: res.status };
};
