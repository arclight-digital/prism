import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseComponent } from '../src/parser.js';

const fixture = readFileSync(
  join(import.meta.dirname, 'fixtures/sample-component.js'),
  'utf-8',
);
const filePath = '/project/src/reactive/button.js';
const prefix = 'arc';

describe('parseComponent', () => {
  it('extracts tag, className, and pascalName from customElements.define', () => {
    const meta = parseComponent(fixture, filePath, prefix);
    expect(meta.tag).toBe('arc-button');
    expect(meta.className).toBe('ArcButton');
    expect(meta.pascalName).toBe('Button');
  });

  it('extracts tier from file path', () => {
    const meta = parseComponent(fixture, filePath, prefix);
    expect(meta.tier).toBe('reactive');
  });

  it('parses static properties with types and reflect', () => {
    const meta = parseComponent(fixture, filePath, prefix);
    const variant = meta.props.find((p) => p.name === 'variant');
    expect(variant.type).toBe('String');
    expect(variant.reflect).toBe(true);

    const disabled = meta.props.find((p) => p.name === 'disabled');
    expect(disabled.type).toBe('Boolean');
    expect(disabled.reflect).toBe(true);

    const count = meta.props.find((p) => p.name === 'count');
    expect(count.type).toBe('Number');
    expect(count.reflect).toBe(false);
  });

  it('excludes { state: true } internal properties from the public prop surface', () => {
    const source = `
      /** @tag arc-card */
      export class ArcCard extends LitElement {
        static properties = {
          href:       { type: String },
          _hasFooter: { state: true },
          _svgContent: { state: true, type: String },
        };
      }
    `;
    const meta = parseComponent(source, '/project/src/content/card.js', prefix);
    expect(meta.props.map((p) => p.name)).toEqual(['href']);
  });

  it('applies constructor defaults', () => {
    const meta = parseComponent(fixture, filePath, prefix);
    const variant = meta.props.find((p) => p.name === 'variant');
    expect(variant.default).toBe("'primary'");

    const size = meta.props.find((p) => p.name === 'size');
    expect(size.default).toBe("'medium'");

    const disabled = meta.props.find((p) => p.name === 'disabled');
    expect(disabled.default).toBe('false');

    const count = meta.props.find((p) => p.name === 'count');
    expect(count.default).toBe('0');
  });

  it('extracts CSS from css`` template literals', () => {
    const meta = parseComponent(fixture, filePath, prefix);
    expect(meta.css).toContain(':host');
    expect(meta.css).toContain('display: inline-flex');
    expect(meta.css).toContain('.btn');
  });

  it('detects enum values from :host([prop="value"]) patterns', () => {
    const meta = parseComponent(fixture, filePath, prefix);
    const variant = meta.props.find((p) => p.name === 'variant');
    expect(variant.values).toContain('primary');
    expect(variant.values).toContain('secondary');

    const size = meta.props.find((p) => p.name === 'size');
    expect(size.values).toContain('small');
    expect(size.values).toContain('medium');
    expect(size.values).toContain('large');
  });

  it('detects enum values from single-quoted :host([prop=\'value\']) patterns', () => {
    const source = `
      /** @tag arc-layout */
      export class ArcLayout extends LitElement {
        static properties = { layout: { type: String } };
        static styles = css\`
          :host([layout='centered']) { display: grid; }
          :host([layout='split']) { display: flex; }
        \`;
      }
    `;
    const meta = parseComponent(source, '/src/layout/layout.js', prefix);
    const layout = meta.props.find((p) => p.name === 'layout');
    expect(layout.values).toContain('centered');
    expect(layout.values).toContain('split');
  });

  it('extracts template from render()', () => {
    const meta = parseComponent(fixture, filePath, prefix);
    expect(meta.template).toContain('<button');
    expect(meta.template).toContain('<slot>');
  });

  it('extracts custom events from dispatchEvent calls', () => {
    const meta = parseComponent(fixture, filePath, prefix);
    expect(meta.events).toContain('arc-click');
    expect(meta.events).toContain('arc-action');
    expect(meta.events).toHaveLength(2);
  });

  it('extracts detail keys alongside event names', () => {
    const source = `
      export class ArcSlider extends LitElement {
        static properties = { value: { type: Number } };
        _emit() {
          this.dispatchEvent(new CustomEvent('arc-input', {
            detail: { value: this.value, valid: true },
            bubbles: true,
            composed: true,
          }));
        }
      }
      customElements.define('arc-slider', ArcSlider);
    `;
    const meta = parseComponent(source, '/src/input/slider.js', prefix);
    expect(meta.eventDetails['arc-input']).toEqual(['value', 'valid']);
  });

  it('captures shorthand detail keys', () => {
    const source = `
      export class ArcToggle extends LitElement {
        _emit() {
          const checked = this.checked;
          this.dispatchEvent(new CustomEvent('arc-change', { detail: { checked } }));
        }
      }
      customElements.define('arc-toggle', ArcToggle);
    `;
    const meta = parseComponent(source, '/src/input/toggle.js', prefix);
    expect(meta.eventDetails['arc-change']).toEqual(['checked']);
  });

  it('captures only top-level detail keys, not nested ones', () => {
    // arc-navigation-menu ships `detail: { href, item: { label, href } }` — the
    // nested `label` must not read as a binding for the menu's own label prop.
    const source = `
      export class ArcNavigationMenu extends LitElement {
        static properties = { label: { type: String } };
        _emit() {
          this.dispatchEvent(new CustomEvent('arc-navigate', {
            detail: { href, item: { label: item.label, href: item.resolvedHref } },
          }));
        }
      }
      customElements.define('arc-navigation-menu', ArcNavigationMenu);
    `;
    const meta = parseComponent(source, '/src/navigation/navigation-menu.js', prefix);
    expect(meta.eventDetails['arc-navigate']).toEqual(['href', 'item']);
  });

  it('does not let a payload-less event inherit the next event\'s detail keys', () => {
    const source = `
      export class ArcThing extends LitElement {
        _emit() {
          this.dispatchEvent(new CustomEvent('arc-open'));
          this.dispatchEvent(new CustomEvent('arc-change', { detail: { value: 1 } }));
        }
      }
      customElements.define('arc-thing', ArcThing);
    `;
    const meta = parseComponent(source, '/src/input/thing.js', prefix);
    expect(meta.eventDetails['arc-open']).toBeUndefined();
    expect(meta.eventDetails['arc-change']).toEqual(['value']);
  });

  it('unions detail keys across repeated dispatches of the same event', () => {
    const source = `
      export class ArcInput extends LitElement {
        _clear() { this.dispatchEvent(new CustomEvent('arc-change', { detail: { value: '' } })); }
        _edit()  { this.dispatchEvent(new CustomEvent('arc-change', { detail: { value: this.value, valid: true } })); }
      }
      customElements.define('arc-input', ArcInput);
    `;
    const meta = parseComponent(source, '/src/input/input.js', prefix);
    expect(meta.eventDetails['arc-change']).toEqual(['value', 'valid']);
  });

  it('ignores a detail passed as a variable rather than a literal', () => {
    const source = `
      export class ArcThing extends LitElement {
        _emit(payload) {
          this.dispatchEvent(new CustomEvent('arc-change', { detail: payload }));
        }
      }
      customElements.define('arc-thing', ArcThing);
    `;
    const meta = parseComponent(source, '/src/input/thing.js', prefix);
    expect(meta.events).toEqual(['arc-change']);
    expect(meta.eventDetails['arc-change']).toBeUndefined();
  });

  it('is not fooled by commas inside detail values', () => {
    const source = `
      export class ArcGrid extends LitElement {
        _emit() {
          this.dispatchEvent(new CustomEvent('arc-sort', {
            detail: {
              sort: next.map((s) => ({ ...s })), // reorder, then clone
              label: \`\${a}, \${b}\`,
            },
          }));
        }
      }
      customElements.define('arc-grid', ArcGrid);
    `;
    const meta = parseComponent(source, '/src/data/grid.js', prefix);
    expect(meta.eventDetails['arc-sort']).toEqual(['sort', 'label']);
  });

  it('detects interactivity level — interactive due to events', () => {
    const meta = parseComponent(fixture, filePath, prefix);
    expect(meta.interactivity).toBe('interactive');
  });

  it('detects static interactivity when no signals present', () => {
    const staticSource = `
      import { LitElement, html, css } from 'lit';
      class ArcBadge extends LitElement {
        static properties = { label: { type: String } };
        static styles = css\`:host { display: inline-flex; }\`;
        render() { return html\`<span>\${this.label}</span>\`; }
      }
      customElements.define('arc-badge', ArcBadge);
    `;
    const meta = parseComponent(staticSource, '/src/content/badge.js');
    expect(meta.interactivity).toBe('static');
  });

  it('respects @arc-prism override', () => {
    const hybridSource = `
      import { LitElement, html, css } from 'lit';
      /** @arc-prism hybrid — display works without JS; copy requires JS */
      class ArcCode extends LitElement {
        static styles = css\`:host { display: block; }\`;
        render() { return html\`<pre><slot></slot></pre>\`; }
        _copy() {
          this.dispatchEvent(new CustomEvent('arc-copy'));
        }
      }
      customElements.define('arc-code', ArcCode);
    `;
    const meta = parseComponent(hybridSource, '/src/content/code.js');
    expect(meta.interactivity).toBe('hybrid');
  });

  it('extracts host display value', () => {
    const meta = parseComponent(fixture, filePath, prefix);
    expect(meta.hostDisplay).toBe('inline-flex');
  });

  it('returns null for non-component files', () => {
    const result = parseComponent('export const foo = 42;', '/src/utils.js');
    expect(result).toBeNull();
  });

  describe('property declaration styles', () => {
    it('reads defaults set after a nested block in the constructor', () => {
      // Regression: a lazy regex stopped at the first nested `}` and dropped
      // any default assigned afterward.
      const source = `
        /** @tag arc-toggle */
        export class ArcToggle extends LitElement {
          static properties = {
            variant: { type: String },
            size: { type: String },
          };
          constructor() {
            super();
            if (this.foo) {
              this.bar = 1;
            }
            this.variant = 'primary';
            this.size = 'medium';
          }
        }
      `;
      const meta = parseComponent(source, '/src/reactive/toggle.js', prefix);
      expect(meta.props.find((p) => p.name === 'variant').default).toBe("'primary'");
      expect(meta.props.find((p) => p.name === 'size').default).toBe("'medium'");
    });

    it('parses @property() decorator declarations', () => {
      const source = `
        /** @tag arc-chip */
        export class ArcChip extends LitElement {
          @property({ type: String, reflect: true }) variant;
          @property({ type: Boolean }) disabled;
          @state() _internal;
        }
      `;
      const meta = parseComponent(source, '/src/reactive/chip.js', prefix);
      const names = meta.props.map((p) => p.name);
      expect(names).toContain('variant');
      expect(names).toContain('disabled');
      expect(names).not.toContain('_internal');
      expect(meta.props.find((p) => p.name === 'variant').reflect).toBe(true);
      expect(meta.props.find((p) => p.name === 'disabled').type).toBe('Boolean');
    });

    it('parses static get properties() getter style', () => {
      const source = `
        /** @tag arc-tag */
        export class ArcTag extends LitElement {
          static get properties() {
            return {
              label: { type: String },
              count: { type: Number },
            };
          }
        }
      `;
      const meta = parseComponent(source, '/src/content/tag.js', prefix);
      const names = meta.props.map((p) => p.name);
      expect(names).toContain('label');
      expect(names).toContain('count');
      expect(meta.props.find((p) => p.name === 'count').type).toBe('Number');
    });
  });

  describe('input validation (injection hardening)', () => {
    it('rejects a component whose customElements.define tag is not a valid custom-element name', () => {
      const malicious = `
        export class ArcEvil extends LitElement {
          static properties = { label: { type: String } };
          render() { return html\`<span></span>\`; }
        }
        customElements.define('div onload={fetch(\`//evil\`)}><script', ArcEvil);
      `;
      expect(parseComponent(malicious, '/src/content/evil.js', prefix)).toBeNull();
    });

    it('rejects a tag containing path-traversal sequences', () => {
      const traversal = `
        export class ArcEvil extends LitElement {
          render() { return html\`<span></span>\`; }
        }
        customElements.define('../../../../etc/passwd', ArcEvil);
      `;
      expect(parseComponent(traversal, '/src/content/evil.js', prefix)).toBeNull();
    });

    it('rejects a single-word tag with no hyphen', () => {
      const noHyphen = `
        export class ArcEvil extends LitElement {
          render() { return html\`<span></span>\`; }
        }
        customElements.define('button', ArcEvil);
      `;
      expect(parseComponent(noHyphen, '/src/content/evil.js', prefix)).toBeNull();
    });

    it('drops events whose names are not valid identifiers but keeps valid ones', () => {
      const source = `
        /** @tag arc-widget */
        export class ArcWidget extends LitElement {
          static properties = { label: { type: String } };
          _emit() {
            this.dispatchEvent(new CustomEvent('arc-change'));
            this.dispatchEvent(new CustomEvent('x: (globalThis.pwned = 1) as any, y'));
          }
        }
      `;
      const meta = parseComponent(source, '/src/reactive/widget.js', prefix);
      expect(meta.events).toEqual(['arc-change']);
    });

    it('drops detail keys that are not plain identifiers', () => {
      // Detail keys are emitted as bare identifiers on the left of an
      // assignment in the wrappers, so a quoted key carrying punctuation must
      // never survive. `$` is excluded too — it is a rune sigil in Svelte.
      const source = `
        /** @tag arc-widget */
        export class ArcWidget extends LitElement {
          static properties = { value: { type: String } };
          _emit() {
            this.dispatchEvent(new CustomEvent('arc-change', {
              detail: { value: this.value, '(globalThis.pwned = 1)': 1, $rune: 2 },
            }));
          }
        }
      `;
      const meta = parseComponent(source, '/src/reactive/widget.js', prefix);
      expect(meta.eventDetails['arc-change']).toEqual(['value']);
    });

    it('still accepts a normal multi-part tag name', () => {
      const source = `
        export class ArcIconButton extends LitElement {
          render() { return html\`<span></span>\`; }
        }
        customElements.define('arc-icon-button', ArcIconButton);
      `;
      const meta = parseComponent(source, '/src/reactive/icon-button.js', prefix);
      expect(meta.tag).toBe('arc-icon-button');
    });
  });
});

