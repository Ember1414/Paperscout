// @ts-check
import { subscribe, runSearch, cancelSearch, state, loadSnapshot, setState } from '../store.js';
import { paramsFromUrl, searchUrl } from '../url.js';
import { filtersHtml, bindFilters } from '../ui/filters.js';
import { resultsHtml, bindResults, registerWorks } from '../ui/results.js';
import { searchBarHtml, bindSearchBar } from '../ui/searchbar.js';
import { navigate, replaceUrlSilent } from '../router.js';
import { openDrawer, drawerContentHtml } from '../ui/drawer.js';
import { cardHtml } from '../ui/card.js';
import { addSearchHistory } from '../db.js';

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
            <button type="button" class="btn btn-sm js-filters-toggle" aria-label="打开筛选面板">筛选</button>
            <button type="button" class="btn btn-sm js-stop" hidden>停止</button>
            <form class="js-refine-form" role="search" hidden style="display:inline-flex;gap:4px;align-items:center">
              <label class="sr-only" for="ps-refine">在结果内再搜</label>
              <input id="ps-refine" type="search" placeholder="在结果内再搜…" style="min-height:32px;width:150px;padding:2px 6px;font-size:var(--t-xs)" maxlength="60" />
              <button type="submit" class="btn btn-sm">过滤</button>
              <button type="button" class="btn btn-sm btn-ghost js-refine-exit" hidden>退出</button>
            </form>
            <label style="font-size:var(--t-xs);color:var(--fg-3);display:inline-flex;gap:4px;align-items:center">分组
              <select class="js-group" style="min-height:32px;padding:2px 4px">
                <option value="">不分组</option>
                <option value="year">按年份</option>
                <option value="venue">按期刊/会议</option>
                <option value="source">按收录源</option>
              </select>
            </label>
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

  /** M2-11：检索历史真正写入（A-01 用户侧闭环，D-012）——同一 requestId 只记一次 */
  let lastLoggedRid = '';
  /** @param {typeof state.results} r */
  const logHistory = (r) => {
    if (r.loading || r.error || !r.items.length || !r.requestId || r.requestId === lastLoggedRid) return;
    lastLoggedRid = r.requestId;
    void addSearchHistory(current.q);
    try {
      const raw = /** @type {string | null} */ (localStorage.getItem('ps-recent-q'));
      const arr = raw ? /** @type {unknown} */ (JSON.parse(raw)) : [];
      const list = Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
      const next = [current.q, ...list.filter((x) => x !== current.q)].slice(0, 5);
      localStorage.setItem('ps-recent-q', JSON.stringify(next));
    } catch { /* 存储不可用忽略 */ }
  };

  /** M2-11：二次检索（池内过滤，零网络请求） */
  let refineQuery = '';
  /** @type {typeof state.results} */
  let refinedView = state.results;
  const applyRefine = () => {
    const r = state.results;
    if (!refineQuery) {
      refinedView = r;
      return;
    }
    const terms = refineQuery.toLowerCase().split(/s+/).filter(Boolean);
    const items = r.items.filter((w) => {
      const hay = `${w.title} ${w.abstract ?? ''}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
    refinedView = { ...r, items };
  };

  const renderResults = () => {
    const r = state.results;
    logHistory(r);
    applyRefine();
    const retriedBar = state.results.retriedFrom
      ? `<div class="notice-bar notice-info" style="background:var(--accent-soft);color:var(--accent);border:1px solid var(--accent)">没有找到「${escapeHtml(state.results.retriedFrom)}」，已自动改为检索「${escapeHtml(current.q)}」</div>`
      : '';
    const refineBar = refineQuery
      ? `<div class="notice-bar notice-info" style="background:var(--accent-soft);color:var(--accent);border:1px solid var(--accent)">结果内再搜「${escapeHtml(refineQuery)}」：${refinedView.items.length}/${r.items.length} 条 <button type="button" class="btn btn-sm js-refine-exit2" style="margin-left:8px">退出</button></div>`
      : '';
    const effective = refineQuery ? refinedView : r;
    if (current.view === 'table') {
      resultsEl.innerHTML = refineBar;
      const tableWrap = document.createElement('div');
      resultsEl.appendChild(tableWrap);
      renderTableInto(tableWrap, effective);
    } else if (current.group) {
      resultsEl.innerHTML = refineBar + groupedHtml(effective, current.group, current.view, current.sel);
      registerWorks(resultsEl, effective.items);
    } else {
      resultsEl.innerHTML = refineBar + resultsHtml(
        { ...effective, view: current.view },
        { q: current.q, citationsTopDecile: poolCtx().citationsTopDecile, currentId: current.sel },
      );
      registerWorks(resultsEl, effective.items);
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

  /* ---------- M2-08：表格视图（自定义列 + 列排序；列设置本地保存 S-27） ---------- */
  const TABLE_COLS = [
    { key: 'title', label: '标题', numeric: false, sortable: false },
    { key: 'authors', label: '作者', numeric: false, sortable: false },
    { key: 'year', label: '年份', numeric: true, sortable: true },
    { key: 'sources', label: '来源', numeric: false, sortable: false },
    { key: 'citations', label: '被引', numeric: true, sortable: true },
    { key: 'oa', label: 'OA', numeric: false, sortable: false },
  ];
  /** @returns {string[]} */
  const tableCols = () => {
    try {
      const raw = /** @type {string | null} */ (localStorage.getItem('ps-table-cols'));
      const arr = raw ? /** @type {unknown} */ (JSON.parse(raw)) : null;
      if (Array.isArray(arr) && arr.length) return arr.filter((k) => TABLE_COLS.some((c) => c.key === k));
    } catch { /* 存储不可用回退全列 */ }
    return TABLE_COLS.map((c) => c.key);
  };
  /** @type {string} */ let tableSortKey = '';
  /** @type {1 | -1} */ let tableSortDir = -1;

  /** @param {typeof state.results} r */
  const renderTable = (r) => renderTableInto(resultsEl, r);
  /** @param {HTMLElement} el @param {typeof state.results} r */
  const renderTableInto = (el, r) => {
    const enabled = tableCols();
    let items = [...r.items];
    if (tableSortKey) {
      const key = tableSortKey;
      items.sort((a, b) => ((key === 'year' ? a.year ?? 0 : a.citations ?? 0) - (key === 'year' ? b.year ?? 0 : b.citations ?? 0)) * tableSortDir);
    }
    /** @param {any} w @param {string} key */
    const cell = (w, key) => {
      switch (key) {
        case 'title': return `<td style="max-width:420px">${escapeHtml(w.title)}</td>`;
        case 'authors': return `<td style="max-width:180px">${escapeHtml((w.authors ?? []).slice(0, 2).map((/** @type {any} */ a) => (typeof a === 'string' ? a : a?.name)).join(', '))}</td>`;
        case 'year': return `<td class="num">${w.year ?? '—'}</td>`;
        case 'sources': return `<td>${escapeHtml((w.sources ?? []).map((/** @type {any} */ s) => s.sourceName).join('/'))}</td>`;
        case 'citations': return `<td class="num">${typeof w.citations === 'number' ? w.citations.toLocaleString('zh-CN') : '—'}</td>`;
        case 'oa': return `<td>${w.openAccess ? '是' : '—'}</td>`;
        default: return '<td></td>';
      }
    };
    el.innerHTML = `
      <details style="margin-bottom:8px">
        <summary style="cursor:pointer;font-size:var(--t-sm);color:var(--fg-2)">列显示</summary>
        <div style="display:flex;gap:12px;flex-wrap:wrap;padding:8px 0">
          ${TABLE_COLS.map((c) => `<label style="font-size:var(--t-sm)"><input type="checkbox" class="js-col-toggle" value="${c.key}" ${enabled.includes(c.key) ? 'checked' : ''} /> ${c.label}</label>`).join('')}
        </div>
      </details>
      <table class="data-table">
        <caption class="sr-only">检索结果表格视图</caption>
        <thead><tr>
          ${TABLE_COLS.filter((c) => enabled.includes(c.key)).map((c) => c.sortable
            ? `<th scope="col" class="${c.numeric ? 'num' : ''}"><button type="button" class="js-col-sort" data-key="${c.key}" style="background:none;border:none;cursor:pointer;color:inherit;font:inherit;padding:0">${c.label}${tableSortKey === c.key ? (tableSortDir === -1 ? ' ↓' : ' ↑') : ''}</button></th>`
            : `<th scope="col" class="${c.numeric ? 'num' : ''}">${c.label}</th>`).join('')}
        </tr></thead>
        <tbody>
          ${items.map((w) => `<tr>${enabled.map((k) => cell(w, k)).join('')}</tr>`).join('')}
        </tbody>
      </table>`;
  };

  /** @type {(e: Event) => void} */
  const onTable = (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    const sortBtn = /** @type {HTMLElement | null} */ (t.closest?.('.js-col-sort'));
    if (sortBtn) {
      const key = sortBtn.dataset.key ?? '';
      if (tableSortKey === key) tableSortDir = tableSortDir === -1 ? 1 : -1;
      else { tableSortKey = key; tableSortDir = -1; }
      renderTable(refineQuery ? refinedView : state.results);
      return;
    }
    const toggle = /** @type {HTMLInputElement | null} */ (t.closest?.('input.js-col-toggle'));
    if (toggle) {
      const boxes = [...root.querySelectorAll('.js-col-toggle')];
      const enabled = boxes.filter((b) => /** @type {HTMLInputElement} */ (b).checked).map((b) => /** @type {HTMLInputElement} */ (b).value);
      if (enabled.length) {
        try { localStorage.setItem('ps-table-cols', JSON.stringify(enabled)); } catch { /* 忽略 */ }
        renderTable(state.results);
      }
    }
  };
  root.addEventListener('click', onTable);

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

  /** M2-09 分组切换（池内重渲染，不发请求 S-29） */
  /** @type {(e: Event) => void} */
  const onGroup = (e) => {
    const sel = /** @type {HTMLSelectElement} */ (e.target);
    if (!sel.classList.contains('js-group')) return;
    applyPatch({ group: /** @type {any} */ (sel.value) });
  };
  root.addEventListener('change', onGroup);

  /** 二次检索（M2-11）：提交过滤 / 退出 */
  /** @type {(e: Event) => void} */
  const onRefineSubmit = (e) => {
    e.preventDefault();
    const input = /** @type {HTMLInputElement} */ (root.querySelector('#ps-refine'));
    refineQuery = (input?.value ?? '').trim();
    const exit = /** @type {HTMLElement | null} */ (root.querySelector('.js-refine-exit'));
    if (exit) exit.hidden = !refineQuery;
    renderResults();
  };
  /** @type {(e: Event) => void} */
  const onRefineClick = (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    if (t.closest('.js-refine-exit') || t.closest('.js-refine-exit2')) {
      refineQuery = '';
      const input = /** @type {HTMLInputElement | null} */ (root.querySelector('#ps-refine'));
      if (input) input.value = '';
      const exit = /** @type {HTMLElement | null} */ (root.querySelector('.js-refine-exit'));
      if (exit) exit.hidden = true;
      renderResults();
    }
  };
  root.querySelector('.js-refine-form')?.addEventListener('submit', onRefineSubmit);
  root.addEventListener('click', onRefineClick);

  /** 筛选面板（300ms 防抖合并，I-04/S-07） */
  const rerenderFilters = () => {
    const aside = /** @type {HTMLElement | null} */ (root.querySelector('.ps-col-filters'));
    if (!aside) return;
    filtersHandle?.destroy?.();
    aside.innerHTML = `
      <div class="ps-sheet-handle">
        <span style="font-size:var(--t-sm);font-weight:600">筛选</span>
        <button type="button" class="btn btn-sm js-sheet-close">完成</button>
      </div>` + filtersHtml(current);
    filtersHandle = bindFilters(aside, current, applyPatch);
    // bottom sheet 开关 + 下滑关闭（S-15）
    const closeSheet = () => {
      aside.classList.remove('ps-sheet-open');
      document.body.classList.remove('ps-sheet-locked');
    };
    root.querySelector('.js-filters-toggle')?.addEventListener('click', () => {
      aside.classList.add('ps-sheet-open');
      document.body.classList.add('ps-sheet-locked');
    });
    aside.querySelector('.js-sheet-close')?.addEventListener('click', closeSheet);
    /** @type {number | undefined} */
    let touchStartY;
    aside.addEventListener('touchstart', (e) => {
      touchStartY = e.touches[0]?.clientY;
    }, { passive: true });
    aside.addEventListener('touchend', (e) => {
      if (touchStartY !== undefined && e.changedTouches[0] && e.changedTouches[0].clientY - touchStartY > 80) closeSheet();
      touchStartY = undefined;
    }, { passive: true });
    aside.addEventListener('click', (e) => {
      // 移动端：应用任一筛选后自动收起 bottom sheet（避免遮挡结果）
      const t = /** @type {HTMLElement} */ (e.target);
      if (aside.classList.contains('ps-sheet-open') && (t.closest('input[name="f-type"]') || t.closest('input[name="f-lang"]'))) {
        setTimeout(closeSheet, 200);
      }
    });
  };
  rerenderFilters();

  // M2-16 快照秒开：sessionStorage 命中（≤10min）→ 先渲染快照，再由 runSearch 后台刷新（SWR）
  const snap = loadSnapshot(new URL(location.href));
  if (snap?.items?.length && !state.results.items.length) {
    setState({
      results: {
        ...state.results,
        items: snap.items, poolSize: snap.poolSize, hasMore: snap.hasMore, exhausted: snap.exhausted,
        sources: snap.sources ?? [], partial: Boolean(snap.partial),
        requestId: snap.requestId ?? '', ms: snap.ms ?? 0, cache: 'snapshot',
      },
    });
  }
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
      root.removeEventListener('click', onTable);
      root.removeEventListener('change', onGroup);
      root.removeEventListener('click', onRefineClick);
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

/* ---------- M2-09：结果分组（details 原生折叠：切换瞬时、零网络请求 S-29） ---------- */
/**
 * @param {typeof state.results} r
 * @param {'year'|'venue'|'source'} mode
 */
/** @param {typeof state.results} r @param {'year'|'venue'|'source'} mode @param {string} viewMode @param {string} selId */
function groupedHtml(r, mode, viewMode, selId) {
  /** @type {Map<string, any[]>} */
  const map = new Map();
  for (const w of r.items) {
    const key = mode === 'year' ? String(w.year ?? '年份未知')
      : mode === 'venue' ? String(w.venue ?? '出版方未知')
      : (w.sources ?? []).map((/** @type {any} */ s) => s.sourceName).join('/') || '单源';
    const arr = map.get(key) ?? [];
    arr.push(w);
    map.set(key, arr);
  }
  const keys = [...map.keys()].sort((a, b) => (mode === 'year' ? Number(b) - Number(a) : (map.get(b)?.length ?? 0) - (map.get(a)?.length ?? 0)));
  return keys
    .map((k) => {
      const items = map.get(k) ?? [];
      return `
      <details class="ps-group" open>
        <summary style="cursor:pointer;font-size:var(--t-sm);font-weight:600;padding:8px 0">
          ${escapeHtml(k)} <span class="chip">${items.length} 条</span>
        </summary>
        ${items.map((w) => cardHtml(w, { citationsTopDecile: 0, density: viewMode === 'compact' ? 'compact' : 'list', current: w.id === selId })).join('')}
      </details>`;
    })
    .join('');
}
