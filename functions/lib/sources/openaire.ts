import type { Paper, SearchParams, SourceAdapter } from '../types';
import { fetchWithRetry } from '../http';

/**
 * OpenAIRE 数据源 —— 欧盟科研基础设施，聚合欧洲各国基金资助的 2 亿+ 出版物与数据集
 * API: https://api.openaire.eu/ (免费，无需密钥)
 */

const SOURCE_NAME = 'OpenAIRE';

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/** 提取 XML 块中指定标签的文本（含 classid 属性匹配） */
function pickXml(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`));
  return m ? stripTags(m[0]) : '';
}

export const openaire: SourceAdapter = {
  id: 'openaire',
  name: SOURCE_NAME,

  async search(params: SearchParams): Promise<Paper[]> {
    if (!params.query) return [];

    const sp = new URLSearchParams({
      keywords: params.query,
      size: String(Math.min(params.limit, 30)),
      page: String(params.page),
      format: 'xml',
    });

    const res = await fetchWithRetry(`https://api.openaire.eu/search/publications?${sp}`, undefined, 2);
    if (!res.ok) throw new Error(`OpenAIRE HTTP ${res.status}`);

    const xml = await res.text();
    const blocks = xml.split('<oaf:result>').slice(1).map((b) => b.split('</oaf:result>')[0]);

    let papers: Paper[] = blocks
      .map((b): Paper => {
        // 原文链接：取第一个 webresource url
        const urlMatch = b.match(/<webresource>[\s\S]*?<url>([\s\S]*?)<\/url>/);
        const url = urlMatch ? stripTags(urlMatch[1]) : '';
        const doiMatch = b.match(/<pid classid="doi"[^>]*>([\s\S]*?)<\/pid>/);
        const doi = doiMatch ? stripTags(doiMatch[1]).replace(/^doi:/, '') : undefined;

        const authors: string[] = [];
        const creatorRe = /<creator>[\s\S]*?<\/creator>/g;
        let cm: RegExpExecArray | null;
        while ((cm = creatorRe.exec(b)) !== null && authors.length < 12) {
          authors.push(stripTags(cm[0]));
        }

        const date = pickXml(b, 'dateofacceptance');
        const year = date ? Number(date.slice(0, 4)) || undefined : undefined;
        const accessMatch = b.match(/<bestaccessright[^>]*classid="([^"]+)"/);

        return {
          title: pickXml(b, 'title') || '(无标题)',
          authors,
          year,
          venue: pickXml(b, 'publisher') || undefined,
          url: url || (doi ? `https://doi.org/${doi}` : ''),
          pdfUrl: url && /\.pdf(\?|$)/i.test(url) ? url : undefined,
          doi,
          type: 'other' as const,
          source: 'openaire',
          sourceName: SOURCE_NAME,
          openAccess: accessMatch?.[1] === 'OPEN',
        };
      })
      .filter((p) => p.url);

    if (params.yearFrom) papers = papers.filter((p) => !p.year || p.year >= params.yearFrom!);
    if (params.yearTo) papers = papers.filter((p) => !p.year || p.year <= params.yearTo!);

    return papers;
  },
};
