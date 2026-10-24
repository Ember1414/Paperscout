// @ts-check
/** 首页（M2-04 完整实现；本版先交付可用的检索入口，URL → /search 契约与 4.2 一致） */

/**
 * @param {import('../router.js').ViewCtx} _ctx
 */
export function render(_ctx) {
  return `
    <section aria-labelledby="home-h">
      <h1 id="home-h">从一个问题开始</h1>
      <p style="color:var(--fg-2)">多源聚合 · 智能去重 · 排序可解释 · 证据可溯源。支持检索式语法：<code>author:</code> <code>year:</code> <code>"短语"</code> <code>-排除</code></p>
      <form class="js-home-search" style="display:flex;gap:8px;max-width:720px;margin:16px 0">
        <label class="sr-only" for="home-q">检索关键词</label>
        <input id="home-q" type="search" name="q" placeholder="搜索论文、作者、DOI，或直接描述你的问题…" style="flex:1" maxlength="200" />
        <button class="btn btn-primary" type="submit">检索</button>
      </form>
      <p style="font-size:var(--t-sm);color:var(--fg-3)">试试：<a href="/search?q=graph+neural+network" data-link>graph neural network</a> · <a href="/search?q=%E5%A4%A7%E8%AF%AD%E8%A8%80%E6%A8%A1%E5%9E%8B%20%E5%B9%BB%E8%A7%89&lang=zh" data-link>大语言模型 幻觉</a> · <a href="/search?q=10.1038/s41586-023-06221-2" data-link>10.1038/s41586-023-06221-2</a></p>
      <div class="notice-bar notice-warn" style="margin-top:32px">M2 施工中：结果页（M2-05）落地前，检索会先跳转到占位页。</div>
    </section>`;
}

/**
 * @param {HTMLElement} root
 * @param {import('../router.js').ViewCtx} ctx
 */
export function mount(root, ctx) {
  const form = /** @type {HTMLFormElement | null} */ (root.querySelector('.js-home-search'));
  /** @param {Event} e */
  const handler = (e) => {
    e.preventDefault();
    const input = /** @type {HTMLInputElement | null} */ (form?.querySelector('input[name="q"]'));
    const q = (input?.value ?? '').trim();
    if (!q) return;
    ctxUrl(q);
  };
  form?.addEventListener('submit', handler);
  /** @param {string} q */
  function ctxUrl(q) {
    // 延迟取 router，避免循环依赖
    import('../router.js').then(({ navigate }) => navigate(`/search?q=${encodeURIComponent(q)}`));
  }
  return {
    destroy() {
      form?.removeEventListener('submit', handler);
    },
  };
}

/** @type {import('../router.js').View} */
export default { render, mount };
