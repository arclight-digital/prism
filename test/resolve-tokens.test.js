import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTokenMap, resolveTokens } from '../src/resolve-tokens.js';

function tokenMapOf(css) {
  const dir = mkdtempSync(join(tmpdir(), 'prism-tokens-'));
  try {
    const path = join(dir, 'tokens.css');
    writeFileSync(path, css);
    return loadTokenMap(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('resolveTokens', () => {
  it('resolves simple var(--token) references', () => {
    const map = new Map([['--color-primary', '#007bff']]);
    const result = resolveTokens('color: var(--color-primary);', map);
    expect(result).toBe('color: #007bff;');
  });

  it('resolves nested var() references', () => {
    const map = new Map([
      ['--color-base', 'blue'],
      ['--color-primary', 'var(--color-base)'],
    ]);
    const result = resolveTokens('color: var(--color-primary);', map);
    expect(result).toBe('color: blue;');
  });

  it('uses fallback values when token missing', () => {
    const map = new Map();
    const result = resolveTokens('color: var(--missing, red);', map);
    expect(result).toBe('color: red;');
  });

  it('leaves unresolved vars intact', () => {
    const map = new Map();
    const result = resolveTokens('color: var(--unknown);', map);
    expect(result).toBe('color: var(--unknown);');
  });

  it('handles circular references without infinite loop', () => {
    const map = new Map([
      ['--a', 'var(--b)'],
      ['--b', 'var(--a)'],
    ]);
    const result = resolveTokens('color: var(--a);', map);
    // Should not hang — circular refs stop resolving
    expect(result).toBeDefined();
  });

  it('resolves multiple vars in one declaration', () => {
    const map = new Map([
      ['--spacing-x', '8px'],
      ['--spacing-y', '16px'],
    ]);
    const result = resolveTokens(
      'padding: var(--spacing-y) var(--spacing-x);',
      map,
    );
    expect(result).toBe('padding: 16px 8px;');
  });

  it('resolves the SAME token used more than once across the string', () => {
    // Regression: a shared `seen` set previously blocked every occurrence after
    // the first, leaving later uses as literal var(--token).
    const map = new Map([['--color-primary', 'red']]);
    const result = resolveTokens(
      '.a { color: var(--color-primary); } .b { border-color: var(--color-primary); }',
      map,
    );
    expect(result).toBe('.a { color: red; } .b { border-color: red; }');
    expect(result).not.toContain('var(--color-primary)');
  });

  it('resolves a token reused after being referenced through another token', () => {
    const map = new Map([
      ['--base', '4px'],
      ['--gap', 'var(--base)'],
    ]);
    const result = resolveTokens('margin: var(--gap) var(--base);', map);
    expect(result).toBe('margin: 4px 4px;');
  });
});

describe('loadTokenMap', () => {
  // The shape of arc-ui's base.css: tokens on :root, then the same names
  // re-declared by a density preset, a media query, and a passthrough rule that
  // lets a :root override reach into shadow DOM.
  const baseCSS = `
    :root {
      --space-xs: 4px;
      --space-sm: 8px;
      --space-md: 16px;
      --touch-min: 24px;
      --font: "a;b{c}", sans-serif; /* ; and { inside a string */
    }
    @media (pointer: coarse) {
      :root { --touch-min: 36px; }
    }
    [data-density="compact"] { --space-md: 12px; }
    :root[data-theme="dark"] { --space-md: 99px; }
    :where(arc-top-bar, arc-button) {
      --space-xs: inherit;
      --space-md: inherit;
    }
  `;

  it('reads only unconditional :root declarations', () => {
    const map = tokenMapOf(baseCSS);
    expect(map.get('--space-xs')).toBe('4px');
    expect(map.get('--space-md')).toBe('16px');
    expect(map.get('--touch-min')).toBe('24px');
    expect(map.get('--font')).toBe('"a;b{c}", sans-serif');
  });

  it('inlines var() inside calc() to token values, never to inherit', () => {
    const map = tokenMapOf(baseCSS);
    const result = resolveTokens(
      'margin-inline-start: calc(var(--space-xs) - var(--space-md)); margin: calc(-1 * var(--space-md));',
      map,
    );
    expect(result).toBe('margin-inline-start: calc(4px - 16px); margin: calc(-1 * 16px);');
    expect(result).not.toContain('inherit');
  });

  it('reads :root inside @layer and in a selector list, and html', () => {
    const map = tokenMapOf(`
      @layer tokens { :root, :host { --a: 1px; } }
      html { --b: 2px; }
      @supports (color: oklch(0 0 0)) { :root { --a: 9px; } }
    `);
    expect(map.get('--a')).toBe('1px');
    expect(map.get('--b')).toBe('2px');
  });

  it('never records a CSS-wide keyword as a token value', () => {
    const map = tokenMapOf(':root { --a: inherit; --b: initial; --c: unset; --d: revert-layer; }');
    expect(map.size).toBe(0);
  });
});

describe('resolveTokens with a CSS-wide keyword in the map', () => {
  it('keeps the var() as written rather than substituting the keyword', () => {
    const map = new Map([['--space-md', 'inherit']]);
    expect(resolveTokens('height: calc(100vh - var(--space-md));', map)).toBe(
      'height: calc(100vh - var(--space-md));',
    );
    expect(resolveTokens('gap: var(--space-md, 16px);', map)).toBe('gap: 16px;');
  });
});
