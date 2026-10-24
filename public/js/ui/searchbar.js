// @ts-check
import { searchUrl } from '../url.js';

/**
 * SearchBar（6.3 / M2-10）：`/` 聚焦；提交 → /search（URL 唯一真相）。
 * 联想（S-32）：输入 300ms 防抖后出建议（本地历史优先 + /api/suggest 补充），
 * 键盘 ↑↓ 选择、⏎ 执行、Esc 关闭；接口失败静默降级为纯本地建议，不阻塞输入。
 */

/**
 * @param {object} opts
 * @param {string} [opts.value]
 * @param {boolean} [opts.autofocus]
 * @returns {string} html
 */
export function searchBarHtml(opts = {}) {
  return `
    <form class="ps-searchbar js-searchbar" role="search" style="display:flex;gap:8px;max-width:760px;margin:0 auto;position:relative">
      <label class="sr-only" for="ps-q">检索关键词</label>
      <input id="ps-q" type="search" name="q" maxlength="200" autocomplete="off"
        placeholder="搜索论文、作者、DOI，或直接描述你的问题…"
        value="${escapeAttr(opts.value ?? '')}"
        ${opts.autofocus ? 'autofocus' : ''} style="flex:1" />
      <button class="btn btn-primary" type="submit">检索</button>
      <ul class="palette-list js-suggest" role="listbox" aria-label="检索建议" hidden
        style="position:absolute;top:100%;left:0;right:88px;background:var(--surface);border:1px solid var(--line);border-radius:6px;box-shadow:var(--shadow-pop);z-index:300;margin-top:4px"></ul>
    </form>`;
}

/**
 * @param {HTMLElement} root
 * @param {{ value?: string }} [opts]
 */
export function bindSearchBar(root, opts = {}) {
  const form = /** @type {HTMLFormElement | null} */ (root.querySelector('.js-searchbar'));
  if (!form) return { destroy() {} };
  const input = /** @type {HTMLInputElement} */ (form.querySelector('input[name="q"]'));
  const list = /** @type {HTMLElement | null} */ (form.querySelector('.js-suggest'));
  /** @type {{ text: string }[]} */
  let items = [];
  let activeIdx = -1;
  /** @type {number | undefined} */
  let debounceTimer;
  /** @type {AbortController | null} */
  let suggestAbort = null;

  const hide = () => {
    if (list) list.hidden = true;
    activeIdx = -1;
  };

  /** @param {{ text: string, kind?: string }[]} suggestions */
  const renderList = (suggestions) => {
    if (!list) return;
    items = suggestions;
    activeIdx = -1;
    if (!suggestions.length) {
      hide();
      return;
    }
    list.innerHTML = suggestions
      .map((s, i) => `<li role="option" data-i="${i}" aria-selected="false">${escapeHtml(s.text)}${s.kind ? ` <span class="pl-hint">${kindLabel(s.kind)}</span>` : ''}</li>`)
      .join('');
    list.hidden = false;
  };

  /** @param {string} kind */
  const kindLabel = (kind) => ({ spell: '你是不是要找', prefix: '热词', synonym: '同义', related: '相关' })[kind] ?? '';

  /** @param {string} q */
  const fetchSuggest = (q) => {
    const local = localHistory(q);
    suggestAbort?.abort();
    suggestAbort = new AbortController();
    fetch(`/api/suggest?q=${encodeURIComponent(q)}`, { signal: suggestAbort.signal })
      .then((r) => (r.ok ? r.json() : { data: { suggestions: [] } }))
      .then((body) => {
        const remote = /** @type {{ text: string, kind: string }[]} */ (body?.data?.suggestions ?? []);
        const merged = [...local, ...remote.filter((r) => !local.some((l) => l.text.toLowerCase() === r.text.toLowerCase()))].slice(0, 7);
        renderList(merged);
      })
      .catch(() => renderList(local)); // 离线/失败：纯本地建议，不阻塞输入
  };

  /** 本地历史前缀匹配（M2-11 迁 IndexedDB，此处读简版存储） */
  const localHistory = (q) => {
    try {
      const raw = /** @type {string | null} */ (localStorage.getItem('ps-recent-q'));
      const arr = raw ? /** @type {unknown} */ (JSON.parse(raw)) : [];
      if (!Array.isArray(arr)) return [];
      return arr.filter((x) => typeof x === 'string' && x.toLowerCase().startsWith(q.toLowerCase()) && x.toLowerCase() !== q.toLowerCase())
        .slice(0, 3)
        .map((x) => ({ text: x }));
    } catch {
      return [];
    }
  };

  /** @type {(e: Event) => void} */
  const onInput = () => {
    const q = input.value.trim();
    if (debounceTimer) clearTimeout(debounceTimer);
    if (q.length < 2) {
      hide();
      return;
    }
    debounceTimer = setTimeout(() => fetchSuggest(q), 300);
  };

  /** @type {(e: KeyboardEvent) => void} */
  const onKey = (e) => {
    if (!list || list.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      activeIdx = (activeIdx + delta + items.length) % items.length;
      [...list.children].forEach((li, i) => {
        li.classList.toggle('is-active', i === activeIdx);
        /** @type {HTMLElement} */ (li).setAttribute('aria-selected', i === activeIdx ? 'true' : 'false');
      });
    } else if (e.key === 'Enter' && activeIdx >= 0 && items[activeIdx]) {
      e.preventDefault();
      input.value = items[activeIdx].text;
      hide();
      submitSearch(items[activeIdx].text);
    } else if (e.key === 'Escape') {
      hide();
    }
  };

  /** @type {(e: Event) => void} */
  const onListClick = (e) => {
    const li = /** @type {HTMLElement | null} */ ((/** @type {HTMLElement} */ (e.target)).closest?.('li'));
    if (!li?.dataset.i) return;
    const item = items[Number(li.dataset.i)];
    if (!item) return;
    input.value = item.text;
    hide();
    submitSearch(item.text);
  };

  /** @type {(e: Event) => void} */
  const onSubmit = (e) => {
    e.preventDefault();
    hide();
    const q = input.value.trim();
    if (!q) return;
    submitSearch(q);
  };

  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKey);
  list?.addEventListener('click', onListClick);
  form.addEventListener('submit', onSubmit);
  document.addEventListener('click', (e) => {
    if (!form.contains(/** @type {Node} */ (e.target))) hide();
  });

  return {
    destroy() {
      input.removeEventListener('input', onInput);
      input.removeEventListener('keydown', onKey);
      list?.removeEventListener('click', onListClick);
      form.removeEventListener('submit', onSubmit);
      if (debounceTimer) clearTimeout(debounceTimer);
      suggestAbort?.abort();
    },
  };
}

/** 检索提交（延迟 import 避免循环依赖）
 * @param {string} q */
export function submitSearch(q) {
  void import('../router.js').then(({ navigate }) => navigate(searchUrl({ q })));
}

/** @param {string} s */
function escapeHtml(s) {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
/** @param {string} s */
function escapeAttr(s) {
  return escapeHtml(s);
}