describe('detectInteractivity — focus event suffixes', () => {
  const wrap = (template) => `
    import { LitElement, html, css } from 'lit';
    export class ArcThing extends LitElement {
      static styles = css\`:host { display: block; }\`;
      render() { return html\`${template}\`; }
    }
    customElements.define('arc-thing', ArcThing);
  `;

  it('treats @focusin as interactive', () => {
    // `@focusin=` has `in` between `focus` and `=`, so a `@focus\s*=` pattern
    // misses it and the component wrongly ships CSS for JS-driven behaviour.
    const meta = parseComponent(wrap('<div @focusin=${this._show}></div>'), 'thing.js', 'arc');
    expect(meta.interactivity).toBe('interactive');
  });

  it('treats @focusout as interactive', () => {
    const meta = parseComponent(wrap('<div @focusout=${this._hide}></div>'), 'thing.js', 'arc');
    expect(meta.interactivity).toBe('interactive');
  });

  it('still treats plain @focus and @blur as interactive', () => {
    for (const ev of ['focus', 'blur']) {
      const meta = parseComponent(wrap(`<div @${ev}=\${this._x}></div>`), 'thing.js', 'arc');
      expect(meta.interactivity).toBe('interactive');
    }
  });

  it('leaves a purely presentational component static', () => {
    const meta = parseComponent(wrap('<div class="box"><slot></slot></div>'), 'thing.js', 'arc');
    expect(meta.interactivity).toBe('static');
  });
});

