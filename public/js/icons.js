// @ts-check
/**
 * SVG 图标集（REBUILD_PLAN 6.8：emoji 一律替换为 SVG/文字）。
 * 内联返回，无网络依赖；装饰性使用必须 aria-hidden="true"。
 */

const PATHS = /** @type {const} */ ({
  search: 'M10.5 3a7.5 7.5 0 0 1 5.9 12.1l4.2 4.2-1.4 1.4-4.2-4.2A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.7l5.9-.8L12 3.5zm0 2.6L10.3 9.5l-3.9.5 2.8 2.7-.7 3.8 3.5-1.9 3.5 1.9-.7-3.8 2.8-2.7-3.9-.5L12 6.1z',
  'star-filled': 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.7l5.9-.8L12 3.5z',
  external: 'M14 4h6v6h-2V7.4l-8.3 8.3-1.4-1.4L16.6 6H14V4zM5 6h5v2H7v9h9v-3h2v5H5V6z',
  download: 'M11 4h2v9.2l3.6-3.6 1.4 1.4-6 6-6-6 1.4-1.4L11 13.2V4zM5 19h14v2H5v-2z',
  x: 'M6.4 5l6.6 6.6L19.6 5 21 6.4 14.4 13l6.6 6.6-1.4 1.4-6.6-6.6L6.4 21 5 19.6 11.6 13 5 6.4 6.4 5z',
  'chevron-down': 'M6.3 9.3L12 15l5.7-5.7 1.4 1.4-7.1 7.1-7.1-7.1 1.4-1.4z',
  'chevron-left': 'M14.7 6.3L9 12l5.7 5.7-1.4 1.4L6.2 12l7.1-7.1 1.4 1.4z',
  command: 'M7 3a4 4 0 0 1 4 4v1h2V7a4 4 0 1 1 4 4h-1v2h1a4 4 0 1 1-4 4v-1h-2v1a4 4 0 1 1-4-4h1v-2H7a4 4 0 0 1 0-8h1V7a4 4 0 0 1-1-4zm0 2a2 2 0 1 0 2 2V5H7zm10 0h-2v2a2 2 0 1 0 2-2zM7 17h2v-2H7a2 2 0 1 0 2 2zm10 0a2 2 0 1 0-2 2v-2h2zm-6-6h2v2h-2v-2z',
  filter: 'M4 5h16v2.2l-6 5.5V20l-4-2v-5.3L4 7.2V5zm2 2.4l6 5.5V18l.4.2V12.9l5-4.6V7H6v.4z',
  book: 'M5 4h9a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4V4zm2 2v10a2 2 0 0 0 2 2h7V8a2 2 0 0 0-2-2H7zm9 12H9a4 4 0 0 1-2-.5V16a2 2 0 0 0 2 2h7v0z',
  clock: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 2a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm1 2v4.6l3.5 2-1 1.7L11 13V7h2z',
  sun: 'M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM11 1h2v3h-2V1zm0 19h2v3h-2v-3zM1 11h3v2H1v-2zm19 0h3v2h-3v-2zM4 5.4L5.4 4l2.1 2.1-1.4 1.4L4 5.4zm12.5 12.5l1.4-1.4 2.1 2.1-1.4 1.4-2.1-2.1zM18.6 4L20 5.4l-2.1 2.1-1.4-1.4L18.6 4zM6.1 16.5l1.4 1.4-2.1 2.1L4 18.6l2.1-2.1z',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z',
  bell: 'M12 2a6 6 0 0 1 6 6v4l2 3v2h-5.2a3 3 0 0 1-5.6 0H4v-2l2-3V8a6 6 0 0 1 6-6zm0 2a4 4 0 0 0-4 4v4.6L6.7 15h10.6L16 12.6V8a4 4 0 0 0-4-4zm-1.7 15h3.4a1.5 1.5 0 0 1-3.4 0z',
});

/** @typedef {keyof typeof PATHS} IconName */
/**
 * 获取内联 SVG 图标（装饰用法默认生成 aria-hidden）。
 * @param {IconName} name
 * @param {{ cls?: string, size?: number, hidden?: boolean }} [opts]
 * @returns {string}
 */
export function icon(name, opts) {
  const path = /** @type {string} */ (PATHS[name]);
  if (!path) return '';
  const cls = opts?.cls ? ` class="${opts.cls}"` : '';
  const size = opts?.size ?? 16;
  const hidden = opts?.hidden === false ? ' role="img" aria-hidden="false"' : ' aria-hidden="true" focusable="false"';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor"${hidden}${cls}><path d="${path}"/></svg>`;
}

/** 图标名清单（供测试与面板使用） */
export const ICON_NAMES = Object.keys(PATHS);
