/**
 * The acceptance corpus: seven component shapes, every generator, one pass.
 *
 * Every defect prism has shipped was found downstream, by a check written in the
 * consuming repo, against a catalog of 200 real components — because the
 * published package carried no corpus of its own and a generator testing its
 * output for *shape* cannot see whether a consumer can use it. An Angular
 * package that registered no custom elements, a Solid augmentation that typed
 * nothing, wrappers that discarded every child: all of them passed unit tests
 * that asserted what the generators were told to write.
 *
 * So the members of `fixtures/corpus/` are not examples. Each one is a shape
 * that broke, kept as source and run through the whole chain, and each file says
 * which failure it stands for. Adding a component here is how the next one gets
 * caught in prism instead of three packages downstream.
 *
 * This is one of the two answers in PRISM-3 §3.3. The other — running the
 * reference consumer's own checks against a release candidate — is recorded in
 * CONTRIBUTING.md, because the corpus is deliberately small and cannot replace
 * a real catalog.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { parseComponent } from '../src/parser.js';
import { generateReact } from '../src/generators/react.js';
import { generateVue } from '../src/generators/vue.js';
import { generateSvelte } from '../src/generators/svelte.js';
import { generateAngular } from '../src/generators/angular.js';
import { generateSolid } from '../src/generators/solid.js';
import { generatePreact } from '../src/generators/preact.js';
import { generateJSXTypes } from '../src/generators/jsx-types.js';
import { formBinding } from '../src/generators/form-control.js';
import {
  verifyWrapper, verifyRegistration, verifyAccessor, verifyHandle, VERIFIABLE,
} from '../src/verify.js';
import { registerImport } from '../src/generators/imports.js';
import { updateReactTierBarrel, updateReactRootBarrel, pruneBarrels } from '../src/generators/barrel.js';

const CORPUS = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'corpus');
const TIERS = ['content', 'input', 'navigation'];

const GENERATORS = {
  react: generateReact,
  vue: generateVue,
  svelte: generateSvelte,
  angular: generateAngular,
  solid: generateSolid,
  preact: generatePreact,
};

/** Every corpus component, parsed from its own source. */
const metas = TIERS.flatMap((tier) =>
  readdirSync(join(CORPUS, tier))
    .filter((f) => f.endsWith('.js'))
    .map((f) => {
      const path = join(CORPUS, tier, f);
      return parseComponent(readFileSync(path, 'utf-8'), path, 'arc');
    })
);

const byTag = new Map(metas.map((m) => [m.tag, m]));
const cfg = (extra = {}) => ({
  outDir: 'out', wcPackage: '@arclux/arc-ui', prefix: 'arc', barrels: false, ...extra,
});

