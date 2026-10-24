// @ts-check
import { icon } from '../icons.js';

/**
 * AppShell（REBUILD_PLAN 6.3）：顶栏 + 主区容器 + 页脚。
 * 由 index.html 的 #app 挂载；路由接管 #main。
 */

export function shellHtml() {
  return `
    <div class="ps-shell">
      <header class="ps-header">
        <div class="ps-header-inner">
          <a class="ps-logo" href="/" data-link><span class="logo-mark" aria-hidden="true">◍</span>PaperScout</a>
          <nav class="ps-nav" aria-label="全局导航">
            <a href="/library" data-link>文库</a>
            <a href="/about" data-link>关于</a>
            <button type="button" class="icon-btn js-theme-toggle" aria-label="切换明暗主题"></button>
          </nav>
        </div>
      </header>
      <main class="ps-main" id="main" aria-live="polite"></main>
      <footer class="ps-footer">
        元数据版权归原数据库/出版方；本站不托管全文 ·
        <a href="/legacy.html">旧版入口</a> ·
        Powered by Cloudflare Pages
      </footer>
    </div>`;
}

/** 头部主题按钮初始化（图标随主题切换） */
export function bindShell() {
  const btn = /** @type {HTMLButtonElement | null} */ (document.querySelector('.js-theme-toggle'));
  if (!btn) return;
  const paint = () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    btn.innerHTML = icon(dark ? 'sun' : 'moon', { size: 18 });
  };
  paint();
  btn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('ps-theme', next);
    } catch {
      /* 持久化失败不影响会话 */
    }
    paint();
  });
}