describe('detectInteractivity — config overrides (Layer 0)', () => {
  const src = (extra = '') => `
    import { LitElement, html, css } from 'lit';
    ${extra}
    export class ArcThing extends LitElement {
      static styles = css\`:host { display: block; }\`;
      render() { return html\`<div class="box"><slot></slot></div>\`; }
    }
    customElements.define('arc-thing', ArcThing);
  `;

  it('config override beats auto-detection', () => {
    // Auto-detection would call this static — nothing in it needs JS.
    expect(parseComponent(src(), 'thing.js', 'arc').interactivity).toBe('static');
    expect(parseComponent(src(), 'thing.js', 'arc', { 'arc-thing': 'hybrid' }).interactivity)
      .toBe('hybrid');
  });

  it('config override beats the @arc-prism JSDoc tag', () => {
    const withTag = src('/** @arc-prism static */');
    expect(parseComponent(withTag, 'thing.js', 'arc').interactivity).toBe('static');
    expect(parseComponent(withTag, 'thing.js', 'arc', { 'arc-thing': 'interactive' }).interactivity)
      .toBe('interactive');
  });

  it('config override can force static despite an interactive signal', () => {
    const clicky = src().replace('<div class="box">', '<div class="box" @click=${this._x}>');
    expect(parseComponent(clicky, 'thing.js', 'arc').interactivity).toBe('interactive');
    expect(parseComponent(clicky, 'thing.js', 'arc', { 'arc-thing': 'static' }).interactivity)
      .toBe('static');
  });

  it('an override for a different tag does not apply', () => {
    expect(parseComponent(src(), 'thing.js', 'arc', { 'arc-other': 'hybrid' }).interactivity)
      .toBe('static');
  });

  it('the JSDoc tag still works when no override is present', () => {
    expect(parseComponent(src('/** @arc-prism hybrid */'), 'thing.js', 'arc', {}).interactivity)
      .toBe('hybrid');
  });
});

