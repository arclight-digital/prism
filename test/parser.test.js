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
});
