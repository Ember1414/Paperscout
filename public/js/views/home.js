// @ts-check
import { searchBarHtml, bindSearchBar } from '../ui/searchbar.js';
import { searchUrl } from '../url.js';

/**
 * 首页（4.3 线框 / 5.13.1 信息流）。
 * 今日前沿/经典必读（Warmer，M7）与订阅增量（M7）当前为诚实空态；最近检索由本地数据驱动（M2-11 起迁 IndexedDB）。
 */

/**
 * @param {import('../router.js').ViewCtx} _ctx
 */
export function render(_ctx) {
  const recent = readRecent();
  return `
    <section aria-labelledby="home-h" class="ps-home">
      <div style="text-align:center;margin:var(--s-6) 0 var(--s-5)">
        <h1 id="home-h" style="font-size:var(--t-2xl);margin-bottom:var(--s-2)">从一个问题开始</h1>
        <p style="color:var(--fg-2);margin-bottom:var(--s-5)">多源聚合 · 智能去重 · 排序可解释 · 证据可溯源</p>
        ${searchBarHtml({ autofocus: true })}
        <p style="font-size:var(--t-sm);color:var(--fg-3);margin-top:var(--s-3)">
          试试：
          <a href="/search?q=graph+neural+network" data-link>graph neural network</a> ·
          <a href="/search?q=%E5%A4%A7%E8%AF%AD%E8%A8%80%E6%A8%A1%E5%9E%8B%20%E5%B9%BB%E8%A7%89&amp;lang=zh" data-link>大语言模型 幻觉</a> ·
          <a href="/search?q=10.1038/s41586-023-06221-2" data-link>10.1038/s41586-023-06221-2</a>
        </p>
      </div>

      <div class="ps-home-grid">
        <section aria-labelledby="quick-h" class="ps-home-card">
          <h2 id="quick-h" style="font-size:var(--t-md)">快速开始</h2>
          <ul class="ps-quick-list">
            <li><a href="/search?q=%E5%A4%A7%E8%AF%AD%E8%A8%80%E6%A8%A1%E5%9E%8B&amp;sort=cited" data-link>某个方向必读论文（按被引）</a></li>
            <li><a href="/search?q=%E6%B7%B1%E5%BA%A6%E5%AD%A6%E4%B9%A0&amp;lang=zh" data-link>中文研究现状</a></li>
            <li><a href="/advanced" data-link>高级检索（条件组 + DSL）</a></li>
            <li><a href="/search?q=10.1145/3292500" data-link>从一篇论文出发（DOI 直达）</a></li>
          </ul>
        </section>

        <section aria-labelledby="recent-h" class="ps-home-card">
          <h2 id="recent-h" style="font-size:var(--t-md)">最近检索</h2>
          ${recent.length
            ? `<ul class="ps-quick-list">${recent.map((q) => `<li><a href="${searchUrl({ q })}" data-link>${escapeHtml(q)}</a></li>`).join('')}</ul>`
            : '<p style="color:var(--fg-3);font-size:var(--t-sm)">暂无最近检索——历史只保存在你的浏览器本地。</p>'}
        </section>

        <section aria-labelledby="fields-h" class="ps-home-card">
          <h2 id="fields-h" style="font-size:var(--t-md)">按学科浏览</h2>
          <p style="font-size:var(--t-sm)">
            <a href="/search?q=*&amp;field=cs" data-link>计算机</a> ·
            <a href="/search?q=*&amp;field=physics" data-link>物理</a> ·
            <a href="/search?q=*&amp;field=math" data-link>数学</a> ·
            <a href="/search?q=*&amp;field=bio" data-link>生物医学</a> ·
            <a href="/search?q=*&amp;field=med" data-link>医学</a> ·
            <a href="/search?q=*&amp;field=econ" data-link>经济</a>
          </p>
          <p style="color:var(--fg-3);font-size:var(--t-xs)">学科导航页（前沿+经典+顶会）在 M7 上线。</p>
        </section>

        <section aria-labelledby="feed-h" class="ps-home-card">
          <h2 id="feed-h" style="font-size:var(--t-md)">今日前沿</h2>
          <p style="color:var(--fg-3);font-size:var(--t-sm)">每日 arXiv 增量与经典必读榜单由定时预热服务聚合，M7 上线后在此展示。</p>
        </section>

        <section aria-labelledby="resume-h" class="ps-home-card">
          <h2 id="resume-h" style="font-size:var(--t-md)">继续阅读</h2>
          <p style="color:var(--fg-3);font-size:var(--t-sm)">暂无记录。打开任意论文详情后会出现在这里（数据仅存本地）。</p>
        </section>

        <section aria-labelledby="topics-h" class="ps-home-card">
          <h2 id="topics-h" style="font-size:var(--t-md)">我的订阅</h2>
          <p style="color:var(--fg-3);font-size:var(--t-sm)">暂无订阅。作者/主题订阅与站内通知在 M7 上线。</p>
        </section>
      </div>
    </section>`;
}

/**
 * @param {HTMLElement} root
 */
export function mount(root) {
  const sb = bindSearchBar(root, {});
  return {
    destroy() {
      sb?.destroy();
    },
  };
}

/** 最近检索（localStorage 简版；M2-11 迁移 IndexedDB） */
function readRecent() {
  try {
    const raw = /** @type {string | null} */ (localStorage.getItem('ps-recent-q'));
    const arr = raw ? /** @type {unknown} */ (JSON.parse(raw)) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string').slice(0, 5) : [];
  } catch {
    return [];
  }
}

/** @param {string} s */
function escapeHtml(s) {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** @type {import('../router.js').View} */
export default { render, mount };
