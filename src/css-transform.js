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
  //   ::slotted(SEL)               → SEL
  result = result.replace(
    /slot\[name=(['"])([^'"]+)\1\]::slotted\(\s*([^)]+?)\s*\)/g,
    (_m, _q, slotName, sel) =>
      sel.trim() === '*' ? `[slot="${slotName}"]` : `${sel.trim()}[slot="${slotName}"]`
  );
  result = result.replace(/slot::slotted\(\s*([^)]+?)\s*\)/g, '$1');
  result = result.replace(/::slotted\(\s*([^)]+?)\s*\)/g, '$1');

  // --- :host(<compound>) with multiple parts, e.g. :host(:not([href]):not([interactive])) ---
  // Must come first: the single-part rules below can't match multi-part compounds,
  // which would otherwise fall through to the bare :host rule and emit invalid CSS
  // like `.tag(:not([href]))` that browsers drop entirely.
  result = result.replace(
    /:host\(((?::not\(\[[^\]]+\]\)|\[[^\]]+\]|::?[a-z][\w-]*(?:\([^()]*\))?){2,})\)/g,
    (_m, inner) => {
      const transformed = inner
        .replace(/:not\(\[([\w-]+)="([^"]+)"\]\)/g, ':not([data-$1="$2"])')
        .replace(/:not\(\[([\w-]+)\]\)/g, ':not([data-$1])')
        .replace(/\[([\w-]+)="([^"]+)"\]/g, '[data-$1="$2"]');
      return `.${tag}${transformed}`;
    }
  );

  // --- :host(:not(...)) variants (must come before general :host(...) rules) ---

  // :host(:not([prop="value"])) → .tag:not([data-prop="value"])
  result = result.replace(
    /:host\(:not\(\[([\w-]+)="([^"]+)"\]\)\)/g,
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
    /:host\(\[([\w-]+)="([^"]+)"\](::?[a-z][\w-]*)\)/g,
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
    /:host\(\[([\w-]+)="([^"]+)"\]\)/g,
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
      const lead = part.match(/^\s*/)[0];
      const trail = part.match(/\s*$/)[0];
      const sel = part.trim();
      if (!sel || scopedRe.test(sel)) return part;
      return `${lead}.${tag} ${sel}${trail}`;
    })
    .join(',');
}

/** Split on a delimiter, ignoring delimiters inside (), [], or quotes. */
function splitTopLevel(str, delim) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (const ch of str) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
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
