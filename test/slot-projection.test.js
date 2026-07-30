/**
 * The projection invariant: whatever a component can receive, every wrapper
 * must be able to pass it.
 *
 * This exists because 2.7.0 broke it and nothing caught the break. The failure
 * was not in a generator and not in the parser, but in the seam between them:
 * `extractTemplate` skips nested html`` inside `${}`, so a default slot in a
 * conditional branch is absent from `meta.template`, and the generators read
 * that absence as "no default slot" and deleted `children` from 111 wrappers.
 *
 * The generator tests of the day all passed, because they built `meta` by hand
 * with `hasDefaultSlot` set to the value the assertion expected. They proved the
 * generators did as they were told. Nothing proved the parser was telling them
 * the truth about real source.
 *
 * So every case here starts from **component source** and runs the whole chain.
 * A shape that survives extraction only by luck fails here, in prism, rather
 * than silently in a design system three packages downstream.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseComponent } from '../src/parser.js';
import { generateReact } from '../src/generators/react.js';
import { generateVue } from '../src/generators/vue.js';
import { generateSvelte } from '../src/generators/svelte.js';
import { generateAngular } from '../src/generators/angular.js';
import { generateSolid } from '../src/generators/solid.js';
import { generatePreact } from '../src/generators/preact.js';

let tmpDir;
beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'prism-slots-')); });
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

const cfg = (sub) => ({ outDir: sub, wcPackage: '@arclux/arc-ui', prefix: 'arc', barrels: false });

/**
 * How each framework spells "the default slot's content goes here". If a
 * component has a default slot, its wrapper must contain this.
 */
const RENDERS_CHILDREN = {
  react:   { gen: generateReact,   marker: 'children?: React.ReactNode;' },
  vue:     { gen: generateVue,     marker: '<slot />' },
  svelte:  { gen: generateSvelte,  marker: '{@render children?.()}' },
  angular: { gen: generateAngular, marker: '<ng-content />' },
  solid:   { gen: generateSolid,   marker: '{local.children}' },
  preact:  { gen: generatePreact,  marker: '{children}' },
};

/**
 * Component shapes that all genuinely have a default slot, written the way real
 * Lit components write them. The parser must see the slot in every one.
 */
const WITH_DEFAULT_SLOT = {
  'plain default slot':
    'render() { return html`<button><slot></slot></button>`; }',

  'default slot beside named ones':
    'render() { return html`<button><slot name="prefix"></slot><slot></slot><slot name="suffix"></slot></button>`; }',

  // The exact shape that broke: extractTemplate skips nested html`` inside ${},
  // so this slot is invisible in meta.template.
  'default slot in a conditional branch':
    'render() { return html`<button>${this.loading ? html`<arc-spinner></arc-spinner>` : html`<slot></slot>`}</button>`; }',

  'default slot only in a helper method':
    'render() { return html`<button>${this.renderInner()}</button>`; }\n  renderInner() { return html`<slot></slot>`; }',

  'default slot behind an open guard':
    "render() { return html`<div>${this.open ? html`<div class=\"body\"><slot></slot></div>` : ''}</div>`; }",

  'default slot in a local template variable':
    'render() { const inner = html`<slot></slot>`; return html`<button>${inner}</button>`; }',

  'default slot in both ternary branches':
    'render() { return this.href ? html`<a><slot></slot></a>` : html`<button><slot></slot></button>`; }',

  'default slot with a slotchange handler':
    'render() { return html`<div><slot @slotchange=${(e) => this._sync(e)}></slot></div>`; }',

  'default slot on its own line, multiline template':
    'render() {\n    return html`\n      <div class="wrap">\n        <slot></slot>\n      </div>\n    `;\n  }',
};

const componentSource = (body, jsdoc = '') => `
import { LitElement, html } from 'lit';
/**
 * @tag arc-thing
${jsdoc}
 */
export class ArcThing extends LitElement {
  ${body}
}
customElements.define('arc-thing', ArcThing);
`;

