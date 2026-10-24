// @ts-check
import { workApi } from '../api.js';
import { toBibtex, toRis, toCslJson } from '../cite-format.js';
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
      void loadAvailability(body, d);
      void loadContexts(body, d);
      renderTrend(body, d);
      mountNet(body, d);
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

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:var(--s-3) 0;align-items:center">
      ${w.doi ? `<a class="btn btn-sm" href="https://doi.org/${esc(w.doi)}" target="_blank" rel="noopener">${icon('external', { size: 14 })} 原文</a>` : ''}
      ${w.pdfUrl ? `<a class="btn btn-sm" href="${esc(w.pdfUrl)}" target="_blank" rel="noopener">${icon('download', { size: 14 })} PDF</a>` : ''}
      <span style="display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap" class="js-availability"><span class="skeleton" style="width:180px;height:26px"></span></span>
    </div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:var(--s-3)">
      <span style="font-size:var(--t-sm);color:var(--fg-2)">引用：</span>
      <button type="button" class="btn btn-sm js-cite-menu" data-fmt="bibtex">复制 BibTeX</button>
      <button type="button" class="btn btn-sm js-cite-menu" data-fmt="ris">复制 RIS</button>
      <button type="button" class="btn btn-sm js-cite-menu" data-fmt="csl">复制 CSL-JSON</button>
    </div>

    ${w.abstract
      ? `<details open class="js-abstract">
          <summary style="cursor:pointer;font-size:var(--t-sm);color:var(--fg-2)">摘要（展开不重新请求）</summary>
          <p style="line-height:1.8;font-size:var(--t-sm)">${esc(w.abstract)}</p>
        </details>`
      : '<p style="color:var(--fg-3);font-size:var(--t-sm)">该来源未提供摘要。</p>'}

    ${w.institutions.length ? `<p style="font-size:var(--t-xs);color:var(--fg-3);margin-top:var(--s-2)">机构：${w.institutions.map(esc).join(' · ')}</p>` : ''}

    <section style="margin-top:var(--s-5)" aria-labelledby="trend-h">
      <h2 id="trend-h" style="font-size:var(--t-md)">被引趋势（近 10 年）</h2>
      <div class="js-trend"></div>
    </section>

    <section style="margin-top:var(--s-5)" aria-labelledby="ctx-h">
      <h2 id="ctx-h" style="font-size:var(--t-md)">引用上下文（谁在哪句话引用）</h2>
      <div class="js-contexts"><p style="color:var(--fg-3);font-size:var(--t-sm)">加载中…</p></div>
    </section>

    <section style="margin-top:var(--s-5)" aria-labelledby="net-h">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <h2 id="net-h" style="font-size:var(--t-md);margin:0">引文网络</h2>
        <button type="button" class="btn btn-sm js-net-toggle">切列表视图</button>
      </div>
      <div class="js-net" style="margin-top:8px"></div>
      <div class="js-net-list" hidden>
        <p style="font-size:var(--t-xs);color:var(--fg-3)">列表视图（无障碍替代）：</p>
        <ul class="ref-list" style="columns:2;gap:24px;font-size:var(--t-xs)"></ul>
      </div>
    </section>

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
 * @param {HTMLElement} body
 * @param {any} d
 */
function bindBody(body, d) {
  const w = d.work;
  /** @type {any} */
  const citeInput = {
    title: w.title,
    authors: (w.authors ?? []).map((/** @type {any} */ a) => a.name),
    year: w.year, venue: w.venue, doi: w.doi, type: w.type, url: w.landingUrl,
  };
  body.querySelector('.js-cite-menu')?.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target);
    const fmt = btn.dataset.fmt;
    if (!fmt) return;
    const text = fmt === 'bibtex' ? toBibtex(citeInput) : fmt === 'ris' ? toRis(citeInput) : toCslJson(citeInput);
    navigator.clipboard?.writeText(text).then(() => {
      const old = btn.textContent;
      btn.textContent = '已复制';
      setTimeout(() => { btn.textContent = old; }, 2000);
    }).catch(() => {
      btn.textContent = '复制失败';
    });
  });
}

/** M3-02 可用性探测（懒加载，失败不阻塞）
 * @param {HTMLElement} body @param {any} d */
