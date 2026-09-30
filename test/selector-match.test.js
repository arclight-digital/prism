import { describe, it, expect } from 'vitest';
import {
  compareSpecificity, elementOf, matchesSelector, parseSelector, specificity, splitSelectorList,
} from '../src/selector-match.js';

const el = (tag, cls, attrs = {}) => elementOf(tag, new Map(Object.entries({ class: cls, ...attrs })));

describe('parseSelector', () => {
  it.each([
    ['.h .a', 'static'],
    ['.h > .a b.c', 'static'],
    ['.h:not([data-href]):not(.x) .a', 'static'],
    ['.h[data-variant="error"] .a', 'variant'],
    ['.h .a::before', 'dynamic'],
    ['.h .a:hover', 'dynamic'],
    ['.h .a:first-child', 'dynamic'],
    ['.h .a + .b', 'dynamic'],
    ['.h .a ~ .b', 'dynamic'],
    ['.h .a:not(:disabled)', 'dynamic'],
    ['.h [class^="x"]', 'dynamic'],
  ])('%s is %s', (selector, kind) => {
    expect(parseSelector(selector).kind).toBe(kind);
  });
});

describe('matchesSelector', () => {
  const host = el('div', 'arc-input');
  const group = el('div', 'input-group');
  const wrapper = el('div', 'input-group__wrapper extra');

  it('checks every ancestor, not only the element', () => {
    // The default input showed an error border: this rule was applied to the
    // wrapper without asking whether any ancestor had `input-group--error`.
    const error = parseSelector('.arc-input .input-group--error .input-group__wrapper');
    expect(matchesSelector(error, wrapper, [host, group])).toBe(false);
    expect(matchesSelector(error, wrapper, [host, el('div', 'input-group input-group--error')])).toBe(true);
  });

  it('matches one class of several', () => {
    expect(matchesSelector(parseSelector('.arc-input .input-group__wrapper'), wrapper, [host, group])).toBe(true);
  });

  it('holds a child combinator to the parent', () => {
    const child = parseSelector('.arc-input > .input-group__wrapper');
    expect(matchesSelector(child, wrapper, [host, group])).toBe(false);
    expect(matchesSelector(child, wrapper, [host])).toBe(true);
  });

  it('matches type selectors and :not() against the element as written', () => {
    expect(matchesSelector(parseSelector('.arc-x p'), el('p', ''), [el('div', 'arc-x')])).toBe(true);
    const not = parseSelector('.arc-x:not([data-href]) .a');
    expect(matchesSelector(not, el('span', 'a'), [el('div', 'arc-x')])).toBe(true);
    expect(matchesSelector(not, el('span', 'a'), [el('div', 'arc-x', { 'data-href': '#' })])).toBe(false);
  });
});

describe('splitSelectorList', () => {
  it('splits only at top-level commas', () => {
    expect(splitSelectorList('.h:not(.a, .b) .c,\n  .h a')).toEqual(['.h:not(.a, .b) .c', '.h a']);
  });
});

describe('specificity', () => {
  it('ranks classes over types, and :not() by its argument', () => {
    const s = (sel) => specificity(parseSelector(sel));
    expect(s('.h .a')).toEqual([0, 2, 0]);
    expect(s('.h p')).toEqual([0, 1, 1]);
    expect(s('.h:not(.x) .a')).toEqual([0, 3, 0]);
    expect(compareSpecificity(s('.h .a.b'), s('.h .a'))).toBeGreaterThan(0);
  });
});
