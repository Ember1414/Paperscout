// @ts-check
import { icon } from '../icons.js';

/**
 * DetailDrawer（6.3 / M2-06）：右滑抽屉 + Esc 关闭 + 焦点归还（S-06）+ 深链 sel（4.2 replaceState）。
 * 内容来自池内 Work（零新请求）；/p/:id 完整详情页在 M3-01 扩展。
 */

/**
 * @param {any} w Work
 * @returns {string}
 */
export function drawerContentHtml(w) {
  const authors = (w.authors ?? []).map((/** @type {any} */ a) => (typeof a === 'string' ? a : a?.name)).filter(Boolean);
  const metrics = [
    typeof w.citations === 'number' ? `被引 ${w.citations.toLocaleString('zh-CN')}` : '',
    w.openAccess ? '开放获取' : '',
    `置信度 ${w.confidence ?? '—'}`,
    w.sources?.length ? `收录于 ${w.sources.length} 源` : '',
  ].filter(Boolean);
  return `
    <div class="drawer-head">
      <h2 class="paper-title" style="font-size:var(--t-lg)">${escapeHtml(w.title)}</h2>
      <button type="button" class="icon-btn js-drawer-close" aria-label="关闭详情">${icon('x', { size: 18 })}</button>
    </div>
    <p style="color:var(--fg-2);font-size:var(--t-sm)">${escapeHtml(authors.slice(0, 6).join(', '))}${authors.length > 6 ? ` 等 ${authors.length} 人` : ''}</p>
    <p style="font-size:var(--t-sm)">${escapeHtml(String(w.venue ?? '出版方未知'))} · ${w.year ?? '—'} ${w.doi ? `· DOI <code>${escapeHtml(w.doi)}</code>` : ''}</p>
    <p style="font-size:var(--t-xs);color:var(--fg-3)">${metrics.map((m) => escapeHtml(m)).join(' · ')}${w.sources?.length ? `（${escapeHtml(w.sources.map((/** @type {any} */ s) => s.sourceName).join('/'))}）` : ''}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:var(--s-3) 0">
      ${w.doi ? `<a class="btn btn-sm" href="https://doi.org/${escapeAttr(w.doi)}" target="_blank" rel="noopener">打开原文</a>` : w.url ? `<a class="btn btn-sm" href="${escapeAttr(w.url)}" target="_blank" rel="noopener">打开原文</a>` : ''}
      ${w.pdfUrl ? `<a class="btn btn-sm" href="${escapeAttr(w.pdfUrl)}" target="_blank" rel="noopener">PDF</a>` : ''}
    </div>
    ${w.abstract
      ? `<details${String(w.abstract).length > 300 ? '' : ' open'}>
          <summary style="cursor:pointer;font-size:var(--t-sm);color:var(--fg-2)">摘要（展开不重新请求）</summary>
          <p style="font-size:var(--t-sm);line-height:1.7">${escapeHtml(String(w.abstract))}</p>
        </details>`
      : '<p style="color:var(--fg-3);font-size:var(--t-sm)">该来源未提供摘要。</p>'}
    <p style="margin-top:var(--s-4);font-size:var(--t-xs);color:var(--fg-3)">完整详情页（引文网络/OA 探测/引用格式/AI 精读/笔记）在 M3 交付；本抽屉为检索池内即时预览。</p>`;
}

/**
 * 打开抽屉：渲染内容、焦点陷阱进入、Esc/遮罩关闭并归还焦点
 * @param {HTMLElement} container 抽屉挂载点（.ps-col-detail 或 body 级）
 * @param {any} w
 * @param {{ onClose?: () => void }} [opts]
 * @returns {{ destroy: () => void }}
 */
export function openDrawer(container, w, opts = {}) {
  const opener = /** @type {HTMLElement | null} */ (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const overlay = document.createElement('div');
  overlay.className = 'drawer-overlay js-drawer-overlay';
  overlay.innerHTML = `<div class="drawer-panel" role="dialog" aria-modal="true" aria-label="论文详情">${drawerContentHtml(w)}</div>`;
  container.appendChild(overlay);
  const panel = /** @type {HTMLElement} */ (overlay.querySelector('.drawer-panel'));

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    opener?.focus(); // S-06 焦点归还
    opts.onClose?.();
  };
  /** @type {(e: KeyboardEvent) => void} */
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'Tab') {
      // 焦点陷阱（S-23 同机制）
      const focusables = panel.querySelectorAll('button, a[href], input, [tabindex]:not([tabindex="-1"])');
      if (!focusables.length) return;
      const first = /** @type {HTMLElement} */ (focusables[0]);
      const last = /** @type {HTMLElement} */ (focusables[focusables.length - 1]);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('.js-drawer-close')?.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  panel.focus();
  if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');

  return { destroy: close };
}

/** @param {string} s */
function escapeHtml(s) {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
/** @param {string} s */
function escapeAttr(s) {
  return escapeHtml(s);
}
