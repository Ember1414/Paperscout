// @ts-check
import { cardHtml, toggleFav, isFav } from './card.js';
import { showToast } from './toast.js';
import { icon } from '../icons.js';

/**
 * ResultList（6.3）：骨架/空态（3 个放宽按钮，I-08）/部分失败条（I-09）/错误态/分页（I-05）。
 * 池 ≤200 条直接渲染；虚拟滚动按 7.2 在 >60 条时窗口化——M2-13 视滚动性能补齐。
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

/** 查询内容词（与 eval 口径一致：长度≥2 去停用词）
 * @param {string} q */
export function highlightTerms(q) {
  return (q ?? '')
    .toLowerCase()
    .split(/\s|,|;+/)
    .map((w) => w.replace(/["'()`]/g, ''))
    .filter((w) => w.length >= 2 && !['the', 'a', 'an', 'of', 'and', 'for', 'in', 'on', 'to', 'with', '的', '和', '与', '在'].includes(w));
}

/**
 * @param {ResultsState} st
 * @param {{ q: string, citationsTopDecile: number, currentId: string }} ctx
 */
export function resultsHtml(st, ctx) {
  if (st.loading && !st.items.length) return skeletonHtml();
  // SWR：已有结果时加载中不闪骨架，仅顶部进度提示（M2-16）
  if (st.error) {
    return `
      <div class="empty-state" role="alert">
        <h2>检索出了点问题</h2>
        <p>${escapeHtml(st.error.message)}</p>
        <button type="button" class="btn btn-primary js-retry">重试</button>
        <a class="btn" href="/" data-link>回到首页</a>
      </div>`;
  }
  if (!st.items.length) {
    return emptyHtml(ctx.q);
  }
  const staleBar = st.stale
    ? '<div class="notice-bar notice-warn" role="status">数据源暂时都不可用，以下为 10 分钟内的缓存结果（可稍后重试）</div>'
    : '';
  const okCount = st.sources.filter((s) => s.status === 'ok' || s.status === undefined).length;
  const partialBar = st.partial
    ? `<div class="notice-bar notice-warn" role="status">
         ${icon('clock', { size: 14 })}
         <span>${okCount}/${st.sources.length || st.sources.length} 源可用${st.sources.filter((s) => s.status !== 'ok').length ? `：${st.sources.filter((s) => s.status !== 'ok').map((s) => `${s.name} ${s.status}`).join('、')}` : ''}；其余结果照常返回。</span>
       </div>`
    : '';
  const view = st.view;
  const hl = highlightTerms(ctx.q);
  const listHtml = view === 'compact'
    ? st.items.map((w) => cardHtml(w, { citationsTopDecile: ctx.citationsTopDecile, density: 'compact', current: w.id === ctx.currentId }, hl)).join('')
    : st.items.map((w) => cardHtml(w, { citationsTopDecile: ctx.citationsTopDecile, density: 'list', current: w.id === ctx.currentId }, hl)).join('');
  return `
    ${staleBar}${partialBar}
    <div class="js-results-list" role="list" aria-live="polite" aria-busy="false">${listHtml}</div>
    ${paginationHtml(st)}`;
}

function skeletonHtml() {
  return `
    <div role="status" aria-label="检索中">
      ${Array.from({ length: 3 }, () => '<div class="skeleton-card" style="margin-bottom:12px"><div class="sk-line skeleton"></div><div class="sk-line skeleton w60"></div></div>').join('')}
    </div>`;
}

/** @param {string} q */
function emptyHtml(q) {
  const nonsense = /asdfqwer|qwerzzz|^[\s*\-';]*$/.test(q);
  return `
    <div class="empty-state">
      <h2>没有找到相关结果</h2>
      <p>${nonsense ? '这个检索词可能没有实际含义，或所有数据源都未收录。' : '可能是筛选条件太紧、语言过滤排除了全部结果，或参与的数据源太少。'}</p>
      <button type="button" class="btn js-relax" data-relax="year">放宽年份</button>
      <button type="button" class="btn js-relax" data-relax="lang">关闭语言过滤</button>
      <button type="button" class="btn js-relax" data-relax="src">恢复默认来源</button>
    </div>`;
}

/**
 * @param {ResultsState} st
 */
function paginationHtml(st) {
  const totalPages = Math.max(1, Math.ceil(st.poolSize / st.limit));
  return `
    <nav class="pagination" aria-label="分页">
      <button type="button" class="btn btn-sm js-prev-page" ${st.page <= 1 ? 'disabled' : ''}>上一页</button>
      <span class="num" style="font-size:var(--t-sm)">第 ${st.page} 页 / 约 ${totalPages} 页（池 ${st.poolSize} 条）</span>
      <button type="button" class="btn btn-sm js-next-page" ${!st.hasMore || st.exhausted && st.page * st.limit >= st.poolSize ? 'disabled' : ''}>下一页</button>
      ${st.exhausted ? `<span style="font-size:var(--t-xs);color:var(--fg-3)">已到末尾（共 ${st.poolSize} 条）</span>` : ''}
    </nav>`;
}

/**
 * 事件绑定（委托）：收藏（I-03）/重试/放宽（I-08）/翻页（I-05）
 * @param {HTMLElement} root
 * @param {{ onRetry(): void, onRelax(kind: 'year'|'lang'|'src'): void, onPage(delta: number): void }} handlers
 */
export function bindResults(root, handlers) {
  /** @type {(e: Event) => void} */
  const onClick = (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    const favBtn = /** @type {HTMLElement | null} */ (t.closest?.('.js-fav'));
    if (favBtn) {
      const id = favBtn.dataset.favId ?? '';
      const card = /** @type {HTMLElement | null} */ (favBtn.closest('.result-card'));
      const w = findWork(root, id);
      if (!w) return;
      const nowFav = toggleFav(w);
      favBtn.innerHTML = icon(nowFav ? 'star-filled' : 'star', { size: 16 });
      favBtn.setAttribute('aria-label', nowFav ? '取消收藏' : '收藏');
      showToast(nowFav ? '已收藏' : '已取消收藏', nowFav
        ? { actionLabel: '撤销', onAction: () => { toggleFav(w); favBtn.innerHTML = icon('star', { size: 16 }); favBtn.setAttribute('aria-label', '收藏'); } }
        : undefined);
      void card;
      return;
    }
    if (t.closest('.js-retry')) return handlers.onRetry();
    const relax = /** @type {HTMLElement | null} */ (t.closest?.('.js-relax'));
    if (relax) return handlers.onRelax(/** @type {any} */ (relax.dataset.relax));
    if (t.closest('.js-prev-page')) return handlers.onPage(-1);
    if (t.closest('.js-next-page')) return handlers.onPage(1);
  };
  root.addEventListener('click', onClick);
  return {
    destroy() {
      root.removeEventListener('click', onClick);
    },
  };
}

/** 从列表 data 中按 id 找 Work（渲染时缓存于 root dataset 不可行，改为闭包注入） */
/** @type {Map<HTMLElement, any[]>} */
const workRegistry = new Map();

/** 渲染后注册列表数据（供收藏回调取 Work）
 * @param {HTMLElement} root @param {any[]} works */
export function registerWorks(root, works) {
  workRegistry.set(root, works);
}

/** @param {HTMLElement} root @param {string} id */
function findWork(root, id) {
  return (workRegistry.get(root) ?? []).find((w) => w.id === id);
}

/** @param {string} s */
function escapeHtml(s) {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export { isFav };
