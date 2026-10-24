import type { FetchRawFn, SourceCaps, SourceDef, SourceId } from '../types';
import { fetchRaw as openalex } from './openalex';
import { fetchRaw as crossref } from './crossref';
import { fetchRaw as arxiv } from './arxiv';
import { fetchRaw as semanticscholar } from './semanticscholar';
import { fetchRaw as pubmed } from './pubmed';
import { fetchRaw as dblp } from './dblp';

/**
 * v3 数据源注册表（附录 A：19 源，四档）。
 * 规则：
 * 1. probe !== 'verified' 的源不得进入 fan-out（M1-02 冒烟探测后更新状态）
 * 2. 单次检索实际调用 ≤ MAX_ACTIVE_SOURCES（9），按 核心→学科→开放 截断
 * 3. 能力声明决定编排器是否调用，不做无效请求
 * probe 状态由 scripts/probe-sources.mjs 实测维护（docs/SOURCES.md 同步）。
 */

const caps = (o: Partial<SourceCaps>): SourceCaps => ({
  yearFilter: false,
  typeFilter: false,
  author: false,
  abstract: false,
  citations: false,
  pdf: false,
  zhCoverage: 'none',
  phrase: false,
  ...o,
});

export const SOURCES: Record<SourceId, SourceDef> = {
  /* ---------- 核心档（6） ---------- */
  openalex: {
    id: 'openalex', name: 'OpenAlex', tier: 'core', mode: 'keyword', fetchRaw: openalex, probe: 'verified',
    caps: caps({ yearFilter: 'native', typeFilter: true, author: true, abstract: true, citations: true, pdf: true, zhCoverage: 'strong', phrase: true }),
  },
  crossref: {
    id: 'crossref', name: 'Crossref', tier: 'core', mode: 'keyword', fetchRaw: crossref, probe: 'verified',
    caps: caps({ yearFilter: 'native', typeFilter: true, author: true, abstract: true, citations: true, pdf: true, zhCoverage: 'medium', phrase: true }),
  },
  arxiv: {
    id: 'arxiv', name: 'arXiv', tier: 'core', mode: 'keyword', fetchRaw: arxiv, probe: 'verified',
    caps: caps({ yearFilter: 'native', author: true, abstract: true, pdf: true, phrase: true }),
  },
  semanticscholar: {
    id: 'semanticscholar', name: 'Semantic Scholar', tier: 'core', mode: 'keyword', fetchRaw: semanticscholar,
    // M1-02：API 可映射但共享出口 429 高发——重试 1 次 + 编排器超时预算 + 降级兜底（风险 R-01）
    probe: 'verified',
    caps: caps({ yearFilter: 'native', author: true, abstract: true, citations: true, pdf: true, zhCoverage: 'weak' }),
  },
  pubmed: {
    id: 'pubmed', name: 'PubMed', tier: 'core', mode: 'keyword', fetchRaw: pubmed, probe: 'verified',
    // 摘要能力冻结为 false：esummary 不含摘要，补摘要需第三次 efetch 调用（DECISIONS D-010）
    caps: caps({ yearFilter: 'native', author: true }),
  },
  dblp: {
    id: 'dblp', name: 'DBLP', tier: 'core', mode: 'keyword', fetchRaw: dblp,
    // M1-02 实测：DBLP 部署 Anubis 反爬（202 + HTML 封锁页），数据中心/CF 出口被持续封锁 → 不参与 fan-out（附录 A 规则 1）；M7 Warmer 每日复测，恢复后自动翻转
    probe: 'external-link',
    caps: caps({ yearFilter: 'client', author: true }),
  },

  /* ---------- 学科档（6）---------- */
  europepmc: {
    id: 'europepmc', name: 'Europe PMC', tier: 'subject', mode: 'keyword', probe: 'verified', // 探测通过；M1-03 接入 fetchRaw
    caps: caps({ yearFilter: 'native', typeFilter: true, author: true, abstract: true, citations: true, pdf: true }),
  },
  doaj: {
    id: 'doaj', name: 'DOAJ', tier: 'subject', mode: 'keyword', probe: 'verified', // 探测通过；M1-03 接入 fetchRaw
    caps: caps({ yearFilter: 'native', typeFilter: true, author: true, abstract: true, pdf: true, zhCoverage: 'medium', phrase: true }),
  },
  hal: {
    id: 'hal', name: 'HAL', tier: 'subject', mode: 'keyword', probe: 'verified', // M1-02 探测通过
    caps: caps({ yearFilter: 'native', author: true, abstract: true, pdf: true }),
  },
  scielo: {
    id: 'scielo', name: 'SciELO', tier: 'subject', mode: 'keyword',
    probe: 'external-link', // M1-02：搜索 403（bot 防护）、OAI 404 → 仅外链
    caps: caps({ yearFilter: 'native', author: true, abstract: true, pdf: true, zhCoverage: 'none' }),
  },
  jstage: {
    id: 'jstage', name: 'J-STAGE', tier: 'subject', mode: 'keyword',
    probe: 'external-link', // M1-02：连接超时（两轮），不可达 → 仅外链
    caps: caps({ author: true, abstract: true }),
  },
  biorxiv: {
    id: 'biorxiv', name: 'bioRxiv/medRxiv', tier: 'subject', mode: 'recent', probe: 'verified', // M1-02 探测通过
    // 仅"最新前沿"按日期区间，不参与关键词检索（附录 A）
    caps: caps({ yearFilter: 'native', abstract: true, pdf: true }),
  },

  /* ---------- 开放档（4）---------- */
  openaire: {
    id: 'openaire', name: 'OpenAIRE', tier: 'open', mode: 'keyword', probe: 'verified', // 探测通过；M1-03 接入 fetchRaw
    caps: caps({ yearFilter: 'client', author: true, abstract: true }),
  },
  zenodo: {
    id: 'zenodo', name: 'Zenodo', tier: 'open', mode: 'keyword', probe: 'verified', // 探测通过；M1-03 接入 fetchRaw
    caps: caps({ yearFilter: 'native', author: true, abstract: true, pdf: true, zhCoverage: 'weak' }),
  },
  datacite: {
    id: 'datacite', name: 'DataCite', tier: 'open', mode: 'keyword', probe: 'verified', // M1-02 探测通过
    caps: caps({ yearFilter: 'native', author: true, pdf: true }),
  },
  chinaxiv: {
    id: 'chinaxiv', name: 'ChinaXiv', tier: 'open', mode: 'keyword',
    probe: 'external-link', // M1-02：OAI 端点 DNS 失效，主站可达但无公开结构化检索 API → 仅外链；中文通道 = OpenAlex/Crossref/DOAJ（5.10）
    caps: caps({ yearFilter: 'native', author: true, abstract: true, pdf: true, zhCoverage: 'strong' }),
  },

  /* ---------- 可选插槽（3，需 key，默认关）---------- */
  ieee: {
    id: 'ieee', name: 'IEEE Xplore', tier: 'optional', mode: 'keyword', probe: 'needs-key',
    caps: caps({ yearFilter: 'native', typeFilter: true, author: true, abstract: true, citations: true, pdf: true }),
  },
  springer: {
    id: 'springer', name: 'Springer Nature', tier: 'optional', mode: 'keyword', probe: 'needs-key',
    caps: caps({ yearFilter: 'native', typeFilter: true, author: true, abstract: true, citations: true, pdf: true }),
  },
  scopus: {
    id: 'scopus', name: 'Scopus', tier: 'optional', mode: 'keyword', probe: 'needs-key',
    caps: caps({ yearFilter: 'native', typeFilter: true, author: true, abstract: true, citations: true, pdf: true }),
  },
};

