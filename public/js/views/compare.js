// @ts-check
import { apiGet } from '../api.js';
import { workApi } from '../api.js';

/**
 * /compare?ids=doi:…,doi:…（M5-09）：≤ 4 篇对比矩阵，URL 可分享
 */

/** @param {string | undefined} s */
const esc = (s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/**
 * @param {import('../router.js').ViewCtx} ctx
 */
export function render(ctx) {
  const ids = (ctx.url.searchParams.get('ids') ?? '').split(',').filter(Boolean).slice(0, 4);
  return `<div class="js-compare"><div class="skeleton" style="height:200px"></div></div><!--${esc(JSON.stringify(ids))}--><span class="js-compare-ids" hidden>${esc(JSON.stringify(ids))}</span>`;
}

/**
 * @param {HTMLElement} root
 * @param {import('../router.js').ViewCtx} ctx
 */
export function mount(root, ctx) {
  const body = /** @type {HTMLElement} */ (root.querySelector('.js-compare'));
  const idsEl = /** @type {HTMLElement} */ (root.querySelector('.js-compare-ids'));
  const ids = /** @type {string[]} */ (JSON.parse(idsEl?.textContent ?? '[]'));
  if (!ids.length) {
    body.innerHTML = '<div class="empty-state"><h1>对比</h1><p>从检索结果勾选论文后点击"对比"。</p><p><a class="btn btn-primary" href="/" data-link>去检索</a></p></div>';
    return { destroy() {} };
  }

  const ctrl = new AbortController();
  Promise.all(ids.slice(0, 4).map((/** @type {string} */ id) => workApi(id, { signal: ctrl.signal }).catch(() => null)))
    .then((results) => {
      const works = /** @type {any[]} */ (results.filter(Boolean));
      if (!works.length) { body.innerHTML = '<div class="empty-state">无法加载所选论文</div>'; return; }
      body.innerHTML = matrixHtml(works);
    })
    .catch(() => { body.innerHTML = '<div class="empty-state">加载失败</div>'; });

  return { destroy() { ctrl.abort(); } };
}

/** @param {any[]} works */
function matrixHtml(works) {
  const fields = /** @type {[string, (w: any) => string][]} */ ([
    ['年份', (/** @type {any} */ w) => String(w.year ?? '—')],
    ['类型', (/** @type {any} */ w) => w.type ?? '—'],
    ['venue', (/** @type {any} */ w) => w.venue ?? '—'],
    ['被引', (/** @type {any} */ w) => String(w.citations ?? '—')],
    ['OA', (/** @type {any} */ w) => w.openAccess ? '✓' : '—'],
    ['DOI', (/** @type {any} */ w) => w.doi ? `<code>${esc(w.doi)}</code>` : '—'],
    ['置信度', (/** @type {any} */ w) => w.confidence ?? '—'],
  ]);
  return `
    <h1 style="font-size:var(--t-lg)">对比（${works.length} 篇 / 最多 4 篇）</h1>
    <div style="overflow-x:auto">
      <table class="data-table">
        <thead><tr><th></th>${works.map((w) => `<th style="min-width:180px"><a class="paper-title" href="/p/${encodeURIComponent(w.id)}" data-link style="font-size:var(--t-sm)">${esc(w.title.slice(0, 60))}</a></th>`).join('')}</tr></thead>
        <tbody>
          ${fields.map(([label, fn]) => `<tr><td style="font-weight:600;white-space:nowrap">${label}</td>${works.map((w) => `<td>${fn(w)}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p style="margin-top:var(--s-3);font-size:var(--t-xs);color:var(--fg-3)">URL 可分享（ids 参数），刷新不丢。</p>`;
}

/** @type {import('../router.js').View} */
export default { render, mount };
