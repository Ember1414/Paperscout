// @ts-check
/**
 * 全键盘流程（I-01 / M2-12 DoD：全流程不用鼠标完成一次检索）：
 * `/` 聚焦搜索框 · `j/k` 结果间移动（滚动跟随 + is-current 标识）· `⏎` 打开当前项详情
 * `g h/l/a` 跳首页/文库/高级检索 · `Esc` 由各组件自理 · 命令面板 ⌘K（palette.js 自理）。
 */

/** @type {number} */
let currentIndex = -1;
/** @type {string | null} */
let pendingG = null;

/** 获取当前结果卡列表 */
function cards() {
  return [...document.querySelectorAll('.result-card')];
}

/** @param {number} i */
function setCurrent(i) {
  const list = cards();
  if (!list.length) return;
  currentIndex = Math.max(0, Math.min(i, list.length - 1));
  list.forEach((c, j) => {
    c.classList.toggle('is-current', j === currentIndex);
    /** @type {HTMLElement} */ (c).setAttribute('aria-current', j === currentIndex ? 'true' : 'false');
  });
  list[currentIndex].scrollIntoView({ block: 'nearest' });
}

/** @returns {Promise<void>} */
function openCurrent() {
  const list = cards();
  if (currentIndex < 0 || !list[currentIndex]) return Promise.resolve();
  const title = /** @type {HTMLElement | null} */ (list[currentIndex].querySelector('.r-title'));
  if (title) {
    title.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }
  return Promise.resolve();
}

/** 注册全局键盘（视图无关；无结果卡时 j/k/⏎ 为 no-op） */
export function bindGlobalKeys() {
  document.addEventListener('keydown', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const inField = /^(input|textarea|select)$/i.test(target.tagName) || target.isContentEditable;
    if (inField || e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === '/') {
      e.preventDefault();
      const input = /** @type {HTMLInputElement | null} */ (document.querySelector('.js-searchbar input[name="q"]') ?? document.querySelector('#home-q'));
      input?.focus();
      input?.select();
      return;
    }
    if (pendingG) {
      const seq = pendingG + e.key.toLowerCase();
      pendingG = null;
      if (seq === 'gh') void import('../router.js').then(({ navigate }) => navigate('/'));
      else if (seq === 'gl') void import('../router.js').then(({ navigate }) => navigate('/library'));
      else if (seq === 'ga') void import('../router.js').then(({ navigate }) => navigate('/about'));
      else if (seq === 'gv') void import('../router.js').then(({ navigate }) => navigate('/advanced'));
      return;
    }
    if (e.key.toLowerCase() === 'g' && !e.shiftKey) {
      pendingG = 'g';
      setTimeout(() => { pendingG = null; }, 1200);
      return;
    }
    if (e.key === 'j') setCurrent(currentIndex < 0 ? 0 : currentIndex + 1);
    else if (e.key === 'k') setCurrent(currentIndex <= 0 ? 0 : currentIndex - 1);
    else if (e.key === 'Enter' && currentIndex >= 0) void openCurrent();
  });
}