describe('classification provenance', () => {
  const src = (extra = '', body = '<div class="box"><slot></slot></div>') => `
    import { LitElement, html, css } from 'lit';
    ${extra}
    export class ArcThing extends LitElement {
      static styles = css\`:host { display: block; }\`;
      render() { return html\`${body}\`; }
    }
    customElements.define('arc-thing', ArcThing);
  `;

  it('records origin "config" for a config override', () => {
    const m = parseComponent(src(), 'thing.js', 'arc', { 'arc-thing': 'hybrid' });
    expect(m.classification.origin).toBe('config');
    expect(m.classification.level).toBe('hybrid');
  });

  it('records origin "jsdoc" for a JSDoc tag', () => {
    const m = parseComponent(src('/** @arc-prism hybrid */'), 'thing.js', 'arc');
    expect(m.classification.origin).toBe('jsdoc');
  });

  it('records origin "auto" otherwise', () => {
    expect(parseComponent(src(), 'thing.js', 'arc').classification.origin).toBe('auto');
  });

  it('captures handler signals even when a config override decides', () => {
    const clicky = src('', '<div @click=${this._a} @keydown=${this._b}></div>');
    const m = parseComponent(clicky, 'thing.js', 'arc', { 'arc-thing': 'static' });
    expect(m.classification.origin).toBe('config');
    expect(m.classification.signals.handlerCount).toBe(2);
    expect(m.classification.signals.handlers.sort()).toEqual(['click', 'keydown']);
  });

  it('captures imperative DOM and display:none signals', () => {
    const m = parseComponent(
      src('', '<div></div>').replace('display: block', 'display: none')
        .replace('render()', 'x() { this.shadowRoot.querySelector("a"); }\n      render()'),
      'thing.js', 'arc'
    );
    expect(m.classification.signals.imperativeDOM).toBe(true);
    expect(m.classification.signals.hostDisplayNone).toBe(true);
  });

  it('interactivity still mirrors classification.level', () => {
    const m = parseComponent(src('/** @arc-prism interactive */'), 'thing.js', 'arc');
    expect(m.interactivity).toBe(m.classification.level);
  });
});

describe('extractTemplate — elements built into a local first', () => {
  const component = (renderBody, props = '') => `
    import { LitElement, html, css } from 'lit';
    export class ArcThing extends LitElement {
      static properties = { ${props} };
      constructor() { super(); ${props ? '' : ''} }
      static styles = css\`:host { display: block; }\`;
      render() { ${renderBody} }
    }
    customElements.define('arc-thing', ArcThing);
  `;

  const withDefaults = (renderBody, ctor, props) => `
    import { LitElement, html, css } from 'lit';
    export class ArcThing extends LitElement {
      static properties = { ${props} };
      constructor() { super(); ${ctor} }
      static styles = css\`:host { display: block; }\`;
      render() { ${renderBody} }
    }
    customElements.define('arc-thing', ArcThing);
  `;

  it('inlines a plain html-valued local (existing behaviour)', () => {
    const src = component('const inner = html`<b>hi</b>`; return html`<div>${inner}</div>`;');
    expect(parseComponent(src, 't.js', 'arc').template).toContain('<b>hi</b>');
  });

  it('resolves a ternary initializer, picking the branch matching the prop default', () => {
    // The reported bug: the element vanished entirely because the initializer
    // wasn't a bare `= html`…``.
    const src = withDefaults(
      'const field = this.multiline ? html`<textarea></textarea>` : html`<input/>`;\nreturn html`<div>${field}</div>`;',
      'this.multiline = false;',
      'multiline: { type: Boolean }'
    );
    const t = parseComponent(src, 't.js', 'arc').template;
    expect(t).toContain('<input/>');
    expect(t).not.toContain('<textarea>');
  });

  it('picks the truthy branch when the prop defaults true', () => {
    const src = withDefaults(
      'const field = this.multiline ? html`<textarea></textarea>` : html`<input/>`;\nreturn html`<div>${field}</div>`;',
      'this.multiline = true;',
      'multiline: { type: Boolean }'
    );
    const t = parseComponent(src, 't.js', 'arc').template;
    expect(t).toContain('<textarea>');
    expect(t).not.toContain('<input/>');
  });

  it('contributes nothing when the chosen branch has no markup', () => {
    // `this.show ? html`…` : ''` with show defaulting false must not start
    // emitting the element just because the initializer is now readable.
    const src = withDefaults(
      "const extra = this.show ? html`<b>shown</b>` : '';\nreturn html`<div>${extra}</div>`;",
      'this.show = false;',
      'show: { type: Boolean }'
    );
    const t = parseComponent(src, 't.js', 'arc').template;
    expect(t).not.toContain('shown');
    expect(t).not.toContain('${extra}');
  });

  it('resolves a condition held in a local alias', () => {
    const src = withDefaults(
      "const hasText = !!this.text;\nconst el = hasText ? html`<span>x</span>` : null;\nreturn html`<div>${el}</div>`;",
      "this.text = '';",
      'text: { type: String }'
    );
    expect(parseComponent(src, 't.js', 'arc').template).not.toContain('<span>x</span>');
  });

  it('leaves an undecidable condition unresolved for the downstream placeholder pass', () => {
    // Collapsing this to '' would strip the interpolation the HTML generator
    // needs in order to substitute a label for an otherwise-empty element.
    const src = component(
      "const content = this.src && this._state !== 'error' ? html`<img/>` : html`<b>x</b>`;\nreturn html`<div>${content}</div>`;"
    );
    expect(parseComponent(src, 't.js', 'arc').template).toContain('${content}');
  });

  it('ignores locals that hold no markup', () => {
    const src = component('const id = this.name || this._fallback;\nreturn html`<div id=${id}></div>`;');
    expect(parseComponent(src, 't.js', 'arc').template).toContain('${id}');
  });

  it('is not confused by a colon inside the branches', () => {
    const src = withDefaults(
      'const el = this.on ? html`<a href="https://x.example">y</a>` : html`<b style="color: red">n</b>`;\nreturn html`<div>${el}</div>`;',
      'this.on = false;',
      'on: { type: Boolean }'
    );
    const t = parseComponent(src, 't.js', 'arc').template;
    expect(t).toContain('<b style="color: red">n</b>');
    expect(t).not.toContain('href=');
  });

  it('re-indents a multi-line block to the interpolation column', () => {
    const src = component(
      'const field = html`<input\n          class="f"\n          type="text"\n        />`;\n' +
      'return html`<div>\n  <span>\n    ${field}\n  </span>\n</div>`;'
    );
    const lines = parseComponent(src, 't.js', 'arc').template.split('\n');
    const open = lines.findIndex((l) => l.includes('<input'));
    // The opening tag and its attributes share one indentation level.
    expect(lines[open].match(/^\s*/)[0]).toBe('    ');
    expect(lines[open + 1].match(/^\s*/)[0]).toBe('      ');
  });
});

