import { readFileSync, writeFileSync } from 'node:fs';

// ---- types.ts：FetchRawOpts 插入 querySuffix ----
{
  const p = 'functions/lib/types.ts';
  let lines = readFileSync(p, 'utf8').split(/\r?\n/);
  if (!lines.some((l) => l.includes('querySuffix'))) {
    const i = lines.findIndex((l) => l.includes('offset?: number;'));
    if (i < 0) throw new Error('types anchor not found');
    lines.splice(i + 1, 0,
      '  /** 查询扩展追加串（M2-14：仅自然语言匹配语义的源使用，openalex/crossref） */',
      '  querySuffix?: string;',
    );
    writeFileSync(p, lines.join('\n'));
  }
  console.log('types ok');
}

// ---- services/search.ts：runSearch 内 parse 行后插入扩展声明 ----
{
  const p = 'functions/lib/services/search.ts';
  let lines = readFileSync(p, 'utf8').split(/\r?\n/);
  if (!lines.some((l) => l.includes('expandQuery(params.q'))) {
    const i = lines.findIndex((l) => l.trim() === 'const parsed = parseQuery(params.q);' && lines[i - 1]?.includes('runSearch'));
    if (i < 0) {
      // 兜底：runSearch 函数体内第一个 parse 行
      const j = lines.findIndex((l, k) => k > lines.findIndex((l2) => l2.includes('export async function runSearch')) && l.trim() === 'const parsed = parseQuery(params.q);');
      if (j < 0) throw new Error('parse line not found');
      lines.splice(j + 1, 0,
        '  // M2-14 查询扩展：中英互译（打分词并入 + zh 召回后缀仅给声明支持的源）',
        '  const expansion = expandQuery(params.q, parsed.terms, parsed.cjkWhole);',
        '  const scoredParsed = expansion.scoreTerms.length ? { ...parsed, terms: [...parsed.terms, ...expansion.scoreTerms] } : parsed;',
        "  const recallSuffix = parsed.lang === 'zh' ? expansion.recallSuffix : '';",
      );
    } else {
      lines.splice(i + 1, 0,
        '  // M2-14 查询扩展：中英互译（打分词并入 + zh 召回后缀仅给声明支持的源）',
        '  const expansion = expandQuery(params.q, parsed.terms, parsed.cjkWhole);',
        '  const scoredParsed = expansion.scoreTerms.length ? { ...parsed, terms: [...parsed.terms, ...expansion.scoreTerms] } : parsed;',
        "  const recallSuffix = parsed.lang === 'zh' ? expansion.recallSuffix : '';",
      );
    }
    writeFileSync(p, lines.join('\n'));
  }
  console.log('search ok');
}
