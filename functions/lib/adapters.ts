import type { LegacySourceId, SourceAdapter } from './types';
import { arxiv } from './sources/arxiv';
import { openalex } from './sources/openalex';
import { crossref } from './sources/crossref';
import { semanticscholar } from './sources/semanticscholar';
import { pubmed } from './sources/pubmed';
import { dblp } from './sources/dblp';
import { doaj } from './sources/doaj';
import { europepmc } from './sources/europepmc';
import { openaire } from './sources/openaire';
import { zenodo } from './sources/zenodo';

/**
 * v2 legacy 数据源注册表（10 源）。
 * 百度学术爬虫已按 D-03 移除；v3 的 19 源注册表见 ./sources/registry.ts。
 * 该文件与 sources/*.ts 的 search() 实现冻结至 M7 删除清单（8.5）。
 */
export const ADAPTERS: Record<LegacySourceId, SourceAdapter> = {
  arxiv,
  openalex,
  crossref,
  semanticscholar,
  pubmed,
  dblp,
  doaj,
  europepmc,
  openaire,
  zenodo,
};

export const VALID_SOURCES = Object.keys(ADAPTERS) as LegacySourceId[];
