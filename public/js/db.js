// @ts-check
/**
 * IndexedDB 完整封装（REBUILD_PLAN 5.7 / M5-01~08）。
 * stores：works / collections / notes / searches / settings / trash
 * 多工作区（M5-02）：所有 store 记录带 workspaceId，通过 setWorkspace 切换。
 * D-11：数据默认只存本地；F-37 清除全部走 clearAllLocalData()。
 */

const DB_NAME = 'paperscout';
const DB_VERSION = 4;
const SNAP_TTL_MS = 10 * 60 * 1000;

/** @type {Promise<IDBDatabase> | null} */
let dbPromise = null;
/** @type {string} */
let currentWorkspace = 'default';

/** @returns {Promise<IDBDatabase>} */
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = /** @type {IDBDatabase} */ (req.result);
      if (!db.objectStoreNames.contains('searches')) {
        const s = db.createObjectStore('searches', { keyPath: 'id', autoIncrement: true });
        s.createIndex('ts', 'ts'); s.createIndex('q', 'q');
      }
      if (!db.objectStoreNames.contains('works')) {
        const s = db.createObjectStore('works', { keyPath: 'id' });
        s.createIndex('ws', 'workspaceId'); s.createIndex('addedAt', 'addedAt'); s.createIndex('tags', 'tags', { multiEntry: true });
      }
      if (!db.objectStoreNames.contains('collections')) {
        const s = db.createObjectStore('collections', { keyPath: 'id' });
        s.createIndex('ws', 'workspaceId');
      }
      if (!db.objectStoreNames.contains('notes')) {
        const s = db.createObjectStore('notes', { keyPath: 'workId' });
        s.createIndex('ws', 'workspaceId');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('recipes')) {
        const s = db.createObjectStore('recipes', { keyPath: 'id' });
        s.createIndex('ws', 'workspaceId'); s.createIndex('ts', 'ts');
      }
      if (!db.objectStoreNames.contains('recentlyViewed')) {
        const s = db.createObjectStore('recentlyViewed', { keyPath: 'workId' });
        s.createIndex('viewedAt', 'viewedAt');
      }
      if (!db.objectStoreNames.contains('trash')) {
        const s = db.createObjectStore('trash', { keyPath: 'id' });
        s.createIndex('deletedAt', 'deletedAt'); s.createIndex('ws', 'workspaceId');
      }
    };
    req.onsuccess = () => resolve(/** @type {IDBDatabase} */ (req.result));
    req.onerror = () => reject(/** @type {any} */ (req.error));
  });
  return dbPromise;
}

/** @param {string} ws */
export function setWorkspace(ws) { currentWorkspace = ws; }
export function getWorkspace() { return currentWorkspace; }

/** @param {IDBDatabase} db @param {string} store */
/**
 * @param {IDBDatabase} db
 * @param {string} store
 * @param {IDBTransactionMode} mode
 */
function tx(db, store, mode) { return db.transaction(store, mode).objectStore(store); }
/** @template T @param {IDBRequest<T>} req */
function toPromise(req) { return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }); }

/* ---------- 通用 CRUD（带 workspace 过滤） ---------- */

/**
 * @template T
 * @param {string} storeName
 * @returns {Promise<T[]>}
 */
export async function getAll(storeName) {
  try {
    const db = await openDb();
    const all = await toPromise(tx(db, storeName, 'readonly').getAll());
    return (/** @type {any[]} */ (all ?? [])).filter((r) => !r.workspaceId || r.workspaceId === currentWorkspace);
  } catch { return []; }
}

/**
 * @template T
 * @param {string} storeName
 * @param {T} record
 */
export async function put(storeName, record) {
  try {
    const db = await openDb();
    /** @type {any} */
    const rec = { ...record };
    if (storeName !== 'settings' && storeName !== 'searches' && !rec.workspaceId) rec.workspaceId = currentWorkspace;
    await toPromise(tx(db, storeName, 'readwrite').put(rec));
  } catch (e) { console.warn('db:put-failed', storeName, e instanceof Error ? e.message : String(e)); }
}

/**
 * @param {string} storeName
 * @param {string | number} key
 */
export async function remove(storeName, key) {
  try {
    const db = await openDb();
    await toPromise(tx(db, storeName, 'readwrite').delete(key));
  } catch (e) { console.warn('db:remove-failed', storeName, e instanceof Error ? e.message : String(e)); }
}

/* ---------- Works（收藏的论文） ---------- */

