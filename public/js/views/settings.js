// @ts-check
import { setSetting, getSetting, getSavedWorks, clearAllLocalData } from '../db.js';
import { showToast } from '../ui/toast.js';

/** /settings（M5-12） */

/** @param {string | undefined} s */
const esc = (s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function render() {
  return `
    <section aria-labelledby="set-h" style="max-width:680px;margin:0 auto">
      <h1 id="set-h">设置</h1>
      <div class="js-settings-body"></div>
    </section>`;
}

/**
 * @param {HTMLElement} root
 */
export function mount(root) {
  const body = /** @type {HTMLElement} */ (root.querySelector('.js-settings-body'));

  Promise.all([
    getSetting('density'), getSetting('defaultLang'), getSetting('defaultSort'), getSetting('privacyQueryLog'),
  ]).then(([density, lang, sort, privacy]) => {
    body.innerHTML = `
      <fieldset style="border:1px solid var(--line);border-radius:6px;padding:12px;margin-bottom:12px">
        <legend style="font-size:var(--t-sm);font-weight:600">结果密度</legend>
        ${['comfortable', 'compact'].map((v) => `<label style="display:block;font-size:var(--t-sm)"><input type="radio" name="set-density" value="${v}" ${density === v ? 'checked' : ''} /> ${v === 'comfortable' ? '舒适' : '紧凑'}</label>`).join('')}
      </fieldset>
      <fieldset style="border:1px solid var(--line);border-radius:6px;padding:12px;margin-bottom:12px">
        <legend style="font-size:var(--t-sm);font-weight:600">语言偏好</legend>
        <label style="display:block;font-size:var(--t-sm)"><input type="radio" name="set-lang" value="all" ${!lang || lang === 'all' ? 'checked' : ''} /> 全部</label>
        <label style="display:block;font-size:var(--t-sm)"><input type="radio" name="set-lang" value="zh" ${lang === 'zh' ? 'checked' : ''} /> 中文优先（不排除英文）</label>
      </fieldset>
      <fieldset style="border:1px solid var(--line);border-radius:6px;padding:12px;margin-bottom:12px">
        <legend style="font-size:var(--t-sm);font-weight:600">默认排序</legend>
        ${[['smart', '智能排序'], ['newest', '按最新']].map(([v, l]) => `<label style="display:block;font-size:var(--t-sm)"><input type="radio" name="set-sort" value="${v}" ${(!sort || sort === v) ? 'checked' : ''} /> ${l}</label>`).join('')}
      </fieldset>
      <fieldset style="border:1px solid var(--line);border-radius:6px;padding:12px;margin-bottom:12px">
        <legend style="font-size:var(--t-sm);font-weight:600">隐私</legend>
        <label style="display:block;font-size:var(--t-sm)"><input type="checkbox" name="set-privacy" ${privacy ? 'checked' : ''} /> 停止检索词入库（热词聚合）</label>
      </fieldset>
      <div class="notice-bar" style="background:var(--surface-2);border:1px solid var(--line);margin-top:12px">
        <span style="font-size:var(--t-xs);color:var(--fg-3)">清除数据、导出备份在 <a href="/about" data-link>关于页</a>。</span>
      </div>`;

    body.addEventListener('change', onChange);
  });

  /** @type {(e: Event) => void} */
  const onChange = (e) => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    if (input.name === 'set-density') { void setSetting('density', input.value); showToast('密度已保存'); }
    if (input.name === 'set-lang') { void setSetting('defaultLang', input.value); showToast('语言偏好已保存'); }
    if (input.name === 'set-sort') { void setSetting('defaultSort', input.value); showToast('默认排序已保存'); }
    if (input.name === 'set-privacy') { void setSetting('privacyQueryLog', input.checked); showToast(input.checked ? '已停止检索词入库' : '已恢复检索词入库'); }
  };

  return {
    destroy() { body.removeEventListener('change', onChange); },
  };
}

/** @type {import('../router.js').View} */
export default { render, mount };
