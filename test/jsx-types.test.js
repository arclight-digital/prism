/**
 * The opt-in JSX declaration files.
 *
 * Two things here are worth more than the rest: that the Solid file augments
 * `solid-js/jsx-runtime` rather than `solid-js`, and that a wrong enum value is
 * a compile error. The first is the difference between a file that types
 * something and one that types nothing with no diagnostic; the second is the
 * whole reason a consumer on the native path wants the file at all.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseComponent } from '../src/parser.js';
import { generateJSXTypes } from '../src/generators/jsx-types.js';
import { normalizeConfig } from '../src/config.js';

let tmpDir;
beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'prism-jsx-')); });
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

const source = `
  import { LitElement, html } from 'lit';
  /**
   * @tag arc-input
   * @prop {'sm'|'md'|'lg'} size - control size
   */
  export class ArcInput extends LitElement {
    static properties = {
      value: { type: String },
      size: { type: String, reflect: true },
      disabled: { type: Boolean },
      count: { type: Number },
      confirmLabel: { type: String },
      hint: { type: String, attribute: 'hint-text' },
      internalOnly: { type: String, attribute: false },
    };
    render() { return html\`<slot></slot>\`; }
  }
  customElements.define('arc-input', ArcInput);
`;

const metas = [parseComponent(source, '/src/input/input.js', 'arc')];
const config = (extra = {}) => ({
  outDir: 'types', prefix: 'arc', wcPackage: '@arclux/arc-ui', ...extra,
});

const write = (extra) => {
  const results = generateJSXTypes(metas, config(extra), tmpDir);
  return Object.fromEntries(results.map((r) => [
    r.framework, r.written ? readFileSync(r.path, 'utf-8') : null,
  ]));
};

describe('generateJSXTypes', () => {
  it('writes one file per framework by default', () => {
    const files = write();
    expect(Object.keys(files).sort()).toEqual(['preact', 'react', 'solid']);
  });

  it('honours a narrowed framework list', () => {
    expect(Object.keys(write({ frameworks: ['solid'] }))).toEqual(['solid']);
  });

  it('augments the module each framework actually resolves JSX through', () => {
    const files = write();
    expect(files.react).toContain("declare module 'react' {");
    expect(files.preact).toContain("declare module 'preact' {");
    // Not `solid-js`. Augmenting the main entry declares a second, unrelated JSX
    // namespace that nothing consults — and merging into an unused namespace is
    // not an error, so there is no diagnostic to notice.
    expect(files.solid).toContain("declare module 'solid-js/jsx-runtime' {");
    expect(files.solid).not.toContain("declare module 'solid-js' {");
  });

  it('is a module, which is what a module augmentation requires', () => {
    expect(write().react).toContain('export {};');
  });

  it('keeps a documented union a union, so a wrong value will not compile', () => {
    for (const content of Object.values(write())) {
      expect(content).toContain("size?: 'sm' | 'md' | 'lg';");
    }
  });

  it('widens a number to accept its markup form', () => {
    // `count="3"` is how a number is written as an attribute, and it is not wrong.
    expect(write().react).toContain('count?: number | string;');
  });

  it('emits both spellings where Lit lowercases the attribute', () => {
    const react = write().react;
    // Lit lowercases; it does not kebab-case. Both reach the element — the
    // attribute in markup, the property through the framework's custom-element
    // handling — so typing only one makes the other an error against an element
    // that handles it fine.
    expect(react).toContain('confirmlabel?: string;');
    expect(react).toContain('confirmLabel?: string;');
  });

  it('quotes an attribute name that is not an identifier', () => {
    const react = write().react;
    expect(react).toContain("'hint-text'?: string;");
    expect(react).toContain('hint?: string;');
  });

  it('still types a property declared with `attribute: false`', () => {
    // It has no markup spelling, but the property is real and these frameworks
    // set properties on custom elements.
    expect(write().react).toContain('internalOnly?: string;');
  });

  it('gives each framework its own base attribute set', () => {
    const files = write();
    // Solid's is the one carrying real information: `on:` is how a custom event
    // is reached from JSX with no ref, and `prop:` is how an array gets there.
    expect(files.solid).toContain('[directive: `on:${string}`]: unknown;');
    expect(files.solid).toContain('[directive: `prop:${string}`]: unknown;');
    expect(files.solid).not.toContain('className');
    // React takes className; Preact needs both spellings of tabindex.
    expect(files.react).toContain('className?: string;');
    expect(files.preact).toContain('tabindex?: number;');
  });

  it('says how to apply the file, and how not to', () => {
    const react = write().react;
    expect(react).toContain('"include": ["src", "node_modules/@arclux/arc-ui/types/react-jsx.d.ts"]');
    // The two instructions that look right and silently do nothing.
    expect(react).toContain('NOT `{ "types": ["@arclux/arc-ui/react-jsx"] }`');
    expect(react).toContain('reference types="@arclux/arc-ui/react-jsx"');
  });

  it('names the base type from the prefix', () => {
    const files = generateJSXTypes(metas, config({ prefix: 'ui' }), tmpDir);
    expect(readFileSync(files[0].path, 'utf-8')).toContain('type UiBaseAttributes = {');
  });

  it('sorts by tag, so a rename does not reshuffle the file', () => {
    const second = parseComponent(
      source.replace(/arc-input/g, 'arc-badge').replace(/ArcInput/g, 'ArcBadge'),
      '/src/content/badge.js', 'arc'
    );
    const results = generateJSXTypes([metas[0], second], config(), tmpDir);
    const content = readFileSync(results[0].path, 'utf-8');
    expect(content.indexOf("'arc-badge'")).toBeLessThan(content.indexOf("'arc-input'"));
  });

  it('names the package the wrappers import from, inherited rather than guessed', () => {
    // The header tells consumers to include
    // `node_modules/<pkg>/types/react-jsx.d.ts`. A guessed package name is a
    // path that resolves to nothing, includes nothing and reports nothing —
    // precisely the silent no-op the rest of that header warns about.
    const c = normalizeConfig({
      components: 'src',
      tiers: ['input'],
      react: { outDir: 'packages/react/src', wcPackage: '@arclux/arc-ui' },
      solid: { outDir: 'packages/solid/src', wcPackage: '@arclux/arc-ui' },
      jsxTypes: { outDir: 'types' },
    });
    expect(c.jsxTypes.wcPackage).toBe('@arclux/arc-ui');
  });

  it('demands the package name when the wrapper sections disagree', () => {
    expect(() => normalizeConfig({
      components: 'src',
      tiers: ['input'],
      react: { outDir: 'a', wcPackage: '@arclux/arc-ui' },
      solid: { outDir: 'b', wcPackage: '@arclux/arc-ui-next' },
      jsxTypes: { outDir: 'types' },
    })).toThrow(/name different packages/);
  });

  it('demands the package name when there is nothing to inherit from', () => {
    expect(() => normalizeConfig({
      components: 'src',
      tiers: ['input'],
      jsxTypes: { outDir: 'types' },
    })).toThrow(/no framework wrapper section is configured/);
  });

  it('never overwrites a hand-written file at the same path', () => {
    mkdirSync(join(tmpDir, 'types'), { recursive: true });
    writeFileSync(join(tmpDir, 'types', 'react-jsx.d.ts'), '// mine\n');
    const results = generateJSXTypes(metas, config(), tmpDir);
    expect(results.find((r) => r.framework === 'react').written).toBe(false);
    expect(readFileSync(join(tmpDir, 'types', 'react-jsx.d.ts'), 'utf-8')).toBe('// mine\n');
    // The other two are unaffected — one foreign file is not a reason to stop
    // writing the rest.
    expect(results.filter((r) => r.written)).toHaveLength(2);
  });
});
