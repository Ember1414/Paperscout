// @ts-check
import { apiGet } from '../api.js';

/** /org/:id 机构页（5.12.2 / M4-04） */

/** @param {string | undefined} s */
const esc = (s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/**
 * @param {import('../router.js').ViewCtx} ctx
 */
export function render(ctx) {
  const id = decodeURIComponent(ctx.params.id ?? '');
  return `<div class="js-org" data-id="${esc(id)}"><nav style="font-size:var(--t-xs);color:var(--fg-3);margin-bottom:var(--s-3)"><a href="/" data-link>首页</a> › <span>机构</span></nav><div class="js-org-body"><div class="skeleton" style="height:32px;width:50%;margin-bottom:16px"></div><div class="skeleton" style="height:80px"></div></div></div>`;
}

/**
 * @param {HTMLElement} root
 * @param {import('../router.js').ViewCtx} ctx
 */
export function mount(root, ctx) {
  const body = /** @type {HTMLElement} */ (root.querySelector('.js-org-body'));
  const id = decodeURIComponent(ctx.params.id ?? '');
  const ctrl = new AbortController();
  apiGet('/api/org', { id }, { signal: ctrl.signal })
    .then((d) => { body.innerHTML = html(d); })
    .catch((e) => {
      if (e?.name === 'AbortError') return;
      body.innerHTML = `<div class="empty-state" role="alert"><h1>${e?.code === 'NOT_FOUND' ? '404 · 没有找到该机构' : '加载失败'}</h1><p>${esc(e?.message ?? '')}</p><p><a class="btn" href="/" data-link>去检索</a></p></div>`;
    });
  return { destroy() { ctrl.abort(); } };
}

/**
 * @param {any} d
 * @returns {string}
 */
function html(d) {
  const stats = [
    ['作品数', String(d.worksCount ?? '—')],
    ['总被引', String(d.citedByCount ?? '—')],
    ['h-index', String(d.hIndex ?? '—')],
  ].map(([k, v]) => `<span><span class="num" style="font-weight:600">${esc(v)}</span> <span style="font-size:var(--t-xs);color:var(--fg-3)">${esc(k)}</span></span>`).join('');
  const byYear = (/** @type {[number,number][]} */ (d.worksByYear ?? [])).slice(-15);
  const max = Math.max(...byYear.map((/** @type {any[]} */ r) => r[1]), 1);
  const bars = byYear.map((/** @type {any[]} */ r) => `<div style="min-width:22px;text-align:center" title="${r[0]}：${r[1]} 篇"><div style="background:var(--accent);height:${Math.max(2, Math.round((r[1] / max) * 70))}px;border-radius:2px 2px 0 0;margin:0 auto;width:70%"></div><div style="font-size:10px;color:var(--fg-3)">${String(r[0]).slice(2)}</div></div>`).join('');
  const topics = (d.topTopics ?? []).map((/** @type {any} */ t) => `<span class="chip" style="margin:2px">${esc(t.name)}</span>`).join(' ');
  return `
    <h1 class="paper-title" style="font-size:var(--t-xl)">${esc(d.displayName)}</h1>
    <p style="color:var(--fg-2);font-size:var(--t-sm)">${esc(d.country ?? '')}${d.type ? ` · ${esc(d.type)}` : ''}</p>
    <div class="notice-bar" style="background:var(--surface-2);border:1px solid var(--line);color:var(--fg-2);margin:var(--s-3) 0;gap:16px;flex-wrap:wrap">${stats}<span style="font-size:var(--t-xs);color:var(--fg-3)">OpenAlex</span></div>
    <section style="margin-top:var(--s-4)"><h2 style="font-size:var(--t-md)">年产出趋势</h2><div style="display:flex;align-items:flex-end;gap:3px;height:80px">${bars || '<span style="color:var(--fg-3)">—</span>'}</div></section>
    ${topics ? `<section style="margin-top:var(--s-4)"><h2 style="font-size:var(--t-md)">Top 主题</h2><div>${topics}</div></section>` : ''}
    <p style="margin-top:var(--s-6);font-size:var(--t-xs);color:var(--fg-3)">数据来源：OpenAlex institutions API · ${new Date().toISOString().slice(0, 10)}</p>`;
}

/** @type {import('../router.js').View} */
export default { render, mount };
