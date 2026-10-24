// @ts-check
import { navigate } from '../router.js';
import { searchUrl } from '../url.js';

/**
 * 高级检索构建器（M2-07 / 附录 B DSL）：
 * 条件组（全部满足 AND / 任一满足 OR / 全部排除 NOT）+ 字段选择（任意字段/标题/作者/venue/DOI/年份）
 * → 实时生成 DSL 预览 → 检索跳 /search?q=<dsl>（URL 唯一真相，可回简单模式）。
 */

/** @typedef {{ field: 'any'|'title'|'author'|'venue'|'doi', value: string }} Clause */
/** @typedef {{ op: 'and'|'or'|'not', clauses: Clause[] }} Group */

/** @param {Group[]} groups @returns {string} */
export function buildDsl(groups) {
  const parts = [];
  for (const g of groups) {
    const clauses = g.clauses.filter((c) => c.value.trim());
    if (!clauses.length) continue;
    const items = clauses.map((c) => {
      const v = c.value.trim();
      if (c.field === 'title') return `"${v}"`;
      if (c.field === 'author') return `author:${v}`;
      if (c.field === 'venue') return `venue:${v}`;
      if (c.field === 'doi') return `doi:${v}`;
      return /\s/.test(v) ? `"${v}"` : v; // 任意字段：多词加引号
    });
    if (g.op === 'not') parts.push(...items.map((i) => `-${i}`));
    else if (g.op === 'or') parts.push(items.length > 1 ? `(${items.join(' OR ')})` : items[0]);
    else parts.push(...items);
  }
  return parts.join(' ');
}

/** @returns {Group[]} */
function defaultGroups() {
  return [
    { op: 'and', clauses: [{ field: 'any', value: '' }, { field: 'any', value: '' }] },
    { op: 'not', clauses: [{ field: 'any', value: '' }] },
  ];
}

/**
 * @param {import('../router.js').ViewCtx} ctx
 */
export function render(ctx) {
  // 从现有 q 反推初值（可回简单模式的往返）
  const q = ctx.url.searchParams.get('q') ?? '';
  return `
    <section aria-labelledby="adv-h" style="max-width:860px;margin:0 auto">
      <h1 id="adv-h">高级检索</h1>
      <p style="color:var(--fg-2);font-size:var(--t-sm)">条件组之间为「且」关系；组内可选「全部满足 / 任一满足 / 全部排除」。生成检索式后可在结果页看到并分享。</p>
      <form class="js-adv-form" aria-describedby="dsl-preview-label">
        <div class="js-groups"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:16px 0;align-items:center">
          <button type="button" class="btn btn-sm js-add-and">+ 且组</button>
          <button type="button" class="btn btn-sm js-add-or">+ 或组</button>
          <button type="button" class="btn btn-sm js-add-not">+ 排除组</button>
          <button type="button" class="btn btn-sm js-adv-reset" style="margin-left:auto">清空</button>
        </div>
        <div style="background:var(--surface-2);border:1px solid var(--line);border-radius:6px;padding:12px">
          <span id="dsl-preview-label" style="font-size:var(--t-xs);color:var(--fg-3)">检索式预览（附录 B 语法）</span>
          <p class="num js-dsl-preview" style="font-size:var(--t-sm);margin:6px 0 0;word-break:break-all">—</p>
        </div>
        <div style="display:flex;gap:8px;margin-top:16px">
          <button type="submit" class="btn btn-primary">检索</button>
          <a class="btn" href="/" data-link>回简单模式</a>
        </div>
      </form>
    </section>`;
}

/**
 * @param {HTMLElement} root
 */
