/**
 * Shared shadow DOM → light DOM CSS transformation logic.
 * Used by both css-gen.js and html-gen.js.
 */

/**
 * Convert shadow DOM CSS to light DOM CSS.
 *
 * Handles :host() selectors with attributes, pseudo-classes, pseudo-elements,
 * :not() negations, and scopes unqualified inner selectors under the component class.
 *
 * @param {string} css - raw shadow DOM CSS
 * @param {string} tag - component tag name (e.g. 'arc-button')
 * @returns {string}
 */
export function shadowToLight(css, tag) {
  let result = css;

  // --- ::slotted(<compound>) → light-DOM equivalent ---
  // ::slotted styles content projected into a slot. Once the shadow boundary is
  // gone that pseudo-element matches nothing, so passing it through verbatim
  // silently drops the styles. Projected nodes are light-DOM children of the
  // host (named slots carry a matching `slot="X"` attribute), so rewrite to the
  // flattened selector and let the scoping pass below re-home it under `.tag`.
  // Runs first so a preceding `:host(...)` compound is still handled below.
  //
  //   slot[name="x"]::slotted(SEL) → SEL[slot="x"]   (or [slot="x"] for `*`)
  //   slot::slotted(SEL)           → SEL
  //   .btn-slot::slotted(SEL)      → SEL
  //   ::slotted(SEL)               → SEL
  result = rewriteSlotted(result);

  // --- :host(<compound>) with multiple parts, e.g. :host(:not([href]):not([interactive])) ---
  // Must come first: the single-part rules below can't match multi-part compounds,
  // which would otherwise fall through to the bare :host rule and emit invalid CSS
  // like `.tag(:not([href]))` that browsers drop entirely.
  result = result.replace(
    /:host\(((?::not\(\[[^\]]+\]\)|\[[^\]]+\]|::?[a-z][\w-]*(?:\([^()]*\))?){2,})\)/g,
    (_m, inner) => {
      const transformed = inner
        .replace(/:not\(\[([\w-]+)=["']([^"']+)["']\]\)/g, ':not([data-$1="$2"])')
        .replace(/:not\(\[([\w-]+)\]\)/g, ':not([data-$1])')
        .replace(/\[([\w-]+)=["']([^"']+)["']\]/g, '[data-$1="$2"]');
      return `.${tag}${transformed}`;
    }
  );

  // --- :host(:not(...)) variants (must come before general :host(...) rules) ---

  // :host(:not([prop="value"])) → .tag:not([data-prop="value"])
  result = result.replace(
    /:host\(:not\(\[([\w-]+)=["']([^"']+)["']\]\)\)/g,
    `.${tag}:not([data-$1="$2"])`
  );

  // :host(:not([prop])) → .tag:not([data-prop])
  result = result.replace(
    /:host\(:not\(\[([\w-]+)\]\)\)/g,
    `.${tag}:not([data-$1])`
  );

  // --- :host([attr]...) with combined pseudo-class/pseudo-element ---

  // :host([attr="value"]::pseudo-element) → .tag[data-attr="value"]::pseudo-element
  result = result.replace(
    /:host\(\[([\w-]+)=["']([^"']+)["']\](::?[a-z][\w-]*)\)/g,
    `.${tag}[data-$1="$2"]$3`
  );

  // :host([attr]::pseudo-element) → .tag[attr]::pseudo-element
  result = result.replace(
    /:host\(\[([\w-]+)\](::?[a-z][\w-]*)\)/g,
    `.${tag}[$1]$2`
  );

  // --- :host([attr]) basic variants ---

  // :host([prop="value"]) → .tag[data-prop="value"]
  result = result.replace(
    /:host\(\[([\w-]+)=["']([^"']+)["']\]\)/g,
    `.${tag}[data-$1="$2"]`
  );

  // :host([attr]) (boolean) → .tag[attr]
  result = result.replace(
    /:host\(\[([\w-]+)\]\)/g,
    `.${tag}[$1]`
  );

  // --- :host(pseudo) ---

  // :host(::pseudo-element) → .tag::pseudo-element
  // :host(:pseudo-class) → .tag:pseudo-class
  result = result.replace(
    /:host\((::?[a-z][\w-]*)\)/g,
    `.${tag}$1`
  );

  // --- :host(.class) ---

  // :host(.state) → .tag.state (compound, no descendant space). Without this a
  // host class selector falls through to the bare rule and emits `.tag(.state)`.
  result = result.replace(
    /:host\((\.[\w.-]+)\)/g,
    `.${tag}$1`
  );

  // --- bare :host ---

  // :host { → .tag {
  result = result.replace(/:host\b/g, `.${tag}`);

  // --- Scope inner selectors ---
  // Every style rule's selector list is prefixed with `.tag ` unless it already
  // starts with `.tag`. This walks the CSS brace-by-brace so it can:
  //   - scope *every* selector in a comma list (`.a, .b` → `.tag .a, .tag .b`),
  //   - scope bare element/id/attribute selectors (`svg`, `#x`, `a:hover`), not
  //     just `.class` selectors,
  //   - handle multiple rules on one line, and
  //   - skip @keyframes step selectors (`0%`, `from`) and at-rule preludes.
  result = scopeSelectors(result, tag);

  return result;
}

/** Escape a string for safe use inside a RegExp. */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Trailing compound selector that `::slotted()` hangs off — the slot's own
 * selector. Anchored at the end of the preceding text so it consumes whole
 * tokens: `.btn-slot` is eaten as one class, never sliced into `.btn-` + `slot`.
 */
