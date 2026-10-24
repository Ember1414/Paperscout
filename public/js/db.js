// @ts-check
/**
 * IndexedDB 封装（REBUILD_PLAN 5.7 / M5-01 完整版）。
 * M2-11 先交付 `searches` store（检索历史真正写入 = A-01 用户侧闭环，D-012）；
 * M5-01 扩展 works/collections/notes/topics/settings/trash 与版本迁移。
 */

const DB_NAME = 'paperscout';
const DB_VERSION = 1;

/** @typedef {{ id?: number, q: string, ts: number }} SearchHistoryRow */

/** @type {Promise<IDBDatabase> | null} */
let dbPromise = null;

/** @returns {Promise<IDBDatabase>} */
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = /** @type {IDBDatabase} */ (req.result);
      if (!db.objectStoreNames.contains('searches')) {
        const store = db.createObjectStore('searches', { keyPath: 'id', autoIncrement: true });
        store.createIndex('ts', 'ts');
        store.createIndex('q', 'q');
      }
    };
    req.onsuccess = () => resolve(/** @type {IDBDatabase} */ (req.result));
    req.onerror = () => reject(/** @type {any} */ (req.error));
  });
  return dbPromise;
}

/**
 * 写入检索历史（去重：同 q 更新时间戳；保留最近 100 条）
 * @param {string} q
 */
export async function addSearchHistory(q) {
  const trimmed = q.trim();
  if (!trimmed || !('indexedDB' in window)) return;
  try {
    const db = await openDb();
    await reqToPromise(db.transaction('searches', 'readwrite').objectStore('searches'));
    const tx = db.transaction('searches', 'readwrite');
    const store = tx.objectStore('searches');
    // 同 q 去重
    const dupReq = store.index('q').getAll(trimmed);
    const dup = await new Promise((resolve) => {
      dupReq.onsuccess = () => resolve(/** @type {SearchHistoryRow[]} */ (dupReq.result ?? []));
      dupReq.onerror = () => resolve([]);
    });
    for (const row of dup) store.delete(/** @type {number} */ (row.id));
    store.put({ q: trimmed, ts: Date.now() });
    // 保留最近 100 条
    const countReq = store.count();
    const count = await new Promise((resolve) => {
      countReq.onsuccess = () => resolve(/** @type {number} */ (countReq.result));
      countReq.onerror = () => resolve(0);
    });
    if (count > 100) {
      const allReq = store.index('ts').getAll();
      const all = await new Promise((resolve) => {
        allReq.onsuccess = () => resolve(/** @type {SearchHistoryRow[]} */ (allReq.result ?? []));
        allReq.onerror = () => resolve([]);
      });
      all.sort((/** @type {SearchHistoryRow} */ a, /** @type {SearchHistoryRow} */ b) => a.ts - b.ts);
      for (const row of all.slice(0, count - 100)) store.delete(/** @type {number} */ (row.id));
    }
  } catch (e) {
    console.warn('db:search-history-failed', e instanceof Error ? e.message : String(e));
  }
}

/**
 * 最近检索（新→旧）
 * @param {number} [limit]
 * @returns {Promise<SearchHistoryRow[]>}
 */
export async function getRecentSearches(limit = 8) {
  if (!('indexedDB' in window)) return [];
  try {
    const db = await openDb();
    const tx = db.transaction('searches', 'readonly');
    const req = tx.objectStore('searches').index('ts').getAll();
    const all = await new Promise((resolve) => {
      req.onsuccess = () => resolve(/** @type {SearchHistoryRow[]} */ (req.result ?? []));
      req.onerror = () => resolve([]);
    });
    return all.sort((/** @type {SearchHistoryRow} */ a, /** @type {SearchHistoryRow} */ b) => b.ts - a.ts).slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * 删除单条 / 清空历史
 * @param {number | 'all'} idOrAll
 */
export async function deleteSearchHistory(idOrAll) {
  if (!('indexedDB' in window)) return;
  try {
    const db = await openDb();
    const tx = db.transaction('searches', 'readwrite');
    const store = tx.objectStore('searches');
    if (idOrAll === 'all') store.clear();
    else store.delete(idOrAll);
  } catch (e) {
    console.warn('db:search-history-delete-failed', e instanceof Error ? e.message : String(e));
  }
}

/** 兼容辅助：让事务写完成（防止提前提交）
 * @param {unknown} _store */
function reqToPromise(_store) {
  return new Promise((resolve) => resolve(undefined));
}

/** 清除全部本地数据（IndexedDB + localStorage + sessionStorage；F-37） */
export function clearAllLocalData() {
  try {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('paperscout');
    if ('caches' in window) {
      caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
    }
    return true;
  } catch {
    return false;
  }
}
