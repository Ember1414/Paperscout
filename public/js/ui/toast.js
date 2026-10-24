// @ts-check
/** Toast（6.3）：3s 自动消失、aria-live、新替旧、可选撤销按钮（I-03/I-11） */

let hideTimer = 0;

/**
 * @param {string} message
 * @param {{ actionLabel?: string, onAction?: () => void, durationMs?: number }} [opts]
 */
export function showToast(message, opts = {}) {
  let el = /** @type {HTMLElement | null} */ (document.querySelector('.toast.js-toast'));
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast js-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  if (hideTimer) clearTimeout(hideTimer);
  el.innerHTML = `${escapeHtml(message)}${opts.actionLabel ? `<button type="button" class="btn-link js-toast-action">${escapeHtml(opts.actionLabel)}</button>` : ''}`;
  el.style.display = 'flex';
  const actionBtn = /** @type {HTMLButtonElement | null} */ (el.querySelector('.js-toast-action'));
  if (actionBtn && opts.onAction) {
    actionBtn.addEventListener('click', () => {
      opts.onAction?.();
      hide();
    }, { once: true });
  }
  hideTimer = setTimeout(hide, opts.durationMs ?? 3000);

  function hide() {
    if (hideTimer) clearTimeout(hideTimer);
    if (el) el.style.display = 'none';
  }
}

/** @param {string} s */
function escapeHtml(s) {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
