import { describe, expect, it } from 'vitest';
import {
  authorKey,
  authorSurname,
  cleanAbstract,
  dice2,
  detectLang,
  normalizeAuthorName,
  normalizeDoi,
  normalizeVenue,
  parseYear,
  titleFingerprint,
  titleMainPart,
  venueKey,
} from '../../functions/lib/core/normalize';

describe('normalizeDoi（5.2.2）', () => {
  it('正例：去前缀 + 小写 + 去尾标点（DoD 用例）', () => {
    expect(normalizeDoi('10.1000/ABC.')).toBe('10.1000/abc');
    expect(normalizeDoi('https://doi.org/10.1038/S41586-023-06221-2')).toBe('10.1038/s41586-023-06221-2');
    expect(normalizeDoi('doi:10.5555/X.1')).toBe('10.5555/x.1');
    expect(normalizeDoi('info:doi/10.12/y')).toBe('10.12/y');
    expect(normalizeDoi('info:doi:10.12/y')).toBe('10.12/y'); // INFO URI 冒号变体
  });
  it('边界：保留大小写无关于内容、句中点号保留', () => {
    expect(normalizeDoi('  10.1000/journal.article.v2 ')).toBe('10.1000/journal.article.v2');
  });
  it('反例：非法形态丢弃（空、无 10. 前缀、URL 而非 DOI）', () => {
    expect(normalizeDoi('')).toBeUndefined();
    expect(normalizeDoi('not-a-doi')).toBeUndefined();
    expect(normalizeDoi('11.1000/abc')).toBeUndefined();
    expect(normalizeDoi('https://example.com/10.1/x')).toBeUndefined();
    expect(normalizeDoi(undefined)).toBeUndefined();
  });
});

describe('titleFingerprint / titleMainPart', () => {
  it('正例：NFKC + 实体 + 标点全剥离', () => {
    expect(titleFingerprint('Attention Is&nbsp;All You Need!')).toBe('attentionisallyouneed');
    expect(titleFingerprint('BERT：预训练语言模型')).toBe('bert预训练语言模型');
    expect(titleFingerprint('ＧＮＮｓ')); // 全角 NFKC → gNNs
    expect(titleFingerprint('ＧＮＮｓ')).toBe('gnns');
  });
  it('去副标题：按首个 :/：/— 切分', () => {
    expect(titleMainPart('Deep Learning: A Survey')).toBe('Deep Learning');
    expect(titleMainPart('图神经网络——综述与应用')).toBe('图神经网络');
    expect(titleMainPart('No Subtitle Here')).toBe('No Subtitle Here');
  });
  it('反例：空串产出空指纹', () => {
    expect(titleFingerprint('')).toBe('');
  });
});

describe('作者归一', () => {
  it('正例：Last, First 翻转与标记清除', () => {
    expect(normalizeAuthorName('Bengio, Yoshua')).toBe('Yoshua Bengio');
    expect(normalizeAuthorName('Yoshua Bengio*†')).toBe('Yoshua Bengio');
    expect(normalizeAuthorName('  张三 ')).toBe('张三');
  });
  it('比对键：大小写/标点不敏感', () => {
    expect(authorKey('Bengio, Yoshua')).toBe(authorKey('yoshua bengio'));
    expect(authorKey('O’Connor, J.')).toBe(authorKey('J O’Connor'.replace('’', "'")));
  });
  it('姓氏提取：西文取末词，中文取首字', () => {
    expect(authorSurname('Bengio, Yoshua')).toBe('Bengio');
    expect(authorSurname('王伟')).toBe('王');
  });
});

describe('parseYear', () => {
  it('正例：从混合文本提取 4 位年份', () => {
    expect(parseYear('2024-03-01')).toBe(2024);
    expect(parseYear(2023)).toBe(2023);
    expect(parseYear('Published 1998')).toBe(1998);
  });
  it('边界：下界 1800 与上界当前年+1', () => {
    expect(parseYear(1799)).toBeUndefined();
    expect(parseYear(new Date().getFullYear() + 1)).toBe(new Date().getFullYear() + 1);
    expect(parseYear(new Date().getFullYear() + 2)).toBeUndefined();
  });
  it('反例：无 4 位数字', () => {
    expect(parseYear('no year')).toBeUndefined();
    expect(parseYear(null)).toBeUndefined();
  });
});

describe('venue / venueKey', () => {
  it('正例：去 Proceedings of the 前缀，比对键小写', () => {
    expect(normalizeVenue('Proceedings of the 35th NeurIPS')).toBe('35th NeurIPS');
    expect(venueKey('  Nature  ')).toBe('nature');
  });
  it('反例：非前缀文本不动', () => {
    expect(normalizeVenue('Proceedings Journal')).toBe('Proceedings Journal');
  });
});

describe('cleanAbstract（A-04/A-05 相邻问题：JATS 清洗）', () => {
  it('正例：JATS 标签与实体清理', () => {
    expect(cleanAbstract('<jats:p>First.</jats:p> <jats:sec>Method</jats:sec>')).toBe('First. Method');
    expect(cleanAbstract('A &amp; B')).toBe('A & B');
  });
  it('边界：3000 字截断加省略号', () => {
    const long = 'x'.repeat(3100);
    expect(cleanAbstract(long)).toHaveLength(3001);
    expect(cleanAbstract(long)?.endsWith('…')).toBe(true);
  });
  it('反例：空/纯标签输入返回 undefined', () => {
    expect(cleanAbstract('')).toBeUndefined();
    expect(cleanAbstract('<jats:p></jats:p>')).toBeUndefined();
    expect(cleanAbstract(undefined)).toBeUndefined();
  });
});

describe('detectLang（A-05 修复：对称判定）', () => {
  it('正例：标题或任一含 CJK → zh', () => {
    expect(detectLang('大语言模型', 'English abstract')).toBe('zh');
    expect(detectLang('English Title', '中文摘要')).toBe('zh');
  });
  it('正例：标题与摘要均无 CJK → en（摘要不再被忽略）', () => {
    expect(detectLang('English Title', 'English abstract')).toBe('en');
    expect(detectLang('English Title')).toBe('en');
  });
});

describe('dice2（k3 阈值 0.92）', () => {
  it('正例：相同串 = 1；微扰接近 1', () => {
    expect(dice2('graph neural network', 'graph neural network')).toBe(1);
    expect(dice2('large language model survey', 'large language model survey!')).toBeGreaterThan(0.9);
  });
  it('边界：单字符与空串', () => {
    expect(dice2('a', 'a')).toBe(1);
    expect(dice2('', 'a')).toBe(0);
  });
  it('反例：不同串显著低分', () => {
    expect(dice2('graph neural network', 'quantum error correction')).toBeLessThan(0.3);
  });
});