/**
 * @typedef {object} SavedWork
 * @property {string} id  doi:… 或 tf:…
 * @property {string} title
 * @property {string[]} authors
 * @property {number | undefined} year
 * @property {string} [venue]
 * @property {string} [doi]
 * @property {string} [url]
 * @property {string} [pdfUrl]
 * @property {number} [citations]
 * @property {boolean} [openAccess]
 * @property {string} [abstract]
 * @property {string[]} tags
 * @property {string[]} collections
 * @property {number} addedAt
 * @property {boolean} [cited]
 * @property {string} workspaceId
 */

/** @param {any} w */
export async function saveWork(w) {
  const existing = await getWork(w.id);
  await put('works', {
    ...w,
    abstract: w.abstract ? String(w.abstract).slice(0, 600) : undefined,
    tags: existing?.tags ?? w.tags ?? [],
    collections: existing?.collections ?? [],
    addedAt: existing?.addedAt ?? Date.now(),
    cited: existing?.cited ?? false,
  });
}

/** @param {string} id @returns {Promise<SavedWork | undefined>} */
export async function getWork(id) {
  try {
    const db = await openDb();
    return /** @type {SavedWork | undefined} */ (await toPromise(tx(db, 'works', 'readonly').get(id)));
  } catch { return undefined; }
}

/** @returns {Promise<SavedWork[]>} */
export async function getSavedWorks() { return getAll('works'); }

/**
 * @param {any} w
 * @returns {Promise<boolean>}
 */
export async function toggleFavorite(w) {
  const existing = await getWork(w.id);
  if (existing) { await remove('works', w.id); return false; }
  await saveWork(w); return true;
}

/** @param {string} id @param {boolean} cited */
export async function markCited(id, cited) {
  const w = await getWork(id);
  if (w) await put('works', { ...w, cited });
}

/* ---------- Collections（集合/文件夹） ---------- */

/**
 * @param {string} name
 * @returns {Promise<{ id: string, name: string, workspaceId: string }>}
 */
export async function createCollection(name) {
  const id = 'col-' + crypto.randomUUID().slice(0, 8);
  await put('collections', { id, name });
  return { id, name, workspaceId: currentWorkspace };
}

/** @param {string} workId @param {string} colId */
export async function addWorkToCollection(workId, colId) {
  const w = await getWork(workId);
  if (w && !w.collections.includes(colId)) {
    w.collections.push(colId);
    await put('works', w);
  }
}

/* ---------- Notes（笔记） ---------- */

/** @param {string} workId @param {string} markdown */
export async function saveNote(workId, markdown) {
  await put('notes', { workId, markdown, updatedAt: Date.now() });
}

/** @param {string} workId @returns {Promise<string | undefined>} */
export async function getNote(workId) {
  try {
    const db = await openDb();
    const row = await toPromise(tx(db, 'notes', 'readonly').get(workId));
    return row?.markdown;
  } catch { return undefined; }
}

/* ---------- Settings ---------- */

/** @param {string} key @param {any} value */
export async function setSetting(key, value) {
  await put('settings', { key, value });
}

/** @param {string} key @template T @returns {Promise<T | undefined>} */
export async function getSetting(key) {
  try {
    const db = await openDb();
    const row = await toPromise(tx(db, 'settings', 'readonly').get(key));
    return row?.value;
  } catch { return undefined; }
}

/* ---------- Trash（回收站，7 天自动清理 M5-08） ---------- */

/** @param {string} workId */
export async function moveToTrash(workId) {
  const w = await getWork(workId);
  if (!w) return;
  await put('trash', { ...w, deletedAt: Date.now() });
  await remove('works', workId);
}

/** @param {string} workId */
export async function restoreFromTrash(workId) {
  try {
    const db = await openDb();
    const row = await toPromise(tx(db, 'trash', 'readonly').get(workId));
    if (row) { await put('works', row); await remove('trash', workId); }
  } catch (e) { console.warn('db:restore-failed', e instanceof Error ? e.message : String(e)); }
}

/** 清理 >7 天的回收站条目（启动时调用） */
export async function purgeOldTrash() {
  try {
    const db = await openDb();
    const all = await toPromise(tx(db, 'trash', 'readonly').getAll());
    const cutoff = Date.now() - 7 * 86_400_000;
    for (const row of /** @type {any[]} */ (all ?? [])) {
      if (row.deletedAt < cutoff) await toPromise(tx(db, 'trash', 'readwrite').delete(row.id));
    }
  } catch { /* 静默清理失败不影响启动 */ }
}

