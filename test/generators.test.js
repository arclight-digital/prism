import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateReact } from '../src/generators/react.js';
import { generateVue } from '../src/generators/vue.js';
import { generateSvelte } from '../src/generators/svelte.js';
import { generateAngular } from '../src/generators/angular.js';
import { generateSolid } from '../src/generators/solid.js';
import { generatePreact } from '../src/generators/preact.js';
import { generateHTML } from '../src/generators/html.js';
import { generateCSS } from '../src/generators/css.js';
import { isPrismGenerated } from '../src/generators/header.js';
import { sweepOrphans } from '../src/generators/prune.js';
import { reservedCollisions } from '../src/generators/identifiers.js';

/** @type {import('../src/parser.js').ComponentMeta} */
const meta = {
  tag: 'arc-button',
  className: 'ArcButton',
  pascalName: 'Button',
  tier: 'reactive',
  props: [
    { name: 'variant', type: 'String', default: "'primary'", reflect: true, values: ['primary', 'secondary'] },
    { name: 'disabled', type: 'Boolean', default: 'false', reflect: true, values: [] },
  ],
  css: ':host { display: inline-flex; } :host([variant="primary"]) { background: blue; } .btn { border: none; }',
  template: '<button class="btn"><slot></slot></button>',
  events: ['arc-click'],
  interactivity: 'static',
  hostDisplay: 'inline-flex',
};

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'prism-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const config = (outSub) => ({
  outDir: outSub,
  wcPackage: '@arclux/arc-ui',
  prefix: 'arc',
  barrels: false,
});

describe('generateReact', () => {
  it('produces a .ts file with createComponent', () => {
    const result = generateReact(meta, config('out/react'), tmpDir);
    expect(result.written).toBe(true);
    const content = readFileSync(result.path, 'utf-8');
    expect(content).toContain('createComponent');
    expect(content).toContain('ArcButton');
    expect(content).toContain("'primary' | 'secondary'");
    expect(content).toContain('onArcClick');
  });
});

describe('generateVue', () => {
  it('produces a .vue SFC', () => {
    const result = generateVue(meta, config('out/vue'), tmpDir);
    expect(result.written).toBe(true);
    const content = readFileSync(result.path, 'utf-8');
    expect(content).toContain('<script setup lang="ts">');
    expect(content).toContain('defineProps');
    expect(content).toContain('arc-button');
  });
});

describe('generateSvelte', () => {
  it('produces a .svelte file', () => {
    const result = generateSvelte(meta, config('out/svelte'), tmpDir);
    expect(result.written).toBe(true);
    const content = readFileSync(result.path, 'utf-8');
    expect(content).toContain('$props()');
    expect(content).toContain('arc-button');
  });

  it('leaves props alone when no event detail matches a prop name', () => {
    const content = readFileSync(generateSvelte(meta, config('out/svelte'), tmpDir).path, 'utf-8');
    expect(content).not.toContain('$bindable');
    expect(content).not.toContain('__on');
  });
});