let tmpDir;
/** framework → tag → generated file contents */
let output;

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'prism-corpus-'));
  output = {};
  for (const [framework, generate] of Object.entries(GENERATORS)) {
    output[framework] = {};
    for (const meta of metas) {
      const result = generate(meta, cfg(), dir);
      output[framework][meta.tag] = readFileSync(result.path, 'utf-8');
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('the corpus itself', () => {
  it('parses every member', () => {
    expect(metas.map((m) => m.tag).sort()).toEqual([
      'arc-badge', 'arc-checkbox', 'arc-code-block', 'arc-drawer', 'arc-input',
      'arc-notice', 'arc-top-bar',
    ]);
  });

  it('loses no declared prop on the way in', () => {
    // A prop prism cannot read is a prop absent from every wrapper, and fewer
    // props still typechecks — so nothing downstream notices.
    expect(byTag.get('arc-input').props.map((p) => p.name))
      .toEqual(['value', 'size', 'disabled', 'confirmLabel']);
  });
});

describe('every wrapper of every component', () => {
  it('registers its element', () => {
    // The worst defect prism has shipped: the Angular wrappers imported the
    // element class in type position only, TypeScript elided the import, and
    // `customElements.define` never ran. Nothing static objected — every prop
    // wrote an expando onto an unupgraded HTMLUnknownElement and read back fine.
    for (const framework of VERIFIABLE) {
      for (const meta of metas) {
        const register = registerImport(meta, cfg());
        expect(verifyRegistration(framework, output[framework][meta.tag], meta, register))
          .toBe(null);
      }
    }
  });

  it('carries an outlet for everything the component can receive', () => {
    for (const framework of VERIFIABLE) {
      for (const meta of metas) {
        expect(verifyWrapper(framework, output[framework][meta.tag], meta)).toEqual([]);
      }
    }
  });

  it('hands back the element wherever the component has methods to call on it', () => {
    for (const framework of VERIFIABLE) {
      for (const meta of metas) {
        expect(verifyHandle(framework, output[framework][meta.tag], meta)).toBe(null);
      }
    }
  });
});

describe('a component that moves state its consumer also holds', () => {
  const meta = byTag.get('arc-drawer');

  it('is read as announcing the prop, not the key the payload happens to use', () => {
    // The whole difference from the rule this replaced: `detail.value` is not
    // called `open`, and a name-keyed rule sees nothing here at all.
    expect(meta.eventDetails['arc-drawer-toggle']).toEqual(['value']);
    expect(meta.eventWrites['arc-drawer-toggle']).toEqual({ value: 'open' });
  });

  it('binds it back in the three frameworks that need the wrapper to say so', () => {
    expect(output.svelte['arc-drawer']).toContain("if ('value' in detail) open = detail.value as boolean;");
    expect(output.vue['arc-drawer']).toContain("if ('value' in detail) emit('update:open', detail.value as boolean);");
    expect(output.angular['arc-drawer']).toContain('this.openChange.emit(detail.value as boolean);');
  });

  it('declares the prop bindable, so a parent copy can be written to', () => {
    expect(output.svelte['arc-drawer']).toContain('open = $bindable(false)');
    expect(output.vue['arc-drawer']).toContain("'update:open': [value: boolean];");
    expect(output.angular['arc-drawer']).toContain('@Output() openChange = new EventEmitter<boolean>();');
  });

  it('leaves the prop it says nothing about alone', () => {
    expect(output.svelte['arc-drawer']).not.toContain('label = $bindable');
    expect(output.angular['arc-drawer']).not.toContain('labelChange');
  });
});

describe('a component driven by its methods', () => {
  const meta = byTag.get('arc-notice');

  it('is read as having the three a consumer calls, and none of the rest', () => {
    // A static isn't reachable through an element reference, `_schedule` is
    // private by the convention the catalog follows, and the browser calls
    // connectedCallback.
    expect(meta.methods).toEqual(['show', 'dismiss', 'clear']);
  });

  it('hands back the element in every wrapper that would otherwise keep it', () => {
    expect(output.svelte['arc-notice']).toContain('export function element(): ArcNotice | undefined {');
    expect(output.vue['arc-notice']).toContain('defineExpose({ element: __el });');
    expect(output.angular['arc-notice']).toContain('get element(): ArcNotice {');
    expect(output.solid['arc-notice']).toContain('ref?: ArcNotice | ((el: ArcNotice) => void);');
    expect(output.preact['arc-notice']).toContain('forwardRef<ArcNotice, NoticeProps>');
  });

  it('leaves React alone, which forwarded refs all along', () => {
    // The reason this was found by an application rather than a build: the one
    // wrapper anybody reaches for first was never broken.
    expect(output.react['arc-notice']).toContain('createComponent({');
    expect(output.react['arc-notice']).not.toContain('forwardRef');
  });

  it('gives a component with no methods no handle at all', () => {
    expect(output.svelte['arc-badge']).not.toContain('export function element');
    expect(output.vue['arc-badge']).not.toContain('defineExpose');
    expect(output.angular['arc-badge']).not.toContain('get element()');
    expect(output.preact['arc-badge']).not.toContain('forwardRef');
  });
});

describe('a component whose slots are all named', () => {
  const meta = byTag.get('arc-top-bar');

  it('is read as having named slots and no default one', () => {
    expect(meta.slots).toEqual(['logo', 'actions']);
    expect(meta.hasDefaultSlot).toBe(false);
  });

  it('still takes children in the four frameworks that project them verbatim', () => {
    // Their single outlet is the route for named-slot content too: the child
    // carries its own `slot` attribute and the browser does the assignment.
    expect(output.angular['arc-top-bar']).toContain('<ng-content />');
    expect(output.solid['arc-top-bar']).toContain('{local.children}');
    expect(output.react['arc-top-bar']).toContain('children?: React.ReactNode;');
    expect(output.preact['arc-top-bar']).toContain(', children)');
  });

  it('gets an outlet per named slot in the two frameworks that interpose', () => {
    expect(output.vue['arc-top-bar']).toContain('<slot name="logo" />');
    expect(output.svelte['arc-top-bar']).toContain('{@render logo?.()}');
  });
});

describe('a dashed custom event', () => {
  it('is reachable in every framework that has to name it', () => {
    expect(output.react['arc-top-bar']).toContain("onArcNavToggle: 'arc-nav-toggle'");
    // Solid's `on:` namespace takes the literal hyphenated name.
    expect(output.solid['arc-top-bar']).toContain("on:arc-nav-toggle={local.onArcNavToggle}");
    // Preact lowercases the part after `on`, so a plain prop cannot carry a
    // dashed name at all — the wrapper attaches a listener instead.
    expect(output.preact['arc-top-bar']).toContain("el.addEventListener('arc-nav-toggle', fn);");
    // Angular needs none: the event fires natively from the host it attaches to.
    expect(output.angular['arc-top-bar']).toContain("selector: 'arc-top-bar',");
  });
});

describe('a form-associated element', () => {
  it('gets an accessor, and commits on the change event rather than the live one', () => {
    const out = output.angular['arc-input'];
    expect(verifyAccessor('angular', out, formBinding(byTag.get('arc-input'), cfg()))).toBe(null);
    expect(out).toContain("this._el.addEventListener('arc-change', () => {");
    expect(out).not.toContain("this._el.addEventListener('arc-input', () => {");
  });

  it('binds `checked` where the control declares both', () => {
    expect(output.angular['arc-checkbox']).toContain('this._onChangeFn(this._el.checked);');
    expect(output.angular['arc-checkbox']).toContain('const next = value ?? false;');
  });

  it('does not mirror a payload onto the prop that merely shares its key', () => {
    // `detail.value` is the checked flag; `value` is the string the form
    // submits. The names line up and the meanings do not, so what the dispatch
    // site says outranks what the key is called.
    expect(byTag.get('arc-checkbox').eventWrites['arc-change']).toEqual({
      value: 'checked', checked: 'checked',
    });
    const svelte = output.svelte['arc-checkbox'];
    expect(svelte).toContain("if ('checked' in detail) checked = detail.checked as boolean;");
    expect(svelte).not.toContain('value = detail.value');
    expect(output.angular['arc-checkbox']).not.toContain('valueChange');
  });

  it('leaves a component that is not form-associated without one', () => {
    for (const tag of ['arc-badge', 'arc-top-bar', 'arc-code-block']) {
      expect(byTag.get(tag).formAssociated).toBe(false);
      expect(output.angular[tag]).not.toContain('@angular/forms');
    }
  });
});

describe('the JSX declaration files', () => {
  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'prism-corpus-jsx-')); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('cover the whole catalog, including components kept out of the barrels', () => {
    const results = generateJSXTypes(metas, { outDir: 'types', prefix: 'arc' }, tmpDir);
    for (const r of results) {
      const content = readFileSync(r.path, 'utf-8');
      for (const meta of metas) expect(content).toContain(`'${meta.tag}':`);
    }
  });

  it('type a documented union as one, so a wrong value will not compile', () => {
    const [react] = generateJSXTypes(metas, { outDir: 'types', prefix: 'arc', frameworks: ['react'] }, tmpDir);
    expect(readFileSync(react.path, 'utf-8')).toContain("tone?: 'neutral' | 'success' | 'danger';");
  });
});

