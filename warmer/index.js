/**
 * Warmer Cron Worker（REBUILD_PLAN 7.1 / M7-01）：
 * 每 60 分钟：预热热门检索 + 源健康探测。
 * KV 写 ≤ 8 key/轮（D-001）；TARGET_ORIGIN 环境变量指定源站。
 */

export default {
  async scheduled(controller, env, ctx) {
    const origin = env.TARGET_ORIGIN || 'https://paperscout.pages.dev';
    const MAILTO = 'mailto=' + (env.CONTACT_EMAIL || '2669788267@qq.com');
    const UA = 'PaperScout/3.0-warmer (+' + origin + ')';

    // 预热热门检索（5 个 KV key，≤8 上限 D-001）
    const warmQueries = ['machine learning', 'deep learning', 'large language model', 'CRISPR gene editing', 'quantum computing'];
    let ok = 0;
    for (const q of warmQueries) {
      try {
        const res = await fetch(origin + '/api/search?limit=20&q=' + encodeURIComponent(q), { headers: { 'User-Agent': UA } });
        if (res.ok) ok++;
      } catch (e) { console.warn('warmer:fetch-failed', e instanceof Error ? e.message : String(e)); }
    }

    // 源健康探测 → 写 D1（通过 origin 代理）
    const sources = [
      ['openalex', 'https://api.openalex.org/works?search=test&per-page=1&' + MAILTO],
      ['crossref', 'https://api.crossref.org/works?rows=1&' + MAILTO],
      ['arxiv', 'https://export.arxiv.org/api/query?search_query=all:test&max_results=1'],
      ['semanticscholar', 'https://api.semanticscholar.org/graph/v1/paper/search?query=test&limit=1'],
      ['pubmed', 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=test&retmode=json&retmax=1'],
    ];
    const health = [];
    for (const entry of sources) {
      try {
        const res = await fetch(entry[1], { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
        health.push({ source: entry[0], ok: res.ok ? 1 : 0, fail: res.ok ? 0 : 1, ms: Date.now() % 100000 });
      } catch {
        health.push({ source: entry[0], ok: 0, fail: 1, ms: 0 });
      }
    }

    try {
      await fetch(origin + '/api/health-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Warmer': env.WARMER_SECRET || 'warmer-secret' },
        body: JSON.stringify({ health }),
      });
    } catch (e) { console.warn('warmer:health-report-failed', e instanceof Error ? e.message : String(e)); }

    console.log(JSON.stringify({ warmer: 'ok', warmed: ok, sources: health.length }));
  },
};
