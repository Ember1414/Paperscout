// @ts-check
import { subscribe, runSearch, cancelSearch, state } from '../store.js';
import { paramsFromUrl, searchUrl } from '../url.js';
import { filtersHtml, bindFilters } from '../ui/filters.js';
import { resultsHtml, bindResults, registerWorks } from '../ui/results.js';
import { searchBarHtml, bindSearchBar } from '../ui/searchbar.js';
import { navigate, replaceUrlSilent } from '../router.js';
import { openDrawer, drawerContentHtml } from '../ui/drawer.js';

/**
 * 检索结果页（REBUILD_PLAN 4.3 三栏 / M2-05 DoD：I-01~I-12）。
 * URL 唯一真相：任何筛选变更 → 300ms 合并 → pushState → runSearch；store 负责竞态与取消。
 */

/** 无 q 重定向首页（4.2 规则） */

/**
 * @param {import('../router.js').ViewCtx} ctx
 */
export function render(ctx) {
  const p = paramsFromUrl(ctx.url);
  return `
    <div class="ps-search-grid">
      <aside class="ps-col-filters" aria-label="筛选面板">
        ${filtersHtml(p)}
      </aside>

      <section class="ps-col-results" aria-label="检索结果">
        ${searchBarHtml({ value: p.q })}
        <div class="js-toolbar" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:12px 0">
          <span class="js-stats num" style="font-size:var(--t-sm);color:var(--fg-2)" aria-live="polite"></span>
          <span style="margin-left:auto;display:flex;gap:6px;align-items:center">
            <span class="sr-only" id="view-label">视图切换</span>
            <button type="button" class="btn btn-sm js-view" data-view="list" aria-pressed="${p.view === 'list'}">列表</button>
            <button type="button" class="btn btn-sm js-view" data-view="compact" aria-pressed="${p.view === 'compact'}">紧凑</button>
            <button type="button" class="btn btn-sm js-view" data-view="table" aria-pressed="${p.view === 'table'}">表格</button>
            <button type="button" class="btn btn-sm js-stop" hidden>停止</button>
          </span>
        </div>
        <div class="js-topbar" aria-hidden="true"></div>
        <div class="js-results"></div>
      </section>

      <aside class="ps-col-detail" aria-label="详情（M2-06 交付）"></aside>
    </div>`;
}

/**
 * @param {HTMLElement} root
 * @param {import('../router.js').ViewCtx} ctx
 */
