// @ts-check
import { showToast } from '../ui/toast.js';
import { clearAllLocalData } from '../db.js';

/**
 * /about（REBUILD_PLAN 4.1 / F-61 / 5.10 / 7.9 合规项全量）
 */

/** @param {string | undefined} s */
const esc = (s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function render() {
  return `
    <section aria-labelledby="about-h" style="max-width:820px;margin:0 auto">
      <h1 id="about-h">关于 PaperScout</h1>
      <p style="color:var(--fg-2)">证据可溯源的学术研究工作台：帮研究者在 60 秒内从"一个模糊问题"走到"一份可引用的文献清单"。</p>

      <h2 style="font-size:var(--t-md);margin-top:var(--s-5)">工作方法</h2>
      <ul style="font-size:var(--t-sm);line-height:1.8;padding-left:20px">
        <li><strong>多源并行聚合</strong>：一次检索同时调用最多 9 个学术数据源，结果在本地融合去重（DOI 优先 + 标题指纹 + 并查集）。</li>
        <li><strong>排序可解释</strong>：每条结果给出理由标签，由排序分项真实推导——不写死、不随机。</li>
        <li><strong>元数据置信度</strong>：A（DOI + 多源一致）/ B（单源 DOI 或多源无 DOI）/ C（单源无 DOI），详情页标注。</li>
        <li><strong>AI 零幻觉</strong>：AI 结论必须逐条标注可回溯的引用编号，不可校验即降级拒答（M6 上线）。</li>
      </ul>

      <h2 style="font-size:var(--t-md);margin-top:var(--s-5)">数据来源与许可</h2>
      <table class="data-table" style="font-size:var(--t-sm)">
        <thead><tr><th>数据源</th><th>许可</th><th>覆盖</th></tr></thead>
        <tbody>
          <tr><td>OpenAlex</td><td>CC0</td><td>全学科（含引文/机构/主题）</td></tr>
          <tr><td>Crossref</td><td>元数据开放</td><td>全学科 DOI 注册元数据</td></tr>
          <tr><td>arXiv</td><td>arXiv 使用条款</td><td>物理/CS/数学预印本</td></tr>
          <tr><td>Semantic Scholar</td><td>S2 API 条款</td><td>全学科 + 引用分析</td></tr>
          <tr><td>PubMed / Europe PMC</td><td>公开 E-utilities / EPMC API</td><td>生物医学</td></tr>
          <tr><td>DOAJ</td><td>CC0</td><td>开放获取期刊</td></tr>
          <tr><td>HAL / OpenAIRE / Zenodo / DataCite</td><td>各自开放条款</td><td>开放科学仓库</td></tr>
        </tbody>
      </table>
      <p style="font-size:var(--t-xs);color:var(--fg-3)">完整源清单与实时可用性见 <a href="/status" data-link>系统状态页</a>。</p>

      <div class="notice-bar notice-warn" style="margin-top:var(--s-4)">
        <div>
          <strong>中文文献覆盖说明</strong>
          <p style="font-size:var(--t-sm);margin:4px 0 0">中文文献来自开放元数据（OpenAlex / Crossref / DOAJ），<strong>不含知网、万方、维普独家收录内容</strong>；覆盖不完整属预期，请以原始数据库为准。基线实测显示中文查询可能混入英文结果——语言筛选"仅中文"可精确过滤。</p>
        </div>
      </div>

      <h2 style="font-size:var(--t-md);margin-top:var(--s-5)">AI 局限</h2>
      <p style="font-size:var(--t-sm);color:var(--fg-2)">AI 功能（研究现状总结/问答，M6 上线）基于 Workers AI 免费额度：输出可能遗漏或概括偏差，<strong>每条论断均标注 [编号] 引用，不可校验即拒答</strong>。AI 生成内容标注"AI 生成，需核实"，不作为创作来源。</p>

      <h2 style="font-size:var(--t-md);margin-top:var(--s-5)">隐私</h2>
      <ul style="font-size:var(--t-sm);line-height:1.8;padding-left:20px">
        <li>不收集 IP、不设 cookie 追踪、无第三方 CDN/tracking。</li>
        <li>收藏/笔记/检索历史存于<strong>你的浏览器本地</strong>（IndexedDB / localStorage），不经服务器。</li>
        <li>可选端到端加密云备份（M5）：服务端只存密文，密钥不出浏览器。</li>
        <li>检索词截断 120 字仅用于热词聚合（可在下方清除）。</li>
      </ul>

      <h2 style="font-size:var(--t-md);margin-top:var(--s-5)">版权与免责</h2>
      <p style="font-size:var(--t-sm);color:var(--fg-2)">元数据版权归原数据库/出版方；本站不托管全文，PDF 直链仅指向正版开放获取版本。AI 输出需人工核实，不构成学术建议。本站无商业化目标，永久免费无登录。</p>

      <h2 style="font-size:var(--t-md);margin-top:var(--s-5)">联系方式</h2>
      <p style="font-size:var(--t-sm)">问题反馈/数据许可洽询：<code>2669788267@qq.com</code></p>

      <h2 style="font-size:var(--t-md);margin-top:var(--s-5)">我的数据</h2>
      <p style="font-size:var(--t-sm);color:var(--fg-2)">以下操作立即生效且不可撤销（数据只在本浏览器）：</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn btn-sm js-clear-history">清除检索历史</button>
        <button type="button" class="btn btn-sm btn-primary js-clear-all">清除我的全部数据</button>
      </div>
      <p class="js-clear-status" style="font-size:var(--t-xs);color:var(--fg-3);margin-top:8px" aria-live="polite"></p>
    </section>`;
}

/**
 * @param {HTMLElement} root
 */
export function mount(root) {
  /** @type {(e: Event) => void} */
  const onClick = (e) => {
    const btn = /** @type {HTMLButtonElement} */ (e.target);
    const status = /** @type {HTMLElement} */ (root.querySelector('.js-clear-status'));
    if (btn.classList.contains('js-clear-history')) {
      try {
        localStorage.removeItem('ps-recent-q');
        localStorage.removeItem('ps-favorites');
        indexedDB.deleteDatabase('paperscout');
        if (status) status.textContent = '检索历史已清除。';
        showToast('检索历史已清除');
      } catch {
        if (status) status.textContent = '清除失败（浏览器限制）。';
      }
      return;
    }
    if (btn.classList.contains('js-clear-all')) {
      if (!confirm('确认清除全部本地数据？此操作不可撤销。')) return;
      if (clearAllLocalData()) {
        if (status) status.textContent = '全部本地数据已清除（刷新后生效）。';
        showToast('全部本地数据已清除');
      } else {
        if (status) status.textContent = '清除失败（浏览器限制）。';
      }
    }
  };
  root.addEventListener('click', onClick);
  return {
    destroy() {
      root.removeEventListener('click', onClick);
    },
  };
}

/** @type {import('../router.js').View} */
export default { render, mount };