const parse = (body, jsdoc) =>
  parseComponent(componentSource(body, jsdoc), '/src/reactive/thing.js', 'arc');

describe('a component with a default slot keeps children in every wrapper', () => {
  for (const [shape, body] of Object.entries(WITH_DEFAULT_SLOT)) {
    it(`sees the default slot — ${shape}`, () => {
      expect(parse(body).hasDefaultSlot).toBe(true);
    });

    for (const [framework, { gen, marker }] of Object.entries(RENDERS_CHILDREN)) {
      it(`${framework} renders children — ${shape}`, () => {
        const meta = parse(body);
        const out = readFileSync(gen(meta, cfg(`out/${framework}`), tmpDir).path, 'utf-8');
        expect(out).toContain(marker);
      });
    }
  }

  it('still sees it when named slots are documented but the default is not', () => {
    // The 2.7.0 trigger: @slot tags populated `slots` while the template scan
    // missed the default, so the component looked named-slots-only.
    const meta = parse(
      WITH_DEFAULT_SLOT['default slot in a conditional branch'],
      ' * @slot prefix - Leading icon\n * @slot suffix - Trailing icon',
    );
    expect(meta.slots).toEqual(['prefix', 'suffix']);
    expect(meta.hasDefaultSlot).toBe(true);
  });
});

describe('children are dropped only on positive evidence', () => {
  it('drops them when named slots exist and no default does', () => {
    const meta = parse('render() { return html`<div><slot name="actions"></slot></div>`; }');
    expect(meta.hasDefaultSlot).toBe(false);
    const out = readFileSync(generateSvelte(meta, cfg('out/s'), tmpDir).path, 'utf-8');
    expect(out).not.toContain('{@render children?.()}');
    expect(out).toContain('{@render actions?.()}');
  });

  it('keeps them when no slot was found at all', () => {
    // Absence of evidence. A component whose render() could not be read looks
    // identical to one with no slots, and only one of those justifies deleting
    // content — so neither does.
    const meta = parse('render() { return this.build(); }');
    expect(meta.slots).toEqual([]);
    for (const [framework, { gen, marker }] of Object.entries(RENDERS_CHILDREN)) {
      const out = readFileSync(gen(meta, cfg(`out/none-${framework}`), tmpDir).path, 'utf-8');
      expect(out, framework).toContain(marker);
    }
  });
});

describe('named slots reach the wrappers that can carry them', () => {
  const body = 'render() { return html`<div><slot name="start"></slot><slot></slot></div>`; }';

  it('Svelte declares and renders a snippet for each', () => {
    const out = readFileSync(generateSvelte(parse(body), cfg('out/s2'), tmpDir).path, 'utf-8');
    expect(out).toContain('start?: Snippet;');
    expect(out).toContain('{@render start?.()}');
  });

  it('Vue forwards each one', () => {
    const out = readFileSync(generateVue(parse(body), cfg('out/v2'), tmpDir).path, 'utf-8');
    expect(out).toContain('<slot name="start" />');
  });
});

describe('children survive a documented slot the parser cannot see rendered', () => {
  it('keeps children when named slots are known only from JSDoc', () => {
    // The residual form of the 2.7.0 bug: a component that documents `@slot
    // header` while its default slot is rendered by a base class this parser
    // never reads. Documented-only evidence must not justify deleting children.
    const meta = parseComponent(`
      /**
       * @tag arc-shell
       * @slot header - Rendered by the base class
       */
      export class ArcShell extends LitElement {}
    `, '/src/application/shell.js', 'arc');
    expect(meta.slots).toEqual(['header']);
    expect(meta.slotsInMarkup).toEqual([]);
    for (const [framework, { gen, marker }] of Object.entries(RENDERS_CHILDREN)) {
      const out = readFileSync(gen(meta, cfg(`out/doc-${framework}`), tmpDir).path, 'utf-8');
      expect(out, framework).toContain(marker);
    }
  });
});