describe('generateSvelte — two-way bindings', () => {
  /** A slider: `value` is written back by both the live and the commit event. */
  const slider = {
    ...meta,
    tag: 'arc-slider',
    className: 'ArcSlider',
    pascalName: 'Slider',
    tier: 'input',
    props: [
      { name: 'value', type: 'Number', default: '0', reflect: false, values: [] },
      { name: 'label', type: 'String', default: "''", reflect: false, values: [] },
    ],
    events: ['arc-input', 'arc-change'],
    eventDetails: { 'arc-input': ['value'], 'arc-change': ['value'] },
  };

  const generate = (m, bindings) =>
    readFileSync(
      generateSvelte(m, { ...config('out/svelte'), bindings }, tmpDir).path,
      'utf-8'
    );

  it('marks a prop $bindable when an event detail carries its name', () => {
    const content = generate(slider);
    expect(content).toContain('value = $bindable(0)');
    // A prop no event writes back keeps its plain default.
    expect(content).toContain("label = ''");
    expect(content).not.toContain('label = $bindable');
  });

  it('listens to every event that carries the key', () => {
    const content = generate(slider);
    expect(content).toContain('onarc-input={__onArcInput}');
    expect(content).toContain('onarc-change={__onArcChange}');
    expect(content).toContain("if ('value' in detail) value = detail.value as number;");
  });

  it('declares handlers after the spread so they win, then forwards explicitly', () => {
    const content = generate(slider);
    expect(content.indexOf('{...rest}')).toBeLessThan(content.indexOf('onarc-input={'));
    expect(content).toContain("(rest['onarc-input'] as ((e: Event) => void) | undefined)?.(e);");
  });

  it('emits $bindable() with no default when the prop has none', () => {
    const noDefault = {
      ...slider,
      props: [{ name: 'value', type: 'String', default: '', reflect: false, values: [] }],
      events: ['arc-change'],
      eventDetails: { 'arc-change': ['value'] },
    };
    expect(generate(noDefault)).toContain('value = $bindable()');
  });

  it('writes back every bound key an event carries in one handler', () => {
    const chip = {
      ...slider,
      props: [
        { name: 'value', type: 'String', default: "''", reflect: false, values: [] },
        { name: 'selected', type: 'Boolean', default: 'false', reflect: true, values: [] },
      ],
      events: ['arc-change'],
      eventDetails: { 'arc-change': ['value', 'selected'] },
    };
    const content = chip && generate(chip);
    expect(content.match(/function __on/g)).toHaveLength(1);
    expect(content).toContain("if ('selected' in detail) selected = detail.selected as boolean;");
    expect(content).toContain("if ('value' in detail) value = detail.value as string;");
  });

  it('ignores detail keys that are not declared props', () => {
    const extra = { ...slider, eventDetails: { 'arc-change': ['value', 'originalEvent'] } };
    const content = generate(extra);
    expect(content).toContain("if ('value' in detail)");
    expect(content).not.toContain('originalEvent');
  });

  it('honours a config.bindings exclude — arc-select must not bind its own label', () => {
    // arc-select dispatches `detail: { value, label }` where `label` is the
    // *selected option's* text, not the field label. Binding it would rewrite
    // the field label on every change.
    const select = {
      ...slider,
      tag: 'arc-select',
      eventDetails: { 'arc-change': ['value', 'label'] },
      events: ['arc-change'],
    };
    const content = generate(select, { 'arc-select': { exclude: ['label'] } });
    expect(content).toContain("if ('value' in detail) value = detail.value as number;");
    expect(content).not.toContain("if ('label' in detail)");
    expect(content).not.toContain('label = $bindable');
  });

  it('emits no handler at all when every key of an event is excluded', () => {
    const content = generate(
      { ...slider, tag: 'arc-copy-button', events: ['arc-copy'], eventDetails: { 'arc-copy': ['value'] } },
      { 'arc-copy-button': { exclude: ['value'] } }
    );
    expect(content).not.toContain('$bindable');
    expect(content).not.toContain('__onArcCopy');
    expect(content).toContain('{...rest}>');
  });
});

/** Shared by the Vue and Angular binding suites below. */
const boundMeta = {
  ...meta,
  tag: 'arc-slider',
  className: 'ArcSlider',
  pascalName: 'Slider',
  tier: 'input',
  props: [
    { name: 'value', type: 'Number', default: '0', reflect: false, values: [] },
    { name: 'label', type: 'String', default: "''", reflect: false, values: [] },
  ],
  events: ['arc-input', 'arc-change'],
  eventDetails: { 'arc-input': ['value'], 'arc-change': ['value'] },
};

describe('generateVue — two-way bindings', () => {
  const generate = (m, bindings) =>
    readFileSync(generateVue(m, { ...config('out/vue'), bindings }, tmpDir).path, 'utf-8');

  it('declares the update: emit that v-model listens for', () => {
    const content = generate(boundMeta);
    expect(content).toContain("'update:value': [value: number];");
    expect(content).not.toContain("'update:label'");
  });

  it('emits update: from every event carrying the key, alongside the relay', () => {
    const content = generate(boundMeta);
    for (const [event, fn] of [['arc-input', 'onArcInput'], ['arc-change', 'onArcChange']]) {
      expect(content).toContain(`function ${fn}(payload: CustomEvent) {`);
      expect(content).toContain(`emit('${event}', payload);`);
      expect(content).toContain(`@${event}="${fn}"`);
    }
    expect(content).toContain("if ('value' in detail) emit('update:value', detail.value as number);");
  });

  it('leaves unbound events on the inline relay', () => {
    const content = generate({ ...boundMeta, events: ['arc-input', 'arc-focus'] });
    expect(content).toContain(`@arc-focus="(payload: CustomEvent) => emit('arc-focus', payload)"`);
  });

  it('emits nothing extra when no detail key matches a prop', () => {
    const content = generate({ ...boundMeta, eventDetails: {} });
    expect(content).not.toContain('update:');
    expect(content).not.toContain('function onArc');
  });

  it('honours a config.bindings exclude', () => {
    const select = { ...boundMeta, tag: 'arc-select', eventDetails: { 'arc-change': ['value', 'label'] } };
    const content = generate(select, { 'arc-select': { exclude: ['label'] } });
    expect(content).toContain("'update:value'");
    expect(content).not.toContain("'update:label'");
  });
});

