import type { SourceAdapter, SourceId } from './types';
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
import { baiduxueshu } from './sources/baiduxueshu';

/**
 * 数据源注册表 —— 11 大学术数据源，覆盖：
 * 计算机科学 / 综合学科 / 开放获取 / 生物医学 / 欧洲科研 / 开放科学仓库 / 中文文献（百度学术聚合知网·万方·维普）
 */
export const ADAPTERS: Record<SourceId, SourceAdapter> = {
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
  baiduxueshu,
};

export const VALID_SOURCES = Object.keys(ADAPTERS) as SourceId[];
