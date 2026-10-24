// @ts-check
import { searchUrl } from '../url.js';

/**
 * FilterPanel（6.3）：年份（区间 + 快捷）/类型/语言/来源/学科 + 重置。
 * 变更 → 300ms 防抖合并 → pushState（I-04：同类请求合并）。
 */

/** 与 registry.ts 的 12 个 verified 源同步（DECISIONS D-013 注记：新增源须更新） */
export const FILTER_SOURCES = [
  { id: 'openalex', name: 'OpenAlex' },
  { id: 'crossref', name: 'Crossref' },
  { id: 'arxiv', name: 'arXiv' },
  { id: 'semanticscholar', name: 'Semantic Scholar' },
  { id: 'pubmed', name: 'PubMed' },
  { id: 'europepmc', name: 'Europe PMC' },
  { id: 'doaj', name: 'DOAJ' },
  { id: 'hal', name: 'HAL' },
  { id: 'openaire', name: 'OpenAIRE' },
  { id: 'zenodo', name: 'Zenodo' },
  { id: 'datacite', name: 'DataCite' },
];

/**
 * @param {import('../url.js').SearchUiParams} p
 * @returns {string}
 */
export function filtersHtml(p) {
  /** @param {string} label @param {number} years */
  const quickYear = (label, years) =>
    `<button type="button" class="btn btn-sm js-qy" data-years="${years}" style="margin:2px">${label}</button>`;
  return `
    <div class="ps-filters" role="group" aria-label="筛选条件">
      <fieldset>
        <legend style="font-size:var(--t-sm);font-weight:600">年份</legend>
        <div style="display:flex;gap:6px;align-items:center;margin:6px 0">
          <label class="sr-only" for="f-from">起始年份</label>
          <input id="f-from" type="number" min="1800" max="2100" value="${p.from ?? ''}" placeholder="1800" style="width:80px" />
          <span aria-hidden="true">—</span>
          <label class="sr-only" for="f-to">结束年份</label>
          <input id="f-to" type="number" min="1800" max="2100" value="${p.to ?? ''}" placeholder="2100" style="width:80px" />
        </div>
        <div>
          ${quickYear('近 1 年', 1)}${quickYear('近 3 年', 3)}${quickYear('近 5 年', 5)}${quickYear('清除', 0)}
        </div>
      </fieldset>

      <fieldset style="margin-top:var(--s-4)">
        <legend style="font-size:var(--t-sm);font-weight:600">类型</legend>
        ${[['all', '全部'], ['journal', '期刊'], ['conference', '会议'], ['preprint', '预印本']].map(([v, l]) =>
          `<label style="display:block;font-size:var(--t-sm)"><input type="radio" name="f-type" value="${v}" ${p.type === v ? 'checked' : ''} /> ${l}</label>`).join('')}
      </fieldset>

      <fieldset style="margin-top:var(--s-4)">
        <legend style="font-size:var(--t-sm);font-weight:600">语言</legend>
        ${[['all', '全部'], ['zh', '仅中文'], ['en', '仅英文']].map(([v, l]) =>
          `<label style="display:block;font-size:var(--t-sm)"><input type="radio" name="f-lang" value="${v}" ${p.lang === v ? 'checked' : ''} /> ${l}</label>`).join('')}
        ${p.lang === 'zh' ? '<p style="font-size:var(--t-xs);color:var(--fg-3)">中文来自开放元数据（OpenAlex/Crossref/DOAJ），不含知网/万方独家内容，覆盖不完整属预期。</p>' : ''}
      </fieldset>

      <fieldset style="margin-top:var(--s-4)">
        <legend style="font-size:var(--t-sm);font-weight:600">来源（${FILTER_SOURCES.length} 源可用）</legend>
        ${FILTER_SOURCES.map((s) =>
          `<label style="display:block;font-size:var(--t-sm)"><input type="checkbox" class="js-src" value="${s.id}" ${p.src.length === 0 || p.src.includes(s.id) ? 'checked' : ''} /> ${s.name}</label>`).join('')}
        <p style="font-size:var(--t-xs);color:var(--fg-3)">默认全部参与（单次最多调用 9 源）；DBLP 暂被上游反爬拦截（见 /status，M3 上线）。</p>
      </fieldset>

      <button type="button" class="btn btn-sm js-filters-reset" style="margin-top:var(--s-4)">重置全部筛选</button>
    </div>`;
}

/**
 * 绑定筛选面板：返回当前面板参数快照的读取器 + 事件清理
 * @param {HTMLElement} root
 * @param {import('../url.js').SearchUiParams} initial
 * @param {(patch: Partial<import('../url.js').SearchUiParams>) => void} onPatch
 */
export function bindFilters(root, initial, onPatch) {
  /** @type {number | undefined} */
  let timer;
  /** @type {Partial<import('../url.js').SearchUiParams>} */
  let pending = {};

  const flush = () => {
    timer = undefined;
    if (Object.keys(pending).length) {
      onPatch(pending);
      pending = {};
    }
  };
  const queue = (/** @type {Partial<import('../url.js').SearchUiParams>} */ patch) => {
    pending = { ...pending, ...patch };
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 300);
  };

  const from = /** @type {HTMLInputElement | null} */ (root.querySelector('#f-from'));
  const to = /** @type {HTMLInputElement | null} */ (root.querySelector('#f-to'));
  /** @type {(e: Event) => void} */
  const onYear = () => {
    const f = Number(from?.value) || undefined;
    const t = Number(to?.value) || undefined;
    queue({ from: f, to: t });
  };
  from?.addEventListener('change', onYear);
  to?.addEventListener('change', onYear);

  /** @type {(e: Event) => void} */
  const onQuickYear = (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('.js-qy');
    if (!btn) return;
    const years = Number((/** @type {HTMLElement} */ (btn)).dataset.years);
    if (!years) {
      queue({ from: undefined, to: undefined });
      if (from) from.value = '';
      if (to) to.value = '';
      return;
    }
    const y = new Date().getFullYear();
    queue({ from: y - years + 1, to: y });
    if (from) from.value = String(y - years + 1);
    if (to) to.value = String(y);
  };
  root.addEventListener('click', onQuickYear);

  /** @type {(e: Event) => void} */
  const onType = (e) => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    if (input.name === 'f-type') queue({ type: /** @type {any} */ (input.value) });
    if (input.name === 'f-lang') queue({ lang: /** @type {any} */ (input.value) });
  };
  root.addEventListener('change', onType);

  /** @type {(e: Event) => void} */
  const onSrc = (e) => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    if (!input.classList.contains('js-src')) return;
    const boxes = [...root.querySelectorAll('.js-src')];
    const checked = boxes.filter((b) => /** @type {HTMLInputElement} */ (b).checked).map((b) => /** @type {HTMLInputElement} */ (b).value);
    queue({ src: checked.length === boxes.length ? [] : checked });
  };
  root.addEventListener('change', onSrc);

  /** @type {(e: Event) => void} */
  const onReset = (e) => {
    if (!(/** @type {HTMLElement} */ (e.target).closest('.js-filters-reset'))) return;
    queue({ from: undefined, to: undefined, type: 'all', lang: 'all', src: [] });
  };
  root.addEventListener('click', onReset);

  void initial;
  return {
    destroy() {
      if (timer) clearTimeout(timer);
      root.removeEventListener('click', onQuickYear);
      root.removeEventListener('change', onType);
      root.removeEventListener('change', onSrc);
      root.removeEventListener('click', onReset);
      from?.removeEventListener('change', onYear);
      to?.removeEventListener('change', onYear);
    },
  };
}

export { searchUrl };
