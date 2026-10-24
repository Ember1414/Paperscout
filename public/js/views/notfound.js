// @ts-check
/** 404 视图（4.5：友好说明 + 搜索框，回首页） */

/**
 * @param {string} [path]
 * @returns {string}
 */
export function notFoundHtml(path = '') {
  return `
    <section class="empty-state">
      <h1>404 · 页面不存在</h1>
      <p>没有找到 <code>${escapeHtml(path)}</code>。它可能已被移动，或链接有误。</p>
      <p><a class="btn btn-primary" href="/" data-link>回到首页检索</a> <a class="btn" href="/legacy.html">旧版入口</a></p>
    </section>`;
}

/** @param {string} s */
function escapeHtml(s) {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** @type {import('../router.js').View} */
export default {
  /** @param {import('../router.js').ViewCtx} ctx */
  render(ctx) {
    return notFoundHtml(ctx.url.pathname);
  },
};