describe('generateAngular — two-way bindings', () => {
  const generate = (m, bindings) =>
    readFileSync(generateAngular(m, { ...config('out/angular'), bindings }, tmpDir).path, 'utf-8');

  it('declares the xChange output that [(x)] desugars to', () => {
    const content = generate(boundMeta);
    expect(content).toContain('@Output() valueChange = new EventEmitter<number>();');
    expect(content).not.toContain('labelChange');
  });

  it('routes bound events through a method that writes back and emits both', () => {
    const content = generate(boundMeta);
    expect(content).toContain('(arc-input)="this.onArcInput($event)"');
    expect(content).toContain('onArcInput(event: CustomEvent) {');
    expect(content).toContain('this.arcInput.emit(event);');
    expect(content).toContain('const next = detail.value as number;');
    expect(content).toContain('this.value = next;');
    expect(content).toContain('this.valueChange.emit(next);');
  });

  it('leaves unbound events on the direct emit', () => {
    const content = generate({ ...boundMeta, events: ['arc-input', 'arc-focus'] });
    expect(content).toContain('(arc-focus)="this.arcFocus.emit($event)"');
  });

  it('emits nothing extra when no detail key matches a prop', () => {
    const content = generate({ ...boundMeta, eventDetails: {} });
    // The `arc-change` relay output is still `arcChange` — only the prop-derived
    // `valueChange` should be absent.
    expect(content).not.toContain('valueChange');
    expect(content).not.toContain('onArcInput(');
    expect(content).toContain('(arc-input)="this.arcInput.emit($event)"');
  });

  it('honours a config.bindings exclude', () => {
    const select = { ...boundMeta, tag: 'arc-select', eventDetails: { 'arc-change': ['value', 'label'] } };
    const content = generate(select, { 'arc-select': { exclude: ['label'] } });
    expect(content).toContain('@Output() valueChange');
    expect(content).not.toContain('labelChange');
  });
});

describe('generateAngular', () => {
  it('produces a .ts file with @Component', () => {
    const result = generateAngular(meta, config('out/angular'), tmpDir);
    expect(result.written).toBe(true);
    const content = readFileSync(result.path, 'utf-8');
    expect(content).toContain('@Component');
    expect(content).toContain('CUSTOM_ELEMENTS_SCHEMA');
    expect(content).toContain('@Input()');
  });
});

describe('generateSolid', () => {
  it('produces a .tsx file with splitProps', () => {
    const result = generateSolid(meta, config('out/solid'), tmpDir);
    expect(result.written).toBe(true);
    const content = readFileSync(result.path, 'utf-8');
    expect(content).toContain('splitProps');
    expect(content).toContain('ButtonProps');
  });
});

describe('generatePreact', () => {
  it('produces a .tsx file with FunctionComponent', () => {
    const result = generatePreact(meta, config('out/preact'), tmpDir);
    expect(result.written).toBe(true);
    const content = readFileSync(result.path, 'utf-8');
    expect(content).toContain('FunctionComponent');
    expect(content).toContain('arc-button');
  });
});

describe('generateHTML', () => {
  it('produces .html files for static components', () => {
    const htmlConfig = {
      outDir: 'out/html',
      baseCSS: 'tokens.css',
      prefix: 'arc',
      inlineVariant: false,
    };
    const result = generateHTML(meta, htmlConfig, tmpDir);
    expect(result.skipped).toBe(false);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].written).toBe(true);
    const content = readFileSync(result.results[0].path, 'utf-8');
    expect(content).toContain('Auto-generated by @arclux/prism');
  });

  it('skips interactive components', () => {
    const interactiveMeta = { ...meta, interactivity: 'interactive' };
    const result = generateHTML(interactiveMeta, { outDir: 'out/html', prefix: 'arc' }, tmpDir);
    expect(result.skipped).toBe(true);
  });
});

describe('generateCSS', () => {
  it('produces a .css file with light DOM selectors', () => {
    const cssConfig = { outDir: 'out/css', baseCSS: 'tokens.css', prefix: 'arc' };
    const result = generateCSS(meta, cssConfig, tmpDir);
    expect(result.skipped).toBe(false);
    expect(result.results[0].written).toBe(true);
    const content = readFileSync(result.results[0].path, 'utf-8');
    expect(content).toContain('.arc-button');
    expect(content).not.toContain(':host');
  });
});