describe('a type import that stops being used', () => {
  // Both were found by test/typecheck/run.js, which compiles this corpus with
  // each framework's own checker — and neither is visible from the inside: the
  // wrapper is well-formed, says everything it should, and fails `tsc` in the
  // consumer's package under `noUnusedLocals`, which is on in the starter
  // template both frameworks ship.
  it('is left out of the Svelte wrapper of a component with no slots', () => {
    expect(byTag.get('arc-notice').noDefaultSlot).toBe(true);
    expect(output.svelte['arc-notice']).not.toContain("import type { Snippet } from 'svelte';");
    // And is still there for the component that has both members.
    expect(output.svelte['arc-top-bar']).toContain("import type { Snippet } from 'svelte';");
  });

  it('is left out of the Solid wrapper of the same component', () => {
    expect(output.solid['arc-notice']).toContain("import { splitProps, type Component } from 'solid-js';");
    // The augmentation below still names the namespace; it is the import that
    // has nothing left to refer to.
    expect(output.solid['arc-notice']).not.toContain('type JSX');
    expect(output.solid['arc-top-bar']).toContain('type JSX');
    expect(output.solid['arc-top-bar']).toContain('children?: JSX.Element;');
  });
});

describe('a component behind barrelExclude', () => {
  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'prism-corpus-barrel-')); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  /** A react package tree with all five components generated into it. */
  const scaffold = () => {
    const outDir = join(tmpDir, 'out');
    for (const meta of metas) generateReact(meta, cfg(), tmpDir);
    for (const meta of metas) {
      updateReactTierBarrel(meta, outDir);
      updateReactRootBarrel(meta, outDir);
    }
    return outDir;
  };

  const config = (barrelExclude) => ({
    components: 'components',
    tiers: TIERS,
    barrelExclude,
    react: { outDir: 'out', barrels: true },
  });

  it('is removed from the barrels it had already reached', () => {
    const outDir = scaffold();
    expect(readFileSync(join(outDir, 'index.ts'), 'utf-8')).toContain('CodeBlock');

    pruneBarrels(config(['arc-code-block']), tmpDir, metas);

    const root = readFileSync(join(outDir, 'index.ts'), 'utf-8');
    const tier = readFileSync(join(outDir, 'content', 'index.ts'), 'utf-8');
    expect(root).not.toContain('CodeBlock');
    expect(tier).not.toContain('CodeBlock');
    // Everything else in the same barrel survives — this removes a name, not a
    // statement, and an over-eager version of it once stripped 136 working
    // exports from a project whose barrels it had guessed the shape of.
    expect(root).toContain('Badge');
    expect(tier).toContain('Badge');
  });

  it('is still generated, and still reachable by its own subpath', () => {
    scaffold();
    // The whole point: the component is excluded from the barrel's module graph,
    // not from the package.
    expect(readFileSync(join(tmpDir, 'out', 'content', 'CodeBlock.ts'), 'utf-8'))
      .toContain('tagName: \'arc-code-block\',');
  });

  it('is removed from a barrel a formatter has wrapped, without reflowing it', () => {
    const outDir = join(tmpDir, 'out', 'content');
    mkdirSync(outDir, { recursive: true });
    for (const meta of metas) generateReact(meta, cfg(), tmpDir);
    // What any formatter produces once a statement passes its print width. The
    // line-anchored matcher this replaced saw nothing here at all: the config
    // entry simply had no effect, and nothing said so.
    writeFileSync(join(outDir, 'index.ts'), [
      '// Auto-generated by @arclux/prism — do not edit manually',
      'export {',
      '  Badge,',
      '  CodeBlock,',
      "} from './CodeBlock.js';",
      '',
    ].join('\n'));

    pruneBarrels(config(['arc-code-block']), tmpDir, metas);

    expect(readFileSync(join(outDir, 'index.ts'), 'utf-8')).toBe([
      '// Auto-generated by @arclux/prism — do not edit manually',
      'export {',
      '  Badge,',
      "} from './CodeBlock.js';",
      '',
    ].join('\n'));
  });
});
