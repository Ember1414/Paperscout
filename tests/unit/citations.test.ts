import { describe, expect, it } from 'vitest';
import { citeKey, toBibtex, toCslJson, toRis } from '../../public/js/cite-format.js';

const sample = {
  title: 'Attention Is All You Need',
  authors: [{ name: 'Ashish Vaswani' }, { name: 'Noam Shazeer' }],
  year: 2017,
  venue: 'NeurIPS',
  doi: '10.5555/3295222',
  type: 'conference' as const,
  pages: '1-11',
};

describe('citeKey', () => {
  it('姓 + 年 + 标题词', () => {
    expect(citeKey(sample)).toBe('vaswani2017attention');
  });
  it('中文作者/标题', () => {
    expect(citeKey({ title: '大语言模型综述', authors: ['王伟'], year: 2024 })).toMatch(/^王伟2024/);
  });
  it('反例：无作者无年 → unknown', () => {
    expect(citeKey({ title: 'x' })).toContain('unknown');
  });
});

describe('toBibtex', () => {
  it('会议 → inproceedings + booktitle', () => {
    const b = toBibtex(sample);
    expect(b).toContain('@inproceedings{vaswani2017attention,');
    expect(b).toContain('author = {Ashish Vaswani and Noam Shazeer}');
    expect(b).toContain('booktitle = {NeurIPS}');
    expect(b).toContain('doi = {10.5555/3295222}');
  });
  it('期刊 → article + journal', () => {
    const b = toBibtex({ ...sample, type: 'journal', venue: 'Nature' });
    expect(b).toContain('@article{');
    expect(b).toContain('journal = {Nature}');
  });
  it('反例：缺字段不产出空行', () => {
    const b = toBibtex({ title: 'Minimal', authors: [] });
    expect(b.split('\n')).not.toContain('');
    expect(b).not.toContain('undefined');
  });
});

describe('toRis', () => {
  it('TY 映射：期刊 JOUR / 会议 CONF / 预印本 RPRT', () => {
    expect(toRis(sample)).toContain('TY  - CONF');
    expect(toRis({ ...sample, type: 'journal' })).toContain('TY  - JOUR');
    expect(toRis({ ...sample, type: 'preprint' })).toContain('TY  - RPRT');
  });
  it('AU 多行 + ER 结尾', () => {
    const r = toRis(sample);
    expect((r.match(/AU  - /g) ?? []).length).toBe(2);
    expect(r.trimEnd().endsWith('ER  -')).toBe(true);
  });
});

describe('toCslJson', () => {
  it('CSL-JSON 结构（Zotero 可导入）', () => {
    const j = JSON.parse(toCslJson(sample));
    expect(j.type).toBe('paper-conference');
    expect(j.author[0]).toEqual({ family: 'Vaswani', given: 'Ashish' });
    expect(j.issued['date-parts'][0][0]).toBe(2017);
    expect(j.DOI).toBe('10.5555/3295222');
  });
  it('反例：缺 DOI/URL 时无对应键', () => {
    const j = JSON.parse(toCslJson({ title: 'X', authors: ['A B'] }));
    expect('DOI' in j).toBe(false);
    expect('URL' in j).toBe(false);
  });
});