/* ---------- 检索历史（M2 已有，保留） ---------- */

/** @typedef {{ id?: number, q: string, ts: number }} SearchHistoryRow */

/** @param {string} q */
export async function addSearchHistory(q) {
  const trimmed = q.trim();
  if (!trimmed || !('indexedDB' in window)) return;
  try {
    const db = await openDb();
    const store = tx(db, 'searches', 'readwrite');
    const dupReq = store.index('q').getAll(trimmed);
    const dup = await toPromise(dupReq);
    for (const row of /** @type {SearchHistoryRow[]} */ (dup ?? [])) store.delete(/** @type {number} */ (row.id));
    store.put({ q: trimmed, ts: Date.now() });
    const count = await toPromise(store.count());
    if (/** @type {number} */ (count) > 100) {
      const all = await toPromise(store.index('ts').getAll());
      const sorted = (/** @type {SearchHistoryRow[]} */ (all ?? [])).sort((a, b) => a.ts - b.ts);
      for (const row of sorted.slice(0, /** @type {number} */ (count) - 100)) store.delete(/** @type {number} */ (row.id));
    }
  } catch (e) { console.warn('db:search-history-failed', e instanceof Error ? e.message : String(e)); }
}

/** @param {number} [limit] @returns {Promise<SearchHistoryRow[]>} */
export async function getRecentSearches(limit = 8) {
  if (!('indexedDB' in window)) return [];
  try {
    const db = await openDb();
    const all = await toPromise(tx(db, 'searches', 'readonly').index('ts').getAll());
    return (/** @type {SearchHistoryRow[]} */ (all ?? [])).sort((a, b) => b.ts - a.ts).slice(0, limit);
  } catch { return []; }
}

/** @param {number | 'all'} idOrAll */
export async function deleteSearchHistory(idOrAll) {
  if (!('indexedDB' in window)) return;
  try {
    const db = await openDb();
    if (idOrAll === 'all') tx(db, 'searches', 'readwrite').clear();
    else tx(db, 'searches', 'readwrite').delete(idOrAll);
  } catch (e) { console.warn('db:delete-search-failed', e instanceof Error ? e.message : String(e)); }
}

/* ---------- Recently Viewed（继续阅读 M9-18） ---------- */

/** @param {string} workId @param {string} title */
export async function trackView(workId, title) {
  try {
    const db = await openDb();
    const store = tx(db, 'recentlyViewed', 'readwrite');
    await toPromise(store.put({ workId, title, viewedAt: Date.now() }));
    // 保留最近 20 条
    const count = await toPromise(store.count());
    if (/** @type {number} */ (count) > 20) {
      const all = await toPromise(store.index('viewedAt').getAll());
      const sorted = (/** @type {any[]} */ (all ?? [])).sort((a, b) => a.viewedAt - b.viewedAt);
      for (const row of sorted.slice(0, /** @type {number} */ (count) - 20)) await toPromise(store.delete(row.workId));
    }
  } catch (e) { console.warn('db:track-view-failed', e instanceof Error ? e.message : String(e)); }
}

/** @returns {Promise<{ workId: string, title: string, viewedAt: number }[]>} */
export async function getRecentlyViewed(limit = 5) {
  try {
    const db = await openDb();
    const all = await toPromise(tx(db, 'recentlyViewed', 'readonly').index('viewedAt').getAll());
    return (/** @type {any[]} */ (all ?? [])).sort((a, b) => b.viewedAt - a.viewedAt).slice(0, limit);
  } catch { return []; }
}

/* ---------- Recipes（检索式保存 M9-21） ---------- */

/**
 * @param {{ q: string, params: Record<string, string>, name?: string }} recipe
 */
export async function saveRecipe(recipe) {
  const id = 'r-' + crypto.randomUUID().slice(0, 8);
  await put('recipes', { ...recipe, id, ts: Date.now() });
  return id;
}

/** @returns {Promise<any[]>} */
export async function getRecipes() { return getAll('recipes'); }

/** @param {string} id */
export async function deleteRecipe(id) { await remove('recipes', id); }

/* ---------- 全量导出/导入（M5-08） ---------- */

/** @returns {Promise<object>} */
export async function exportAll() {
  const db = await openDb();
  /** @type {{ [key: string]: any[] }} */
  const out = /** @type {{ [key: string]: any[] }} */ ({});
  for (const store of ['works', 'collections', 'notes', 'searches', 'settings']) {
    out[store] = await toPromise(tx(db, store, 'readonly').getAll());
  }
  return out;
}

