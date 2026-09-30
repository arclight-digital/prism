/**
 * Loads design tokens and resolves CSS custom property references.
 */

import { readFileSync } from 'node:fs';

/**
 * CSS-wide keywords. As a custom property's value they are not a value but an
 * instruction to the cascade — `--space-md: inherit` means "take the parent's"
 * — so there is nothing to substitute, and inside calc() they are invalid.
 */
const CSS_WIDE_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);

const isCSSWideKeyword = (value) => CSS_WIDE_KEYWORDS.has(value.trim().toLowerCase());

/**
 * Build a flat map of --token-name → value from tokens.css.
 *
 * Only declarations that hold on every page are tokens: those in a `:root` (or
 * `html`) rule that no condition encloses — an `@layer` may, since a layer
 * orders rules rather than gating them. A base stylesheet also re-declares its
 * tokens under density presets, theme selectors, `@media` overrides and
 * passthrough rules like `arc-button { --space-md: inherit }`; reading those
 * as well, last one winning, turned `calc(-1 * var(--space-md))` into
 * `calc(-1 * inherit)`, which a browser drops.
 *
 * @param {string} cssPath - absolute path to tokens.css
 * @returns {Map<string, string>}
 */
export function loadTokenMap(cssPath) {
  return readUnconditionalProperties(readFileSync(cssPath, 'utf-8'), /^(?::root|html)$/i);
}

/**
 * The custom properties a component's unconditional `:host` rules declare.
 *
 * A component can set a private property on its own host (`--_status-rgb`) and
 * read it further down its stylesheet. That value is the component's, not a
 * token, so it is in no base stylesheet; it is only in the component's styles,
 * which may come from a module the component imports. `:host([variant=…])`
 * and other conditional rules are left out, the same as for tokens: the
 * unconditional rule is the value an element with no attributes set has.
 *
 * @param {string} css - a component's shadow CSS, `:host` selectors intact
 * @returns {Map<string, string>}
 */
export function readHostProperties(css) {
  return readUnconditionalProperties(css, /^:host$/i);
}

/**
 * What a page gives every element on it by inheritance: the inherited
 * properties its unconditional `html` and `body` rules set, `body` winning as
 * the nearer ancestor.
 *
 * A component that sets no font or color of its own takes the page's, so in a
 * standalone example, with no page around it, it falls back to the browser's
 * serif and black. Only inherited properties are read: a `body` background or
 * `min-height` belongs to the page, not to anything placed on it.
 *
 * @param {string} css - a stylesheet with the page's `html`/`body` rules
 * @returns {Map<string, string>} property → value, `var()`s unresolved
 */
export function readPageDefaults(css) {
  const html = readUnconditionalProperties(css, /^html$/i, { custom: false });
  const body = readUnconditionalProperties(css, /^body$/i, { custom: false });
  const defaults = new Map();
  for (const [name, value] of [...html, ...body]) {
    if (INHERITED.has(name)) defaults.set(name, value);
  }
  return defaults;
}

/** Inherited properties a page's `html`/`body` rules commonly set. */
const INHERITED = new Set([
  'color', 'font', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'font-stretch',
  'font-feature-settings', 'font-variation-settings', 'font-kerning', 'font-optical-sizing', 'line-height',
  'letter-spacing', 'word-spacing', 'text-align', 'text-transform', 'text-indent', 'text-rendering',
  'text-shadow', 'text-wrap', 'white-space', 'direction', 'hyphens', 'tab-size', 'quotes', 'color-scheme',
  'accent-color', 'caret-color', 'cursor', '-webkit-font-smoothing', '-moz-osx-font-smoothing',
]);

/**
 * Properties declared in rules whose selector list includes one that
 * `selector` matches, with no enclosing condition but `@layer`. Later
 * declarations win, as in the cascade; CSS-wide keywords are never a value.
 * Only custom properties unless `custom` is false.
 */