/** 核心档默认参与检索的源（v2 契约兼容：/api/sources 返回 legacy 集合，v3 用此表） */
export const DEFAULT_CORE_SOURCES: SourceId[] = ['openalex', 'crossref', 'arxiv', 'semanticscholar', 'pubmed', 'dblp'];

export function getSource(id: SourceId): SourceDef | undefined {
  return SOURCES[id];
}

/** 可参与 fan-out 的源（探测通过且已接入 adapter；optional 档需用户显式给 key，M8 前不进默认集） */
export function activeSources(ids: SourceId[]): SourceDef[] {
  return ids
    .map((id) => SOURCES[id])
    .filter((s): s is SourceDef & { fetchRaw: FetchRawFn } => Boolean(s) && s.probe === 'verified' && typeof s.fetchRaw === 'function');
}

/** 按档位截断到 maxActive：核心 → 学科 → 开放（附录 A 规则 2），optional 不自动参与 */
export function truncateByTier(defs: SourceDef[], maxActive: number): { selected: SourceDef[]; dropped: SourceDef[] } {
  const order: SourceDef['tier'][] = ['core', 'subject', 'open'];
  const sorted = [...defs].sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier));
  return { selected: sorted.slice(0, maxActive), dropped: sorted.slice(maxActive) };
}