export function mount(root, ctx) {
  /** 首次进入：无 q → 重定向首页（4.2） */
  const first = paramsFromUrl(ctx.url);
  if (!first.q.trim()) {
    navigate('/', { replace: true });
    return { destroy() {} };
  }

  const resultsEl = /** @type {HTMLElement} */ (root.querySelector('.js-results'));
  const statsEl = /** @type {HTMLElement} */ (root.querySelector('.js-stats'));
  const stopBtn = /** @type {HTMLButtonElement | null} */ (root.querySelector('.js-stop'));
  const topbar = /** @type {HTMLElement} */ (root.querySelector('.js-topbar'));

  /** @type {import('../url.js').SearchUiParams} */
  let current = first;
  /** @type {{ destroy?: () => void } | null} */
  let filtersHandle = null;
  let resultsHandle = null;

  /** @param {Partial<import('../url.js').SearchUiParams>} patch */
  const applyPatch = (patch) => {
    current = { ...current, ...patch };
    if (patch.page === undefined) current.page = 1; // 筛选变更回第 1 页
    navigate(searchUrl(current));
  };

  const poolCtx = () => {
    const cites = state.results.items.map((w) => w.citations ?? 0).filter((c) => c > 0).sort((a, b) => b - a);
    const top = cites[Math.floor(cites.length * 0.1)] ?? Number.MAX_SAFE_INTEGER;
    return { q: current.q, citationsTopDecile: top, currentId: current.sel };
  };

  const renderResults = () => {
    const r = state.results;
    if (current.view === 'table') {
      renderTable(r);
    } else {
      resultsEl.innerHTML = resultsHtml(
        { ...r, view: current.view },
        { q: current.q, citationsTopDecile: poolCtx().citationsTopDecile, currentId: current.sel },
      );
      registerWorks(resultsEl, r.items);
    }
    const srcPart = r.sources.length ? ` · ${r.sources.filter((s) => s.status === 'ok').length}/${r.sources.length} 源` : '';
    statsEl.textContent = r.loading
      ? '检索中…'
      : `${r.items.length} 条${srcPart} · ${r.ms}ms${r.cache && r.cache !== 'miss' ? ` · ${r.cache} 缓存` : ''}`;
    if (stopBtn) stopBtn.hidden = !r.loading;
    if (!r.loading && topbar.firstElementChild) topbar.innerHTML = '';
    // sel 深链（F-21）：搜索完成后若尚未打开且 Work 在池内 → 打开
    if (!r.loading && current.sel && !detailCol?.innerHTML && !drawerHandle) {
      const w = state.results.items.find((x) => x.id === current.sel);
      if (w) openFor(w);
      else {
        current = { ...current, sel: '' };
        replaceUrlSilent(searchUrl(current));
      }
    }
  };

  /** @param {typeof state.results} r */
  const renderTable = (r) => {
    resultsEl.innerHTML = `
      <table class="data-table">
        <caption class="sr-only">检索结果表格视图</caption>
        <thead><tr>
          <th scope="col">标题</th><th scope="col">作者</th><th scope="col">年份</th>
          <th scope="col">来源</th><th scope="col" class="num">被引</th><th scope="col">OA</th>
        </tr></thead>
        <tbody>
          ${r.items.map((w) => `<tr>
            <td style="max-width:420px">${escapeHtml(w.title)}</td>
            <td style="max-width:180px">${escapeHtml((w.authors ?? []).slice(0, 2).join(', '))}</td>
            <td class="num">${w.year ?? '—'}</td>
            <td>${escapeHtml((w.sources ?? []).map((/** @type {any} */ s) => s.sourceName).join('/'))}</td>
            <td class="num">${typeof w.citations === 'number' ? w.citations.toLocaleString('zh-CN') : '—'}</td>
            <td>${w.openAccess ? '是' : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <p style="font-size:var(--t-xs);color:var(--fg-3)">表格列自定义在 M2-08 交付。</p>`;
  };

  /** 订阅 store → 局部重渲染结果区 */
  const unsubscribe = subscribe((s) => {
    if (s.results.loading && !topbar.firstElementChild) {
      topbar.innerHTML = '<div class="top-progress" style="width:60%"></div>';
    }
    renderResults();
  });

  /** 抽屉（M2-06）：标题点击开抽屉；sel 深链 replaceState；Esc/关闭归还焦点并清 sel */
  /** @type {{ destroy: () => void } | null} */
  let drawerHandle = null;
  const detailCol = /** @type {HTMLElement | null} */ (root.querySelector('.ps-col-detail'));
  /** @param {any} w */
  const openFor = (w) => {
    if (!detailCol) return;
    if (window.matchMedia('(min-width: 1024px)').matches) {
      detailCol.innerHTML = drawerInlineHtml(w); // 桌面右栏常驻
    } else {
      drawerHandle?.destroy();
      drawerHandle = openDrawer(document.body, w, { onClose: clearSel });
    }
    current = { ...current, sel: String(w.id) };
    replaceUrlSilent(searchUrl(current));
  };
  const clearSel = () => {
    current = { ...current, sel: '' };
    replaceUrlSilent(searchUrl(current));
    if (detailCol) detailCol.innerHTML = '';
  };
  /** @type {(e: Event) => void} */
  const onTitleClick = (e) => {
    const title = /** @type {HTMLElement | null} */ ((/** @type {HTMLElement} */ (e.target)).closest?.('.r-title'));
    if (!title) return;
    const card = /** @type {HTMLElement | null} */ (title.closest('.result-card'));
    const w = findWorkById(card?.dataset.workId ?? '');
    if (w) openFor(w);
  };
  resultsEl.addEventListener('click', onTitleClick);
  /** @param {string} id */
  const findWorkById = (id) => state.results.items.find((w) => w.id === id);

  resultsHandle = bindResults(resultsEl, {
    onRetry: () => void runSearch(),
    onRelax: (kind) => {
      if (kind === 'year') applyPatch({ from: undefined, to: undefined });
      else if (kind === 'lang') applyPatch({ lang: 'all' });
      else applyPatch({ src: [] });
    },
    onPage: (delta) => {
      const next = current.page + delta;
      if (next < 1 || next > 10) return;
      current = { ...current, page: next };
      navigate(searchUrl(current));
      document.querySelector('.ps-col-results')?.scrollIntoView({ behavior: 'auto' });
    },
  });

  const sb = bindSearchBar(root, { value: current.q });
  /** 搜索条提交：回到第 1 页新查询 */
  root.querySelector('.js-searchbar')?.addEventListener('submit', () => {
    const input = /** @type {HTMLInputElement} */ (root.querySelector('.js-searchbar input[name="q"]'));
    current = { ...current, q: input.value.trim(), page: 1 };
  });

  /** 视图切换（I-19 不闪烁：同池重渲染） */
  /** 内联详情关闭按钮 */
  /** @type {(e: Event) => void} */
  const onDetailClick = (e) => {
    if ((/** @type {HTMLElement} */ (e.target)).closest?.('.js-drawer-close')) clearSel();
  };
  detailCol?.addEventListener('click', onDetailClick);
  /** Esc 关闭内联详情（抽屉路径由 drawer.js 自理） */
  /** @type {(e: KeyboardEvent) => void} */
  const onEsc = (e) => {
    if (e.key === 'Escape' && current.sel && detailCol?.innerHTML) clearSel();
  };
  document.addEventListener('keydown', onEsc);

  /** @type {(e: Event) => void} */
  const onView = (e) => {
    const btn = /** @type {HTMLElement | null} */ ((/** @type {HTMLElement} */ (e.target)).closest?.('.js-view'));
    if (!btn) return;
    applyPatch({ view: /** @type {any} */ (btn.dataset.view) });
  };
  root.addEventListener('click', onView);

  /** 停止（I-12/S-20） */
  stopBtn?.addEventListener('click', () => cancelSearch());

  /** 筛选面板（300ms 防抖合并，I-04/S-07） */
  const rerenderFilters = () => {
    const aside = /** @type {HTMLElement | null} */ (root.querySelector('.ps-col-filters'));
    if (!aside) return;
    filtersHandle?.destroy?.();
    aside.innerHTML = filtersHtml(current);
    filtersHandle = bindFilters(aside, current, applyPatch);
  };
  rerenderFilters();

  // 首次（或导航进入）执行检索；sel 深链自动开抽屉（F-21）
  if (current.sel) {
    const w = state.results.items.find((x) => x.id === current.sel);
    if (w) openFor(w);
  }
  void runSearch();

  return {
    destroy() {
      unsubscribe();
      filtersHandle?.destroy?.();
      resultsHandle?.destroy();
      sb?.destroy();
      drawerHandle?.destroy();
      resultsEl.removeEventListener('click', onTitleClick);
      detailCol?.removeEventListener('click', onDetailClick);
      document.removeEventListener('keydown', onEsc);
      root.removeEventListener('click', onView);
      cancelSearch();
    },
  };
}

/** @param {string} s */
function escapeHtml(s) {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** @type {import('../router.js').View} */
export default { render, mount };

/** 桌面右栏内联详情（与抽屉同内容）
 * @param {any} w */
function drawerInlineHtml(w) {
  return `<div class="result-card js-detail-inline" tabindex="-1">${drawerContentHtml(w)}</div>`;
}
