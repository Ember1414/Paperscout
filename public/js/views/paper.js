// @ts-check
import { workApi } from '../api.js';
import { icon } from '../icons.js';
import { isTopVenueName } from '../ui/card.js';

/**
 * /p/:id 论文详情页（REBUILD_PLAN 4.3 / M3-01 骨架 + M3-02~08 逐步补齐）。
 * 刷新不丢（URL 即 id）；摘要折叠零请求；所有外部数据标注来源与抓取时间（D-12）。
 */

/** @param {string | undefined} s */
const esc = (s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/**
 * @param {import('../router.js').ViewCtx} ctx
 */
export function render(ctx) {
  const id = decodeURIComponent(ctx.params.id ?? '');
  return `
    <div class="js-paper" data-id="${esc(id)}">
      <nav class="crumbs" aria-label="面包屑" style="font-size:var(--t-xs);color:var(--fg-3);margin-bottom:var(--s-3)">
        <a href="/" data-link>首页</a> › <span>论文详情</span>
      </nav>
      <div class="js-paper-body">
        <div role="status" aria-label="加载详情中">
          <div class="skeleton" style="height:28px;width:70%;margin-bottom:12px"></div>
          <div class="skeleton" style="height:14px;width:40%;margin-bottom:20px"></div>
          <div class="skeleton" style="height:14px;margin-bottom:8px"></div>
          <div class="skeleton" style="height:14px;margin-bottom:8px"></div>
          <div class="skeleton" style="height:14px;width:80%"></div>
        </div>
      </div>
    </div>`;
}

/**
 * @param {HTMLElement} root
 * @param {import('../router.js').ViewCtx} ctx
 */
export function mount(root, ctx) {
  const body = /** @type {HTMLElement} */ (root.querySelector('.js-paper-body'));
  const id = decodeURIComponent(ctx.params.id ?? '');
  const controller = new AbortController();
  /** @type {any} */
  let detail = null;

  workApi(id, { signal: controller.signal })
    .then((d) => {
      detail = d;
      body.innerHTML = detailHtml(d);
      bindBody(body, d);
    })
    .catch((e) => {
      if (/** @type {any} */ (e)?.name === 'AbortError') return;
      const code = /** @type {any} */ (e)?.code ?? '';
      body.innerHTML = `
        <div class="empty-state" role="alert">
          <h1>${code === 'NOT_FOUND' ? '404 · 没有找到这篇文献' : '详情加载失败'}</h1>
          <p>${esc(/** @type {any} */ (e)?.message ?? '网络错误，请稍后重试')}</p>
          <p style="font-size:var(--t-xs);color:var(--fg-3)">当前仅支持 DOI / OpenAlex id 直达；从检索结果点入会自动带 id。</p>
          <p><a class="btn btn-primary" href="/" data-link>去检索</a> <a class="btn" href="/legacy.html">旧版入口</a></p>
        </div>`;
    });

  return {
    destroy() {
      controller.abort();
    },
  };
}

/**
 * @param {any} d WorkDetailResult
 * @returns {string}
 */
function detailHtml(d) {
  const w = d.work;
  const authors = (w.authors ?? []).map((/** @type {any} */ a) => esc(a.name)).join(', ');
  const badges = [
    w.type && typeLabel(w.type),
    isTopVenueName(w.venue) ? '顶会/顶刊' : '',
    w.openAccess ? '开放获取' : '',
  ].filter(Boolean);
  return `
    <h1 class="paper-title" style="font-size:var(--t-xl);line-height:1.35">${esc(w.title)}</h1>
    <p style="color:var(--fg-2);font-size:var(--t-sm);margin:var(--s-2) 0">
      ${authors || '作者未知'}${w.year ? ` · ${w.year}` : ''}
    </p>
    <p style="font-size:var(--t-sm)">
      <span>${esc(w.venue ?? '出版方未知')}</span>
      ${w.doi ? `· DOI <code>${esc(w.doi)}</code>` : ''}
      ${badges.map((b) => ` <span class="badge badge-accent">${esc(b)}</span>`).join('')}
    </p>

    <div class="notice-bar" style="background:var(--surface-2);border:1px solid var(--line);color:var(--fg-2);margin:var(--s-3) 0;flex-wrap:wrap">
      <span class="num">被引 ${typeof w.citations === 'number' ? w.citations.toLocaleString('zh-CN') : '—'}</span>
      <span>元数据置信度 ${confidenceOf(w)}</span>
      ${w.openAccess ? '<span class="badge badge-ok">开放获取</span>' : ''}
      <span style="font-size:var(--t-xs);color:var(--fg-3)">被引数据：OpenAlex · ${esc(d.metricsFetchedAt.slice(0, 10))}</span>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:var(--s-3) 0">
      ${w.doi ? `<a class="btn btn-sm" href="https://doi.org/${esc(w.doi)}" target="_blank" rel="noopener">${icon('external', { size: 14 })} 原文</a>` : ''}
      ${w.pdfUrl ? `<a class="btn btn-sm" href="${esc(w.pdfUrl)}" target="_blank" rel="noopener">${icon('download', { size: 14 })} PDF</a>` : ''}
      <span class="badge" title="M3-02 交付全文探测">全文可用性探测将在下方给出</span>
    </div>

    ${w.abstract
      ? `<details open class="js-abstract">
          <summary style="cursor:pointer;font-size:var(--t-sm);color:var(--fg-2)">摘要（展开不重新请求）</summary>
          <p style="line-height:1.8;font-size:var(--t-sm)">${esc(w.abstract)}</p>
        </details>`
      : '<p style="color:var(--fg-3);font-size:var(--t-sm)">该来源未提供摘要。</p>'}

    ${w.institutions.length ? `<p style="font-size:var(--t-xs);color:var(--fg-3);margin-top:var(--s-2)">机构：${w.institutions.map(esc).join(' · ')}</p>` : ''}

    <section style="margin-top:var(--s-5)" aria-labelledby="refs-h">
      <h2 id="refs-h" style="font-size:var(--t-md)">参考文献（${d.references.length}）</h2>
      ${d.references.length ? `<ol class="ref-list">${d.references.map((/** @type {any} */ r) => refItemHtml(r)).join('')}</ol>` : '<p style="color:var(--fg-3);font-size:var(--t-sm)">该来源未提供参考文献列表。</p>'}
    </section>

    <section style="margin-top:var(--s-5)" aria-labelledby="cited-h">
      <h2 id="cited-h" style="font-size:var(--t-md)">被引文献（${d.citedBy.length}）</h2>
      ${d.citedBy.length ? `<ol class="ref-list">${d.citedBy.map((/** @type {any} */ r) => refItemHtml(r)).join('')}</ol>` : '<p style="color:var(--fg-3);font-size:var(--t-sm)">暂无被引记录（新论文常见）。</p>'}
    </section>

    <section style="margin-top:var(--s-5)" aria-labelledby="sim-h">
      <h2 id="sim-h" style="font-size:var(--t-md)">相似论文（${d.similar.length}）</h2>
      ${d.similar.length ? `<ol class="ref-list">${d.similar.map((/** @type {any} */ r) => refItemHtml(r)).join('')}</ol>` : '<p style="color:var(--fg-3);font-size:var(--t-sm)">暂无相似推荐。</p>'}
    </section>

    <p style="margin-top:var(--s-6);font-size:var(--t-xs);color:var(--fg-3)">
      引文网络图、全文可用性探测、引用格式复制、AI 精读、笔记由 M3-02~07 / M5 / M6 陆续补齐；本页数据来源 OpenAlex，引文元数据版权归原数据库。
    </p>`;
}

/**
 * @param {any} r
 * @returns {string}
 */
function refItemHtml(r) {
  // id 必须整体 encodeURIComponent（DOI 含 / 会破坏路径分段）
  const href = (r.doi || r.id) ? `/p/${encodeURIComponent(r.doi ? `doi:${r.doi}` : r.id)}` : '';
  return `<li style="margin:var(--s-2) 0;font-size:var(--t-sm)">
    ${href ? `<a class="paper-title" href="${esc(href)}" data-link>${esc(r.title)}</a>` : `<span class="paper-title">${esc(r.title)}</span>`}
    <span style="color:var(--fg-3)"> — ${esc(r.venue ?? '')}${r.year ? ` ${r.year}` : ''}${typeof r.citations === 'number' ? ` · 被引 ${r.citations}` : ''}</span>
  </li>`;
}

/**
 * @param {string} t
 * @returns {string}
 */
function typeLabel(t) {
  const map = /** @type {const} */ ({ article: '期刊', 'journal-article': '期刊', 'proceedings-article': '会议', 'conference-paper': '会议', preprint: '预印本', 'posted-content': '预印本' });
  return (/** @type {Record<string, string>} */ (map))[t] ?? t;
}

/**
 * @param {any} w
 * @returns {string}
 */
function confidenceOf(w) {
  if (w.doi && (w.institutions.length || w.venue)) return 'B（单源 DOI）';
  if (w.doi) return 'B';
  return 'C（待核实）';
}

/**
 * @param {HTMLElement} _body
 * @param {any} _d
 */
function bindBody(_body, _d) { /* M3-07 复制菜单等后续接入 */ }

/** @type {import('../router.js').View} */
export default { render, mount };
