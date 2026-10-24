// @ts-check
/**
 * PaperScout v3 前端入口（M2-01：壳层引导；M2-02 接入 router，M2-03 接入 store/api）。
 * 零构建 ESM；URL 是唯一真相（D-01/D-02）。
 */

const THEME_KEY = 'ps-theme';

/** 主题初始化：localStorage > 系统偏好（防 FOUC 的同款逻辑也内联在 index.html） */
export function initTheme() {
  let stored = null;
  try {
    stored = /** @type {string | null} */ (localStorage.getItem(THEME_KEY));
  } catch {
    stored = null; // 隐私模式等 localStorage 不可用场景，回退系统偏好
  }
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = stored === 'light' || stored === 'dark' ? stored : systemDark ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  return /** @type {'light' | 'dark'} */ (theme);
}

/** 切换主题并持久化 */
export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* 持久化失败不影响本次会话主题 */
  }
  return next;
}

/** v3 SW 策略：注销 v2 遗留 Service Worker（逃生脚本，M8-02 再做版本化缓存） */
async function retireLegacySW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) await reg.unregister();
  } catch {
    /* SW 状态不可读时忽略（无痕模式等） */
  }
}

function mountShell() {
  const root = document.getElementById('app');
  if (!root) return;
  root.innerHTML = `
    <div class="ps-shell">
      <header class="ps-header">
        <div class="ps-header-inner">
          <a class="ps-logo" href="/"><span class="logo-mark">◍</span>PaperScout</a>
          <nav class="ps-nav" aria-label="全局导航">
            <button type="button" class="icon-btn" id="theme-toggle" aria-label="切换明暗主题"></button>
          </nav>
        </div>
      </header>
      <main class="ps-main" id="main">
        <section class="empty-state" aria-live="polite">
          <h1>PaperScout v3</h1>
          <p>前端重构施工中（M2）。检索核心已在 API 层就绪：<code>/api/search?q=…</code></p>
          <p><a href="/legacy.html">临时使用旧版界面</a>（保留 7 天）</p>
        </section>
      </main>
      <footer class="ps-footer">
        元数据版权归原数据库/出版方；本站不托管全文 · Powered by Cloudflare Pages
      </footer>
    </div>`;
  const btn = /** @type {HTMLButtonElement | null} */ (document.getElementById('theme-toggle'));
  if (btn) {
    btn.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀' : '☾';
    btn.addEventListener('click', () => {
      const next = toggleTheme();
      btn.textContent = next === 'dark' ? '☀' : '☾';
    });
  }
}

initTheme();
mountShell();
void retireLegacySW();
