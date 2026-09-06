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

export type SourceId =
  | 'arxiv'
  | 'openalex'
  | 'crossref'
  | 'semanticscholar'
  | 'pubmed'
  | 'dblp'
  | 'doaj'
  | 'europepmc'
  | 'openaire'
  | 'zenodo'
  | 'baiduxueshu';

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
