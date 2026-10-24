// @ts-check
import { cardHtml, toggleFav } from './card.js';
import { showToast } from './toast.js';
import { icon } from '../icons.js';

/**
 * ResultList（6.3）：骨架/空态（3 个放宽按钮 I-08）/部分失败条（I-09）/错误态/分页（I-05）/对比选择（M9-06）。
 */

/**
 * @typedef {object} ResultsState
 * @property {any[]} items
 * @property {boolean} loading
 * @property {{ code: string, message: string, retryable: boolean } | null} error
 * @property {boolean} partial
 * @property {any[]} sources
 * @property {number} page
 * @property {number} limit
 * @property {boolean} hasMore
 * @property {boolean} exhausted
 * @property {number} poolSize
 * @property {string} view
 * @property {boolean} [stale]
 */

/**
 * 查询内容词
 * @param {string} q
 * @returns {string[]}
 */
export function highlightTerms(q) {
  return (q ?? '').toLowerCase().split(/\s|,|;+/).map((w) => w.replace(/["'()`]/g, '')).filter((w) => w.length >= 2 && !['the', 'a', 'an', 'of', 'and', 'for', 'in', 'on', 'to', 'with', '的', '和', '与', '在'].includes(w));
}

/**
 * @param {ResultsState} st
 * @param {{ q: string, citationsTopDecile: number, currentId: string }} ctx
 * @returns {string}
 */
export function resultsHtml(st, ctx) {
  if (st.loading && !st.items.length) return skeletonHtml();

  if (st.error) {
    return `<div class="empty-state" role="alert"><h2>检索出了点问题</h2><p>${esc(st.error.message)}</p><button type="button" class="btn btn-primary js-retry">重试</button><a class="btn" href="/" data-link>回到首页</a></div>`;
  }
  if (!st.items.length) return emptyHtml(ctx.q);

  const staleBar = st.stale ? '<div class="notice-bar notice-warn" role="status">数据源暂时都不可用，以下为 10 分钟内的缓存结果</div>' : '';
  const okCount = st.sources.filter((s) => s.status === 'ok').length;
  const failSources = st.sources.filter((s) => s.status !== 'ok');
  const partialBar = st.partial ? `<div class="notice-bar notice-warn" role="status">${icon('clock', { size: 14 })}<span>${okCount}/${st.sources.length} 源可用${failSources.length ? '：' + failSources.map((s) => esc(s.name + ' ' + s.status)).join('、') : ''}；其余结果照常返回。</span></div>` : '';

  const hl = highlightTerms(ctx.q);
  const listHtml = st.items.map((w) => cardHtml(w, {
    citationsTopDecile: ctx.citationsTopDecile,
    density: st.view === 'compact' ? 'compact' : 'list',
    current: w.id === ctx.currentId,
  }, hl)).join('');

  return `${staleBar}${partialBar}<div class="js-results-list" role="list" aria-live="polite" aria-busy="false">${listHtml}</div>${paginationHtml(st)}`;
}

function skeletonHtml() {
  return `<div role="status" aria-label="检索中">${Array.from({ length: 3 }, () => '<div class="skeleton-card" style="margin-bottom:12px"><div class="sk-line skeleton"></div><div class="sk-line skeleton w60"></div></div>').join('')}</div>`;
}

/**
 * @param {string} q
 * @returns {string}
 */
function emptyHtml(q) {
  const nonsense = /asdfqwer|qwerzzz/.test(q);
  return `<div class="empty-state"><h2>没有找到相关结果</h2><p>${nonsense ? '这个检索词可能没有实际含义，或所有数据源都未收录。' : '可能是筛选条件太紧、语言过滤排除了全部结果，或参与的数据源太少。'}</p><button type="button" class="btn js-relax" data-relax="year">放宽年份</button><button type="button" class="btn js-relax" data-relax="lang">关闭语言过滤</button><button type="button" class="btn js-relax" data-relax="src">恢复默认来源</button></div>`;
}

/**
 * @param {ResultsState} st
 * @returns {string}
 */
function paginationHtml(st) {
  const totalPages = Math.max(1, Math.ceil(st.poolSize / st.limit));
  const atEnd = st.exhausted && st.page * st.limit >= st.poolSize;
  return `<nav class="pagination" aria-label="分页"><button type="button" class="btn btn-sm js-prev-page" ${st.page <= 1 ? 'disabled' : ''}>上一页</button><span class="num" style="font-size:var(--t-sm)">第 ${st.page} 页 / 约 ${totalPages} 页（池 ${st.poolSize} 条）</span><button type="button" class="btn btn-sm js-next-page" ${!st.hasMore || atEnd ? 'disabled' : ''}>下一页</button>${st.exhausted ? `<span style="font-size:var(--t-xs);color:var(--fg-3)">已到末尾（共 ${st.poolSize} 条）</span>` : ''}</nav>`;
}

/**
 * @param {HTMLElement} root
 * @param {{ onRetry(): void, onRelax(kind: string): void, onPage(delta: number): void, onCompareSelected(ids: string[]): void }} handlers
 * @returns {{ destroy(): void }}
 */
export function bindResults(root, handlers) {
  /** @type {(e: Event) => void} */
  const onClick = (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    const favBtn = /** @type {HTMLElement | null} */ (t.closest?.('.js-fav'));
    if (favBtn) {
      const w = findWork(root, favBtn.dataset.favId ?? '');
      if (!w) return;
      const nowFav = toggleFav(w);
      favBtn.innerHTML = icon(nowFav ? 'star-filled' : 'star', { size: 16 });
      favBtn.setAttribute('aria-label', nowFav ? '取消收藏' : '收藏');
      showToast(nowFav ? '已收藏' : '已取消收藏', nowFav ? { actionLabel: '撤销', onAction: () => { toggleFav(w); favBtn.innerHTML = icon('star', { size: 16 }); } } : undefined);
      return;
    }
    if (t.closest('.js-retry')) return handlers.onRetry();
    const relax = /** @type {HTMLElement | null} */ (t.closest?.('.js-relax'));
    if (relax) return handlers.onRelax(relax.dataset.relax ?? 'year');
    if (t.closest('.js-prev-page')) return handlers.onPage(-1);
    if (t.closest('.js-next-page')) return handlers.onPage(1);
    const compareBtn = /** @type {HTMLElement | null} */ (t.closest?.('.js-compare-selected'));
    if (compareBtn) {
      const checked = [...root.querySelectorAll('.js-compare-check:checked')];
      if (checked.length >= 2) {
        const ids = checked.map((c) => (/** @type {HTMLInputElement} */ (c)).dataset.compareId ?? '').filter(Boolean);
        handlers.onCompareSelected(ids);
      }
    }
  };
  root.addEventListener('click', onClick);
  return { destroy() { root.removeEventListener('click', onClick); } };
}

/** @type {Map<HTMLElement, any[]>} */
const workRegistry = new Map();

/**
 * @param {HTMLElement} root
 * @param {any[]} works
 */
export function registerWorks(root, works) { workRegistry.set(root, works); }

/**
 * @param {HTMLElement} root
 * @param {string} id
 * @returns {any | undefined}
 */
function findWork(root, id) { return (workRegistry.get(root) ?? []).find((w) => w.id === id); }

/**
 * @param {string} s
 * @returns {string}
 */
function esc(s) { return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }
