// @ts-check
import { icon } from '../icons.js';

/**
 * CommandPalette（6.3 / I-10 / S-04 / S-23）：⌘K/Ctrl+K 唤起；
 * 模糊匹配（本地最近检索 + 命令）；↑↓⏎Esc；焦点陷阱。
 */

/** @typedef {{ id: string, label: string, hint?: string, run: () => void }} Command */

/** @type {boolean} */
let paletteOpen = false;
/** @type {{ destroy: () => void } | null} */
let handle = null;

/** 命令注册表（延迟执行 import 避免循环依赖） */
async function getCommands() {
  const { navigate } = await import('../router.js');
  const { submitSearch } = await import('./searchbar.js');
  const { toggleTheme } = await import('../app.js');
  const { cancelSearch } = await import('../store.js');
  /** @type {Command[]} */
  const commands = [
    { id: 'library', label: '去文库', hint: 'G L', run: () => navigate('/library') },
    { id: 'about', label: '打开关于页（方法/覆盖/隐私）', hint: 'G A', run: () => navigate('/about') },
    { id: 'advanced', label: '高级检索构建器', hint: 'G V', run: () => navigate('/advanced') },
    {
      id: 'copy-url',
      label: '复制当前检索链接',
      run: () => {
        navigator.clipboard?.writeText(location.href).then(
          () => void import('./toast.js').then(({ showToast }) => showToast('链接已复制')),
          () => void import('./toast.js').then(({ showToast }) => showToast('复制失败（浏览器未授权剪贴板）')),
        );
      },
    },
    { id: 'theme', label: '切换明暗主题', run: () => toggleTheme() },
    { id: 'stop', label: '停止当前检索', run: () => cancelSearch() },
  ];
  void submitSearch;
  return commands;
}

/** 模糊匹配：子序列命中（中文按包含） */
/**
 * @param {string} query
 * @param {string} text
 */
function fuzzyMatch(query, text) {
  if (!query) return true;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (t.includes(q)) return true;
  let i = 0;
  for (const ch of q) {
    i = t.indexOf(ch, i);
    if (i < 0) return false;
    i++;
  }
  return true;
}

/** 打开面板 */
async function open() {
  if (paletteOpen) return;
  paletteOpen = true;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const overlay = document.createElement('div');
  overlay.className = 'palette-overlay js-palette';
  overlay.innerHTML = `
    <div class="palette-panel" role="dialog" aria-modal="true" aria-label="命令面板">
      <label class="sr-only" for="palette-input">命令或检索词</label>
      <input id="palette-input" class="palette-input" type="text" placeholder="输入命令或检索词…" autocomplete="off" />
      <ul class="palette-list js-palette-list" role="listbox"></ul>
      <div style="padding:6px 12px;border-top:1px solid var(--line);font-size:var(--t-xs);color:var(--fg-3)">
        <kbd>↑↓</kbd> 选择 · <kbd>⏎</kbd> 执行 · <kbd>Esc</kbd> 关闭 · 输入文本后 ⏎ 直接检索
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const input = /** @type {HTMLInputElement} */ (overlay.querySelector('#palette-input'));
  const listEl = /** @type {HTMLElement} */ (overlay.querySelector('.js-palette-list'));
  const commands = await getCommands();
  /** @type {Array<{ label: string, hint?: string, run: () => void, kind: 'cmd' | 'search' }>} */
  let visible = [];

  /** @param {string} q */
  const renderList = (q) => {
    const cmds = commands.filter((c) => fuzzyMatch(q, c.label)).map((c) => ({ ...c, kind: /** @type {const} */ ('cmd') }));
    const searchItem = q.trim() ? [{ label: `检索「${q.trim()}」`, run: () => submitSearchRef(q.trim()), kind: /** @type {const} */ ('search') }] : [];
    visible = [...searchItem, ...cmds].slice(0, 9);
    listEl.innerHTML = visible
      .map((v, i) => `<li role="option" data-i="${i}" class="${i === 0 ? 'is-active' : ''}" aria-selected="${i === 0}">${escapeHtml(v.label)}${v.hint ? `<span class="pl-hint"><kbd>${v.hint}</kbd></span>` : ''}</li>`)
      .join('');
  };

  /** @param {string} q */
  const submitSearchRef = (q) => {
    void import('./searchbar.js').then(({ submitSearch }) => submitSearch(q));
  };

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onDocKey, true);
    paletteOpen = false;
    opener?.focus();
  };
  const setActive = (/** @type {number} */ i) => {
    [...listEl.children].forEach((li, j) => {
      li.classList.toggle('is-active', j === i);
      /** @type {HTMLElement} */ (li).setAttribute('aria-selected', j === i ? 'true' : 'false');
    });
    const el = /** @type {HTMLElement | null} */ (listEl.children[i]);
    el?.scrollIntoView({ block: 'nearest' });
  };
  const runIdx = (/** @type {number} */ i) => {
    const item = visible[i];
    if (!item) return;
    close();
    item.run();
  };

  /** @type {(e: KeyboardEvent) => void} */
  const onDocKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const cur = [...listEl.children].findIndex((li) => li.classList.contains('is-active'));
      const next = (cur + (e.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length;
      setActive(next);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cur = [...listEl.children].findIndex((li) => li.classList.contains('is-active'));
      runIdx(cur < 0 ? 0 : cur);
    } else if (e.key === 'Tab') {
      e.preventDefault(); // 焦点陷阱：面板内只有输入框
    }
  };

  input.addEventListener('input', () => renderList(input.value));
  listEl.addEventListener('click', (e) => {
    const li = /** @type {HTMLElement | null} */ ((/** @type {HTMLElement} */ (e.target)).closest?.('li'));
    if (li?.dataset.i) runIdx(Number(li.dataset.i));
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onDocKey, true);
  renderList('');
  input.focus();

  handle = { destroy: close };
}

/** 全局快捷键注册（⌘K / Ctrl+K） */
export function mountPalette() {
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (paletteOpen) handle?.destroy();
      else void open();
    }
  });
}

/** @param {string} s */
function escapeHtml(s) {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export { icon };
