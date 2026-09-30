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
  const css = readFileSync(cssPath, 'utf-8');
  const map = new Map();

  const isRootSelector = (prelude) =>
    prelude.split(',').some((selector) => /^(?::root|html)$/i.test(selector.trim()));
  const inTokenScope = (preludes) =>
    preludes.length > 0 &&
    isRootSelector(preludes[preludes.length - 1]) &&
    preludes.slice(0, -1).every((prelude) => /^@layer\b/i.test(prelude));

  const preludes = [];
  let buffer = '';
  let parens = 0;

  const declare = () => {
    const match = /^(--[\w-]+)\s*:([\s\S]*)$/.exec(buffer.trim());
    buffer = '';
    if (!match || !inTokenScope(preludes)) return;
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
  // A fresh RegExp is created per call: `String.replace` with a global regex
  // mutates `lastIndex`, so reusing one instance across the recursive calls
  // inside the callback would corrupt the outer iteration.
  function resolveValue(value, chain) {
    const pattern = /var\((--[\w-]+)(?:\s*,\s*([^)]*))?\)/g;
    return value.replace(pattern, (full, name, fallback) => {
      if (chain.has(name)) {
        // Circular reference — stop resolving this token
        return fallback !== undefined ? resolveValue(fallback.trim(), chain) : full;
      }
      // A map built by hand can still hold a CSS-wide keyword; substituting it
      // would put `inherit` where a length belongs, so treat it as unresolved.
      if (tokenMap.has(name) && !isCSSWideKeyword(tokenMap.get(name))) {
        return resolveValue(tokenMap.get(name), new Set(chain).add(name));
      }
      if (fallback !== undefined) {
        return resolveValue(fallback.trim(), chain);
      }
      return full; // Leave unresolved
    });
  }

  return resolveValue(css, new Set());
}
