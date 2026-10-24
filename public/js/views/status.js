// @ts-check
import { apiGet } from '../api.js';

/**
 * /status 数据源健康 + 今日配额 + 版本（REBUILD_PLAN 4.1 / F-60~F-63）
 */

/** @param {string | undefined} s */
const esc = (s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function render() {
  return `
    <section aria-labelledby="status-h">
      <h1 id="status-h">系统状态</h1>
      <div class="js-status-body"><div class="skeleton" style="height:120px"></div></div>
    </section>`;
}

/** @param {HTMLElement} body */
export async function hydrate(body) {
  try {
    const body0 = await apiGet('/api/status');
    const d = /** @type {any} */ (body0?.data ?? body0);
    body.innerHTML = statusHtml(d);
  } catch {
    body.innerHTML = '<div class="empty-state" role="alert"><p>状态接口暂不可用，请稍后刷新。</p></div>';
  }
}

/** @param {any} d */
function statusHtml(d) {
  const dash = '—';
  return `
    <p style="font-size:var(--t-sm);color:var(--fg-2)">版本 <code>v${esc(d.version)}</code> · 服务器时间 ${esc(String(d.time).slice(0, 19).replace('T', ' '))} UTC</p>
    ${(d.notes ?? []).map((/** @type {string} */ n) => `<div class="notice-bar notice-warn">${esc(n)}</div>`).join('')}

    <section aria-labelledby="src-h" style="margin-top:var(--s-4)">
      <h2 id="src-h" style="font-size:var(--t-md)">数据源近 24h</h2>
      <table class="data-table">
        <thead><tr><th>源</th><th class="num">成功</th><th class="num">失败</th><th class="num">平均耗时</th><th>成功率</th></tr></thead>
        <tbody>
          ${(d.sources ?? []).map((/** @type {any} */ s) => `<tr>
            <td>${esc(s.name)}</td>
            <td class="num">${s.ok24h ?? dash}</td>
            <td class="num">${s.fail24h ?? dash}</td>
            <td class="num">${s.avgMs24h ? s.avgMs24h + 'ms' : dash}</td>
            <td>${esc(s.rate)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </section>

    <section aria-labelledby="quota-h" style="margin-top:var(--s-4)">
      <h2 id="quota-h" style="font-size:var(--t-md)">今日用量</h2>
      <table class="data-table">
        <thead><tr><th>指标</th><th>值</th><th>预算</th></tr></thead>
        <tbody>
          <tr><td>检索次数</td><td class="num">${d.today?.searches ?? dash}</td><td class="num">≤ 20,000</td></tr>
          <tr><td>平均耗时</td><td class="num">${d.today?.avgMs ? d.today.avgMs + 'ms' : dash}</td><td class="num">冷 ≤ 6,500ms</td></tr>
          <tr><td>缓存命中率</td><td class="num">${esc(d.today?.cacheHitRate ?? dash)}</td><td class="num">≥ 40%</td></tr>
          <tr><td>KV 写</td><td class="num">${d.today?.kvWrites ?? dash}</td><td class="num">≤ 300/天</td></tr>
          <tr><td>AI 调用</td><td class="num">${d.today?.aiCalls ?? dash}${d.today?.aiQuotaGlobal ? ` / ${d.today.aiQuotaGlobal.limit}` : ''}</td><td class="num">≤ 350/天</td></tr>
        </tbody>
      </table>
    </section>

    <p style="margin-top:var(--s-4);font-size:var(--t-xs);color:var(--fg-3)">
      数据来源：D1 聚合（非实时探测）。源健康 24h 成功率由定时预热服务（M7）聚合；
      AI 配额每 00:00 UTC 重置；免费额度详单见 <a href="/about" data-link>关于页</a>。
    </p>`;
}

/** @type {import('../router.js').View} */
export default {
  render,
  mount(root) {
    const body = /** @type {HTMLElement} */ (root.querySelector('.js-status-body'));
    if (body) void hydrate(body);
    return { destroy() {} };
  },
};
