// @ts-check
import { icon } from '../icons.js';

/**
 * ResultCard（6.3）：标题（2 行截断）/作者（前 3 + N）/venue 年/被引/徽章/理由 chips/操作条。
 * chips 由 Work 数据与 score.parts 真实推导（与 functions/lib/core/explain.ts 同规则），禁止写死。
 */

/** @typedef {any} Work */

/**
 * 关键词高亮（功能全景 B 组 P0）：先 HTML 转义再包 <mark>，terms 同步转义后匹配。
 * @param {string} text
 * @param {string[]} terms
 * @returns {string}
 */
export function highlightHtml(text, terms) {
  const escaped = escapeHtml(String(text ?? ''));
  if (!terms.length) return escaped;
  /** @type {RegExp[]} */
  const res = [];
  for (const t of terms.slice(0, 6)) {
    const et = escapeHtml(t);
    if (et.length < 2) continue;
    const safe = et.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (/^[a-z0-9]+$/.test(et)) res.push(new RegExp('\\b(' + safe + ')\\b', 'gi'));
    else res.push(new RegExp('(' + safe + ')', 'gi'));
  }
  let out = escaped;
  for (const re of res) out = out.replace(re, '<mark class="ps-hl">$1</mark>');
  return out;
}

/**
 * @param {Work} w
 * @param {{ citationsTopDecile: number }} poolCtx
 * @returns {string[]}
 */
export function chipsFor(w, poolCtx) {
  /** @type {string[]} */
  const out = [];
  const citations = typeof w.citations === 'number' ? w.citations : 0;
  const year = /** @type {number | undefined} */ (w.year);
  const age = year ? Math.max(0, new Date().getFullYear() - year) : undefined;
  if ((w.sources?.length ?? 0) >= 3) out.push(`${w.sources.length} 源一致收录`);
  if (citations >= 100) out.push(citations >= 10000 ? `高被引 ${(citations / 10000).toFixed(1)} 万` : citations >= 1000 ? `高被引 ${(citations / 1000).toFixed(1)}k` : `高被引 ${citations}`);
  else if (citations > 0 && citations >= poolCtx.citationsTopDecile) out.push('本主题高影响');
  if (isTopVenueName(w.venue)) out.push('顶会/顶刊');
  if (w.type === 'preprint' && age !== undefined && age <= 1) out.push('最新预印本');
  else if (age !== undefined && age <= 1) out.push('近 12 个月');
  if (w.openAccess && w.pdfUrl) out.push('可下载 PDF');
  return out.slice(0, 3);
}

/** 与后端 venues.ts 对齐的轻量判定（Top 列表同步维护于 core/venues.ts） */
const TOP_HINTS = ['neurips', 'nips', 'icml', 'iclr', 'cvpr', 'iccv', 'eccv', 'acl', 'emnlp', 'aaai', 'ijcai', 'kdd', 'sigir', 'sigmod', 'vldb', 'osdi', 'sosp', 'ccs', 'nature', 'science', 'cell', 'pnas', 'jmlr', 'tpami', 'ijcv', 'lancet', '计算机学报', '软件学报', '自动化学报'];
/** @param {string | undefined} venue */
export function isTopVenueName(venue) {
  if (!venue) return false;
  const v = venue.toLowerCase().replace(/^proceedings\s+of\s+(the\s+)?/i, '');
  return TOP_HINTS.some((t) => new RegExp(`(^|\\b)${t}(\\b|$)`).test(v));
}

/**
 * @param {Work} w
 * @param {{ citationsTopDecile: number, density: 'list'|'compact', current?: boolean }} opts
 */
/**
 * @param {Work} w
 * @param {{ citationsTopDecile: number, density: 'list'|'compact', current?: boolean }} opts
 * @param {string[]} [highlightTerms]
 */
