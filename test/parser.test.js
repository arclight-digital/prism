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
