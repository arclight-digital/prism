import { describe, it, expect } from 'vitest';
import { shadowToLight } from '../src/css-transform.js';

const tag = 'arc-button';

describe('shadowToLight', () => {
  it(':host → .tag', () => {
    const result = shadowToLight(':host { display: block; }', tag);
    expect(result).toContain('.arc-button { display: block; }');
  });

  it(':host([attr="val"]) → .tag[data-attr="val"]', () => {
    const result = shadowToLight(':host([variant="primary"]) { color: red; }', tag);
    expect(result).toContain('.arc-button[data-variant="primary"]');
  });

  it(':host([attr]) boolean → .tag[attr]', () => {
    const result = shadowToLight(':host([disabled]) { opacity: 0.5; }', tag);
    expect(result).toContain('.arc-button[disabled]');
  });

  it(':host(:hover) → .tag:hover', () => {
    const result = shadowToLight(':host(:hover) { color: blue; }', tag);
    expect(result).toContain('.arc-button:hover');
  });

  it(':host(::before) → .tag::before', () => {
    const result = shadowToLight(':host(::before) { content: ""; }', tag);
    expect(result).toContain('.arc-button::before');
  });

  it(':host(:not([attr="val"])) → .tag:not([data-attr="val"])', () => {
    const result = shadowToLight(
      ':host(:not([variant="primary"])) { border: 1px solid; }',
      tag,
    );
    expect(result).toContain('.arc-button:not([data-variant="primary"])');
  });

  it(':host with compound :not() chain → valid selector (no dropped rule)', () => {
    const result = shadowToLight(
      ':host(:not([href]):not([interactive])) .card:hover { transform: none; }',
      'arc-card',
    );
    expect(result).toContain('.arc-card:not([data-href]):not([data-interactive]) .card:hover');
    // Regression: previously emitted invalid `.arc-card(:not(...))`
    expect(result).not.toContain('.arc-card(');
  });

  it(':host with mixed attr + pseudo compound', () => {
    const result = shadowToLight(
      ':host([variant="pills"]:hover) { color: red; }',
      tag,
    );
    expect(result).toContain('.arc-button[data-variant="pills"]:hover');
  });

  it('scopes inner selectors: .btn → .tag .btn', () => {
    const result = shadowToLight('.btn { border: none; }', tag);
    expect(result).toContain('.arc-button .btn');
  });

  it('preserves already-scoped selectors', () => {
    const input = '.arc-button .inner { color: red; }';
    const result = shadowToLight(input, tag);
    // Should not double-scope
    expect(result).not.toContain('.arc-button .arc-button');
  });

  it('scopes EVERY selector in a comma-separated list', () => {
    // Regression: only the first selector used to be scoped, leaking `.label`.
    const result = shadowToLight('.icon, .label { display: flex; }', tag);
    expect(result).toContain('.arc-button .icon');
    expect(result).toContain('.arc-button .label');
  });

  it('scopes bare element selectors, not just classes', () => {
    // Regression: `svg`/`a:hover` used to leak site-wide because scoping only
    // matched selectors beginning with `.`.
    const result = shadowToLight('svg { fill: currentColor; }', tag);
    expect(result).toContain('.arc-button svg');
  });

  it('scopes multiple rules on a single line', () => {
    const result = shadowToLight('.a { color: red; } .b { color: blue; }', tag);
    expect(result).toContain('.arc-button .a');
    expect(result).toContain('.arc-button .b');
  });

  it('does not scope @keyframes step selectors', () => {
    const input = '@keyframes spin { 0% { opacity: 0; } 100% { opacity: 1; } }';
    const result = shadowToLight(input, tag);
    expect(result).toContain('0% {');
    expect(result).toContain('100% {');
    expect(result).not.toContain('.arc-button 0%');
    expect(result).not.toContain('.arc-button 100%');
  });

  it('scopes rules nested inside @media', () => {
    const input = '@media (min-width: 600px) { .btn { padding: 1rem; } }';
    const result = shadowToLight(input, tag);
    expect(result).toContain('@media (min-width: 600px)');
    expect(result).toContain('.arc-button .btn');
  });

  it('treats a same-prefixed class as a distinct, still-scopable selector', () => {
    // `.arc-button-icon` shares the tag as a string prefix but is a different
    // class token, so it must still be scoped.
    const result = shadowToLight('.arc-button-icon { width: 1em; }', tag);
    expect(result).toContain('.arc-button .arc-button-icon');
  });

  it('maps ::slotted(SEL) to a scoped descendant instead of dropping it', () => {
    // Regression: ::slotted() is inert in light DOM, so passing it through
    // verbatim silently lost the slotted content styles.
    const result = shadowToLight('::slotted(h1) { font-size: 2rem; }', 'arc-page-header');
    expect(result).toContain('.arc-page-header h1');
    expect(result).not.toContain('::slotted');
  });

  it('maps :host(...) ::slotted(SEL) with the host qualifier preserved', () => {
    const result = shadowToLight(
      ':host([variant="hero"]) ::slotted(h1) { font-size: 3rem; }',
      'arc-page-header',
    );
    expect(result).toContain('.arc-page-header[data-variant="hero"] h1');
    expect(result).not.toContain('::slotted');
  });

  it('preserves pseudo-classes trailing a ::slotted() selector', () => {
    const result = shadowToLight('::slotted(p):first-child { margin-top: 0; }', 'arc-page-header');
    expect(result).toContain('.arc-page-header p:first-child');
  });

  it('maps slot[name="x"]::slotted(*) to a scoped [slot="x"] attribute selector', () => {
    // Real page-header pattern: named-slot projected content carries slot="x"
    // in light DOM, so the selector must target that, not the (gone) slot element.
    const result = shadowToLight(
      `.page-header__heading,\nslot[name="heading"]::slotted(*) { font-weight: 700; }`,
      'arc-page-header',
    );
    expect(result).toContain('.arc-page-header .page-header__heading');
    expect(result).toContain('.arc-page-header [slot="heading"]');
    expect(result).not.toContain('::slotted');
    expect(result).not.toContain('slot[name');
  });

  it('maps slot[name="x"]::slotted(SEL) keeping the element selector', () => {
    const result = shadowToLight(
      `slot[name="heading"]::slotted(h1) { font-size: 2rem; }`,
      'arc-page-header',
    );
    expect(result).toContain('.arc-page-header h1[slot="heading"]');
  });

  it('does not glue a standalone comment onto the next selector', () => {
    // Regression: a comment before a :host([attr]) variant rule was prefixed
    // with `.tag ` and fused into the (already-scoped) selector, producing the
    // dead `.tag .tag[data-…]`.
    const result = shadowToLight(
      '.card { color: red; }\n/* Variants */\n:host([variant="primary"]) { background: blue; }',
      tag,
    );
    expect(result).toContain('/* Variants */');
    expect(result).toContain('.arc-button[data-variant="primary"]');
    expect(result).not.toContain('.arc-button .arc-button');
  });

  it('handles a comment containing braces without miscounting rules', () => {
    const result = shadowToLight('/* a { b } c */\n.btn { color: red; }', tag);
    expect(result).toContain('.arc-button .btn');
  });

  it('transforms :host() attributes written with single quotes', () => {
    const result = shadowToLight(":host([layout='centered']) { display: grid; }", 'arc-page-layout');
    expect(result).toContain('.arc-page-layout[data-layout="centered"]');
    expect(result).not.toContain("([layout='centered'])");
  });

  it('scopes every selector in a comma list (all combinators)', () => {
    const result = shadowToLight('.a:hover .x, .b:focus .x { color: red; }', tag);
    expect(result).toContain('.arc-button .a:hover .x');
    expect(result).toContain('.arc-button .b:focus .x');
  });

  it('transforms :host(.class) into a compound .tag.class selector', () => {
    const result = shadowToLight(':host(.dismissed) { display: none; }', 'arc-callout');
    expect(result).toContain('.arc-callout.dismissed');
    expect(result).not.toContain('.arc-callout(');
  });
});