async function loadAvailability(body, d) {
  const el = body.querySelector('.js-availability');
  if (!el || !d.work.doi) {
    if (el) el.innerHTML = '<span class="badge">无 DOI，跳过全文探测</span>';
    return;
  }
  try {
    const res = await fetch('/api/availability?doi=' + encodeURIComponent(d.work.doi));
    const j = await res.json();
    const x = j?.data ?? {};
    const kindLabel = /** @type {Record<string, string>} */ ({ publisher: '出版方', repository: '知识库', preprint: '预印本', pmc: 'PMC' });
    const verLabel = /** @type {Record<string, string>} */ ({ published: '正式版', accepted: '接受稿', submitted: '投稿稿', unknown: '版本未知' });
    if (x.best) {
      el.innerHTML = `
        <span class="badge badge-ok">${kindLabel[x.best.kind] ?? x.best.kind} · ${verLabel[x.best.version] ?? x.best.version}</span>
        ${x.best.pdfUrl ? `<a class="btn btn-sm" href="${esc(x.best.pdfUrl)}" target="_blank" rel="noopener">${icon('download', { size: 14 })} 正版 PDF</a>` : ''}
        ${x.best.landingUrl ? `<a class="btn btn-sm" href="${esc(x.best.landingUrl)}" target="_blank" rel="noopener">落地页</a>` : ''}
        <span style="font-size:var(--t-xs);color:var(--fg-3)">探测：${esc((x.sources ?? []).join('/'))} · ${esc(String(x.checkedAt).slice(0, 10))}</span>`;
    } else {
      el.innerHTML = `<span class="badge badge-warn">未发现开放获取版本</span>
        <span style="font-size:var(--t-xs);color:var(--fg-3)">三路建议：</span>${(x.suggestions ?? []).map((/** @type {any} */ s) => `<a class="btn btn-sm" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join('')}`;
    }
  } catch (e) {
    console.warn('paper:availability-failed', e instanceof Error ? e.message : String(e));
    el.innerHTML = '<span class="badge">全文探测暂不可用（不影响本页其余内容）</span>';
  }
}

/** M3-06 引用上下文（S2，懒加载，失败显示暂无）
 * @param {HTMLElement} body @param {any} d */
async function loadContexts(body, d) {
  const el = body.querySelector('.js-contexts');
  if (!el || !d.work.doi) { if (el) el.innerHTML = '<p style="color:var(--fg-3);font-size:var(--t-sm)">无 DOI，跳过。</p>'; return; }
  try {
    const res = await fetch('/api/citations?id=' + encodeURIComponent('doi:' + d.work.doi) + '&dir=contexts');
    const j = await res.json();
    const x = j?.data ?? {};
    if (!x.available) {
      el.innerHTML = '<p style="color:var(--fg-3);font-size:var(--t-sm)">暂无引用上下文（S2 暂未收录或限流，不影响本页其余内容）。</p>';
      return;
    }
    el.innerHTML = x.contexts.map((/** @type {any} */ c) => `
      <div style="border-left:2px solid var(--line-strong);padding-left:12px;margin:10px 0">
        <div style="font-size:var(--t-sm)">“${esc(String(c.contexts[0] ?? '').slice(0, 200))}”</div>
        <div style="font-size:var(--t-xs);color:var(--fg-3)">— ${esc(c.citingTitle)}${c.year ? ' ' + c.year : ''}（Semantic Scholar）</div>
      </div>`).join('');
  } catch (e) {
    console.warn('paper:contexts-failed', e instanceof Error ? e.message : String(e));
    el.innerHTML = '<p style="color:var(--fg-3);font-size:var(--t-sm)">引用上下文暂不可用。</p>';
  }
}

/** M3-05 被引增速（OpenAlex counts_by_year；口径标注 D-12）
 * @param {HTMLElement} body @param {any} d */
function renderTrend(body, d) {
  const el = body.querySelector('.js-trend');
  if (!el) return;
  const rows = [...(d.work.countsByYear ?? [])].filter((/** @type {any[]} */ r) => r[0] >= new Date().getFullYear() - 10).sort((a, b) => a[0] - b[0]);
  if (!rows.length) {
    el.innerHTML = '<p style="color:var(--fg-3);font-size:var(--t-sm)">—（该来源未提供按年被引数据）</p>';
    return;
  }
  const thisYear = new Date().getFullYear();
  const recent = rows.filter((/** @type {any[]} */ r) => r[0] >= thisYear - 1);
  const recentSum = recent.reduce((a, /** @type {any[]} */ r) => a + r[1], 0);
  const total = d.work.citedByCount ?? rows.reduce((a, /** @type {any[]} */ r) => a + r[1], 0);
  const ratio = total ? recentSum / total : 0;
  const label = ratio > 0.4 ? '正在快速上升' : ratio >= 0.15 ? '稳定上升' : '经典/沉淀';
  const max = Math.max(...rows.map((/** @type {any[]} */ r) => r[1]), 1);
  el.innerHTML = `
    <div style="display:flex;align-items:flex-end;gap:4px;height:80px;margin:8px 0">
      ${rows.map((/** @type {any[]} */ r) => `<div style="flex:1;text-align:center" title="${r[0]}：被引 ${r[1]}">
        <div style="background:var(--accent);height:${Math.max(2, Math.round((r[1] / max) * 70))}px;border-radius:2px 2px 0 0;margin:0 auto;width:70%"></div>
        <div style="font-size:10px;color:var(--fg-3);margin-top:2px">${String(r[0]).slice(2)}</div>
      </div>`).join('')}
    </div>
    <p style="font-size:var(--t-xs);color:var(--fg-3)">近 12 个月被引 ${recentSum}（占比 ${(ratio * 100).toFixed(0)}%）→ ${label} · 基于 OpenAlex counts_by_year，更新于 ${esc(d.metricsFetchedAt.slice(0, 10))}（D-12 口径标注）</p>`;
}


/** @type {import('../router.js').View} */
export default { render, mount };

/**
 * M3-04 引文网络：canvas 图 ↔ 列表替身切换；节点点击跳详情（S-26）
 * @param {HTMLElement} body
 * @param {any} d
 */
function mountNet(body, d) {
  const wrap = /** @type {HTMLElement | null} */ (body.querySelector('.js-net'));
  const listEl = /** @type {HTMLElement | null} */ (body.querySelector('.js-net-list'));
  const toggle = /** @type {HTMLButtonElement | null} */ (body.querySelector('.js-net-toggle'));
  if (!wrap || !listEl) return;
  void import('../ui/net.js').then(({ buildGraphData, mountGraph }) => {
    const graph = buildGraphData({ center: d.work, references: d.references, citedBy: d.citedBy, similar: d.similar });
    const ul = /** @type {HTMLElement | null} */ (listEl.querySelector('ul'));
    if (ul) {
      ul.innerHTML = graph.nodes.map((n) => `<li>${esc(n.kind === 'center' ? '★ ' : '')}${esc(n.title)} ${n.year ? '(' + n.year + ')' : ''}${n.citations !== undefined ? ' · 被引 ' + n.citations : ''}</li>`).join('');
    }
    let showingGraph = true;
    /** @type {{ destroy: () => void } | null} */
    let handle = mountGraph(wrap, graph, { width: Math.min(wrap.clientWidth || 700, 760), height: 380 }, { onOpen: (id) => void import('../router.js').then(({ navigate }) => navigate('/p/' + encodeURIComponent(id))) });
    toggle?.addEventListener('click', () => {
      showingGraph = !showingGraph;
      wrap.hidden = !showingGraph;
      listEl.hidden = showingGraph;
      if (toggle) toggle.textContent = showingGraph ? '切列表视图' : '切网络图';
      if (showingGraph && !handle) {
        handle = mountGraph(wrap, graph, { width: Math.min(wrap.clientWidth || 700, 760), height: 380 }, { onOpen: (id) => void import('../router.js').then(({ navigate }) => navigate('/p/' + encodeURIComponent(id))) });
      }
    });
  });
}

/** M6-07 AI 精读（懒加载）
 * @param {HTMLElement} body
 * @param {string} doi
 */
async function loadAiExtract(body, doi) {
  const el = /** @type {HTMLElement | null} */ (body.querySelector('.js-ai-extract-body'));
  if (!el) return;
  el.innerHTML = '<div class="skeleton" style="height:60px"></div>';
  try {
    const res = await fetch('/api/ai/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Id': localStorage.getItem('ps-client-id') ?? 'anon' },
      body: JSON.stringify({ doi }),
    });
    const j = await res.json();
    if (j.error) { el.innerHTML = '<p style="color:var(--fg-3);font-size:var(--t-sm)">' + esc(j.error.message) + '</p>'; return; }
    el.innerHTML = '<div style="font-size:var(--t-sm);line-height:1.8;white-space:pre-wrap">' + esc(j.data.analysis) + '</div>' +
      (j.data.verified ? '<span class="badge badge-ok">AI 分析（需核实）</span>' : '<span class="badge badge-warn">AI 分析（引用未校验）</span>');
  } catch (e) {
    el.innerHTML = '<p style="color:var(--fg-3);font-size:var(--t-sm)">AI 精读暂不可用。</p>';
  }
}