describe('documented enum unions (@prop)', () => {
  it('reads a string-literal union from the class JSDoc', () => {
    const source = `
      /**
       * @tag arc-badge
       * @prop {'neutral' | 'success' | 'danger'} tone
       */
      export class ArcBadge extends LitElement {
        static properties = { tone: { type: String } };
        constructor() { super(); this.tone = 'neutral'; }
      }
    `;
    const meta = parseComponent(source, '/src/content/badge.js', prefix);
    const tone = meta.props.find((p) => p.name === 'tone');
    expect(tone.values).toEqual(['neutral', 'success', 'danger']);
  });

  it('keeps the documented union when CSS only styles the non-default members', () => {
    // The default member has no :host([size="…"]) rule to be inferred from —
    // it is the unqualified base style — so CSS alone loses it.
    const source = `
      /**
       * @tag arc-avatar
       * @prop {'small' | 'medium' | 'large'} size
       */
      export class ArcAvatar extends LitElement {
        static properties = { size: { type: String } };
        constructor() { super(); this.size = 'medium'; }
        static styles = css\`
          :host { width: 32px; }
          :host([size="small"]) { width: 24px; }
          :host([size="large"]) { width: 48px; }
        \`;
      }
    `;
    const meta = parseComponent(source, '/src/content/avatar.js', prefix);
    const size = meta.props.find((p) => p.name === 'size');
    expect(size.values).toEqual(['small', 'medium', 'large']);
  });

  it('survives when the variants are driven from JS and there is no CSS at all', () => {
    const source = `
      /**
       * @tag arc-label
       * @prop {'inline' | 'stacked'} layout
       */
      export class ArcLabel extends LitElement {
        static properties = { layout: { type: String } };
        constructor() { super(); this.layout = 'inline'; }
      }
    `;
    const meta = parseComponent(source, '/src/content/label.js', prefix);
    const layout = meta.props.find((p) => p.name === 'layout');
    expect(layout.values).toEqual(['inline', 'stacked']);
  });

  it('leaves non-literal documented types alone', () => {
    const source = `
      /**
       * @tag arc-field
       * @prop {string} label
       * @prop {number} max
       */
      export class ArcField extends LitElement {
        static properties = { label: { type: String }, max: { type: Number } };
      }
    `;
    const meta = parseComponent(source, '/src/content/field.js', prefix);
    expect(meta.props.find((p) => p.name === 'label').values).toEqual([]);
    expect(meta.props.find((p) => p.name === 'max').values).toEqual([]);
  });

  it('warns when the CSS styles a value the documented union omits', () => {
    const source = `
      /**
       * @tag arc-chip
       * @prop {'solid' | 'outline'} variant
       */
      export class ArcChip extends LitElement {
        static properties = { variant: { type: String } };
        static styles = css\`
          :host([variant="outline"]) { border: 1px solid; }
          :host([variant="ghost"]) { border: none; }
        \`;
      }
    `;
    const warnings = [];
    const original = console.warn;
    console.warn = (msg) => warnings.push(msg);
    let meta;
    try {
      meta = parseComponent(source, '/src/content/chip.js', prefix);
    } finally {
      console.warn = original;
    }
    // The documented union still wins — the warning is advisory.
    expect(meta.props.find((p) => p.name === 'variant').values).toEqual(['solid', 'outline']);
    expect(warnings.join('\n')).toContain('"ghost"');
    expect(warnings.join('\n')).toContain('arc-chip');
  });

  it('still infers from CSS when nothing is documented', () => {
    const meta = parseComponent(fixture, filePath, prefix);
    expect(meta.props.find((p) => p.name === 'variant').values)
      .toEqual(['primary', 'secondary']);
  });
});

