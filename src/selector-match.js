/**
 * Match CSS selectors against a static example's markup.
 *
 * The inline HTML variant writes each element's styles into its `style`
 * attribute, which is only right for a rule that applies to that element as the
 * example renders it: no state, no variant, every ancestor in place. A rule that
 * depends on something the markup can't settle (a pseudo-class, a
 * pseudo-element, a sibling) is left for the browser instead, in the example's
 * `<style>` block.
 *
 * So a selector is one of three things here:
 *   - `static`: types, classes, ids, and `:not()` over those and attributes,
 *     joined by descendant or child combinators. Matched here, exactly.
 *   - `variant`: static, but asks for an attribute the element carries only
 *     when a prop is set (`.tag[data-variant="error"] .x`). The example sets
 *     none, so it never applies.
 *   - `dynamic`: anything else. The browser decides.
 */

/** A parsed element: what a selector can ask about it. */
export function elementOf(tag, attrs) {
  const classes = new Set((attrs.get('class') ?? '').split(/\s+/).filter(Boolean));
  return { tag: tag.toLowerCase(), classes, attrs };
}

/** Split a selector list at its top-level commas. */
export function splitSelectorList(selector) {
  const parts = [];
  let depth = 0;
  let bracket = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === '[') bracket++;
    else if (ch === ']') bracket--;
    else if (ch === ',' && depth === 0 && bracket === 0) {
      parts.push(selector.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(selector.slice(start).trim());
  return parts.filter(Boolean);
}

const IDENT = /^-?[_a-zA-Z][\w-]*/;
const ATTR = /^\[\s*([\w-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([\w-]+))\s*)?\]/;

/**
 * Parse one compound selector starting at `i`. Returns the compound and where it
 * ended, or `{ dynamic: true }` for anything this matcher does not decide.
 */
function parseCompound(sel, i, { inNot = false } = {}) {
  const compound = { type: null, classes: [], ids: [], attrs: [], nots: [] };
  const start = i;
  while (i < sel.length) {
    const rest = sel.slice(i);
    let m;
    if (rest[0] === '*') {
      i++;
    } else if ((m = IDENT.exec(rest)) && i === start) {
      compound.type = m[0].toLowerCase();
      i += m[0].length;
    } else if (rest[0] === '.' && (m = IDENT.exec(rest.slice(1)))) {
      compound.classes.push(m[0]);
      i += 1 + m[0].length;
    } else if (rest[0] === '#' && (m = IDENT.exec(rest.slice(1)))) {
      compound.ids.push(m[0]);
      i += 1 + m[0].length;
    } else if (rest[0] === '[') {
      m = ATTR.exec(rest);
      if (!m) return { dynamic: true }; // ~=, ^=, i flags and the rest
      compound.attrs.push({ name: m[1].toLowerCase(), value: m[2] ?? m[3] ?? m[4] });
      i += m[0].length;
    } else if (rest.startsWith(':not(') && !inNot) {
      let depth = 1;
      let j = i + 5;
      for (; j < sel.length && depth > 0; j++) {
        if (sel[j] === '(') depth++;
        else if (sel[j] === ')') depth--;
      }
      if (depth > 0) return { dynamic: true };
      const inner = [];
      for (const part of splitSelectorList(sel.slice(i + 5, j - 1))) {
        const parsed = parseCompound(part, 0, { inNot: true });
        if (parsed.dynamic || parsed.end !== part.length) return { dynamic: true };
        inner.push(parsed.compound);
      }
      compound.nots.push(inner);
      i = j;
    } else {
      break;
    }
  }
  if (i === start) return { dynamic: true };
  return { compound, end: i };
}

/**
 * Parse a complex selector (no commas) into compounds and the combinators
 * between them, rightmost last.
 *
 * @returns {{ kind: 'dynamic' } | { kind: 'static'|'variant', compounds: object[], combinators: string[] }}
 */
export function parseSelector(selector) {
  const sel = selector.trim();
  const compounds = [];
  const combinators = [];
  let i = 0;
  while (i < sel.length) {
    const parsed = parseCompound(sel, i);
    if (parsed.dynamic) return { kind: 'dynamic' };
    compounds.push(parsed.compound);
    i = parsed.end;
    const ws = /^\s*/.exec(sel.slice(i))[0];
    i += ws.length;
    if (i >= sel.length) break;
    if (sel[i] === '>') {
      combinators.push('>');
      i += 1 + /^\s*/.exec(sel.slice(i + 1))[0].length;
    } else if (ws) {
      combinators.push(' ');
    } else {
      return { kind: 'dynamic' }; // `+`, `~`, `:hover`, `::before`, …
    }
  }
  if (compounds.length === 0 || combinators.length !== compounds.length - 1) return { kind: 'dynamic' };
  const variant = compounds.some((c) => c.attrs.length > 0);
  return { kind: variant ? 'variant' : 'static', compounds, combinators };
}

function matchesCompound(compound, el) {
  if (compound.type && compound.type !== el.tag) return false;
  for (const c of compound.classes) if (!el.classes.has(c)) return false;
  for (const id of compound.ids) if (el.attrs.get('id') !== id) return false;
  for (const { name, value } of compound.attrs) {
    if (!el.attrs.has(name)) return false;
    if (value !== undefined && el.attrs.get(name) !== value) return false;
  }
  for (const inner of compound.nots) {
    if (inner.some((c) => matchesCompound(c, el))) return false;
  }
  return true;
}

/**
 * Whether a parsed static selector matches `el`, whose ancestors are
 * `ancestors`, nearest last.
 */
export function matchesSelector(parsed, el, ancestors) {
  const { compounds, combinators } = parsed;
  const walk = (ci, node, depth) => {
    if (!matchesCompound(compounds[ci], node)) return false;
    if (ci === 0) return true;
    if (combinators[ci - 1] === '>') {
      return depth > 0 && walk(ci - 1, ancestors[depth - 1], depth - 1);
    }
    for (let d = depth - 1; d >= 0; d--) {
      if (walk(ci - 1, ancestors[d], d)) return true;
    }
    return false;
  };
  return walk(compounds.length - 1, el, ancestors.length);
}

/** Specificity as [ids, classes/attributes/pseudo-classes, types]. */
export function specificity(parsed) {
  const s = [0, 0, 0];
  const add = (c) => {
    s[0] += c.ids.length;
    s[1] += c.classes.length + c.attrs.length;
    if (c.type) s[2]++;
    // :not() counts as its most specific argument.
    for (const inner of c.nots) {
      const best = inner
        .map((x) => { const t = [0, 0, 0]; t[0] = x.ids.length; t[1] = x.classes.length + x.attrs.length; t[2] = x.type ? 1 : 0; return t; })
        .sort(compareSpecificity)
        .pop();
      if (best) { s[0] += best[0]; s[1] += best[1]; s[2] += best[2]; }
    }
  };
  parsed.compounds.forEach(add);
  return s;
}

export function compareSpecificity(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}
