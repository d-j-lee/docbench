/** 화면 문구(src/ui/i18n.ts)는 ko·en 둘 다 — 한쪽에만 있는 낱말이 없다 */
import { describe, it, expect } from 'vitest';
import { dictKeys } from '../../src/ui/i18n';

describe('화면 문구', () => {
  it('ko·en 낱말이 같다', () => {
    const { ko, en } = dictKeys();
    expect(ko.filter((k) => !en.includes(k)), 'en 에 없는 낱말').toEqual([]);
    expect(en.filter((k) => !ko.includes(k)), 'ko 에 없는 낱말').toEqual([]);
  });
});
