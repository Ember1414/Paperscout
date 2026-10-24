// @ts-check
/**
 * SPA 路由（REBUILD_PLAN 4.1 / 7.2）：History API + _redirects 回退。
 * 契约（D-02）：视图导出 render(ctx): string（html 模板转义输出）与可选 mount(root, ctx)（返回 { update?, destroy? }）。
 * 滚动策略（I-05）：pushState 前记录滚动位置；popstate 恢复；新页面回顶部。
 */

/**
 * @typedef {object} ViewCtx
 * @property {URL} url
 * @property {Record<string, string>} params
 */

/**
 * @typedef {object} View
 * @property {(ctx: ViewCtx) => string} render
 * @property {(root: HTMLElement, ctx: ViewCtx) => ({ update?: (data: unknown) => void, destroy?: () => void } | void) | Promise<({ update?: (data: unknown) => void, destroy?: () => void } | void)>} [mount]
 */

/**
 * @typedef {object} RouteDef
 * @property {string} pattern
 * @property {() => Promise<{ default: View }>} load  动态 import，降低首屏字节（7.2）
 */

/** @type {RouteDef[]} */
const ROUTES = [
  { pattern: '/', load: () => import('./views/home.js') },
  { pattern: '/search', load: () => import('./views/search.js') },
  { pattern: '/advanced', load: () => import('./views/advanced.js') },
  { pattern: '/library', load: () => import('./views/notfound.js') }, // M5 接管
  { pattern: '/about', load: () => import('./views/notfound.js') }, // M3 接管
  { pattern: '/p/:id', load: () => import('./views/notfound.js') }, // M3 接管
];

/** @type {Map<string, { view: View }>} */
const viewCache = new Map();

/**
 * 路径匹配：'/p/:id' → { id }
 * @param {string} pattern
 * @param {string} pathname
 * @returns {Record<string, string> | null}
 */
export function matchPath(pattern, pathname) {
  const p = pattern.split('/').filter(Boolean);
  const a = pathname.split('/').filter(Boolean);
  if (p.length !== a.length) return null;
  /** @type {Record<string, string>} */
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(a[i]);
    else if (p[i] !== a[i]) return null;
  }
  return params;
}

/** 当前活动视图的清理句柄 */
/** @type {{ destroy?: () => void } | null} */
let activeHandle = null;
/** 滚动位置记忆：key = history.state 的 psScrollKey */
const scrollMemory = new Map();
let scrollSeq = 0;

/**
 * 渲染当前 URL 对应视图
 * @param {{ main: HTMLElement }} els
 */
async function renderCurrent(els) {
  const url = new URL(location.href);
  const pathname = url.pathname;

  let matched = null;
  /** @type {Record<string, string>} */
  let params = {};
  for (const r of ROUTES) {
    const m = matchPath(r.pattern, pathname);
    if (m) {
      matched = r;
      params = m;
      break;
    }
  }

  if (activeHandle?.destroy) {
    try {
      activeHandle.destroy();
    } catch (e) {
      console.warn('router:destroy-failed', e instanceof Error ? e.message : String(e));
    }
  }
  activeHandle = null;

  if (!matched) {
    const nf = await import('./views/notfound.js');
    els.main.innerHTML = nf.notFoundHtml(url.pathname);
    return;
  }

  let mod = viewCache.get(matched.pattern);
  if (!mod) {
    const loaded = await matched.load();
    mod = { view: loaded.default };
    viewCache.set(matched.pattern, mod);
  }
  const ctx = { url, params };
  els.main.innerHTML = mod.view.render(ctx);
  if (mod.view.mount) {
    const h = await mod.view.mount(els.main, ctx);
    if (h && typeof h === 'object') activeHandle = h;
  }
}

/**
 * 启动路由
 * @param {{ main: HTMLElement }} els
 */
export function startRouter(els) {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.addEventListener('popstate', () => {
    const st = /** @type {any} */ (history.state);
    const key = st?.psScrollKey;
    void renderCurrent(els).then(() => {
      const y = key !== undefined ? scrollMemory.get(key) : 0;
      window.scrollTo(0, typeof y === 'number' ? y : 0);
    });
  });
  // 拦截站内 <a data-link> 点击（事件委托，6.3 渲染约定）
  document.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const a = /** @type {HTMLAnchorElement | null} */ (target.closest?.('a[data-link]'));
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || a.target === '_blank' || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    navigate(href);
  });
  return renderCurrent(els);
}

/**
 * 站内导航（pushState；replace=true 用于抽屉深链等不污染后退栈的场景）
 * @param {string} href
 * @param {{ replace?: boolean, scrollKey?: number }} [opts]
 */
export function navigate(href, opts = {}) {
  const scrollKey = opts.scrollKey ?? ++scrollSeq;
  scrollMemory.set(scrollKey, window.scrollY);
  const state = { psScrollKey: scrollKey };
  if (opts.replace) history.replaceState(state, '', href);
  else history.pushState(state, '', href);
  const els = { main: /** @type {HTMLElement} */ (document.getElementById('main')) };
  void renderCurrent(els).then(() => {
    if (!opts.replace) window.scrollTo(0, 0);
  });
}

/** 生成带 data-link 的站内链接属性（防遗漏）
 * @param {string} href */
export function linkAttrs(href) {
  return `href="${href}" data-link`;
}

/** 仅替换地址栏（不重渲染）——抽屉深链 sel 开合专用（4.2 replaceState 规则）
 * @param {string} href */
export function replaceUrlSilent(href) {
  const st = /** @type {any} */ (history.state) ?? {};
  history.replaceState(st, '', href);
}