describe('diagnostics collector', () => {
  /** Run a parse with a collector, asserting nothing was printed. */
  const collect = (source, path = '/src/content/x.js') => {
    const diagnostics = [];
    const printed = [];
    const original = console.warn;
    console.warn = (msg) => printed.push(msg);
    let meta;
    try {
      meta = parseComponent(source, path, prefix, {}, diagnostics);
    } finally {
      console.warn = original;
    }
    // A collector means the caller owns presentation — nothing goes to stdout,
    // or the CLI's grouped block would double-report every entry.
    expect(printed).toEqual([]);
    return { meta, diagnostics };
  };

  it('collects doc drift instead of printing it', () => {
    const { meta, diagnostics } = collect(`
      /**
       * @tag arc-chip
       * @prop {'solid' | 'outline'} variant
       */
      export class ArcChip extends LitElement {
        static properties = { variant: { type: String } };
        static styles = css\`
          :host([variant="ghost"]) { border: none; }
        \`;
      }
    `);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: 'doc-drift',
      tag: 'arc-chip',
      prop: 'variant',
      values: ['ghost'],
    });
    // The union still wins — a diagnostic is not a rejection.
    expect(meta.props.find((p) => p.name === 'variant').values).toEqual(['solid', 'outline']);
  });

  it('collects an invalid tag name, and still returns null', () => {
    const { meta, diagnostics } = collect(`
      export class Bad extends LitElement {}
      customElements.define('nohyphen', Bad);
    `);
    expect(meta).toBeNull();
    expect(diagnostics[0]).toMatchObject({ code: 'invalid-tag' });
    expect(diagnostics[0].file).toBe('/src/content/x.js');
  });

  it('collects invalid event and detail-key names', () => {
    const { meta, diagnostics } = collect(`
      /** @tag arc-thing */
      export class ArcThing extends LitElement {
        _fire() {
          this.dispatchEvent(new CustomEvent('bad name', { detail: { ok: 1 } }));
          this.dispatchEvent(new CustomEvent('arc-ok', { detail: { $weird: 1, fine: 2 } }));
        }
      }
    `);
    const codes = diagnostics.map((d) => d.code);
    expect(codes).toContain('invalid-event');
    expect(codes).toContain('invalid-detail-key');
    expect(meta.events).toEqual(['arc-ok']);
    expect(meta.eventDetails['arc-ok']).toEqual(['fine']);
  });

  it('stays silent on a clean component', () => {
    const { diagnostics } = collect(`
      /** @tag arc-clean */
      export class ArcClean extends LitElement {
        static properties = { label: { type: String } };
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it('still prints when no collector is passed', () => {
    const printed = [];
    const original = console.warn;
    console.warn = (msg) => printed.push(msg);
    try {
      parseComponent(`
        /**
         * @tag arc-chip
         * @prop {'solid'} variant
         */
        export class ArcChip extends LitElement {
          static properties = { variant: { type: String } };
          static styles = css\`:host([variant="ghost"]) { border: none; }\`;
        }
      `, '/src/content/chip.js', prefix);
    } finally {
      console.warn = original;
    }
    expect(printed.join('\n')).toContain('"ghost"');
  });
});

describe('enum values include the prop default', () => {
  const component = (styles, ctor = "this.size = 'md';") => `
    /** @tag arc-tag */
    export class ArcTag extends LitElement {
      static properties = { size: { type: String } };
      constructor() { super(); ${ctor} }
      static styles = css\`${styles}\`;
    }
  `;
  const sizeOf = (src) =>
    parseComponent(src, '/src/content/tag.js', prefix).props.find((p) => p.name === 'size');

  it('adds a default the CSS never styles', () => {
    const size = sizeOf(component(`
      :host([size="sm"]) { font-size: 12px; }
      :host([size="lg"]) { font-size: 18px; }
    `));
    expect(size.values).toEqual(['sm', 'lg', 'md']);
  });

  it('does not duplicate a default the CSS already styles', () => {
    const size = sizeOf(component(`
      :host([size="sm"]) { font-size: 12px; }
      :host([size="md"]) { font-size: 14px; }
    `));
    expect(size.values).toEqual(['sm', 'md']);
  });

  it('ignores an empty-string default', () => {
    const size = sizeOf(component(':host([size="sm"]) { font-size: 12px; }', "this.size = '';"));
    expect(size.values).toEqual(['sm']);
  });

  it('ignores a default that is not a string literal', () => {
    const size = sizeOf(component(':host([size="sm"]) { font-size: 12px; }', 'this.size = SIZES[0];'));
    expect(size.values).toEqual(['sm']);
  });

  it('does not invent a union from a default alone', () => {
    // One legal value is not an enum — without CSS variants this stays a string.
    const size = sizeOf(component(':host { display: inline-flex; }'));
    expect(size.values).toEqual([]);
  });

  it('warns when a documented union omits the component default', () => {
    const diagnostics = [];
    parseComponent(`
      /**
       * @tag arc-tag
       * @prop {'sm' | 'lg'} size
       */
      export class ArcTag extends LitElement {
        static properties = { size: { type: String } };
        constructor() { super(); this.size = 'md'; }
      }
    `, '/src/content/tag.js', prefix, {}, diagnostics);
    expect(diagnostics.map((d) => d.code)).toEqual(['doc-drift']);
    expect(diagnostics[0].message).toContain('defaults size to "md"');
  });
});