describe('event wiring (regressions)', () => {
  it('Vue captures emit and wires the template listener', () => {
    const content = readFileSync(
      generateVue(meta, config('out/vue'), tmpDir).path,
      'utf-8',
    );
    expect(content).toContain('const emit = defineEmits<{');
    expect(content).toContain(
      `@arc-click="(payload: CustomEvent) => emit('arc-click', payload)"`,
    );
  });

  it('React omits the EventName type import when a component has no events', () => {
    // No custom events, non-button tag, and no <button> in the template → no
    // event map at all (buildEventMap adds onClick for arc-button/<button>).
    const staticMeta = {
      ...meta,
      tag: 'arc-badge',
      className: 'ArcBadge',
      pascalName: 'Badge',
      events: [],
      template: '<span class="badge"><slot></slot></span>',
    };
    const content = readFileSync(
      generateReact(staticMeta, config('out/react'), tmpDir).path,
      'utf-8',
    );
    expect(content).toContain(`import { createComponent } from '@lit/react';`);
    expect(content).not.toContain('EventName');
  });

  it('React still imports EventName when events exist', () => {
    const content = readFileSync(
      generateReact(meta, config('out/react'), tmpDir).path,
      'utf-8',
    );
    expect(content).toContain('type EventName');
  });

  it('Angular binds Array/Object props as properties, not attributes', () => {
    const arrMeta = {
      ...meta,
      props: [
        { name: 'items', type: 'Array', default: '', reflect: false, values: [] },
        { name: 'config', type: 'Object', default: '', reflect: false, values: [] },
        { name: 'label', type: 'String', default: '', reflect: false, values: [] },
      ],
    };
    const content = readFileSync(
      generateAngular(arrMeta, config('out/angular'), tmpDir).path,
      'utf-8',
    );
    expect(content).toContain('[items]="this.items"');
    expect(content).toContain('[config]="this.config"');
    expect(content).not.toContain('[attr.items]');
    expect(content).not.toContain('[attr.config]');
    // String props still bind as attributes
    expect(content).toContain('[attr.label]="this.label"');
  });

  it('Solid exposes a typed handler prop and binds via on: namespace', () => {
    const content = readFileSync(
      generateSolid(meta, config('out/solid'), tmpDir).path,
      'utf-8',
    );
    expect(content).toContain('onArcClick?: (e: CustomEvent) => void;');
    expect(content).toContain('on:arc-click={local.onArcClick}');
    expect(content).toContain(`'onArcClick'`); // included in splitProps keys
  });

  it('Preact wires custom events through a ref + effect', () => {
    const content = readFileSync(
      generatePreact(meta, config('out/preact'), tmpDir).path,
      'utf-8',
    );
    expect(content).toContain('onArcClick?: (e: CustomEvent) => void;');
    expect(content).toContain("from 'preact/hooks'");
    expect(content).toContain(`el.addEventListener('arc-click'`);
    expect(content).toContain('removeEventListener');
  });

  it('Preact keeps the simple functional form when there are no events', () => {
    const staticMeta = { ...meta, events: [] };
    const content = readFileSync(
      generatePreact(staticMeta, config('out/preact'), tmpDir).path,
      'utf-8',
    );
    expect(content).not.toContain('preact/hooks');
    expect(content).not.toContain('addEventListener');
  });
});

describe('generated-header recognition (org-rename regression)', () => {
  it('isPrismGenerated matches both legacy and current org headers', () => {
    expect(isPrismGenerated('// Auto-generated by @arclux/prism — do not edit manually')).toBe(true);
    expect(isPrismGenerated('<!-- Auto-generated by @arclight/prism — do not edit manually -->')).toBe(true);
    expect(isPrismGenerated('/* Auto-generated by @arclight/prism — do not edit manually */')).toBe(true);
    expect(isPrismGenerated('// My manual file')).toBe(false);
    expect(isPrismGenerated('<template>Manual</template>')).toBe(false);
  });

  it('React — overwrites a file carrying the pre-rename @arclight header', () => {
    // Regression: files generated before the @arclight→@arclux rename were
    // treated as manual and skipped forever, going stale.
    const outDir = join(tmpDir, 'out/react/reactive');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'Button.ts'),
      '// Auto-generated by @arclight/prism — do not edit manually\n// old content\n',
    );

    const result = generateReact(meta, config('out/react'), tmpDir);
    expect(result.written).toBe(true);
    expect(readFileSync(result.path, 'utf-8')).toContain('createComponent');
  });

  it('HTML — overwrites a file carrying the pre-rename @arclight header', () => {
    const outDir = join(tmpDir, 'out/html');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'button.html'),
      '<!-- Auto-generated by @arclight/prism — do not edit manually -->\n<div>stale</div>\n',
    );

    const result = generateHTML(meta, { outDir: 'out/html', prefix: 'arc' }, tmpDir);
    expect(result.results[0].written).toBe(true);
    expect(readFileSync(result.results[0].path, 'utf-8')).not.toContain('stale');
  });
});

describe('manual-file safety', () => {
  it('React — does not overwrite manual file', () => {
    const outDir = join(tmpDir, 'out/react/reactive');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'Button.ts'), '// My manual file\n');

    const result = generateReact(meta, config('out/react'), tmpDir);
    expect(result.written).toBe(false);
  });

  it('Vue — does not overwrite manual file', () => {
    const outDir = join(tmpDir, 'out/vue/reactive');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'Button.vue'), '<template>Manual</template>\n');

    const result = generateVue(meta, config('out/vue'), tmpDir);
    expect(result.written).toBe(false);
  });

  it('Svelte — does not overwrite manual file', () => {
    const outDir = join(tmpDir, 'out/svelte/reactive');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'Button.svelte'), '<div>Manual</div>\n');

    const result = generateSvelte(meta, config('out/svelte'), tmpDir);
    expect(result.written).toBe(false);
  });

  it('Angular — does not overwrite manual file', () => {
    const outDir = join(tmpDir, 'out/angular/reactive');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'Button.ts'), '// Manual Angular\n');

    const result = generateAngular(meta, config('out/angular'), tmpDir);
    expect(result.written).toBe(false);
  });

  it('Solid — does not overwrite manual file', () => {
    const outDir = join(tmpDir, 'out/solid/reactive');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'Button.tsx'), '// Manual Solid\n');

    const result = generateSolid(meta, config('out/solid'), tmpDir);
    expect(result.written).toBe(false);
  });

  it('Preact — does not overwrite manual file', () => {
    const outDir = join(tmpDir, 'out/preact/reactive');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'Button.tsx'), '// Manual Preact\n');

    const result = generatePreact(meta, config('out/preact'), tmpDir);
    expect(result.written).toBe(false);
  });

  it('CSS — does not overwrite manual file', () => {
    const outDir = join(tmpDir, 'out/css');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'button.css'), '/* My manual CSS */\n');

    const cssConfig = { outDir: 'out/css', baseCSS: 'tokens.css', prefix: 'arc' };
    const result = generateCSS(meta, cssConfig, tmpDir);
    expect(result.results[0].written).toBe(false);
  });
});