const SLOT_COMPOUND_RE = /(?:[.#]?[\w-]+|\[[^\]]*\])*$/;

/** `[name="x"]` / `[name=x]` inside a slot compound. */
const SLOT_NAME_RE = /\[name=(['"]?)([^'"\]]+)\1\]/;

/**
 * Rewrite every `::slotted(...)` to its flattened light-DOM form.
 *
 * `::slotted()` is only valid attached to a `<slot>`, so whatever compound
 * precedes it *is* the slot's selector by construction — `slot`, `slot[name=x]`
 * or a class the component put on its slot (`.btn-slot`). The slot element
 * itself has no light-DOM counterpart, so that compound is dropped and only the
 * projected-node selector survives; a named slot re-attaches as `[slot="x"]`.
 *
 * Scans rather than pattern-matches the argument so one level of nesting
 * (`::slotted(:not(:first-child))`) doesn't terminate at the inner `)`, and
 * steps over `/* … *\/` spans so prose that merely *mentions* a selector is
 * copied through instead of being rewritten into nonsense.
 */
function rewriteSlotted(css) {
  const TOKEN = '::slotted(';
  let out = '';
  let i = 0; // start of the run not yet copied to `out`
  let at = 0; // scan cursor

  while (at < css.length) {
    if (css[at] === '/' && css[at + 1] === '*') {
      const end = css.indexOf('*/', at + 2);
      at = end === -1 ? css.length : end + 2;
      continue;
    }
    if (!css.startsWith(TOKEN, at)) {
      at++;
      continue;
    }

    // Find the matching `)` for the argument list.
    let depth = 1;
    let j = at + TOKEN.length;
    for (; j < css.length && depth > 0; j++) {
      if (css[j] === '(') depth++;
      else if (css[j] === ')') depth--;
    }
    // Unbalanced — bail out and pass the remainder through untouched rather
    // than emitting a mangled selector.
    if (depth !== 0) break;

    const sel = css.slice(at + TOKEN.length, j - 1).trim();
    const before = css.slice(i, at);
    const compound = before.match(SLOT_COMPOUND_RE)[0];

    const named = compound.match(SLOT_NAME_RE);
    let replacement;
    if (named) {
      const slotName = named[2];
      replacement = !sel || sel === '*' ? `[slot="${slotName}"]` : `${sel}[slot="${slotName}"]`;
    } else {
      replacement = sel || '*';
    }

    out += before.slice(0, before.length - compound.length) + replacement;
    i = j;
    at = j;
  }

  return out + css.slice(i);
}

/**
 * Prefix every style-rule selector in `css` with `.tag `, leaving selectors that
 * are already scoped, at-rule preludes, and @keyframes steps untouched.
 */
function scopeSelectors(css, tag) {
  // Matches a selector already anchored on the component class, as a whole token
  // (so `.arc-button-icon` is treated as a distinct, still-scopable class).
  const scopedRe = new RegExp('^\\.' + escapeRegExp(tag) + '(?![\\w-])');

  let out = '';
  let buf = '';
  // Stack of enclosing at-rule names (null = a plain style-rule block). Used to
  // detect when a `{` opens keyframe steps rather than selectors.
  const context = [];

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') {
      // Copy comments through verbatim without letting any braces inside them be
      // counted as rule boundaries.
      const end = css.indexOf('*/', i + 2);
      const stop = end === -1 ? css.length : end + 2;
      buf += css.slice(i, stop);
      i = stop - 1;
      continue;
    }
    if (ch === '{') {
      const prelude = buf;
      const trimmed = prelude.trim();
      if (trimmed.startsWith('@')) {
        const name = trimmed.slice(1).split(/[\s(]/)[0].toLowerCase();
        context.push(name);
        out += prelude + '{';
      } else {
        const parent = context[context.length - 1];
        const inKeyframes = parent === 'keyframes' || parent === '-webkit-keyframes';
        out += (inKeyframes ? prelude : scopeSelectorList(prelude, tag, scopedRe)) + '{';
        context.push(null);
      }
      buf = '';
    } else if (ch === '}') {
      out += buf + '}';
      buf = '';
      context.pop();
    } else {
      buf += ch;
    }
  }
  return out + buf;
}

/** Scope each comma-separated selector in a rule's prelude. */
function scopeSelectorList(prelude, tag, scopedRe) {
  return splitTopLevel(prelude, ',')
    .map((part) => {
      // Separate leading whitespace AND standalone comments from the actual
      // selector. Without this, a comment sitting between rules glues onto the
      // next selector and gets `.tag ` prefixed — and when that selector is
      // itself already `.tag`-anchored (every :host([attr]) variant), the result
      // is `.tag .tag[data-…]`, which requires a nested component and matches
      // nothing (dead CSS).
      const lead = part.match(/^(?:\s|\/\*[\s\S]*?\*\/)*/)[0];
      let sel = part.slice(lead.length);
      const trail = sel.match(/\s*$/)[0];
      sel = sel.slice(0, sel.length - trail.length);
      if (!sel || scopedRe.test(sel)) return part;
      return `${lead}.${tag} ${sel}${trail}`;
    })
    .join(',');
}

/** Split on a delimiter, ignoring delimiters inside (), [], quotes, or comments. */
function splitTopLevel(str, delim) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    // Skip comments wholesale — prose commas/parens inside a `/* … */` block
    // must not affect depth or trigger a split (a comment can even fall between
    // two comma-separated selectors).
    if (ch === '/' && str[i + 1] === '*') {
      const end = str.indexOf('*/', i + 2);
      const stop = end === -1 ? str.length : end + 2;
      cur += str.slice(i, stop);
      i = stop - 1;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === delim && depth === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts;
}
