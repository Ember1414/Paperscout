// @ts-check
import { searchUrl } from '../url.js';

/**
 * SearchBar（6.3）：`/` 聚焦；Enter/提交 → navigate 到 /search（URL 唯一真相）。
 * 联想下拉在 M2-10 接入（本地历史 + 热词，不阻塞输入）。
 */

/**
 * @param {object} opts
 * @param {string} [opts.value]
 * @param {boolean} [opts.autofocus]
 * @returns {string} html
 */
export function searchBarHtml(opts = {}) {
  return `
    <form class="ps-searchbar js-searchbar" role="search" style="display:flex;gap:8px;max-width:760px;margin:0 auto">
      <label class="sr-only" for="ps-q">检索关键词</label>
      <input id="ps-q" type="search" name="q" maxlength="200" autocomplete="off"
        placeholder="搜索论文、作者、DOI，或直接描述你的问题…"
        value="${escapeAttr(opts.value ?? '')}"
        ${opts.autofocus ? 'autofocus' : ''} style="flex:1" />
      <button class="btn btn-primary" type="submit">检索</button>
    </form>`;
}

/**
 * @param {HTMLElement} root
 * @param {{ value?: string }} [opts]
 */
export function bindSearchBar(root, opts = {}) {
  const form = /** @type {HTMLFormElement | null} */ (root.querySelector('.js-searchbar'));
  if (!form) return { destroy() {} };
  /** @param {Event} e */
  const onSubmit = (e) => {
    e.preventDefault();
    const input = /** @type {HTMLInputElement} */ (form.querySelector('input[name="q"]'));
    const q = input.value.trim();
    if (!q) return;
    submitSearch(q);
  };
  form.addEventListener('submit', onSubmit);
  return {
    destroy() {
      form.removeEventListener('submit', onSubmit);
    },
  };
}

/** 检索提交（延迟 import 避免循环依赖）
 * @param {string} q */
export function submitSearch(q) {
  void import('../router.js').then(({ navigate }) => navigate(searchUrl({ q })));
}

/** @param {string} s */
function escapeAttr(s) {
  return s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
