/**
 * Form controls, end to end: from `static formAssociated = true` in the source
 * to a ControlValueAccessor in the Angular wrapper.
 *
 * Every case starts from component source rather than a hand-built meta, for the
 * reason slot-projection.test.js starts that way: a generator test that builds
 * `meta` by hand proves the generator did as it was told, and the failures worth
 * catching live in whether it was told the truth.
 *
 * What is being protected is a silence. A wrapper with no accessor does not
 * fail — `<arc-input formControlName="email">` compiles, reports nothing, and
 * binds nothing, leaving the control pristine and empty while the element on
 * screen holds the user's text.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseComponent } from '../src/parser.js';
import { generateAngular } from '../src/generators/angular.js';
import { formBinding } from '../src/generators/form-control.js';
import { verifyAccessor } from '../src/verify.js';

let tmpDir;
beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'prism-form-')); });
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

const cfg = (extra = {}) => ({
  outDir: 'out', wcPackage: '@arclux/arc-ui', prefix: 'arc', barrels: false, ...extra,
});

/** Build a component source with the given class body. */
const component = (tag, className, body, { formAssociated = true } = {}) => `
  import { LitElement, html } from 'lit';
  /** @tag ${tag} */
  export class ${className} extends LitElement {
    ${formAssociated ? 'static formAssociated = true;' : ''}
    ${body}
    render() { return html\`<slot></slot>\`; }
  }
  customElements.define('${tag}', ${className});
`;

const parse = (tag, className, body, opts) =>
  parseComponent(component(tag, className, body, opts), `/src/input/${tag}.js`, 'arc');

const textField = `
    static properties = {
      value: { type: String },
      disabled: { type: Boolean, reflect: true },
    };
    constructor() { super(); this.value = ''; this.disabled = false; }
    _commit() { this.dispatchEvent(new CustomEvent('arc-change', { detail: { value: this.value } })); }
`;

const generate = (meta, config = cfg()) =>
  readFileSync(generateAngular(meta, config, tmpDir).path, 'utf-8');