/**
 * @param {{ [key: string]: any[] }} data
 */
export async function importAll(data) {
  const db = await openDb();
  for (const store of ['works', 'collections', 'notes', 'settings']) {
    const records = /** @type {any[]} */ (data[store] ?? []);
    for (const rec of records) {
      try { await toPromise(tx(db, store, 'readwrite').put(rec)); } catch { /* 跳过冲突 */ }
    }
  }
}

/* ---------- 快照（M2-16 SWR） ---------- */

/** @param {URL} url @param {any} r */
export function saveSnapshot(url, r) {
  try {
    const key = 'ps-snap:' + queryFromParams(paramsFromUrl(url));
    sessionStorage.setItem(key, JSON.stringify({
      ts: Date.now(),
      items: (r.items ?? []).slice(0, 50).map((/** @type {any} */ w) => ({
        id: w.id, title: w.title, authors: (w.authors ?? []).slice(0, 4).map((/** @type {any} */ a) => (typeof a === 'string' ? a : a?.name)),
        year: w.year, venue: w.venue, doi: w.doi, url: w.url, pdfUrl: w.pdfUrl,
        citations: w.citations, type: w.type, openAccess: w.openAccess, lang: w.lang,
        confidence: w.confidence, venueType: w.venueType,
        abstract: w.abstract ? String(w.abstract).slice(0, 300) : undefined,
        sources: (w.sources ?? []).map((/** @type {any} */ x) => ({ source: x.source, sourceName: x.sourceName })),
      })),
      poolSize: r.poolSize, hasMore: r.hasMore, exhausted: r.exhausted,
      sources: r.sources, partial: r.partial, requestId: r.requestId, ms: r.ms,
    }));
  } catch { /* 静默 */ }
}

/** @param {URL} url @returns {any | null} */
export function loadSnapshot(url) {
  try {
    const raw = sessionStorage.getItem('ps-snap:' + queryFromParams(paramsFromUrl(url)));
    if (!raw) return null;
    const snap = JSON.parse(raw);
    if (!snap?.ts || Date.now() - snap.ts > SNAP_TTL_MS || !Array.isArray(snap.items)) return null;
    return snap;
  } catch { return null; }
}

/** 清除全部本地数据（F-37） */
export function clearAllLocalData() {
  try {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase(DB_NAME);
    if ('caches' in window) caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
    return true;
  } catch { return false; }
}

/* ---------- 依赖导入（循环依赖安全：延迟 import） ---------- */

/** @param {URL} url */
function paramsFromUrl(url) {
  const sp = url.searchParams;
  return {
    q: (sp.get('q') ?? '').slice(0, 200), src: (sp.get('src') ?? '').split(',').filter(Boolean),
    from: sp.get('from') ? Number(sp.get('from')) : undefined, to: sp.get('to') ? Number(sp.get('to')) : undefined,
    type: sp.get('type') ?? 'all', lang: sp.get('lang') ?? 'all', field: sp.get('field') ?? '',
    sort: sp.get('sort') ?? 'smart', page: Number(sp.get('page') ?? 1), limit: Number(sp.get('limit') ?? 20),
    view: sp.get('view') ?? 'list', group: sp.get('group') ?? '', sel: sp.get('sel') ?? '',
  };
}

/** @param {any} p */
function queryFromParams(p) {
  const sp = new URLSearchParams();
  if (p.q) sp.set('q', p.q);
  if (p.src?.length) sp.set('src', p.src.join(','));
  if (p.from) sp.set('from', String(p.from));
  if (p.to) sp.set('to', String(p.to));
  if (p.type && p.type !== 'all') sp.set('type', p.type);
  if (p.lang && p.lang !== 'all') sp.set('lang', p.lang);
  if (p.field) sp.set('field', p.field);
  if (p.sort && p.sort !== 'smart') sp.set('sort', p.sort);
  if (p.page && p.page !== 1) sp.set('page', String(p.page));
  if (p.limit && p.limit !== 20) sp.set('limit', String(p.limit));
  if (p.view && p.view !== 'list') sp.set('view', p.view);
  if (p.group) sp.set('group', p.group);
  if (p.sel) sp.set('sel', p.sel);
  const s = sp.toString();
  return s ? '?' + s : '';
}
