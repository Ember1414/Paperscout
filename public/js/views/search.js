// @ts-check
/** 检索结果页（M2-05 完整实现；本版为路由占位，展示 URL 状态契约） */

/**
 * @param {import('../router.js').ViewCtx} ctx
 */
export function render(ctx) {
  const q = ctx.url.searchParams.get('q') ?? '';
  return `
    <section>
      <h1>检索结果</h1>
      <div class="notice-bar notice-warn">结果页在 M2-05 交付。当前 URL 状态：<code>q=${escapeHtml(q)}</code></div>
      <p><a class="btn" href="/" data-link>返回首页</a></p>
    </section>`;
}

/** @param {string} s */
function escapeHtml(s) {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** @type {import('../router.js').View} */
export default { render };