describe('documented types beyond literal unions', () => {
  const parse = (typeText, propName = 'series', type = 'Array') => {
    const diagnostics = [];
    const meta = parseComponent(`
      /**
       * @tag arc-chart
       * @prop {${typeText}} ${propName}
       */
      export class ArcChart extends LitElement {
        static properties = { ${propName}: { type: ${type} } };
      }
    `, '/src/content/chart.js', prefix, {}, diagnostics);
    return { prop: meta.props.find((p) => p.name === propName), diagnostics };
  };

  it('keeps a nested object type verbatim rather than truncating at the first brace', () => {
    const { prop } = parse('Array<{label: string, data: number[]}>');
    expect(prop.docType).toBe('Array<{label: string, data: number[]}>');
  });

  it('keeps a bare shape type', () => {
    const { prop } = parse('{ id: string, rows: number[] }[]', 'rows');
    expect(prop.docType).toBe('{ id: string, rows: number[] }[]');
  });

  it('leaves trivial types to the existing type map', () => {
    expect(parse('string', 'label', 'String').prop.docType).toBe('');
    expect(parse('number', 'max', 'Number').prop.docType).toBe('');
    expect(parse('Array', 'items').prop.docType).toBe('');
  });

  it('leaves a literal union on values, not docType', () => {
    const { prop } = parse("'a' | 'b'", 'variant', 'String');
    expect(prop.docType).toBe('');
    expect(prop.values).toEqual(['a', 'b']);
  });

  it('warns about a documented type naming a symbol it cannot import', () => {
    const { prop, diagnostics } = parse('ChartSeries[]');
    expect(prop.docType).toBe('ChartSeries[]');
    expect(diagnostics.map((d) => d.code)).toEqual(['unportable-doc-type']);
    expect(diagnostics[0].message).toContain('"ChartSeries"');
  });

  it('accepts built-in generics without warning', () => {
    const { prop, diagnostics } = parse('Record<string, Array<number>>');
    expect(prop.docType).toBe('Record<string, Array<number>>');
    expect(diagnostics).toEqual([]);
  });

  it('refuses a type it cannot emit safely and says so', () => {
    const { prop, diagnostics } = parse('string; declare const x: number');
    expect(prop.docType).toBe('');
    expect(diagnostics.map((d) => d.code)).toEqual(['unusable-doc-type']);
  });

  it('ignores a @prop tag naming a prop that does not exist', () => {
    const { diagnostics } = parse('Array<number>', 'series');
    expect(diagnostics).toEqual([]);
  });
});

describe('documented type rejections name their cause', () => {
  const parse = (typeText) => {
    const diagnostics = [];
    const meta = parseComponent(`
      /**
       * @tag arc-big
       * @prop {${typeText}} rows
       */
      export class ArcBig extends LitElement {
        static properties = { rows: { type: Array } };
      }
    `, '/src/content/big.js', prefix, {}, diagnostics);
    return { prop: meta.props.find((p) => p.name === 'rows'), diagnostics };
  };

  it('states the length and the limit when a type is too long', () => {
    const long = `Array<{${Array.from({ length: 40 }, (_, i) => `field${i}: string`).join(', ')}}>`;
    const { prop, diagnostics } = parse(long);
    expect(prop.docType).toBe('');
    expect(diagnostics[0]).toMatchObject({
      code: 'unusable-doc-type', reason: 'too-long', length: long.length, limit: 500,
    });
    expect(diagnostics[0].message).toContain(`${long.length} characters`);
    expect(diagnostics[0].message).toContain('500-character limit');
  });

  it('names the offending characters when a type is unsafe', () => {
    const { prop, diagnostics } = parse('string; declare const x: number');
    expect(prop.docType).toBe('');
    expect(diagnostics[0]).toMatchObject({ code: 'unusable-doc-type', reason: 'unsafe-characters' });
    expect(diagnostics[0].characters).toContain(';');
  });

  it('accepts a realistically deep nested shape', () => {
    // ~200 chars — the shape this feature exists to serve, rejected by the
    // original limit.
    const nested = 'Array<{id: string, label: string, children: Array<{id: string, label: string, children: Array<{id: string, label: string, href: string, disabled: boolean}>}>}>';
    const { prop, diagnostics } = parse(nested);
    expect(nested.length).toBeGreaterThan(150);
    expect(prop.docType).toBe(nested);
    expect(diagnostics).toEqual([]);
  });

  it('tells you to inline the shape when a type names an unimportable symbol', () => {
    const { diagnostics } = parse('ChartSeries[]');
    expect(diagnostics[0].code).toBe('unportable-doc-type');
    expect(diagnostics[0].message).toContain('inline the shape');
    expect(diagnostics[0].message).toContain('generated wrappers take no imports');
  });
});

describe('named slots', () => {
  const parse = (renderBody) => parseComponent(`
    /** @tag arc-toolbar */
    export class ArcToolbar extends LitElement {
      render() { return html\`${renderBody}\`; }
    }
  `, '/src/application/toolbar.js', prefix);

  it('records named slots in template order', () => {
    const meta = parse(`
      <div class="bar">
        <slot name="start"></slot>
        <div class="context"></div>
        <slot name="end"></slot>
      </div>
    `);
    expect(meta.slots).toEqual(['start', 'end']);
    expect(meta.hasDefaultSlot).toBe(false);
  });

  it('detects a default slot alongside named ones', () => {
    const meta = parse('<slot name="start"></slot><slot></slot>');
    expect(meta.slots).toEqual(['start']);
    expect(meta.hasDefaultSlot).toBe(true);
  });

  it('reports no named slots for a plain default slot', () => {
    const meta = parse('<button><slot></slot></button>');
    expect(meta.slots).toEqual([]);
    expect(meta.hasDefaultSlot).toBe(true);
  });

  it('does not mistake a slot with fallback content for a default slot', () => {
    const meta = parse('<slot name="icon"><arc-icon name="x"></arc-icon></slot>');
    expect(meta.slots).toEqual(['icon']);
    expect(meta.hasDefaultSlot).toBe(false);
  });

  it('handles single quotes and extra attributes', () => {
    const meta = parse("<slot part=\"s\" name='start'></slot>");
    expect(meta.slots).toEqual(['start']);
  });

  it('deduplicates a slot named twice', () => {
    const meta = parse('<slot name="start"></slot><slot name="start"></slot>');
    expect(meta.slots).toEqual(['start']);
  });

  it('records names that are not valid identifiers verbatim', () => {
    // `icon-left` is a legal slot name but cannot be a Svelte snippet prop —
    // recording it as-is leaves that decision to the generator.
    const meta = parse('<slot name="icon-left"></slot>');
    expect(meta.slots).toEqual(['icon-left']);
  });
});

