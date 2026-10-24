import { AppError } from '../errors';
import { fetchUpstream } from '../infra/http';
import { CONTACT_EMAIL } from '../config';

/**
 * 期刊/会议页服务（REBUILD_PLAN 5.12.3 / M4-05）：
 * OpenAlex sources endpoint：年发文量/被引/Top 主题（近 12 月）/高被引 5 篇。
 * "投稿参考"主题 Top5 标注为"统计推断，非编辑部口径"。
 */

const MAILTO = `mailto=${CONTACT_EMAIL}`;

export interface VenueDetail {
  id: string;
  displayName: string;
  issn?: string;
  publisher?: string;
  type?: string;
  isOpenAccess: boolean;
  worksCount: number;
  citedByCount: number;
  hIndex?: number;
  firstYear?: number;
  lastYear?: number;
  worksByYear: [number, number][];
  topics: { name: string; count: number }[];
  topPapers: { id: string; doi?: string; title: string; year?: number; citations?: number }[];
}

/** @param {string} venueId S123… */
export async function getVenueDetail(venueId: string): Promise<VenueDetail> {
  const clean = venueId.trim();
  if (!/^S\d+$/.test(clean)) throw new AppError('BAD_PARAM', '期刊 id 格式不合法（应为 S123…）');

  const res = await fetchUpstream<any>(`https://api.openalex.org/sources/${clean}?${MAILTO}`, { source: 'OpenAlex' });
  if (!res.ok) {
    if (res.status === 404) throw new AppError('NOT_FOUND', '没有找到该期刊/会议');
    throw new AppError('UPSTREAM_TIMEOUT', '期刊数据源暂时不可用', { retryable: true });
  }
  const a = res.data;
  const worksByYear = (a.works_by_year ?? []) as [number, number][];
  const years = worksByYear.map((x) => x[0]).filter(Boolean);

  // 该刊高被引 5 篇
  let topPapers: VenueDetail['topPapers'] = [];
  try {
    const wp = await fetchUpstream<any>(
      `https://api.openalex.org/works?filter=primary_location.source.id:${clean}&sort=cited_by_count:desc&per-page=5&${MAILTO}`,
      { source: 'OpenAlex', timeoutMs: 8000 },
    );
    if (wp.ok) {
      topPapers = ((wp.data?.results ?? []) as any[]).map((w) => ({
        id: String(w.doi ?? '').replace(/^https?:\/\/doi\.org\//i, 'doi:') || w.id?.split('/').pop() || '',
        doi: String(w.doi ?? '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase() || undefined,
        title: String(w.display_name ?? ''),
        year: w.publication_year ?? undefined,
        citations: w.cited_by_count ?? 0,
      }));
    }
  } catch (e) {
    // Top papers 是增强层，失败不影响主内容，留痕
    console.warn('venue:top-papers-failed', e instanceof Error ? e.message : String(e));
  }

  return {
    id: a.id?.split('/').pop() ?? clean,
    displayName: String(a.display_name ?? ''),
    issn: Array.isArray(a.issn) ? a.issn[0] : a.issn_l || a.issn || undefined,
    publisher: a.host_organization_name || a.parent_organization?.[0]?.display_name || undefined,
    type: a.type || undefined,
    isOpenAccess: a.is_oa === true,
    worksCount: a.works_count ?? 0,
    citedByCount: a.cited_by_count ?? 0,
    hIndex: a.summary_stats?.h_index,
    firstYear: years.length ? Math.min(...years) : undefined,
    lastYear: years.length ? Math.max(...years) : undefined,
    worksByYear,
    topics: (a.topics ?? []).slice(0, 6).map((t: any) => ({ name: String(t.display_name ?? ''), count: t.count ?? 0 })),
    topPapers,
  };
}
