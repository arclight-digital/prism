/**
 * Loads design tokens and resolves CSS custom property references.
 */

import { readFileSync } from 'node:fs';

/**
 * Build a flat map of --token-name → value from tokens.css.
 * @param {string} cssPath - absolute path to tokens.css
 * @returns {Map<string, string>}
 */
export function loadTokenMap(cssPath) {
  const css = readFileSync(cssPath, 'utf-8');
  const map = new Map();

  // Match --prop-name: value; (including multi-line values)
  const propPattern = /(--[\w-]+)\s*:\s*((?:[^;]|(?=\n\s+\S))+);/g;
  let match;
  while ((match = propPattern.exec(css)) !== null) {
    const name = match[1];
    const value = match[2].trim().replace(/\s+/g, ' ');
    map.set(name, value);
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
      if (tokenMap.has(name)) {
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
