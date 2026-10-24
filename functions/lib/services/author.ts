import { AppError } from '../errors';
import { fetchUpstream } from '../infra/http';
import { CONTACT_EMAIL } from '../config';

/**
 * 作者页服务（REBUILD_PLAN 5.12.1 / M4-01~03）：
 * 同名消歧（候选 ≤5）→ 身份卡 → 产出时间线 → Top10 → 主题分布 → 合作者。
 * 数据源：OpenAlex authors endpoint。
 */

const MAILTO = `mailto=${CONTACT_EMAIL}`;

export interface AuthorCandidate {
  id: string;
  displayName: string;
  worksCount: number;
  citedByCount: number;
  lastKnownInstitution?: string;
  orcid?: string;
}

export interface AuthorDetail {
  id: string;
  orcid?: string;
  displayName: string;
  worksCount: number;
  citedByCount: number;
  hIndex?: number;
  i10Index?: number;
  lastKnownInstitution?: string;
  institutionId?: string;
  firstYear?: number;
  lastYear?: number;
  primaryTopic?: string;
  topics: { name: string; count: number; share: number }[];
  productivityByYear: [number, number][];
  citesByYear: [number, number][];
  topWorks: { id: string; doi?: string; title: string; year?: number; venue?: string; citations?: number }[];
  coAuthors: { id: string; name: string; worksCount: number }[];
}

/** 同名消歧：author search → 候选 ≤5（F-70：不自动跳第一个） */
export async function searchAuthors(query: string): Promise<AuthorCandidate[]> {
  const res = await fetchUpstream<any>(
    `https://api.openalex.org/authors?search=${encodeURIComponent(query)}&per-page=5&sort=works_count:desc&${MAILTO}`,
    { source: 'OpenAlex', timeoutMs: 6000 },
  );
  if (!res.ok) return [];
  return ((res.data?.results ?? []) as any[]).map((a) => ({
    id: a.id?.split('/').pop() ?? '',
    displayName: String(a.display_name ?? ''),
    worksCount: a.works_count ?? 0,
    citedByCount: a.cited_by_count ?? 0,
    lastKnownInstitution: a.last_known_institutions?.[0]?.display_name || undefined,
    orcid: a.orcid || undefined,
  }));
}

/** OpenAlex author → AuthorDetail */
function mapAuthor(a: any): AuthorDetail {
  const worksByYear = (a.works_by_year ?? []) as [number, number][];
  const years = worksByYear.map((x) => x[0]).filter(Boolean);
  return {
    id: a.id?.split('/').pop() ?? '',
    orcid: a.orcid || undefined,
    displayName: String(a.display_name ?? ''),
    worksCount: a.works_count ?? 0,
    citedByCount: a.cited_by_count ?? 0,
    hIndex: a.summary_stats?.h_index,
    i10Index: a.summary_stats?.i10_index,
    lastKnownInstitution: a.last_known_institutions?.[0]?.display_name || undefined,
    institutionId: a.last_known_institutions?.[0]?.id?.split('/').pop() || undefined,
    firstYear: years.length ? Math.min(...years) : undefined,
    lastYear: years.length ? Math.max(...years) : undefined,
    primaryTopic: a.topics?.[0]?.display_name || undefined,
    topics: (a.topics ?? []).slice(0, 6).map((t: any) => ({ name: String(t.display_name ?? ''), count: t.count ?? 0, share: t.count ?? 0 })),
    productivityByYear: worksByYear,
    citesByYear: (a.counts_by_year ?? []) as [number, number][],
    topWorks: [],
    coAuthors: [],
  };
}

/** 作者详情 + Top10 作品 + 合作者 Top10 */
export async function getAuthorDetail(authorId: string): Promise<AuthorDetail> {
  const clean = authorId.trim();
  if (!/^A\d+$/.test(clean)) throw new AppError('BAD_PARAM', '作者 id 格式不合法（应为 A123…）');

  const author = await fetchUpstream<any>(`https://api.openalex.org/authors/${clean}?${MAILTO}`, { source: 'OpenAlex' });
  if (!author.ok) {
    if (author.status === 404) throw new AppError('NOT_FOUND', '没有找到该作者');
    throw new AppError('UPSTREAM_TIMEOUT', '作者数据源暂时不可用', { retryable: true });
  }
  const detail = mapAuthor(author.data);

  // Top 10 作品 + 合作者（一次取 50 篇，从中统计合作者）
  const worksRes = await fetchUpstream<any>(
    `https://api.openalex.org/works?filter=author.id:${clean}&sort=cited_by_count:desc&per-page=50&${MAILTO}`,
    { source: 'OpenAlex', timeoutMs: 8000 },
  );
  if (worksRes.ok) {
    const works = (worksRes.data?.results ?? []) as any[];
    detail.topWorks = works.slice(0, 10).map((w) => ({
      id: String(w.doi ?? '').replace(/^https?:\/\/doi\.org\//i, 'doi:') || w.id?.split('/').pop() || '',
      doi: String(w.doi ?? '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase() || undefined,
      title: String(w.display_name ?? ''),
      year: w.publication_year ?? undefined,
      venue: w.primary_location?.source?.display_name || undefined,
      citations: w.cited_by_count ?? 0,
    }));
    // 合作者统计
    const counts = new Map<string, { name: string; n: number }>();
    for (const w of works) {
      for (const a of (w.authorships ?? [])) {
        const coId = a?.author?.id?.split('/').pop();
        const coName = a?.author?.display_name;
        if (coId && coName && coId !== clean) {
          const cur = counts.get(coId);
          if (cur) cur.n++;
          else counts.set(coId, { name: coName, n: 1 });
        }
      }
    }
    detail.coAuthors = [...counts.entries()]
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, 10)
      .map(([id, v]) => ({ id, name: v.name, worksCount: v.n }));
  }

  return detail;
}