export function mount(root) {
  /** @type {Group[]} */
  let groups = defaultGroups();
  const groupsEl = /** @type {HTMLElement} */ (root.querySelector('.js-groups'));
  const previewEl = /** @type {HTMLElement} */ (root.querySelector('.js-dsl-preview'));

  const FIELD_OPTS = [['any', '任意字段'], ['title', '标题（短语）'], ['author', '作者'], ['venue', '期刊/会议'], ['doi', 'DOI']];

  const renderGroups = () => {
    groupsEl.innerHTML = groups
      .map((g, gi) => {
        const opLabel = g.op === 'and' ? '全部满足（AND）' : g.op === 'or' ? '任一满足（OR）' : '全部排除（NOT）';
        return `
        <fieldset style="border:1px solid var(--line);border-radius:6px;padding:12px;margin-bottom:12px">
          <legend style="font-size:var(--t-sm);padding:0 6px">条件组 ${gi + 1} · ${opLabel}</legend>
          ${g.clauses
            .map(
              (c, ci) => `
            <div style="display:flex;gap:6px;margin:6px 0;flex-wrap:wrap">
              <label class="sr-only" for="f-${gi}-${ci}">字段</label>
              <select data-g="${gi}" data-c="${ci}" data-role="field" id="f-${gi}-${ci}" style="width:130px">
                ${FIELD_OPTS.map(([v, l]) => `<option value="${v}" ${c.field === v ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
              <label class="sr-only" for="v-${gi}-${ci}">值</label>
              <input data-g="${gi}" data-c="${ci}" data-role="value" id="v-${gi}-${ci}" type="text" value="${escapeAttr(c.value)}" placeholder="输入关键词…" style="flex:1;min-width:160px" />
              <button type="button" class="btn btn-sm btn-ghost js-del-clause" data-g="${gi}" data-c="${ci}" aria-label="删除该条件">删除</button>
            </div>`,
            )
            .join('')}
          <button type="button" class="btn btn-sm js-add-clause" data-g="${gi}">+ 加条件</button>
          ${groups.length > 1 ? `<button type="button" class="btn btn-sm btn-ghost js-del-group" data-g="${gi}" style="margin-left:6px">删除组</button>` : ''}
        </fieldset>`;
      })
      .join('');
  };

  const updatePreview = () => {
    const dsl = buildDsl(groups);
    previewEl.textContent = dsl || '—';
  };

  /** @type {(e: Event) => void} */
  const onInput = (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    const g = Number(t.dataset.g);
    const c = Number(t.dataset.c);
    if (Number.isNaN(g) || Number.isNaN(c)) return;
    if (t.dataset.role === 'value') groups[g].clauses[c].value = /** @type {HTMLInputElement} */ (t).value;
    if (t.dataset.role === 'field') groups[g].clauses[c].field = /** @type {any} */ (/** @type {HTMLSelectElement} */ (t).value);
    updatePreview();
  };
  /** @type {(e: Event) => void} */
  const onClick = (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    const btn = /** @type {HTMLElement} */ (t.closest?.('button'));
    if (!btn) return;
    if (btn.classList.contains('js-add-and')) groups.push({ op: 'and', clauses: [{ field: 'any', value: '' }] });
    else if (btn.classList.contains('js-add-or')) groups.push({ op: 'or', clauses: [{ field: 'any', value: '' }] });
    else if (btn.classList.contains('js-add-not')) groups.push({ op: 'not', clauses: [{ field: 'any', value: '' }] });
    else if (btn.classList.contains('js-add-clause')) groups[Number(btn.dataset.g)].clauses.push({ field: 'any', value: '' });
    else if (btn.classList.contains('js-del-clause')) {
      const g = Number(btn.dataset.g);
      if (groups[g].clauses.length > 1) groups[g].clauses.splice(Number(btn.dataset.c), 1);
      else groups.splice(g, 1);
      if (!groups.length) groups = defaultGroups();
    } else if (btn.classList.contains('js-del-group')) {
      groups.splice(Number(btn.dataset.g), 1);
      if (!groups.length) groups = defaultGroups();
    } else if (btn.classList.contains('js-adv-reset')) {
      groups = defaultGroups();
    } else return;
    renderGroups();
    updatePreview();
  };
  /** @type {(e: Event) => void} */
  const onSubmit = (e) => {
    e.preventDefault();
    const dsl = buildDsl(groups);
    if (!dsl) return;
    navigate(searchUrl({ q: dsl }));
  };

  groupsEl.addEventListener('input', onInput);
  groupsEl.addEventListener('change', onInput);
  root.addEventListener('click', onClick);
  /** @type {HTMLFormElement | null} */ (root.querySelector('.js-adv-form'))?.addEventListener('submit', onSubmit);
  renderGroups();
  updatePreview();

  return {
    destroy() {
      groupsEl.removeEventListener('input', onInput);
      groupsEl.removeEventListener('change', onInput);
      root.removeEventListener('click', onClick);
    },
  };
}

/** @param {string} s */
function escapeAttr(s) {
  return s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** @type {import('../router.js').View} */
export default { render, mount };
