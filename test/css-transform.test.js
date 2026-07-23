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
});