describe('stale-output pruning on static → interactive', () => {
  const cssCfg = () => ({ outDir: 'css', prefix: 'arc', baseCSS: 'tokens.css' });
  const htmlCfg = () => ({ outDir: 'html', prefix: 'arc', baseCSS: 'tokens.css', inlineVariant: true });

  it('deletes a per-component CSS file once the component turns interactive', () => {
    // First run: static — file is written.
    const first = generateCSS({ ...meta, interactivity: 'static' }, cssCfg(), tmpDir);
    const cssPath = first.results[0].path;
    expect(first.results[0].written).toBe(true);
    expect(existsSync(cssPath)).toBe(true);

    // Component gains a @click handler → reclassified interactive.
    const second = generateCSS({ ...meta, interactivity: 'interactive' }, cssCfg(), tmpDir, { prune: true });
    expect(second.skipped).toBe(true);
    expect(second.removed).toEqual([cssPath]);
    expect(existsSync(cssPath)).toBe(false);
  });

  it('deletes both HTML variants once the component turns interactive', () => {
    const first = generateHTML({ ...meta, interactivity: 'static' }, htmlCfg(), tmpDir);
    const paths = first.results.map((r) => r.path);
    expect(paths).toHaveLength(2);
    for (const p of paths) expect(existsSync(p)).toBe(true);

    const second = generateHTML({ ...meta, interactivity: 'interactive' }, htmlCfg(), tmpDir, { prune: true });
    expect(second.skipped).toBe(true);
    expect(second.removed.sort()).toEqual(paths.sort());
    for (const p of paths) expect(existsSync(p)).toBe(false);
  });

  it('prunes the inline variant even when inlineVariant is now disabled', () => {
    generateHTML({ ...meta, interactivity: 'static' }, htmlCfg(), tmpDir);
    const inlinePath = join(tmpDir, 'html', 'button.inline.html');
    expect(existsSync(inlinePath)).toBe(true);

    const cfg = { ...htmlCfg(), inlineVariant: false };
    const out = generateHTML({ ...meta, interactivity: 'interactive' }, cfg, tmpDir, { prune: true });
    expect(out.removed).toContain(inlinePath);
    expect(existsSync(inlinePath)).toBe(false);
  });

  it('never deletes a hand-written file at a generated path', () => {
    const cssDir = join(tmpDir, 'css');
    mkdirSync(cssDir, { recursive: true });
    const cssPath = join(cssDir, 'button.css');
    writeFileSync(cssPath, '/* hand-written, keep me */\n.arc-button { color: red; }');

    const out = generateCSS({ ...meta, interactivity: 'interactive' }, cssCfg(), tmpDir, { prune: true });
    expect(out.skipped).toBe(true);
    expect(out.removed).toEqual([]);
    expect(existsSync(cssPath)).toBe(true);
    expect(readFileSync(cssPath, 'utf-8')).toContain('hand-written');
  });

  it('recognizes output written under the old org name', () => {
    const cssDir = join(tmpDir, 'css');
    mkdirSync(cssDir, { recursive: true });
    const cssPath = join(cssDir, 'button.css');
    writeFileSync(cssPath, '/* Auto-generated by @arclight/prism — do not edit manually */\n.arc-button {}');

    const out = generateCSS({ ...meta, interactivity: 'interactive' }, cssCfg(), tmpDir, { prune: true });
    expect(out.removed).toEqual([cssPath]);
    expect(existsSync(cssPath)).toBe(false);
  });

  it('is a no-op when there is nothing stale to remove', () => {
    const out = generateCSS({ ...meta, interactivity: 'interactive' }, cssCfg(), tmpDir, { prune: true });
    expect(out.skipped).toBe(true);
    expect(out.removed).toEqual([]);
  });
});