export function cardHtml(w, opts, highlightTerms = []) {
  const chips = chipsFor(w, opts);
  const authors = (/** @type {any[]} */ (w.authors ?? [])).map((a) => (typeof a === 'string' ? a : a?.name)).filter(Boolean);
  const authorText = authors.length ? `${authors.slice(0, 3).join(', ')}${authors.length > 3 ? ` 等 ${authors.length} 人` : ''}` : '作者未知';
  const year = w.year ?? '—';
  const citations = typeof w.citations === 'number' ? w.citations : null;
  const badges = [
    w.type === 'journal' ? '期刊' : w.type === 'conference' ? '会议' : w.type === 'preprint' ? '预印本' : '',
    w.openAccess ? '开放获取' : '',
    isTopVenueName(w.venue) ? '顶会/顶刊' : '',
  ].filter(Boolean);
  const typeIcons = { journal: 'book', conference: 'book', preprint: 'clock' };
  void typeIcons;
  return `
    <article class="result-card${opts.current ? ' is-current' : ''}${opts.density === 'compact' ? ' is-compact' : ''}" data-work-id="${escapeAttr(w.id)}" data-key="${escapeAttr(w.id)}" tabindex="0" aria-label="${escapeAttr(w.title)}">
                  ${opts.density !== 'compact' ? `<h3 class="r-title">${highlightHtml(w.title, highlightTerms)}</h3>` : `<h3 class="r-title" style="font-size:var(--t-sm);white-space:nowrap;text-overflow:ellipsis;overflow:hidden;-webkit-line-clamp:unset">${escapeHtml(w.title)}</h3>`}
      <div class="r-meta">
        <span>${authors.slice(0, 3).map((a) => `<a href="/search?q=${encodeURIComponent('author:' + a)}" data-link style="color:var(--fg-2)" title="搜索 ${escapeAttr(a)} 的论文">${escapeHtml(a)}</a>`).join(', ')}${authors.length > 3 ? ` 等 ${authors.length} 人` : ''}</span>
        ${w.venue ? `<a href="/search?q=${encodeURIComponent('venue:' + w.venue)}" data-link class="ps-venue-link" title="查看该期刊/会议更多论文" style="color:var(--fg-2)">${escapeHtml(String(w.venue))}</a>` : `<span>出版方未知</span>`}
        <span class="num">${escapeHtml(String(year))}</span>
        ${citations !== null ? `<span class="num">被引 ${citations.toLocaleString('zh-CN')}</span>` : ''}
        ${badges.map((b) => `<span class="badge">${escapeHtml(b)}</span>`).join('')}
      </div>
                  ${opts.density !== 'compact' && w.abstract ? `<p class="r-abstract">${highlightHtml(String(w.abstract).slice(0, 240) + '…', highlightTerms)}</p>` : ''}
      ${opts.density !== 'compact' && chips.length ? `<div class="r-chips" style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${chips.map((c) => `<span class="chip">${escapeHtml(c)}</span>`).join('')}</div>` : ''}
      ${opts.density !== 'compact' && w.sources?.length ? `<div class="r-sources" style="margin-top:6px;font-size:var(--t-xs);color:var(--fg-3)">收录于 ${w.sources.length} 源：${escapeHtml(w.sources.map((/** @type {any} */ s) => s.sourceName).join(' / '))}</div>` : ''}
      <div class="r-actions">
        ${w.doi ? `<a class="icon-btn" href="https://doi.org/${escapeAttr(w.doi)}" target="_blank" rel="noopener" aria-label="打开原文" title="打开原文">${icon('external', { size: 16 })}</a>` : w.url ? `<a class="icon-btn" href="${escapeAttr(w.url)}" target="_blank" rel="noopener" aria-label="打开原文" title="打开原文">${icon('external', { size: 16 })}</a>` : ''}
        ${w.pdfUrl ? `<a class="icon-btn" href="${escapeAttr(w.pdfUrl)}" target="_blank" rel="noopener" aria-label="下载 PDF" title="下载 PDF">${icon('download', { size: 16 })}</a>` : ''}
        <button type="button" class="icon-btn js-fav" data-fav-id="${escapeAttr(w.id)}" aria-label="${isFav(w.id) ? '取消收藏' : '收藏'}" title="${isFav(w.id) ? '取消收藏' : '收藏'}">${icon(isFav(w.id) ? 'star-filled' : 'star', { size: 16 })}</button>
      </div>
    </article>`;
}

/* ---------- 本地收藏（localStorage；M5-01 迁移 IndexedDB） ---------- */

const FAV_KEY = 'ps-favorites';

/** @param {string} id */
export function isFav(id) {
  try {
    const set = readFavs();
    return set.includes(id);
  } catch {
    return false;
  }
}

/**
 * @param {Work} w
 * @returns {boolean} 新状态
 */
export function toggleFav(w) {
  const set = readFavs();
  const idx = set.findIndex((f) => f.id === w.id);
  if (idx >= 0) set.splice(idx, 1);
  else set.push({ id: w.id, title: w.title, url: w.url ?? '', doi: w.doi ?? '', year: w.year ?? null, savedAt: Date.now() });
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(set.slice(-500)));
  } catch {
    /* 存储满等场景：本次会话内仍生效 */
  }
  return idx < 0;
}

function readFavs() {
  try {
    const raw = /** @type {string | null} */ (localStorage.getItem(FAV_KEY));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** @param {string} s */
function escapeHtml(s) {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
/** @param {string} s */
function escapeAttr(s) {
  return escapeHtml(s);
}
