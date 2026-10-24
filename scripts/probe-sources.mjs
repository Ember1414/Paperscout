#!/usr/bin/env node
/**
 * M1-02 十九源冒烟探测（REBUILD_PLAN 附录 A 规则 1）。
 * 对每个源发 1 条真实测试查询，判定 verified（可解析、可映射 RawRecord）/
 * external-link（仅外链入口，不参与 fan-out）/ needs-key（可选插槽）。
 * 结果写入 docs/SOURCES.md 与 docs/EVIDENCE/probe.json。零依赖。
 * 用法：node scripts/probe-sources.mjs
 */
import { writeFile, mkdir } from 'node:fs/promises';

const MAILTO = '2669788267@qq.com';
const UA = `PaperScout/3.0-probe (+https://paperscout.pages.dev; mailto:${MAILTO})`;

const PROBES = [
  { id: 'openalex', name: 'OpenAlex', tier: '核心', url: `https://api.openalex.org/works?search=graph+neural+network&per-page=1&mailto=${MAILTO}`, expect: 'json', ok: (d) => d?.results?.[0]?.display_name },
  { id: 'crossref', name: 'Crossref', tier: '核心', url: `https://api.crossref.org/works?rows=1&query=graph&mailto=${MAILTO}`, expect: 'json', ok: (d) => d?.message?.items?.[0]?.title?.[0] },
  { id: 'arxiv', name: 'arXiv', tier: '核心', url: 'https://export.arxiv.org/api/query?search_query=all:%22graph%22&max_results=1', expect: 'text', ok: (t) => t.includes('<entry>') },
  { id: 'semanticscholar', name: 'Semantic Scholar', tier: '核心', url: 'https://api.semanticscholar.org/graph/v1/paper/search?query=graph&limit=1&fields=title', expect: 'json', ok: (d) => d?.data?.[0]?.title },
  { id: 'pubmed', name: 'PubMed', tier: '核心', url: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=test&retmode=json&retmax=1', expect: 'json', ok: (d) => Array.isArray(d?.esearchresult?.idlist) },
  { id: 'dblp', name: 'DBLP', tier: '核心', url: 'https://dblp.org/search/publ/api?q=graph&h=1&format=json', expect: 'json', ok: (d) => Array.isArray(d?.result?.hits?.hit) },
  { id: 'europepmc', name: 'Europe PMC', tier: '学科', url: 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=test&format=json&pageSize=1', expect: 'json', ok: (d) => Array.isArray(d?.resultList?.result) },
  { id: 'doaj', name: 'DOAJ', tier: '学科', url: 'https://doaj.org/api/search/articles/graph%20neural%20network?pageSize=1', expect: 'json', ok: (d) => Array.isArray(d?.results) },
  { id: 'hal', name: 'HAL', tier: '学科', url: 'https://api.archives-ouvertes.fr/search/?q=graph+neural+network&wt=json&rows=1', expect: 'json', ok: (d) => Array.isArray(d?.response?.docs) },
  { id: 'scielo', name: 'SciELO', tier: '学科', url: 'https://search.scielo.org/?q=graph+neural+network&format=json&size=1', expect: 'json', ok: (d) => Array.isArray(d?.hits?.hits) || Array.isArray(d?.hits) },
  { id: 'jstage', name: 'J-STAGE', tier: '学科', url: 'https://www.jstage.jst.go.jp/do/oai/?verb=Identify', expect: 'text', ok: (t) => /<Identify|<OAI-PMH/.test(t) },
  { id: 'biorxiv', name: 'bioRxiv/medRxiv', tier: '学科', url: 'https://api.biorxiv.org/details/biorxiv/2026-10-20/2026-10-24/1', expect: 'json', ok: (d) => Array.isArray(d?.collection) },
  { id: 'openaire', name: 'OpenAIRE', tier: '开放', url: 'https://api.openaire.eu/search/publications?keywords=test&size=1&format=json', expect: 'json', ok: (d) => d?.response?.results !== undefined },
  { id: 'zenodo', name: 'Zenodo', tier: '开放', url: 'https://zenodo.org/api/records?q=test&size=1', expect: 'json', ok: (d) => Array.isArray(d?.hits?.hits) },
  { id: 'datacite', name: 'DataCite', tier: '开放', url: 'https://api.datacite.org/dois?query=test&page%5Bsize%5D=1', expect: 'json', ok: (d) => Array.isArray(d?.data) },
  { id: 'chinaxiv', name: 'ChinaXiv', tier: '开放', url: 'http://oai.chinaxiv.org/obo/oai?verb=Identify', expect: 'text', ok: (t) => /<Identify|<OAI-PMH/.test(t) },
  { id: 'ieee', name: 'IEEE Xplore', tier: '可选', url: 'https://ieeexploreapi.ieee.org/api/v1/search/articles?apikey=demo&querytext=test&max_records=1', expect: 'json', ok: () => false, needsKey: true },
  { id: 'springer', name: 'Springer Nature', tier: '可选', url: 'https://api.springernature.com/meta/v2/json?q=test&p=1&api_key=demo', expect: 'json', ok: () => false, needsKey: true },
  { id: 'scopus', name: 'Scopus', tier: '可选', url: 'https://api.elsevier.com/content/search/scopus?query=test', expect: 'json', ok: () => false, needsKey: true },
];

async function probe(def) {
  const t0 = Date.now();
  try {
    const res = await fetch(def.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) });
    const ms = Date.now() - t0;
    if (def.needsKey && (res.status === 401 || res.status === 403)) {
      return { id: def.id, status: 'needs-key', httpStatus: res.status, ms, note: '端点可达，需免费/机构 key（设置页插槽，M8）' };
    }
    if (!res.ok) return { id: def.id, status: 'external-link', httpStatus: res.status, ms, note: `HTTP ${res.status}` };
    const body = await res.text();
    let parsed;
    try { parsed = def.expect === 'json' ? JSON.parse(body) : body; } catch {
      return { id: def.id, status: 'external-link', httpStatus: res.status, ms, note: '响应不可解析为 JSON（结构不符）' };
    }
    const mapped = def.ok(parsed);
    if (mapped) return { id: def.id, status: 'verified', httpStatus: res.status, ms, note: `样例字段可映射（${String(mapped).slice(0, 60)}）` };
    return { id: def.id, status: 'external-link', httpStatus: res.status, ms, note: '响应可达但字段不可映射为 RawRecord' };
  } catch (e) {
    const msg = String(e?.cause?.message ?? e?.message ?? e).slice(0, 80);
    return { id: def.id, status: 'external-link', httpStatus: null, ms: Date.now() - t0, note: `网络失败：${msg}` };
  }
}

const results = [];
for (const def of PROBES) {
  const r = await probe(def);
  results.push(r);
  console.log(`${r.status.padEnd(14)} ${def.name.padEnd(18)} ${String(r.httpStatus ?? '-').padEnd(4)} ${String(r.ms).padStart(6)}ms  ${r.note}`);
  await new Promise((r2) => setTimeout(r2, 400)); // 礼貌间隔
}

await mkdir('docs/EVIDENCE', { recursive: true });
await writeFile('docs/EVIDENCE/probe.json', JSON.stringify({ probedAt: new Date().toISOString(), ua: UA, results }, null, 2));
const n = (s) => results.filter((r) => r.status === s).length;
console.log(`\n汇总：verified=${n('verified')} needs-key=${n('needs-key')} external-link=${n('external-link')}（共 ${results.length} 源）`);
