// @ts-check

/** /notifications 通知中心（M7-05 前端） */

/** @param {string | undefined} s */
const esc = (s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function render() {
  return `<section aria-labelledby="notif-h" style="max-width:680px;margin:0 auto"><h1 id="notif-h" style="font-size:var(--t-lg)">通知中心</h1><div class="js-notif-body"><div class="skeleton" style="height:80px"></div></div></section>`;
}

/**
 * @param {HTMLElement} root
 */
export function mount(root) {
  const body = /** @type {HTMLElement} */ (root.querySelector('.js-notif-body'));
  const ctrl = new AbortController();

  fetch('/api/notifications', { signal: ctrl.signal })
    .then((r) => r.json())
    .then((j) => {
      const d = j?.data ?? {};
      const note = d.note ?? '';
      if (!d.items?.length) {
        body.innerHTML = `<div class="empty-state"><p>暂无通知。</p><p style="font-size:var(--t-xs);color:var(--fg-3)">${esc(note || '订阅作者或期刊后，新论文会在此通知。')}</p><p><a class="btn btn-primary" href="/" data-link>去检索</a></p></div>`;
        return;
      }
      body.innerHTML = d.items.map((/** @type {any} */ item) => `<div style="padding:8px 0;border-bottom:1px solid var(--line);font-size:var(--t-sm)">${esc(item.title)}</div>`).join('');
    })
    .catch(() => {
      body.innerHTML = '<div class="empty-state"><p>通知加载失败。</p></div>';
    });

  return { destroy() { ctrl.abort(); } };
}

/** @type {import('../router.js').View} */
export default { render, mount };