describe('report-only default (no --prune)', () => {
  const cssCfg = () => ({ outDir: 'css', prefix: 'arc', baseCSS: 'tokens.css' });

  it('reports stale output but leaves it on disk', () => {
    const first = generateCSS({ ...meta, interactivity: 'static' }, cssCfg(), tmpDir);
    const cssPath = first.results[0].path;

    const second = generateCSS({ ...meta, interactivity: 'interactive' }, cssCfg(), tmpDir);
    expect(second.stale).toEqual([cssPath]);
    expect(second.removed).toEqual([]);
    expect(existsSync(cssPath)).toBe(true);
  });
});

describe('sweepOrphans', () => {
  const sweepConfig = () => ({
    prefix: 'arc',
    tiers: ['content', 'reactive'],
    react: { outDir: 'react', prefix: 'arc' },
    css: { outDir: 'css', prefix: 'arc', baseCSS: 'tokens.css' },
    html: { outDir: 'html', prefix: 'arc', baseCSS: 'tokens.css', inlineVariant: true },
  });

  const writeGen = (rel, body = '') => {
    const p = join(tmpDir, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, `/* Auto-generated by @arclux/prism — do not edit manually */\n${body}`);
    return p;
  };

  it('removes wrappers, CSS and HTML for a component that no longer exists', () => {
    const cfg = sweepConfig();
    generateReact(meta, { ...cfg.react, wcPackage: '@arclux/arc-ui' }, tmpDir);
    generateCSS(meta, cfg.css, tmpDir);
    generateHTML(meta, cfg.html, tmpDir);

    // Leftovers from a deleted `arc-widget` component.
    const orphans = [
      writeGen('react/reactive/Widget.ts'),
      writeGen('css/widget.css'),
      writeGen('html/widget.html'),
      writeGen('html/widget.inline.html'),
    ];

    const out = sweepOrphans([meta], cfg, tmpDir, { apply: true });
    expect(out.removed.sort()).toEqual(orphans.sort());
    for (const p of orphans) expect(existsSync(p)).toBe(false);

    // The surviving component's own output is untouched.
    expect(existsSync(join(tmpDir, 'react/reactive/Button.ts'))).toBe(true);
    expect(existsSync(join(tmpDir, 'css/button.css'))).toBe(true);
    expect(existsSync(join(tmpDir, 'html/button.html'))).toBe(true);
  });

  it('reports without deleting by default', () => {
    const cfg = sweepConfig();
    const orphan = writeGen('css/widget.css');

    const out = sweepOrphans([meta], cfg, tmpDir, {});
    expect(out.stale).toEqual([orphan]);
    expect(out.removed).toEqual([]);
    expect(existsSync(orphan)).toBe(true);
  });

  it('never touches barrel files', () => {
    const cfg = sweepConfig();
    const barrel = writeGen('react/reactive/index.ts', "export * from './Button.js';");

    const out = sweepOrphans([meta], cfg, tmpDir, { apply: true });
    expect(out.removed).not.toContain(barrel);
    expect(existsSync(barrel)).toBe(true);
  });

  it('never touches the CSS bundle', () => {
    const cfg = sweepConfig();
    const bundle = writeGen('css/arc-ui.css', ':root {}');

    const out = sweepOrphans([meta], cfg, tmpDir, { apply: true });
    expect(out.removed).not.toContain(bundle);
    expect(existsSync(bundle)).toBe(true);
  });

  it('never touches hand-written files', () => {
    const cfg = sweepConfig();
    const manual = join(tmpDir, 'css', 'handwritten.css');
    mkdirSync(join(tmpDir, 'css'), { recursive: true });
    writeFileSync(manual, '.handwritten { color: red; }');

    const out = sweepOrphans([meta], cfg, tmpDir, { apply: true });
    expect(out.removed).toEqual([]);
    expect(existsSync(manual)).toBe(true);
  });

  it('sweeps a tier that no longer has any components', () => {
    const cfg = sweepConfig();
    const orphan = writeGen('react/content/Ghost.ts');

    const out = sweepOrphans([meta], cfg, tmpDir, { apply: true });
    expect(out.removed).toEqual([orphan]);
  });

  it('treats the inline variant as orphaned once inlineVariant is off', () => {
    const cfg = sweepConfig();
    generateHTML(meta, cfg.html, tmpDir);
    const inlinePath = join(tmpDir, 'html', 'button.inline.html');
    expect(existsSync(inlinePath)).toBe(true);

    cfg.html.inlineVariant = false;
    const out = sweepOrphans([meta], cfg, tmpDir, { apply: true });
    expect(out.removed).toEqual([inlinePath]);
  });

  it('skips targets that are not configured', () => {
    const cfg = sweepConfig();
    delete cfg.react;
    const orphan = writeGen('react/reactive/Widget.ts');

    const out = sweepOrphans([meta], cfg, tmpDir, { apply: true });
    expect(out.removed).toEqual([]);
    expect(existsSync(orphan)).toBe(true);
  });
});

