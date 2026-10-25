import { describe, expect, it } from 'vitest';
import { stem } from '../../functions/lib/query/stemmer';

describe('Porter Stemmer 简化版（M10-01）', () => {
  it('正例：复数归一化', () => {
    expect(stem('networks')).toBe('network');
    expect(stem('models')).toBe('model');
    expect(stem('papers')).toBe('paper');
    expect(stem('processes')).toBe('process');
  });
  it('正例：-ing / -ed', () => {
    expect(stem('learning')).toBe('learn');
    expect(stem('running')).toBe('run');
    expect(stem('trained')).toBe('train');
    expect(stem('stopped')).toBe('stop');
  });
  it('正例：-tion / -ly / -ness', () => {
    expect(stem('generation')).toBe('generate');
    expect(stem('quickly')).toBe('quick');
    expect(stem('effectiveness')).toBe('effective');
  });
  it('正例：不规则词', () => {
    expect(stem('data')).toBe('data');
    expect(stem('analyses')).toBe('analysis');
    expect(stem('indices')).toBe('index');
  });
  it('边界：短词/空不变', () => {
    expect(stem('')).toBe('');
    expect(stem('a')).toBe('a');
    expect(stem('is')).toBe('is');
  });
  it('反例：ss/us/is 不去 s', () => {
    expect(stem('class')).toBe('class');
    expect(stem('virus')).toBe('virus');
    expect(stem('basis')).toBe('basis');
  });
});
