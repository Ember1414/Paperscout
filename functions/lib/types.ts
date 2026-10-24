/**
 * PaperScout 共享类型定义
 */

/** 论文类型 */
export type PaperType = 'journal' | 'conference' | 'preprint' | 'other';

/** 统一的论文检索结果 */
export interface Paper {
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  abstract?: string;
  /** 原文链接（点击跳转） */
  url: string;
  /** PDF 直链（可下载时提供） */
  pdfUrl?: string;
  doi?: string;
  citations?: number;
  type?: PaperType;
  source: SourceId;
  sourceName: string;
  openAccess?: boolean;
}

/** v2 legacy 仍在使用的源（百度源按 D-03 移除） */
export type LegacySourceId =
  | 'arxiv'
  | 'openalex'
  | 'crossref'
  | 'semanticscholar'
  | 'pubmed'
  | 'dblp'
  | 'doaj'
  | 'europepmc'
  | 'openaire'
  | 'zenodo';

export type SourceId = LegacySourceId
  // v3 新增源（附录 A 19 源；legacy 检索不使用，仅 registry/编排器使用）
  | 'hal'
  | 'scielo'
  | 'jstage'
  | 'biorxiv'
  | 'datacite'
  | 'chinaxiv'
  | 'ieee'
  | 'springer'
  | 'scopus';

/** 语言筛选 */
export type LanguageFilter = 'all' | 'zh' | 'en';

/** 文献类型筛选 */
export type PaperTypeFilter = 'all' | 'journal' | 'conference' | 'preprint';

/** 规范化后的检索参数 */
export interface SearchParams {
  query: string;
  author?: string;
  yearFrom?: number;
  yearTo?: number;
  sources: SourceId[];
  limit: number;
  sort: 'smart' | 'relevance' | 'newest' | 'citations';
  /** 页码（1 起），各源据此计算偏移量 */
  page: number;
  /** 语言筛选 */
  language: LanguageFilter;
  /** 文献类型筛选 */
  paperType: PaperTypeFilter;
  /** 学科领域筛选（arXiv 分类：cs / physics / math / bio / ee） */
  field?: string;
}

/** Pages Functions 环境绑定 */
export interface Env {
  CACHE: KVNamespace;
  /** Workers AI（翻译兜底 / AI 总结 / AI 问答） */
  AI?: Ai;
  /** D1 数据库（检索历史 + 收藏夹） */
  DB?: D1Database;
}

/** 单个数据源的适配器 */
export interface SourceAdapter {
  id: SourceId;
  name: string;
  search(params: SearchParams): Promise<Paper[]>;
}

/* ==================== v3 数据核心（M1 起） ==================== */

/** 各源统一返回的记录形态（上游解析结果，融合前；5.2.1 的前身） */
export interface RawRecord {
  source: SourceId;
  sourceName: string;
  fetchedAt: number;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  venueType?: 'journal' | 'conference' | 'preprint' | 'repository' | 'unknown';
  abstract?: string;
  doi?: string;
  url?: string;
  pdfUrl?: string;
  citations?: number;
  type?: PaperType;
  openAccess?: boolean;
  /** 源内主键（arXiv id / PMID / OpenAlex id / DBLP key），M3 引文与 OA 探测复用 */
  nativeId?: string;
}

/** 上游错误分类（禁止静默；fetchUpstream 永不抛异常） */
export type UpstreamErrorKind = 'http' | 'rate_limited' | 'timeout' | 'network' | 'parse';

export interface UpstreamError {
  kind: UpstreamErrorKind;
  message: string;
  status?: number;
}

/** fetchRaw 结果：异常不抛，失败时返回 { records: [], error }（M1-01 DoD） */
export interface RawFetchResult {
  records: RawRecord[];
  error?: UpstreamError;
  elapsedMs: number;
  httpStatus?: number;
}

export type FetchRawFn = (params: SearchParams, opts?: FetchRawOpts) => Promise<RawFetchResult>;

export interface FetchRawOpts {
  /** 本次召回上限（覆盖 params.limit） */
  limit?: number;
  /** 追加召回偏移量（结果池模型，5.4） */
  offset?: number;
}

/** 源能力（5.1.2 能力矩阵；编排器据此决定是否调用，不做无效请求） */
export interface SourceCaps {
  yearFilter: 'native' | 'client' | false;
  typeFilter: boolean;
  author: boolean;
  abstract: boolean;
  citations: boolean;
  pdf: boolean;
  zhCoverage: 'strong' | 'medium' | 'weak' | 'none';
  /** 支持精确短语检索 */
  phrase: boolean;
}

/** 源档次（附录 A：核心 6 / 学科 6 / 开放 4 / 可选 3） */
export type SourceTier = 'core' | 'subject' | 'open' | 'optional';

/** 冒烟探测状态（附录 A 规则 1：非 verified 不得进入 fan-out） */
export type ProbeStatus = 'verified' | 'pending' | 'external-link' | 'needs-key';

export interface SourceDef {
  id: SourceId;
  name: string;
  tier: SourceTier;
  caps: SourceCaps;
  /** keyword=常规关键词检索；recent=仅"最新前沿"按日期区间（bioRxiv） */
  mode: 'keyword' | 'recent';
  fetchRaw?: FetchRawFn;
  probe: ProbeStatus;
}