describe('@slot JSDoc tags', () => {
  it('recovers slots when render() could not be parsed', () => {
    // No extractable render(), so the template source yields nothing — the tags
    // are the only evidence the slots exist.
    const meta = parseComponent(`
      /**
       * @tag arc-app-shell
       * @slot start - Leading region
       * @slot end - Trailing region
       */
      export class ArcAppShell extends LitElement {}
    `, '/src/application/app-shell.js', prefix);
    expect(meta.slots).toEqual(['start', 'end']);
  });

  it('unions with template slots, template order first', () => {
    const meta = parseComponent(`
      /**
       * @tag arc-toolbar
       * @slot overflow - Overflow menu
       */
      export class ArcToolbar extends LitElement {
        render() { return html\`<slot name="start"></slot><slot></slot>\`; }
      }
    `, '/src/application/toolbar.js', prefix);
    expect(meta.slots).toEqual(['start', 'overflow']);
    expect(meta.hasDefaultSlot).toBe(true);
  });

  it('does not double-count a slot documented and present', () => {
    const meta = parseComponent(`
      /**
       * @tag arc-card
       * @slot footer - Footer
       */
      export class ArcCard extends LitElement {
        render() { return html\`<slot name="footer"></slot>\`; }
      }
    `, '/src/content/card.js', prefix);
    expect(meta.slots).toEqual(['footer']);
  });

  it('treats a bare @slot as the default slot, adding no named one', () => {
    const meta = parseComponent(`
      /**
       * @tag arc-box
       * @slot - The default content
       */
      export class ArcBox extends LitElement {
        render() { return html\`<slot></slot>\`; }
      }
    `, '/src/content/box.js', prefix);
    expect(meta.slots).toEqual([]);
    expect(meta.hasDefaultSlot).toBe(true);
  });
});

describe('components with no default slot', () => {
  it('records hasDefaultSlot false when only named slots exist', () => {
    const meta = parseComponent(`
      /** @tag arc-confirm */
      export class ArcConfirm extends LitElement {
        render() { return html\`<div class="box"><slot name="actions"></slot></div>\`; }
      }
    `, '/src/application/confirm.js', prefix);
    expect(meta.hasDefaultSlot).toBe(false);
  });

  it('records hasDefaultSlot false when the template projects nothing', () => {
    const meta = parseComponent(`
      /** @tag arc-confirm */
      export class ArcConfirm extends LitElement {
        render() { return html\`<div class="box"><p>fixed</p></div>\`; }
      }
    `, '/src/application/confirm.js', prefix);
    expect(meta.hasDefaultSlot).toBe(false);
  });
});

describe('dynamic slot names', () => {
  it('ignores a runtime-built slot name in the template', () => {
    const meta = parseComponent(`
      /** @tag arc-virtual-list */
      export class ArcVirtualList extends LitElement {
        render() {
          return html\`<div>\${this.rows.map((r, index) => html\`<slot name="item-\${index}"></slot>\`)}</div>\`;
        }
      }
    `, '/src/application/virtual-list.js', prefix);
    expect(meta.slots).toEqual([]);
  });

  it('ignores a @slot tag documenting a dynamic family', () => {
    // The name regex stops at the `$` and would record a phantom `item-` slot.
    const meta = parseComponent(`
      /**
       * @tag arc-virtual-list
       * @slot item-\${index} - Per-row content
       */
      export class ArcVirtualList extends LitElement {}
    `, '/src/application/virtual-list.js', prefix);
    expect(meta.slots).toEqual([]);
  });

  it('still records the static slots of the same component', () => {
    const meta = parseComponent(`
      /**
       * @tag arc-virtual-list
       * @slot empty - Shown when there are no rows
       * @slot item-\${index} - Per-row content
       */
      export class ArcVirtualList extends LitElement {
        render() { return html\`<div><slot name="empty"></slot><slot name="item-\${this.i}"></slot></div>\`; }
      }
    `, '/src/application/virtual-list.js', prefix);
    expect(meta.slots).toEqual(['empty']);
  });
});

describe('slotsInMarkup separates seen from documented', () => {
  it('records a JSDoc-only slot in slots but not in slotsInMarkup', () => {
    const meta = parseComponent(`
      /**
       * @tag arc-shell
       * @slot header - Documented, rendered by a base class
       */
      export class ArcShell extends LitElement {}
    `, '/src/application/shell.js', prefix);
    expect(meta.slots).toEqual(['header']);
    expect(meta.slotsInMarkup).toEqual([]);
  });

  it('records both when the slot is real markup', () => {
    const meta = parseComponent(`
      /** @tag arc-shell */
      export class ArcShell extends LitElement {
        render() { return html\`<div><slot name="header"></slot></div>\`; }
      }
    `, '/src/application/shell.js', prefix);
    expect(meta.slotsInMarkup).toEqual(['header']);
  });
});