describe('detecting a form control', () => {
  it('reads `static formAssociated = true` from the source', () => {
    expect(parse('arc-input', 'ArcInput', textField).formAssociated).toBe(true);
  });

  it('reads the legacy getter form', () => {
    const meta = parse(
      'arc-input', 'ArcInput',
      `static get formAssociated() { return true; }\n${textField}`,
      { formAssociated: false }
    );
    expect(meta.formAssociated).toBe(true);
  });

  it('does not guess from a change event alone', () => {
    // The count this replaces: "components emitting arc-change" swept in tabs,
    // theme toggles, waveforms and sortable lists, none of them a form control.
    const meta = parse('arc-tabs', 'ArcTabs', textField, { formAssociated: false });
    expect(meta.formAssociated).toBe(false);
    expect(formBinding(meta, cfg())).toBe(null);
  });

  it('lets config.formAssociated answer for a mixin-built class', () => {
    const source = component('arc-input', 'ArcInput', textField, { formAssociated: false })
      .replace('extends LitElement', 'extends FormControlMixin(LitElement)');
    const meta = parseComponent(source, '/src/input/input.js', 'arc', {}, [], {
      formAssociated: (src) => /FormControlMixin\(/.test(src) || undefined,
    });
    expect(meta.formAssociated).toBe(true);
  });

  it('reports a hook that answers with something unusable, and reads the source itself', () => {
    const diagnostics = [];
    const meta = parseComponent(
      component('arc-input', 'ArcInput', textField), '/src/input/input.js', 'arc', {}, diagnostics,
      { formAssociated: () => 'yes' }
    );
    expect(meta.formAssociated).toBe(true);
    expect(diagnostics.map((d) => d.code)).toContain('invalid-form-associated');
  });

  it('survives a hook that throws', () => {
    const diagnostics = [];
    const meta = parseComponent(
      component('arc-input', 'ArcInput', textField), '/src/input/input.js', 'arc', {}, diagnostics,
      { formAssociated: () => { throw new Error('boom'); } }
    );
    expect(meta.formAssociated).toBe(true);
    expect(diagnostics[0].code).toBe('invalid-form-associated');
  });
});

describe('what a form binds', () => {
  it('binds `value`, committing on the change event', () => {
    const binding = formBinding(parse('arc-input', 'ArcInput', textField), cfg());
    expect(binding.parts.map((p) => p.name)).toEqual(['value']);
    expect(binding.event).toBe('arc-change');
    expect(binding.empty).toBe("''");
  });

  it('binds `checked` rather than `value` where a control declares both', () => {
    const body = `
      static properties = { checked: { type: Boolean }, value: { type: String } };
      constructor() { super(); this.checked = false; this.value = 'on'; }
      _c() { this.dispatchEvent(new CustomEvent('arc-change', { detail: { checked: this.checked } })); }
    `;
    const binding = formBinding(parse('arc-checkbox', 'ArcCheckbox', body), cfg());
    expect(binding.parts.map((p) => p.name)).toEqual(['checked']);
    expect(binding.empty).toBe('false');
  });

  it('commits on the change event, not the live-input one', () => {
    const body = `
      static properties = { value: { type: Number } };
      _i() { this.dispatchEvent(new CustomEvent('arc-input', { detail: { value: this.value } })); }
      _c() { this.dispatchEvent(new CustomEvent('arc-change', { detail: { value: this.value } })); }
    `;
    // Binding the first would mark a form dirty on every keystroke.
    expect(formBinding(parse('arc-slider', 'ArcSlider', body), cfg()).event).toBe('arc-change');
  });

  it('carries a pair as one object when config.formValue names two properties', () => {
    const body = `
      static properties = { start: { type: String }, end: { type: String } };
      constructor() { super(); this.start = ''; this.end = ''; }
      _c() { this.dispatchEvent(new CustomEvent('arc-change', { detail: { start: this.start } })); }
    `;
    const meta = parse('arc-date-range-picker', 'ArcDateRangePicker', body);
    const binding = formBinding(meta, cfg({ formValue: { 'arc-date-range-picker': ['start', 'end'] } }));
    expect(binding.composite).toBe(true);
    expect(binding.type).toBe('{ start: string; end: string }');
    expect(binding.empty).toBe("{ start: '', end: '' }");
  });

  it("uses a union's own default as its empty value, because '' is not a member", () => {
    const body = `
      /** @prop {'off'|'on'|'auto'} value - the mode */
      static properties = { value: { type: String } };
      constructor() { super(); this.value = 'auto'; }
      _c() { this.dispatchEvent(new CustomEvent('arc-change', { detail: { value: this.value } })); }
    `;
    const binding = formBinding(parse('arc-mode', 'ArcMode', body), cfg());
    expect(binding.type).toBe("'off' | 'on' | 'auto'");
    expect(binding.empty).toBe("'auto'");
  });

  it('reports a form control with nothing a form could bind', () => {
    const body = `
      static properties = { label: { type: String } };
      _c() { this.dispatchEvent(new CustomEvent('arc-change')); }
    `;
    const binding = formBinding(parse('arc-odd', 'ArcOdd', body), cfg());
    expect(binding.problem).toMatch(/neither "value" nor "checked"/);
  });

  it('reports a config.formValue naming a property that does not exist', () => {
    const binding = formBinding(
      parse('arc-input', 'ArcInput', textField),
      cfg({ formValue: { 'arc-input': 'valeu' } })
    );
    expect(binding.problem).toMatch(/declares no such property/);
  });

  it('reports a form control that never says its value changed', () => {
    const body = 'static properties = { value: { type: String } };';
    const binding = formBinding(parse('arc-mute', 'ArcMute', body), cfg());
    expect(binding.problem).toMatch(/no event a form could commit on/);
  });
});

describe('the emitted Angular accessor', () => {
  it('registers itself as the value accessor for the element', () => {
    const out = generate(parse('arc-input', 'ArcInput', textField));
    expect(out).toContain("import { NG_VALUE_ACCESSOR, type ControlValueAccessor } from '@angular/forms';");
    expect(out).toContain('{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => Input), multi: true },');
    expect(out).toContain('export class Input implements ControlValueAccessor {');
  });

  it('listens in the constructor, because host metadata already has that event', () => {
    const out = generate(parse('arc-input', 'ArcInput', textField));
    // The decorator maps (arc-change) to the component's own @Output, and a host
    // object cannot carry two handlers for one event.
    expect(out).toContain("'(arc-change)': '_onArcChange($event)',");
    expect(out).toContain("this._el.addEventListener('arc-change', () => {");
  });

  it('reads the element rather than the event detail', () => {
    const out = generate(parse('arc-input', 'ArcInput', textField));
    expect(out).toContain('this._onChangeFn(this._el.value);');
  });

  it('does not echo writeValue back to the form', () => {
    // Echoing marks the control dirty on every programmatic setValue.
    const out = generate(parse('arc-input', 'ArcInput', textField));
    const writeValue = out.slice(out.indexOf('writeValue('), out.indexOf('registerOnChange('));
    expect(writeValue).not.toContain('_onChangeFn');
    expect(writeValue).toContain("const next = value ?? '';");
  });

  it('writes both halves of a composite value', () => {
    const body = `
      static properties = { low: { type: Number }, high: { type: Number } };
      constructor() { super(); this.low = 0; this.high = 100; }
      _c() { this.dispatchEvent(new CustomEvent('arc-change', { detail: { low: this.low } })); }
    `;
    const out = generate(
      parse('arc-range-slider', 'ArcRangeSlider', body),
      cfg({ formValue: { 'arc-range-slider': ['low', 'high'] } })
    );
    expect(out).toContain('writeValue(value: { low: number; high: number } | null | undefined): void {');
    expect(out).toContain('const next = value ?? { low: 0, high: 0 };');
    expect(out).toContain('this._el.low = next.low;');
    expect(out).toContain('this._el.high = next.high;');
    expect(out).toContain('this._onChangeFn({ low: this._el.low, high: this._el.high });');
  });

  it('omits setDisabledState where the element has no disabled property', () => {
    const body = `
      static properties = { value: { type: String } };
      _c() { this.dispatchEvent(new CustomEvent('arc-change', { detail: { value: this.value } })); }
    `;
    const out = generate(parse('arc-thing', 'ArcThing', body));
    expect(out).not.toContain('setDisabledState');
    expect(out).toContain('No `disabled` property on this element');
  });

  it('leaves a component that is not form-associated alone', () => {
    const out = generate(parse('arc-tabs', 'ArcTabs', textField, { formAssociated: false }));
    expect(out).not.toContain('@angular/forms');
    expect(out).toContain('export class Tabs {');
  });

  it('generates the wrapper anyway when it cannot decide what a form binds', () => {
    const body = `
      static properties = { label: { type: String } };
      _c() { this.dispatchEvent(new CustomEvent('arc-change')); }
    `;
    // The finding is the CLI's to report; the wrapper is still worth having.
    const out = generate(parse('arc-odd', 'ArcOdd', body));
    expect(out).not.toContain('@angular/forms');
    expect(out).toContain('export class Odd {');
  });

  it('aliases a forms import that collides with the class name', () => {
    const body = `
      static properties = { value: { type: String } };
      _c() { this.dispatchEvent(new CustomEvent('arc-change', { detail: { value: this.value } })); }
    `;
    const meta = parse('arc-control-value-accessor', 'ArcControlValueAccessor', body);
    const out = generate(meta);
    expect(out).toContain('type ControlValueAccessor as NgControlValueAccessor');
    expect(out).toContain('export class ControlValueAccessor implements NgControlValueAccessor {');
  });
});

describe('verifying the accessor survived into the file', () => {
  it('accepts a wrapper that registers one', () => {
    const meta = parse('arc-input', 'ArcInput', textField);
    const out = generate(meta);
    expect(verifyAccessor('angular', out, formBinding(meta, cfg()))).toBe(null);
  });

  it('names the marker a form control lost', () => {
    const meta = parse('arc-input', 'ArcInput', textField);
    const gutted = generate(meta).replace(/\{ provide: NG_VALUE_ACCESSOR[^\n]*\n/, '');
    expect(verifyAccessor('angular', gutted, formBinding(meta, cfg())))
      .toBe('provide: NG_VALUE_ACCESSOR,');
  });

  it('asks nothing of the other frameworks', () => {
    const meta = parse('arc-input', 'ArcInput', textField);
    expect(verifyAccessor('react', '', formBinding(meta, cfg()))).toBe(null);
  });
});
