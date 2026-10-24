// @ts-check
import { searchUrl } from '../url.js';

/**
 * /field/:slug 学科导航（REBUILD_PLAN 5.13.4 / M7-03 / M9-13）
 * 每页含：检索模板（可一键）+ 顶会/顶刊列表 + 相关热词
 */

const FIELDS = /** @type {Record<string, { label: string, queries: string[], venues: string[] }>} */ ({
  cs: { label: '计算机科学', queries: ['large language model', 'graph neural network', 'reinforcement learning', 'federated learning', 'computer vision'], venues: ['NeurIPS', 'ICML', 'ICLR', 'CVPR', 'ACL', 'SIGIR', 'KDD', 'CCS'] },
  physics: { label: '物理学', queries: ['quantum computing', 'quantum error correction', 'condensed matter', 'particle physics'], venues: ['Physical Review Letters', 'Physical Review X', 'Nature Physics'] },
  math: { label: '数学', queries: ['optimization', 'graph theory', 'probability theory', 'numerical analysis'], venues: ['Annals of Mathematics', 'Inventiones Mathematicae', 'Journal of the AMS'] },
  bio: { label: '生物医学', queries: ['CRISPR gene editing', 'single cell sequencing', 'immunotherapy', 'protein structure'], venues: ['Cell', 'Nature Biotechnology', 'Nature Methods'] },
  med: { label: '医学', queries: ['clinical trial', 'epidemiology', 'drug discovery', 'immunotherapy'], venues: ['The Lancet', 'New England Journal of Medicine', 'JAMA', 'BMJ'] },
  econ: { label: '经济学', queries: ['causal inference', 'machine learning economics', 'behavioral economics'], venues: ['American Economic Review', 'Econometrica', 'Quarterly Journal of Economics'] },
  social: { label: '社会科学', queries: ['social network analysis', 'survey methodology', 'public opinion'], venues: ['PNAS', 'Nature Human Behaviour'] },
});

/** @param {string | undefined} s */
const esc = (s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/**
 * @param {import('../router.js').ViewCtx} ctx
 */
export function render(ctx) {
  const slug = ctx.params.slug ?? '';
  const field = FIELDS[slug];
  if (!field) {
    return `<div class="empty-state"><h1>未知学科</h1><p>可用学科：${Object.keys(FIELDS).map((k) => `<a href="/field/${k}" data-link>${k}</a>`).join(' · ')}</p><p><a class="btn" href="/" data-link>回首页</a></p></div>`;
  }
  return `
    <section aria-labelledby="field-h">
      <h1 id="field-h" style="font-size:var(--t-xl)">${esc(field.label)}</h1>
      <p style="color:var(--fg-2);font-size:var(--t-sm);margin-bottom:var(--s-4)">点击检索模板立即搜索；下方为该领域常见顶刊/顶会。</p>

      <h2 style="font-size:var(--t-md)">检索模板</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">
        ${field.queries.map((/** @type {string} */ q) => `<a class="btn btn-sm" href="${searchUrl({ q })}" data-link>${esc(q)}</a>`).join('')}
      </div>

      <h2 style="font-size:var(--t-md);margin-top:var(--s-4)">顶刊 / 顶会</h2>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0">
        ${field.venues.map((/** @type {string} */ v) => `<a class="chip chip-accent" href="/search?q=${encodeURIComponent('venue:' + v)}" data-link style="font-size:var(--t-sm)">${esc(v)}</a>`).join(' ')}
      </div>

      <div class="notice-bar" style="background:var(--surface-2);border:1px solid var(--line);margin-top:var(--s-4)">
        <span style="font-size:var(--t-xs);color:var(--fg-3)">今日前沿 + 经典必读榜单由定时预热服务聚合（Warmer 每小时运行）；AI 研究现状总结在检索结果页可用。</span>
      </div>

      <p style="margin-top:var(--s-4)"><a class="btn btn-primary" href="${searchUrl({ q: field.queries[0] })}" data-link>开始检索「${esc(field.queries[0])}」</a> <a class="btn" href="/" data-link>回首页</a></p>
    </section>`;
}

/** @type {import('../router.js').View} */
export default { render };
