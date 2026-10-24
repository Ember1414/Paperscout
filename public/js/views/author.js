// @ts-check
import { apiGet } from '../api.js';
import { icon } from '../icons.js';

/**
 * /a/:id 作者页（REBUILD_PLAN 5.12.1 / M4-01~03）
 * 身份卡（h-index/机构/年份范围/主题分布）+ 产出时间线 + Top10 + 合作者 Top10 + 订阅按钮
 */

/** @param {string | undefined} s */
const esc = (s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/**
 * @param {import('../router.js').ViewCtx} ctx
 */
export function render(ctx) {
  const id = decodeURIComponent(ctx.params.id ?? '');
  return `
    <div class="js-author" data-id="${esc(id)}">
      <nav aria-label="面包屑" style="font-size:var(--t-xs);color:var(--fg-3);margin-bottom:var(--s-3)">
        <a href="/" data-link>首页</a> › <span>作者</span>
      </nav>
      <div class="js-author-body"><div class="skeleton" style="height:32px;width:40%;margin-bottom:16px"></div><div class="skeleton" style="height:80px"></div></div>
    </div>`;
}

/**
 * @param {HTMLElement} root
 * @param {import('../router.js').ViewCtx} ctx
 */
export function mount(root, ctx) {
  const body = /** @type {HTMLElement} */ (root.querySelector('.js-author-body'));
  const id = decodeURIComponent(ctx.params.id ?? '');
  const ctrl = new AbortController();
  apiGet('/api/author', { id }, { signal: ctrl.signal })
    .then((d) => { body.innerHTML = detailHtml(d); bindSub(body, 'author', id, d.displayName); })
    .catch((e) => {
      if (e?.name === 'AbortError') return;
      body.innerHTML = `<div class="empty-state" role="alert"><h1>${e?.code === 'NOT_FOUND' ? '404 · 没有找到该作者' : '加载失败'}</h1><p>${esc(e?.message ?? '')}</p><p><a class="btn" href="/" data-link>去检索</a></p></div>`;
    });
  return { destroy() { ctrl.abort(); } };
}

/**
 * @param {any} d
 * @returns {string}
 */
function detailHtml(d) {
  const age = d.firstYear && d.lastYear ? `${d.firstYear}–${d.lastYear}` : '';
  const topicBars = (d.topics ?? []).map((/** @type {any} */ t) => {
    const max = Math.max(...d.topics.map((/** @type {any} */ x) => x.count), 1);
    return `<div style="margin:4px 0"><span style="font-size:var(--t-xs);color:var(--fg-2)">${esc(t.name)}</span><div style="height:6px;background:var(--accent-soft);border-radius:3px;margin-top:2px"><div style="height:6px;background:var(--accent);border-radius:3px;width:${Math.round((t.count / max) * 100)}%"></div></div></div>`;
  }).join('');
  const topWorks = (d.topWorks ?? []).map((/** @type {any} */ w) => `
    <li style="margin:var(--s-2) 0;font-size:var(--t-sm)">
      <a class="paper-title" href="/p/${encodeURIComponent(w.id)}" data-link>${esc(w.title)}</a>
      <span style="color:var(--fg-3)"> — ${esc(w.venue ?? '')}${w.year ? ` ${w.year}` : ''} · 被引 ${w.citations ?? 0}</span>
    </li>`).join('');
  const coAuthors = (d.coAuthors ?? []).map((/** @type {any} */ c) => `<a class="badge" href="/a/${esc(c.id)}" data-link style="margin:2px">${esc(c.name)} (${c.worksCount})</a>`).join(' ');
  const stats = [
    ['h-index', d.hIndex ?? '—'], ['i10-index', d.i10Index ?? '—'],
    ['作品数', d.worksCount?.toLocaleString() ?? '—'], ['总被引', d.citedByCount?.toLocaleString() ?? '—'],
  ];
  return `
    <h1 class="paper-title" style="font-size:var(--t-xl)">${esc(d.displayName)}</h1>
    ${d.lastKnownInstitution ? `<p style="color:var(--fg-2);font-size:var(--t-sm)">${esc(d.lastKnownInstitution)}${age ? ` · ${age}` : ''}</p>` : ''}
    ${d.orcid ? `<p style="font-size:var(--t-xs)"><a href="https://orcid.org/${esc(d.orcid.replace('https://orcid.org/', ''))}" target="_blank" rel="noopener">ORCID</a></p>` : ''}

    <div class="notice-bar" style="background:var(--surface-2);border:1px solid var(--line);color:var(--fg-2);margin:var(--s-3) 0;flex-wrap:wrap;gap:16px">
      ${stats.map(([k, v]) => `<span><span class="num" style="font-weight:600">${esc(String(v))}</span> <span style="font-size:var(--t-xs);color:var(--fg-3)">${k}</span></span>`).join('')}
      <span style="font-size:var(--t-xs);color:var(--fg-3)">被引数据：OpenAlex</span>
    </div>

    ${d.primaryTopic ? `<p style="font-size:var(--t-sm);color:var(--fg-3)">主要研究主题：${esc(d.primaryTopic)}</p>` : ''}
    ${topicBars ? `<div style="max-width:400px">${topicBars}</div>` : ''}

    <div style="margin:var(--s-3) 0;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <button type="button" class="btn btn-sm btn-primary js-subscribe" data-type="author" data-id="${esc(d.id)}" data-name="${esc(d.displayName)}">${icon('bell', { size: 14 })} 订阅此作者</button>
    </div>

    <section style="margin-top:var(--s-5)" aria-labelledby="prod-h">
      <h2 id="prod-h" style="font-size:var(--t-md)">产出时间线</h2>
      <div style="display:flex;align-items:flex-end;gap:3px;height:80px;flex-wrap:nowrap;overflow-x:auto">
        ${(d.productivityByYear ?? []).map((/** @type {any[]} */ r) => {
          const max = Math.max(...d.productivityByYear.map((/** @type {any[]} */ x) => x[1]), 1);
          return `<div style="min-width:22px;text-align:center" title="${r[0]}：${r[1]} 篇"><div style="background:var(--info);height:${Math.max(2, Math.round((r[1] / max) * 70))}px;border-radius:2px 2px 0 0;margin:0 auto;width:70%"></div><div style="font-size:10px;color:var(--fg-3)">${String(r[0]).slice(2)}</div></div>`;
        }).join('') || '<span style="color:var(--fg-3)">—</span>'}
      </div>
    </section>

    <section style="margin-top:var(--s-5)" aria-labelledby="top-h">
      <h2 id="top-h" style="font-size:var(--t-md)">高被引 Top 10</h2>
      ${topWorks ? `<ol class="ref-list">${topWorks}</ol>` : '<p style="color:var(--fg-3);font-size:var(--t-sm)">—</p>'}
    </section>

    <section style="margin-top:var(--s-5)" aria-labelledby="co-h">
      <h2 id="co-h" style="font-size:var(--t-md)">合作者 Top 10</h2>
      ${coAuthors || '<p style="color:var(--fg-3);font-size:var(--t-sm)">—</p>'}
    </section>

    <p style="margin-top:var(--s-6);font-size:var(--t-xs);color:var(--fg-3)">数据来源：OpenAlex authors API · ${new Date().toISOString().slice(0, 10)} · 引文元数据版权归原数据库</p>`;
}

/** 订阅按钮（M4-07：localStorage 本地存储；M7 接通知中心） */
/**
 * @param {HTMLElement} body
 * @param {string} type
 * @param {string} id
 * @param {string} name
 */
function bindSub(body, type, id, name) {
  body.querySelector('.js-subscribe')?.addEventListener('click', () => {
    try {
      const raw = /** @type {string | null} */ (localStorage.getItem('ps-subs'));
      const subs = raw ? JSON.parse(raw) : [];
      if (subs.some((/** @type {any} */ s) => s.id === id)) { showToast('已订阅'); return; }
      subs.push({ type, id, name, ts: Date.now() });
      localStorage.setItem('ps-subs', JSON.stringify(subs.slice(-50)));
      showToast(`已订阅「${name}」`);
    } catch { showToast('订阅失败（浏览器限制）'); }
  });
}

import { showToast } from '../ui/toast.js';

/** @type {import('../router.js').View} */
export default { render, mount };
