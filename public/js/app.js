// @ts-check
/**
 * PaperScout v3 前端入口（M2-01：壳层引导；M2-02 接入 router，M2-03 接入 store/api）。
 * 零构建 ESM；URL 是唯一真相（D-01/D-02）。
 */

import { shellHtml, bindShell } from './ui/shell.js';
import { startRouter } from './router.js';
import { mountPalette } from './ui/palette.js';
import { bindGlobalKeys } from './ui/keyboard.js';

const THEME_KEY = 'ps-theme';

/** 切换主题并持久化（palette 命令复用） */
export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem('ps-theme', next);
  } catch { /* 会话内仍生效 */ }
  return /** @type {'light' | 'dark'} */ (next);
}

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

async function boot() {
  initTheme();
  const root = document.getElementById('app');
  if (!root) return;
  root.innerHTML = shellHtml();
  bindShell();
  const main = /** @type {HTMLElement | null} */ (document.getElementById('main'));
  if (main) await startRouter({ main });
  mountPalette();
  bindGlobalKeys();
}

void boot();
void retireLegacySW();