describe('sweepOrphans — no double-reporting with per-component pruning', () => {
  const sweepConfig = () => ({
    prefix: 'arc',
    tiers: ['content', 'reactive'],
    css: { outDir: 'css', prefix: 'arc', baseCSS: 'tokens.css' },
    html: { outDir: 'html', prefix: 'arc', baseCSS: 'tokens.css', inlineVariant: true },
  });

  it('leaves an interactive component leftovers to the generator that skipped it', () => {
    const cfg = sweepConfig();
    // Output from when the component was static.
    generateCSS({ ...meta, interactivity: 'static' }, cfg.css, tmpDir);
    generateHTML({ ...meta, interactivity: 'static' }, cfg.html, tmpDir);

    const interactive = { ...meta, interactivity: 'interactive' };
    const out = sweepOrphans([interactive], cfg, tmpDir, { apply: true });
    expect(out.stale).toEqual([]);
    // Still present — generateCSS/generateHTML own these paths.
    expect(existsSync(join(tmpDir, 'css', 'button.css'))).toBe(true);
    expect(existsSync(join(tmpDir, 'html', 'button.inline.html'))).toBe(true);

    // …and they do prune them.
    const cssOut = generateCSS(interactive, cfg.css, tmpDir, { prune: true });
    const htmlOut = generateHTML(interactive, cfg.html, tmpDir, { prune: true });
    expect(cssOut.removed).toHaveLength(1);
    expect(htmlOut.removed).toHaveLength(2);
  });
});

describe('reserved words in binding position', () => {
  /**
   * True if `pattern` is a legal JS destructuring pattern. Checked in strict
   * mode inside an async function so `let`, `static`, `yield` and `await` —
   * reserved only in those contexts — are caught too.
   */
  const isValidBindingPattern = (pattern) => {
    try {
      new Function(`"use strict"; (async function ({${pattern}}) {});`);
      return true;
    } catch {
      return false;
    }
  };

  /** @type {import('../src/parser.js').ComponentMeta} */
  const labelMeta = {
    tag: 'arc-label',
    className: 'ArcLabel',
    pascalName: 'Label',
    tier: 'content',
    props: [
      { name: 'for', type: 'String', default: "''", reflect: true, values: [] },
      { name: 'text', type: 'String', default: "''", reflect: false, values: [] },
    ],
    css: ':host { display: block; }',
    template: '<label><slot></slot></label>',
    events: ['arc-change'],
    eventDetails: { 'arc-change': ['for'] },
    interactivity: 'static',
    hostDisplay: 'block',
  };

  it('Svelte renames the local and keeps the attribute name', () => {
    const result = generateSvelte(labelMeta, config('out/svelte'), tmpDir);
    const content = readFileSync(result.path, 'utf-8');

    const pattern = content.match(/let \{ (.*) \}: Props = \$props\(\);/)[1];
    expect(isValidBindingPattern(pattern)).toBe(true);
    expect(pattern).toContain('for: forProp');

    // Interface key and attribute keep the real name; only the local moves.
    expect(content).toContain('for?: string;');
    expect(content).toContain('for={forProp}');
    expect(content).not.toMatch(/\{for\}/);
    // Write-back assigns the local, but still reads the real detail key.
    expect(content).toContain('forProp = detail.for as');
  });

  it('Preact renames the local and keeps the JSX attribute name', () => {
    const result = generatePreact(labelMeta, config('out/preact'), tmpDir);
    const content = readFileSync(result.path, 'utf-8');

    const pattern = content.match(/FunctionComponent<LabelProps> = \(\{ (.*?) \}\) =>/)[1];
    expect(isValidBindingPattern(pattern)).toBe(true);
    expect(pattern).toContain('for: forProp');

    expect(content).toContain('for?: string;');
    expect(content).toContain('for={forProp}');
  });

  it('Vue reads props through the props object rather than bare identifiers', () => {
    const result = generateVue(labelMeta, config('out/vue'), tmpDir);
    const content = readFileSync(result.path, 'utf-8');

    expect(content).toContain('const props = withDefaults(defineProps<{');
    expect(content).toContain(':for="props.for"');
    expect(content).toContain(':text="props.text"');
    expect(content).not.toContain(':for="for"');
  });

  it('Vue captures the props object when the component declares no defaults', () => {
    const noDefaults = {
      ...labelMeta,
      props: labelMeta.props.map((p) => ({ ...p, default: '' })),
    };
    const result = generateVue(noDefaults, config('out/vue-nd'), tmpDir);
    const content = readFileSync(result.path, 'utf-8');
    expect(content).toContain('const props = defineProps<{');
    expect(content).toContain(':for="props.for"');
  });

  it('does not collide when the component also declares the renamed prop', () => {
    const both = {
      ...labelMeta,
      props: [
        { name: 'for', type: 'String', default: "''", reflect: true, values: [] },
        { name: 'forProp', type: 'String', default: "''", reflect: false, values: [] },
      ],
      eventDetails: {},
      events: [],
    };
    const content = readFileSync(
      generateSvelte(both, config('out/svelte-collide'), tmpDir).path,
      'utf-8',
    );
    const pattern = content.match(/let \{ (.*) \}: Props = \$props\(\);/)[1];
    expect(isValidBindingPattern(pattern)).toBe(true);
    expect(pattern).toContain('for: forProp_');
    expect(content).toContain('for={forProp_}');
    expect(content).toContain('{forProp}');
  });

  it('Angular qualifies template expressions so its own keywords parse', () => {
    // `as` is a keyword in Angular's template grammar but not in JavaScript,
    // so the class field is fine and only the expression needed qualifying.
    const textMeta = {
      ...labelMeta,
      tag: 'arc-text',
      className: 'ArcText',
      pascalName: 'Text',
      props: [
        { name: 'as', type: 'String', default: "'p'", reflect: true, values: [] },
        { name: 'wrap', type: 'Boolean', default: 'false', reflect: false, values: [] },
      ],
      eventDetails: {},
    };
    const content = readFileSync(
      generateAngular(textMeta, config('out/angular-kw'), tmpDir).path,
      'utf-8',
    );
    expect(content).toContain('[attr.as]="this.as"');
    expect(content).toContain('[wrap]="this.wrap"');
    expect(content).toContain('(arc-change)="this.arcChange.emit($event)"');
    expect(content).not.toContain('[attr.as]="as"');
    // The class field keeps the real name — reserved words are legal there.
    expect(content).toContain("@Input() as: string = 'p';");
  });

  it('leaves ordinary prop names untouched', () => {
    const content = readFileSync(
      generateSvelte(meta, config('out/svelte-plain'), tmpDir).path,
      'utf-8',
    );
    expect(content).toContain('{variant}');
    expect(content).not.toContain('variantProp');
  });
});