function readUnconditionalProperties(css, selector, { custom = true } = {}) {
  const map = new Map();

  const inScope = (preludes) =>
    preludes.length > 0 &&
    preludes[preludes.length - 1].split(',').some((s) => selector.test(s.trim())) &&
    preludes.slice(0, -1).every((prelude) => /^@layer\b/i.test(prelude));

  const preludes = [];
  let buffer = '';
  let parens = 0;

  const declare = () => {
    const match = (custom ? /^(--[\w-]+)\s*:([\s\S]*)$/ : /^(-{0,2}[\w-]+)\s*:([\s\S]*)$/).exec(buffer.trim());
    buffer = '';
    if (!match || !inScope(preludes)) return;
    const value = match[2].replace(/!important\s*$/i, '').trim().replace(/\s+/g, ' ');
    if (value && !isCSSWideKeyword(value)) map.set(match[1], value);
  };

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 1;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== ch) j += css[j] === '\\' ? 2 : 1;
      buffer += css.slice(i, j + 1);
      i = j;
    } else if (ch === '(') {
      parens++;
      buffer += ch;
    } else if (ch === ')') {
      parens = Math.max(0, parens - 1);
      buffer += ch;
    } else if (ch === ';' && parens === 0) {
      declare();
    } else if (ch === '{') {
      preludes.push(buffer.trim());
      buffer = '';
    } else if (ch === '}') {
      declare();
      preludes.pop();
    } else {
      buffer += ch;
    }
  }

  return map;
}

/**
 * Resolve all var(--token) references in a CSS string using the token map.
 * Handles nested var() and fallback values.
 * @param {string} css
 * @param {Map<string, string>} tokenMap
 * @returns {string}
 */
export function resolveTokens(css, tokenMap) {
  // Resolve each var() reference recursively, tracking the chain of tokens
  // already visited *on the current branch* so that a genuine circular
  // reference stops but an ordinary token reused elsewhere in the string still
  // resolves. `chain` must be per-branch, never shared across sibling matches.
  //
  // A var() is found by balancing parentheses, not by a pattern: a fallback is
  // itself a value, and commonly holds another var() or a function —
  // `var(--hook, var(--space-xs))`, `var(--x, rgba(var(--rgb), 0))`. A pattern
  // that ends the fallback at the first `)` split those in the middle, leaving
  // the inner var() unresolved or rewriting it into a different value.
  function resolveVar(name, fallback, full, chain) {
    if (chain.has(name)) {
      // Circular reference — stop resolving this token
      return fallback !== undefined ? resolveValue(fallback, chain) : full;
    }
    // A map built by hand can still hold a CSS-wide keyword; substituting it
    // would put `inherit` where a length belongs, so treat it as unresolved.
    if (tokenMap.has(name) && !isCSSWideKeyword(tokenMap.get(name))) {
      return resolveValue(tokenMap.get(name), new Set(chain).add(name));
    }
    if (fallback !== undefined) {
      return resolveValue(fallback, chain);
    }
    return full; // Leave unresolved
  }

  function resolveValue(value, chain) {
    let out = '';
    let i = 0;
    for (;;) {
      const at = value.indexOf('var(', i);
      if (at === -1) return out + value.slice(i);
      // `var(` inside a longer identifier (`--my-var(`) is not a var() call.
      if (at > 0 && /[\w-]/.test(value[at - 1])) {
        out += value.slice(i, at + 4);
        i = at + 4;
        continue;
      }
      let depth = 1;
      let comma = -1;
      let j = at + 4;
      for (; j < value.length && depth > 0; j++) {
        const ch = value[j];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === ',' && depth === 1 && comma === -1) comma = j;
      }
      if (depth > 0) return out + value.slice(i); // Unbalanced — leave the rest as is
      const close = j - 1;
      const full = value.slice(at, close + 1);
      const name = value.slice(at + 4, comma === -1 ? close : comma).trim();
      out += value.slice(i, at);
      if (/^--[\w-]+$/.test(name)) {
        const fallback = comma === -1 ? undefined : value.slice(comma + 1, close).trim();
        out += resolveVar(name, fallback, full, chain);
      } else {
        out += full;
      }
      i = close + 1;
    }
  }

  return resolveValue(css, new Set());
}
