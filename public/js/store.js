// @ts-check
import { apiGet, searchApi, ApiError } from './api.js';
import { paramsFromUrl, toApiQuery, queryFromParams } from './url.js';

/**
 * 单一 store（REBUILD_PLAN 6.4）：单向数据流 + 订阅 + requestId 竞态保护（修复 v2 A-20）。
 * URL 是 query 切片的唯一真相；results 不持久化；ui/user 落 localStorage。
 */

/**
 * @typedef {object} AppState
 * @property {{ raw: string, params: import('./url.js').SearchUiParams }} query
 * @property {{ items: any[], poolSize: number, page: number, limit: number, hasMore: boolean, exhausted: boolean, loading: boolean, error: {code: string, message: string, retryable: boolean} | null, partial: boolean, stale: boolean, sources: any[], parsed: any, requestId: string, cache: string, ms: number, retriedFrom?: string }} results
 * @property {{ theme: string, view: string, drawerId: string, paletteOpen: boolean, filtersOpen: boolean, density: string }} ui
 * @property {{ clientId: string }} user
 */

/** @type {AppState} */
export const state = {
  query: { raw: '', params: paramsFromUrl(new URL(location.href)) },
  results: {
    items: [], poolSize: 0, page: 1, limit: 20, hasMore: false, exhausted: false,
    loading: false, error: null, partial: false, stale: false, sources: [], parsed: null, requestId: '', cache: '', ms: 0,
  },
  ui: { theme: document.documentElement.getAttribute('data-theme') ?? 'light', view: 'list', drawerId: '', paletteOpen: false, filtersOpen: false, density: 'comfortable' },
  user: { clientId: ensureClientId() },
};

/** @type {Set<(s: AppState) => void>} */
const listeners = new Set();

/** @param {(s: AppState) => void} fn */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** @param {Partial<AppState>} patch */
export function setState(patch) {
  Object.assign(state, patch);
  for (const fn of listeners) {
    try {
      fn(state);
    } catch (e) {
      console.warn('store:listener-failed', e instanceof Error ? e.message : String(e));
    }
  }
}

function ensureClientId() {
  try {
    let id = localStorage.getItem('ps-client-id');
    if (!id) {
      id = 'c_' + crypto.randomUUID().slice(0, 12);
      localStorage.setItem('ps-client-id', id);
    }
    return id;
  } catch {
    return 'c_anon';
  }
}

/* ---------- 检索动作：requestId 竞态保护（A-20） ---------- */

let searchSeq = 0;
let searchAbort = /** @type {AbortController | null} */ (null);

/**
 * 按 URL 执行检索：新请求发出前 abort 旧的；过期响应丢弃。
 * @param {URL} [url] 缺省用当前 location
 * @returns {Promise<void>}
 */
export async function runSearch(url = new URL(location.href)) {
  const params = paramsFromUrl(url);
  if (!params.q.trim()) {
    setState({
      query: { raw: '', params },
      results: { ...state.results, loading: false, items: [], error: null },
    });
    return;
  }
  const seq = ++searchSeq;
  searchAbort?.abort();
  const abort = new AbortController();
  searchAbort = abort;

  setState({
    query: { raw: params.q, params },
    results: { ...state.results, loading: true, error: null, page: params.page, limit: params.limit },
  });

  try {
    const r = await searchApi(toApiQuery(params), { signal: abort.signal });
    if (seq !== searchSeq) return; // 过期响应丢弃（只渲染最后一次，M2-03 DoD）
    saveSnapshot(url, r);
    setState({
      results: {
        ...state.results,
        items: r.items, poolSize: r.poolSize, hasMore: r.hasMore, exhausted: r.exhausted, stale: Boolean(r.stale),
        loading: false, error: null, partial: r.partial, sources: r.sources, parsed: r.parsed,
        requestId: r.requestId, cache: r.cache, ms: r.ms,
      },
    });
  } catch (e) {
    if (seq !== searchSeq) return;
    if (/** @type {any} */ (e)?.name === 'AbortError') return; // 主动取消不是错误（I-12）
    const err = e instanceof ApiError ? e : new ApiError('NETWORK', '网络连接失败，请检查网络后重试', 0, true);
    setState({ results: { ...state.results, loading: false, error: { code: err.code, message: err.message, retryable: err.retryable } } });
  }
}

/** 取消进行中的检索（I-12"停止"按钮） */
export function cancelSearch() {
  searchSeq++; // 使在途响应全部过期
  searchAbort?.abort();
  setState({ results: { ...state.results, loading: false } });
}

export { apiGet };


/* ---------- M2-16 结果池快照（sessionStorage，10 分钟有效；刷新秒开/离线可看） ---------- */

const SNAP_TTL_MS = 10 * 60 * 1000;

/** @param {any[]} items 精简字段，控体积 */
function trimItems(items) {
  return (items ?? []).slice(0, 50).map((w) => ({
    id: w.id, title: w.title,
    authors: (w.authors ?? []).slice(0, 4).map((/** @type {any} */ a) => (typeof a === 'string' ? a : a?.name)),
    year: w.year, venue: w.venue, doi: w.doi, url: w.url, pdfUrl: w.pdfUrl,
    citations: w.citations, type: w.type, openAccess: w.openAccess, lang: w.lang,
    confidence: w.confidence, venueType: w.venueType,
    abstract: w.abstract ? String(w.abstract).slice(0, 300) : undefined,
    sources: (w.sources ?? []).map((/** @type {any} */ x) => ({ source: x.source, sourceName: x.sourceName })),
  }));
}

/** @param {URL} url @param {any} r */
function saveSnapshot(url, r) {
  try {
    const key = snapKey(url);
    sessionStorage.setItem('ps-snap:' + key, JSON.stringify({
      ts: Date.now(),
      items: trimItems(r.items),
      poolSize: r.poolSize, hasMore: r.hasMore, exhausted: r.exhausted,
      sources: r.sources, partial: r.partial, requestId: r.requestId, ms: r.ms,
    }));
  } catch { /* 配额满/隐私模式：快照是增强层，静默放弃 */ }
}

/** @param {URL} url */
export function loadSnapshot(url) {
  try {
    const raw = sessionStorage.getItem('ps-snap:' + snapKey(url));
    if (!raw) return null;
    const snap = /** @type {any} */ (JSON.parse(raw));
    if (!snap?.ts || Date.now() - snap.ts > SNAP_TTL_MS || !Array.isArray(snap.items)) return null;
    return snap;
  } catch {
    return null;
  }
}

/** @param {URL} url */
function snapKey(url) {
  return queryFromParams(paramsFromUrl(url));
}