describe('framework-reserved prop names', () => {
  const props = (...names) => names.map((name) => ({
    name, type: 'String', default: '', reflect: false, values: [], docType: '',
  }));

  it('flags a prop React and Preact intercept before the component sees it', () => {
    const out = reservedCollisions(props('key', 'label'), ['react', 'preact', 'vue']);
    expect(out).toEqual([{ prop: 'key', frameworks: ['react', 'preact'] }]);
  });

  it('only reports frameworks actually being generated', () => {
    expect(reservedCollisions(props('key'), ['vue', 'angular'])).toEqual([]);
    expect(reservedCollisions(props('key'), ['react'])).toEqual([
      { prop: 'key', frameworks: ['react'] },
    ]);
  });

  it('flags children against every generator that injects its own', () => {
    const out = reservedCollisions(props('children'), ['react', 'preact', 'svelte', 'solid', 'vue', 'angular']);
    expect(out[0].frameworks).toEqual(['react', 'preact', 'svelte', 'solid']);
  });

  it('says nothing about ordinary prop names', () => {
    expect(reservedCollisions(props('label', 'variant', 'size'), ['react', 'preact'])).toEqual([]);
  });
});

describe('documented prop types reach every wrapper', () => {
  const chartMeta = {
    ...meta,
    tag: 'arc-chart',
    className: 'ArcChart',
    pascalName: 'Chart',
    props: [{
      name: 'series',
      type: 'Array',
      default: '[]',
      reflect: false,
      values: [],
      docType: 'Array<{label: string, data: number[]}>',
    }],
    events: [],
    eventDetails: {},
  };
  const DOC = 'Array<{label: string, data: number[]}>';

  it('React', () => {
    const c = readFileSync(generateReact(chartMeta, config('out/r2'), tmpDir).path, 'utf-8');
    expect(c).toContain(`series?: ${DOC};`);
    expect(c).not.toContain('unknown[]');
  });

  it('Vue', () => {
    const c = readFileSync(generateVue(chartMeta, config('out/v2'), tmpDir).path, 'utf-8');
    expect(c).toContain(`series?: ${DOC};`);
  });

  it('Svelte', () => {
    const c = readFileSync(generateSvelte(chartMeta, config('out/s2'), tmpDir).path, 'utf-8');
    expect(c).toContain(`series?: ${DOC};`);
  });

  it('Angular', () => {
    const c = readFileSync(generateAngular(chartMeta, config('out/a2'), tmpDir).path, 'utf-8');
    expect(c).toContain(`@Input() series: ${DOC} = [];`);
  });

  it('Solid', () => {
    const c = readFileSync(generateSolid(chartMeta, config('out/so2'), tmpDir).path, 'utf-8');
    expect(c).toContain(`series?: ${DOC};`);
  });

  it('Preact', () => {
    const c = readFileSync(generatePreact(chartMeta, config('out/p2'), tmpDir).path, 'utf-8');
    expect(c).toContain(`series?: ${DOC};`);
  });

  it('falls back to the static properties type when nothing is documented', () => {
    const plain = { ...chartMeta, props: [{ ...chartMeta.props[0], docType: '' }] };
    const c = readFileSync(generateReact(plain, config('out/r3'), tmpDir).path, 'utf-8');
    expect(c).toContain('series?: unknown[];');
  });
});
