// @ts-check
/**
 * URL ⇄ 检索参数双向编解码（REBUILD_PLAN 4.2 URL 状态契约）。
 * 纯函数、可单测；规则：默认值不进 URL；可分享/刷新/后退完全还原。
 */

/** @typedef {'list'|'compact'|'table'} ResultView */
/**
 * @typedef {object} SearchUiParams
 * @property {string} q
 * @property {string[]} src
 * @property {number|undefined} from
 * @property {number|undefined} to
 * @property {'all'|'journal'|'conference'|'preprint'} type
 * @property {'all'|'zh'|'en'} lang
 * @property {string} field
 * @property {'smart'|'relevance'|'newest'|'cited'} sort
 * @property {number} page
 * @property {20|50} limit
 * @property {ResultView} view
 * @property {string} sel  当前打开的详情（Work id），抽屉深链
 */

export const SEARCH_DEFAULTS = /** @type {const} */ ({
  type: 'all',
  lang: 'all',
  sort: 'smart',
  page: 1,
  limit: 20,
  view: 'list',
});

/**
 * URL → 参数（宽容解析：非法值回退默认）
 * @param {URL} url
 * @returns {SearchUiParams}
 */
export function paramsFromUrl(url) {
  const sp = url.searchParams;
  /** @param {string | null} v @param {number} lo @param {number} hi @param {number|undefined} dflt */
  const num = (v, lo, hi, dflt) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= lo && n <= hi ? n : dflt;
  };
  /** @param {string | null} v @param {readonly string[]} allowed @param {string} dflt */
  const pick = (v, allowed, dflt) => (allowed.includes(/** @type {string} */ (v)) ? /** @type {any} */ (v) : dflt);
  return {
    q: (sp.get('q') ?? '').slice(0, 200),
    src: (sp.get('src') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    from: sp.get('from') ? num(sp.get('from'), 1800, 2100, undefined) : undefined,
    to: sp.get('to') ? num(sp.get('to'), 1800, 2100, undefined) : undefined,
    type: pick(sp.get('type'), ['all', 'journal', 'conference', 'preprint'], SEARCH_DEFAULTS.type),
    lang: pick(sp.get('lang'), ['all', 'zh', 'en'], SEARCH_DEFAULTS.lang),
    field: (sp.get('field') ?? '').split(',').map((s) => s.trim()).filter(Boolean).join(','),
    sort: pick(sp.get('sort'), ['smart', 'relevance', 'newest', 'cited'], SEARCH_DEFAULTS.sort),
    page: num(sp.get('page'), 1, 10, 1) ?? 1,
    limit: (num(sp.get('limit'), 1, 100, 20) ?? 20) === 50 ? /** @type {50} */ (50) : /** @type {20} */ (20),
    view: pick(sp.get('view'), ['list', 'compact', 'table'], SEARCH_DEFAULTS.view),
    sel: (sp.get('sel') ?? '').slice(0, 120),
  };
}

/**
 * 参数 → URL 查询串（默认值省略，保证链接短）
 * @param {SearchUiParams} p
 * @returns {string} 如 `?q=...&from=2023`（无参时返回 ''）
 */
export function queryFromParams(p) {
  const sp = new URLSearchParams();
  if (p.q) sp.set('q', p.q);
  if (p.src.length) sp.set('src', [...p.src].join(','));
  if (p.from) sp.set('from', String(p.from));
  if (p.to) sp.set('to', String(p.to));
  if (p.type !== SEARCH_DEFAULTS.type) sp.set('type', p.type);
  if (p.lang !== SEARCH_DEFAULTS.lang) sp.set('lang', p.lang);
  if (p.field) sp.set('field', p.field);
  if (p.sort !== SEARCH_DEFAULTS.sort) sp.set('sort', p.sort);
  if (p.page !== SEARCH_DEFAULTS.page) sp.set('page', String(p.page));
  if (p.limit !== SEARCH_DEFAULTS.limit) sp.set('limit', String(p.limit));
  if (p.view !== SEARCH_DEFAULTS.view) sp.set('view', p.view);
  if (p.sel) sp.set('sel', p.sel);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/**
 * 全量搜索 URL（/search?...）
 * @param {Partial<SearchUiParams>} patch
 * @returns {string}
 */
export function searchUrl(patch) {
  /** @type {SearchUiParams} */
  const base = {
    q: '', src: [], from: undefined, to: undefined,
    type: SEARCH_DEFAULTS.type, lang: SEARCH_DEFAULTS.lang, field: '',
    sort: SEARCH_DEFAULTS.sort, page: SEARCH_DEFAULTS.page, limit: SEARCH_DEFAULTS.limit,
    view: SEARCH_DEFAULTS.view, sel: '',
  };
  return `/search${queryFromParams({ ...base, ...patch })}`;
}

/**
 * 构造 API 请求参数（前端参数 → /api/search v3 契约）
 * @param {SearchUiParams} p
 * @returns {Record<string, string>}
 */
export function toApiQuery(p) {
  /** @type {Record<string, string>} */
  const out = { q: p.q, page: String(p.page), limit: String(p.limit) };
  if (p.src.length) out.src = p.src.join(',');
  if (p.from) out.from = String(p.from);
  if (p.to) out.to = String(p.to);
  if (p.type !== 'all') out.type = p.type;
  if (p.lang !== 'all') out.lang = p.lang;
  if (p.field) out.field = p.field;
  if (p.sort !== 'smart') out.sort = p.sort;
  return out;
}
