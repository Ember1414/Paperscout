import { AppError } from '../errors';
import { fetchUpstream } from '../infra/http';
import { CONTACT_EMAIL } from '../config';

/**
 * 正版全文探测（REBUILD_PLAN 5.11.1 / M3-02）：
 * OpenAlex OA 位置 → Unpaywall → Europe PMC（PMCID）→ 兜底三路建议。
 * 只给正版直链，不托管/不代理 PDF（N-04）。缓存 KV 24h（仅首次写，5.11.1）。
 */

export interface AvailabilityProvider {
  provider: string;
  kind: 'publisher' | 'repository' | 'preprint' | 'pmc';
  version: 'published' | 'accepted' | 'submitted' | 'unknown';
  pdfUrl?: string;
  landingUrl?: string;
}

export interface AvailabilityResult {
  doi: string;
  best: AvailabilityProvider | null;
  providers: AvailabilityProvider[];
  suggestions: { label: string; url: string }[];
  checkedAt: string;
  sources: string[];
}

/** Unpaywall version 词 → 统一枚举 */
function normVersion(v?: string): AvailabilityProvider['version'] {
  if (!v) return 'unknown';
  if (/published/i.test(v)) return 'published';
  if (/accepted/i.test(v)) return 'accepted';
  if (/submitted/i.test(v)) return 'submitted';
  return 'unknown';
}

const DOI_RE = /^10\.\d{2,}\S*$/;

/** @param {string} doi */
export async function getAvailability(doi: string, env?: { CACHE?: KVNamespace }): Promise<AvailabilityResult> {
  const clean = doi.trim().toLowerCase().replace(/^https?:\/\/doi\.org\//i, '').replace(/^doi:/, '');
  if (!DOI_RE.test(clean)) throw new AppError('BAD_PARAM', 'DOI 格式不合法');
  const cacheKey = `avail:${clean}`;

  // KV 24h（仅首次写；读失败不阻塞）
  try {
    const hitData: any = await env?.CACHE?.get(cacheKey, 'json');
    if (hitData && Array.isArray(hitData.providers)) return /** @type {AvailabilityResult} */ (hitData);
  } catch (e) {
    // KV 读失败继续探测（增强层降级），留痕
    console.warn('availability:kv-read-failed', e instanceof Error ? e.message : String(e));
  }

  /** @type {AvailabilityProvider[]} */
  const providers: AvailabilityProvider[] = [];
  /** @type {string[]} */
  const used: string[] = [];
  /** @type {any} */
  let oaWork: any = null;

  // 1. OpenAlex（best_oa_location）
  const oa = await fetchUpstream<any>(`https://api.openalex.org/works/doi:${clean}?mailto=${CONTACT_EMAIL}`, { source: 'OpenAlex', timeoutMs: 6000 });
  if (oa.ok && oa.data) {
    oaWork = oa.data;
    used.push('OpenAlex');
    const best = oaWork.best_oa_location ?? {};
    const landing = oaWork.primary_location?.landing_page_url;
    if (best?.pdf_url || landing) {
      providers.push({
        provider: 'OpenAlex',
        kind: /repository|repo/i.test(String(best?.source?.type ?? '')) ? 'repository' : 'publisher',
        version: normVersion(best?.version),
        pdfUrl: best?.pdf_url || undefined,
        landingUrl: landing || undefined,
      });
    }
  }

  // 2. Unpaywall
  const up = await fetchUpstream<any>(`https://api.unpaywall.org/v2/${clean}?email=${CONTACT_EMAIL}`, { source: 'Unpaywall', timeoutMs: 6000 });
  if (up.ok && up.data) {
    used.push('Unpaywall');
    const best = up.data.best_oa_location ?? {};
    if (best?.url_for_pdf || best?.url) {
      providers.push({
        provider: 'Unpaywall',
        kind: best?.host_type === 'repository' ? 'repository' : 'publisher',
        version: normVersion(best?.version),
        pdfUrl: best?.url_for_pdf || undefined,
        landingUrl: best?.url || undefined,
      });
    }
    for (const loc of (up.data.oa_locations ?? []).slice(0, 3)) {
      if (loc?.url_for_pdf && !providers.some((p) => p.pdfUrl === loc.url_for_pdf)) {
        providers.push({ provider: 'Unpaywall-OA', kind: loc.host_type === 'repository' ? 'repository' : 'publisher', version: normVersion(loc.version), pdfUrl: loc.url_for_pdf, landingUrl: loc.url });
      }
    }
  }

  // 3. Europe PMC（PMCID → PMC 全文）
  if (oaWork?.ids?.pmcid) {
    used.push('Europe PMC');
    providers.push({
      provider: 'Europe PMC',
      kind: 'pmc',
      version: 'published',
      pdfUrl: `https://europepmc.org/articles/${oaWork.ids.pmcid}/pdf`,
      landingUrl: `https://europepmc.org/articles/${oaWork.ids.pmcid}`,
    });
  }

  // 择优：published 版本 > accepted > submitted；publisher > repository；有 PDF > 仅落地页
  const rank = (p: AvailabilityProvider) =>
    (p.version === 'published' ? 4 : p.version === 'accepted' ? 3 : p.version === 'submitted' ? 2 : 1) +
    (p.kind === 'publisher' ? 0.5 : 0) + (p.pdfUrl ? 0.5 : 0);
  const best = [...providers].sort((a, b) => rank(b) - rank(a))[0] ?? null;

  // 三路建议（无 OA 时的出路，不是死路）
  const suggestions = buildSuggestions(clean, best === null);

  const result: AvailabilityResult = {
    doi: clean,
    best,
    providers,
    suggestions,
    checkedAt: new Date().toISOString(),
    sources: used,
  };

  // KV 24h：仅首次写（有实质结果才写，避免污染）
  if (env?.CACHE && providers.length) {
    try {
      await env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 86_400 });
    } catch (e) {
      console.warn('availability:kv-write-failed', e instanceof Error ? e.message : String(e));
    }
  }
  return result;
}

/** 三路建议：机构 DOI 解析 / 作者主页站外搜索 / 预印本站外搜索（5.11.1 第 5 条） */
function buildSuggestions(doi: string, noOa: boolean): { label: string; url: string }[] {
  const out = [
    { label: '通过 DOI 解析（机构订阅入口）', url: `https://doi.org/${doi}` },
  ];
  if (noOa) {
    out.push(
      { label: '站外搜索作者主页（Google）', url: `https://www.google.com/search?q=%22${encodeURIComponent('doi:' + doi)}%22` },
      { label: '站外搜索预印本（arXiv）', url: `https://arxiv.org/abs/${doi}`.replace(/abs\/10\.\d+\//, 'search/?query=') + '' },
    );
  }
  return out;
}
