// @ts-check
import { getSavedWorks, getNote, saveNote, moveToTrash, restoreFromTrash, getAll, exportAll, importAll, createCollection, addWorkToCollection } from '../db.js';
import { toBibtex, toRis, toCslJson } from '../cite-format.js';
import { showToast } from '../ui/toast.js';
import { icon } from '../icons.js';

/**
 * /library 文库页（REBUILD_PLAN 5.7 / M5-03~08）
 * 列表/标签/批量/本地搜索/笔记/导出/导入/回收站
 */

/** @param {string | undefined} s */
const esc = (s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function render() {
  return `
    <section aria-labelledby="lib-h">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:var(--s-3)">
        <h1 id="lib-h" style="font-size:var(--t-lg);margin:0">文库</h1>
        <span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">
          <button type="button" class="btn btn-sm js-export" data-fmt="bibtex">BibTeX</button>
          <button type="button" class="btn btn-sm js-export" data-fmt="ris">RIS</button>
          <button type="button" class="btn btn-sm js-export" data-fmt="csl">CSL-JSON</button>
          <button type="button" class="btn btn-sm js-export" data-fmt="csv">CSV</button>
          <button type="button" class="btn btn-sm js-export" data-fmt="md">Markdown</button>
          <button type="button" class="btn btn-sm js-export" data-fmt="doc">Word</button>
          <button type="button" class="btn btn-sm js-export" data-fmt="json">JSON 备份</button>
          <label class="btn btn-sm" style="cursor:pointer">导入 JSON<input type="file" accept=".json" class="js-import" hidden /></label>
        </span>
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:var(--s-3);flex-wrap:wrap">
        <input type="search" class="js-lib-search" placeholder="在文库中搜索…" style="flex:1;max-width:300px;min-height:36px" aria-label="文库搜索" />
        <button type="button" class="btn btn-sm js-trash-toggle">回收站</button>
        <button type="button" class="btn btn-sm js-new-col">新建集合</button>
      </div>
      <div class="js-lib-body"><div class="skeleton" style="height:120px"></div></div>
      <div class="js-trash-body" hidden><h2 style="font-size:var(--t-sm);color:var(--fg-3);margin-top:var(--s-3)">回收站（7 天后自动清理）</h2><div class="js-trash-list"></div></div>
      <div class="js-col-area" style="margin-top:var(--s-4)">
        <h2 style="font-size:var(--t-sm);color:var(--fg-2)">集合</h2>
        <div class="js-col-list"></div>
        <div style="display:flex;gap:4px;margin-top:4px">
          <input type="text" class="js-col-name" placeholder="集合名…" style="flex:0 0 160px;min-height:32px;font-size:var(--t-xs)" />
          <button type="button" class="btn btn-sm js-col-create">创建</button>
        </div>
      </div>
    </section>`;
}

/**
 * @param {HTMLElement} root
 */
export function mount(root) {
  const body = /** @type {HTMLElement} */ (root.querySelector('.js-lib-body'));
  const trashList = /** @type {HTMLElement} */ (root.querySelector('.js-trash-list'));
  const trashBody = /** @type {HTMLElement} */ (root.querySelector('.js-trash-body'));
  /** @type {any[]} */
  let works = [];
  /** @type {string} */
  let query = '';
  let showTrash = false;

  /** 刷新列表 */
  const refresh = async () => {
    works = await getSavedWorks();
    renderList();
    renderTrash();
  };

  /** 渲染主列表 */
  const renderList = () => {
    const filtered = query
      ? works.filter((w) => (w.title + ' ' + (w.venue ?? '') + ' ' + (w.tags ?? []).join(' ')).toLowerCase().includes(query.toLowerCase()))
      : works;
    if (!filtered.length) {
      body.innerHTML = `<div class="empty-state"><h2>文库为空</h2><p>在检索结果点 ★ 收藏论文后可在此管理。</p><p><a class="btn btn-primary" href="/" data-link>去检索</a></p></div>`;
      return;
    }
    body.innerHTML = `
      <p style="font-size:var(--t-xs);color:var(--fg-3)">${filtered.length} 篇${query ? `（搜索"${esc(query)}"）` : ''}</p>
      ${filtered.map((w) => `
        <div class="result-card" data-id="${esc(w.id)}">
          <label style="position:absolute;top:8px;left:8px;cursor:pointer"><input type="checkbox" class="js-lib-check" data-check-id="${esc(w.id)}" /></label>
          <h3 class="r-title"><a href="/p/${encodeURIComponent(w.id)}" data-link>${esc(w.title)}</a></h3>
          <div class="r-meta">
            <span>${esc((w.authors ?? []).slice(0, 3).join(', '))}</span>
            <span>${esc(w.venue ?? '')}</span>
            <span class="num">${w.year ?? ''}</span>
            ${(w.tags ?? []).map((/** @type {string} */ t) => `<span class="chip chip-accent">${esc(t)}</span>`).join(' ')}
            ${w.cited ? '<span class="badge badge-info">已引用</span>' : ''}
          </div>
          <div class="r-actions" style="opacity:1">
            <button type="button" class="icon-btn js-cite" data-id="${esc(w.id)}" aria-label="复制 BibTeX" title="复制 BibTeX">${icon('download', { size: 14 })}</button>
            <button type="button" class="icon-btn js-note" data-id="${esc(w.id)}" aria-label="笔记" title="笔记">${icon('book', { size: 14 })}</button>
            <button type="button" class="icon-btn js-trash" data-id="${esc(w.id)}" aria-label="移入回收站" title="移入回收站">${icon('x', { size: 14 })}</button>
          </div>
          <div class="js-note-area" data-id="${esc(w.id)}" hidden>
            <textarea class="js-note-input" rows="4" placeholder="笔记（Markdown 子集：**粗体** 列表 - 链接 [文本](url)）" style="width:100%;margin-top:8px;font-size:var(--t-sm)">${esc(w.abstract ? '' : '')}</textarea>
            <button type="button" class="btn btn-sm js-note-save" data-id="${esc(w.id)}" style="margin-top:4px">保存笔记</button>
            <span style="font-size:var(--t-xs);color:var(--fg-3);margin-left:8px">自动保存已启用</span>
          </div>
        </div>`).join('')}`;
  };

  /** 渲染回收站 */
  const renderTrash = async () => { /* returns void */
    const items = await getAll('trash') ?? [];
    trashList.innerHTML = items.length
      ? items.map((w) => `<div style="margin:var(--s-2) 0;font-size:var(--t-sm);display:flex;gap:8px;align-items:center"><span style="flex:1">${esc(w.title)}</span><button type="button" class="btn btn-sm js-restore" data-id="${esc(w.id)}">恢复</button></div>`).join('')
      : '<p style="color:var(--fg-3);font-size:var(--t-sm)">回收站为空。</p>';
  };

  /** 导出 */
  const doExport = async (/** @type {string} */ fmt) => {
    if (!works.length) { showToast('文库为空'); return; }
    let content = '', mime = 'text/plain', ext = fmt;
    if (fmt === 'bibtex') { content = works.map((w) => toBibtex(w)).join('\n\n'); mime = 'application/x-bibtex'; ext = 'bib'; }
    else if (fmt === 'ris') { content = works.map((w) => toRis(w)).join('\n'); mime = 'application/x-research-info-systems'; ext = 'ris'; }
    else if (fmt === 'csl') { content = JSON.stringify(works.map((w) => JSON.parse(toCslJson(w))), null, 2); mime = 'application/json'; ext = 'json'; }
    else if (fmt === 'csv') {
      const header = 'title,authors,year,venue,doi,citations,url\n';
      content = header + works.map((w) => [w.title, (w.authors ?? []).join('; '), w.year, w.venue, w.doi, w.citations, w.url].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
      mime = 'text/csv;charset=utf-8';
    } else if (fmt === 'md') {
      content = works.map((w) => `## [${w.title}](${w.url ?? 'https://doi.org/' + (w.doi ?? '')})\n\n${(w.authors ?? []).join(', ')} (${w.year ?? ''}) ${w.venue ?? ''}\n`).join('\n');
      mime = 'text/markdown'; ext = 'md';
    } else if (fmt === 'doc') {
      content = `<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"></head><body><h1>PaperScout 文库导出</h1>${works.map((w) => `<h2>${esc(w.title)}</h2><p>${esc((w.authors ?? []).join(', '))} (${w.year ?? ''}) ${esc(w.venue ?? '')}</p>`).join('')}</body></html>`;
      mime = 'application/msword'; ext = 'doc';
    } else if (fmt === 'json') {
      content = JSON.stringify(exportAll(), null, 2); mime = 'application/json';
    }
    const blob = new Blob([content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `paperscout-${fmt}-${Date.now()}.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast(`已导出 ${works.length} 篇（${fmt.toUpperCase()}）`);
  };

  /** 事件委托 */
  /** @type {(e: Event) => Promise<void>} */
  const onClick = async (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    const exportBtn = /** @type {HTMLElement | null} */ (t.closest?.('.js-export'));
    if (exportBtn) { doExport(exportBtn.dataset.fmt ?? ''); return; }
    if (t.closest('.js-trash-toggle')) { showTrash = !showTrash; trashBody.hidden = !showTrash; if (showTrash) renderTrash(); return; }
    const restore = /** @type {HTMLElement | null} */ (t.closest?.('.js-restore'));
    if (restore) { await restoreFromTrash(restore.dataset.id ?? ''); await refresh(); return; }
    const trash = /** @type {HTMLElement | null} */ (t.closest?.('.js-trash'));
    if (trash) { await moveToTrash(trash.dataset.id ?? ''); await refresh(); showToast('已移入回收站'); return; }
    const noteToggle = /** @type {HTMLElement | null} */ (t.closest?.('.js-note'));
    if (noteToggle) {
      const area = /** @type {HTMLElement} */ (body.querySelector(`.js-note-area[data-id="${noteToggle.dataset.id}"]`));
      if (area) {
        area.hidden = !area.hidden;
        if (!area.hidden) {
          const input = /** @type {HTMLTextAreaElement} */ (area.querySelector('.js-note-input'));
          input.value = (await getNote(noteToggle.dataset.id ?? '')) ?? '';
          input.focus();
        }
      }
      return;
    }
    const noteSave = /** @type {HTMLElement | null} */ (t.closest?.('.js-note-save'));
    if (noteSave) {
      const input = /** @type {HTMLTextAreaElement} */ (body.querySelector(`.js-note-input[data-id="${noteSave.dataset.id}"]`)) ?? /** @type {HTMLTextAreaElement} */ (noteSave.closest('.js-note-area')?.querySelector('.js-note-input'));
      if (input) { await saveNote(noteSave.dataset.id ?? '', input.value); showToast('笔记已保存'); }
      return;
    }
    const citeBtn = /** @type {HTMLElement | null} */ (t.closest?.('.js-cite'));
    if (citeBtn) {
      const w = works.find((x) => x.id === citeBtn.dataset.id);
      if (w) {
        await navigator.clipboard.writeText(toBibtex(w)).then(() => showToast('BibTeX 已复制'), () => showToast('复制失败'));
      }
    }
  };

  /** @type {(e: Event) => void} */
  const onSearch = (e) => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    query = input.value;
    renderList();
  };

  /** @type {(e: Event) => void} */
  const onImport = (e) => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(/** @type {string} */ (reader.result));
        await importAll(data);
        await refresh();
        showToast('导入成功');
      } catch { showToast('导入失败（格式不正确）'); }
    };
    reader.readAsText(file);
    input.value = '';
  };

  root.addEventListener('click', onClick);
  root.querySelector('.js-lib-search')?.addEventListener('input', onSearch);
  root.querySelector('.js-import')?.addEventListener('change', onImport);
  void refresh();

  return {
    destroy() {
      root.removeEventListener('click', onClick);
    },
  };
}

/** @type {import('../router.js').View} */
export default { render, mount };
