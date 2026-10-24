import { AppError } from '../errors';
import { fetchUpstream } from '../infra/http';
import { CONTACT_EMAIL } from '../config';

/**
 * 机构页服务（REBUILD_PLAN 5.12.2 / M4-04）：
 * OpenAlex institutions endpoint：产出/被引/Top 作者/Top 主题/趋势。
 */

const MAILTO = `mailto=${CONTACT_EMAIL}`;

export interface OrgDetail {
  id: string;
  displayName: string;
  country?: string;
  type?: string;
  worksCount: number;
  citedByCount: number;
  hIndex?: number;
  /** OpenAlex ror id */
  ror?: string;
  topAuthors: { id: string; name: string; worksCount: number }[];
  topTopics: { name: string; count: number }[];
  worksByYear: [number, number][];
  citesByYear: [number, number][];
}

/** @param {string} orgId I123… */
export async function getOrgDetail(orgId: string): Promise<OrgDetail> {
  const clean = orgId.trim();
  if (!/^I\d+$/.test(clean)) throw new AppError('BAD_PARAM', '机构 id 格式不合法（应为 I123…）');

  const res = await fetchUpstream<any>(`https://api.openalex.org/institutions/${clean}?${MAILTO}`, { source: 'OpenAlex' });
  if (!res.ok) {
    if (res.status === 404) throw new AppError('NOT_FOUND', '没有找到该机构');
    throw new AppError('UPSTREAM_TIMEOUT', '机构数据源暂时不可用', { retryable: true });
  }
  const a = res.data;
  const worksByYear = (a.works_by_year ?? []) as [number, number][];
  return {
    id: a.id?.split('/').pop() ?? clean,
    displayName: String(a.display_name ?? ''),
    country: a.country_code || undefined,
    type: a.type || undefined,
    worksCount: a.works_count ?? 0,
    citedByCount: a.cited_by_count ?? 0,
    hIndex: a.summary_stats?.h_index,
    ror: a.ror || undefined,
    topAuthors: (a.affiliations_count ?? []).length ? [] : [], // OpenAlex 不直接返回 top authors——从 works 反查太贵，标注 "—"
    topTopics: (a.topics ?? []).slice(0, 6).map((t: any) => ({ name: String(t.display_name ?? ''), count: t.count ?? 0 })),
    worksByYear,
    citesByYear: (a.counts_by_year ?? []) as [number, number][],
  };
}
