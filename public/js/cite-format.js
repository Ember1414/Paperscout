// @ts-check
/**
 * 引用格式化（REBUILD_PLAN M3-07 / 5.7：全部纯前端生成，Blob 下载）。
 * BibTeX / RIS / CSL-JSON。测试直指本文件（原 functions 副本已裁撤）。
 */

/**
 * @typedef {object} CiteInput
 * @property {string} title
 * @property {Array<{ name: string } | string>} authors
 * @property {number} [year]
 * @property {string} [venue]
 * @property {string} [doi]
 * @property {string} [type]
 * @property {string} [volume]
 * @property {string} [issue]
 * @property {string} [pages]
 * @property {string} [url]
 */

/**
 * @param {CiteInput} input
 * @returns {string[]}
 */
function rawAuthors(input) {
  return (input.authors ?? [])
    .map((a) => (typeof a === 'string' ? a : a?.name))
    .filter(Boolean)
    .slice(0, 30);
}

/**
 * BibTeX key：姓 + 年 + 首个标题词（规划 5.7）
 * @param {CiteInput} input
 * @returns {string}
 */
export function citeKey(input) {
  const first = rawAuthors(input)[0] ?? 'unknown';
  const surname = (first.includes(',') ? first.split(',')[0] : first.split(/\s+/).pop()) ?? 'unknown';
  const word = (input.title.toLowerCase().match(/[a-z\u4e00-\u9fa5]{3,}/) ?? ['paper'])[0].slice(0, 12);
  return slug(surname) + (input.year ?? '') + slug(word);
}

/**
 * @param {CiteInput} input
 * @returns {string}
 */
export function toBibtex(input) {
  const kind = input.type === 'conference' ? 'inproceedings' : input.type === 'preprint' ? 'misc' : 'article';
  const key = citeKey(input);
  const authors = rawAuthors(input).map((a) => a.replace(/,/g, ' and')).join(' and ');
  const lines = [
    `@${kind}{${key},`,
    `  title = {${input.title}},`,
    authors ? `  author = {${authors}},` : '',
    input.year ? `  year = {${input.year}},` : '',
    input.venue ? `  ${kind === 'inproceedings' ? 'booktitle' : 'journal'} = {${input.venue}},` : '',
    input.volume ? `  volume = {${input.volume}},` : '',
    input.issue ? `  number = {${input.issue}},` : '',
    input.pages ? `  pages = {${input.pages}},` : '',
    input.doi ? `  doi = {${input.doi}},` : '',
    input.url ? `  url = {${input.url}},` : '',
    '}',
  ];
  return lines.filter(Boolean).join('\n');
}

/**
 * @param {CiteInput} input
 * @returns {string}
 */
export function toRis(input) {
  const kind = input.type === 'conference' ? 'CONF' : input.type === 'preprint' ? 'RPRT' : 'JOUR';
  const lines = [
    `TY  - ${kind}`,
    `TI  - ${input.title}`,
    ...rawAuthors(input).map((a) => `AU  - ${a}`),
    input.year ? `PY  - ${input.year}` : '',
    input.venue ? (kind === 'CONF' ? `T2  - ${input.venue}` : `JO  - ${input.venue}`) : '',
    input.volume ? `VL  - ${input.volume}` : '',
    input.issue ? `IS  - ${input.issue}` : '',
    input.pages ? `SP  - ${String(input.pages).split('-')[0]}` : '',
    input.doi ? `DO  - ${input.doi}` : '',
    input.url ? `UR  - ${input.url}` : '',
    'ER  - ',
  ];
  return lines.filter(Boolean).join('\n');
}

/**
 * @param {CiteInput} input
 * @returns {string}
 */
export function toCslJson(input) {
  /** @type {any} */
  const csl = {
    id: input.doi ?? citeKey(input),
    type: input.type === 'conference' ? 'paper-conference' : 'article-journal',
    title: input.title,
    author: rawAuthors(input).map((name) => {
      if (name.includes(',')) {
        const parts = name.split(',');
        return { family: parts[0].trim(), given: (parts[1] ?? '').trim() };
      }
      const parts = name.split(/\s+/);
      return { family: parts.pop() ?? name, given: parts.join(' ') };
    }),
  };
  if (input.year) csl.issued = { 'date-parts': [[input.year]] };
  if (input.venue) csl['container-title'] = input.venue;
  if (input.volume) csl.volume = input.volume;
  if (input.issue) csl.issue = input.issue;
  if (input.pages) csl.page = input.pages;
  if (input.doi) csl.DOI = input.doi;
  if (input.url) csl.URL = input.url;
  return JSON.stringify(csl, null, 2);
}

/**
 * @param {string} s
 * @returns {string}
 */
function slug(s) {
  return s.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '').toLowerCase() || 'x';
}
