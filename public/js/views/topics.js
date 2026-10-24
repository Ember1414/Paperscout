// @ts-check
import { icon } from '../icons.js';

/**
 * /topics 订阅管理（REBUILD_PLAN 5.13 / M7-04）：
 * localStorage ps-subs 读写（M4-07 写入；此处管理展示/删除）
 */

/** @param {string | undefined} s */
const esc = (s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;>').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function render() {
  return `<section aria-labelledby="topics-h" style="max-width:680px;margin:0 auto"><h1 id="topics-h" style="font-size:var(--t-lg)">我的订阅</h1><p style="font-size:var(--t-xs);color:var(--fg-3)">订阅数据存于本地浏览器；通知中心（增量角标）M7 后期上线。</p><div class="js-topics-body"><div class="skeleton" style="height:80px"></div></div></section>`;
}

/**
 * @param {HTMLElement} root
 */
export function mount(root) {
  const body = /** @type {HTMLElement} */ (root.querySelector('.js-topics-body'));
  /** @param {string | undefined} s */
function esc2(s) { return String(s ?? ''); }
const refresh = () => {
    let subs = /** @type {any[]} */ ([]);
    try { subs = JSON.parse(localStorage.getItem('ps-subs') ?? '[]'); } catch { /* 空 */ }
    if (!subs.length) {
      body.innerHTML = '<div class="empty-state"><p>暂无订阅。从作者页或期刊页点"订阅"按钮添加。</p><p><a class="btn btn-primary" href="/" data-link>去检索</a></p></div>';
      return;
    }
    body.innerHTML = subs.map((/** @type {any} */ s, /** @type {number} */ i) => `
      <div style="display:flex;align-items:center;gap:8px;margin:8px 0;padding:8px;border:1px solid var(--line);border-radius:6px">
        <span style="flex:1;font-size:var(--t-sm)">${esc(s.name)} <span class="badge">${esc(s.type)}</span></span>
        ${s.type === 'author' ? `<a class="btn btn-sm" href="/a/${esc(s.id)}" data-link>查看</a>` : s.type === 'venue' ? `<a class="btn btn-sm" href="/venue/${esc(s.id)}" data-link>查看</a>` : ''}
        <button type="button" class="btn btn-sm btn-ghost js-unsub" data-i="${i}">删除</button>
      </div>`).join('');
  };
  /** @type {(e: Event) => void} */
  const onClick = (e) => {
    const btn = /** @type {HTMLElement} */ ((/** @type {HTMLElement} */ (e.target)).closest?.('.js-unsub'));
    if (!btn) return;
    try {
      const subs = JSON.parse(localStorage.getItem('ps-subs') ?? '[]');
      subs.splice(Number(btn.dataset.i), 1);
      localStorage.setItem('ps-subs', JSON.stringify(subs));
      refresh();
    } catch { /* 忽略 */ }
  };
  body.addEventListener('click', onClick);
  refresh();
  return { destroy() { body.removeEventListener('click', onClick); } };
}

/** @type {import('../router.js').View} */
export default { render, mount };
