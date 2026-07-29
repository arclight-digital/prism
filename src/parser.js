/**
 * Parses a Lit web component source file and extracts component metadata.
 * Uses regex-based parsing — no AST library needed.
 */

/**
 * @typedef {Object} PropMeta
 * @property {string} name
 * @property {string} type - String, Boolean, Number, Array, Object
 * @property {string} default - default value as source string
 * @property {boolean} reflect
 * @property {string[]} values - enum values, from the `@prop` JSDoc union if one
 *   is documented, otherwise inferred from CSS `:host([prop="value"])` patterns
 */

/**
 * @typedef {Object} ComponentMeta
 * @property {string} tag - e.g. 'arc-button'
 * @property {string} className - e.g. 'ArcButton'
 * @property {string} pascalName - e.g. 'Button' (without Arc prefix)
 * @property {string} tier - e.g. 'reactive', 'content'
 * @property {PropMeta[]} props
 * @property {string} css - raw CSS string from static styles
 * @property {string} template - raw HTML string from render()
 * @property {string[]} events - custom event names
 * @property {Record<string, string[]>} eventDetails - event name → keys of its `detail` object
 * @property {'static'|'hybrid'|'interactive'} interactivity - how much JS the component needs
 * @property {string} hostDisplay - CSS display value from :host (e.g. 'block', 'inline-flex')
 */

// A valid custom-element tag name: lowercase, at least one hyphen, no other
// characters. This is deliberately strict — the tag flows unescaped into
// generated code, file paths, and dynamically-built RegExps, so anything
// outside this grammar is a code-injection / path-traversal / ReDoS vector.
export const VALID_TAG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;

// A valid custom event name for the same reasons (used as an object key and
// string literal in generated wrappers). Custom events are conventionally
// lowercase/kebab-case; we allow word characters and hyphens.
const VALID_EVENT = /^[a-z][\w-]*$/i;

// A detail key is stricter still: it is emitted as a bare identifier on the
// left of an assignment in the generated wrappers, so it must be a plain JS
// identifier. No `$` — that is a rune sigil in Svelte and would collide.
const VALID_DETAIL_KEY = /^[a-z_][\w]*$/i;

/**
 * @typedef {Object} Diagnostic
 * @property {string} code - machine-readable kind, e.g. 'doc-drift'
 * @property {string} message - one-line human-readable form
 * @property {string} [file] - source file the diagnostic came from
 * @property {string} [tag] - component tag, where one is known
 */

/**
 * Build the parser's warning sink.
 *
 * With a collector the caller owns presentation — nothing is printed, because
 * the CLI aggregates these into one end-of-run block and uses them to decide
 * the exit code. Without one, warnings print as before, so a library consumer
 * calling parseComponent directly still sees them.
 */
function makeWarn(diagnostics, filePath) {
  return (code, message, extra = {}) => {
    if (diagnostics) diagnostics.push({ code, message, file: filePath, ...extra });
    else console.warn(`prism: ${message}`);
  };
}

/**
 * Parse a Lit component source file into ComponentMeta.
 * @param {string} source - file contents
 * @param {string} filePath - path to the file (used to extract tier)
 * @param {string} [prefix='arc'] - component tag prefix (e.g. 'arc' for arc-button)
 * @param {Record<string, string>} [overrides={}] - config.interactivity, tag → level
 * @param {Diagnostic[]} [diagnostics] - collector; suppresses console output
 * @returns {ComponentMeta|null}
 */
export function parseComponent(source, filePath, prefix = 'arc', overrides = {}, diagnostics = null) {
  const warn = makeWarn(diagnostics, filePath);
  // Extract tag name from @tag JSDoc, falling back to customElements.define
  const tagDocMatch = source.match(/@tag\s+([a-z][\w-]*)/);
  const defineMatch = source.match(/customElements\.define\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)\s*\)/);
  const tag = tagDocMatch?.[1] ?? defineMatch?.[1];
  const classMatch = source.match(/export\s+class\s+(\w+)\s+extends/);
  const className = classMatch?.[1] ?? defineMatch?.[2];

  if (!tag || !className) return null;

  // Reject anything whose tag isn't a syntactically valid custom-element name.
  // The @tag JSDoc path is already constrained by its regex, but the
  // customElements.define fallback captures any non-quote character, so an
  // untrusted component source could otherwise smuggle injection payloads
  // through `tag`.
  if (!VALID_TAG.test(tag)) {
    warn('invalid-tag', `skipping component with invalid tag name "${tag}" in ${filePath}`);
    return null;
  }

  // Derive PascalName by stripping the prefix (e.g. Arc → Button)
  const pascalPrefix = prefix.charAt(0).toUpperCase() + prefix.slice(1);
  const pascalName = className.replace(new RegExp('^' + pascalPrefix), '');

  // Extract tier from file path (supports both / and \ separators)
  const normalizedPath = filePath.replace(/\\/g, '/');
  const tierMatch = normalizedPath.match(/\/(?:src\/)?(\w+)\/[^/]+$/);
  const tier = tierMatch ? tierMatch[1] : 'unknown';

  // Parse static properties block
  const props = parseProperties(source);

  // Parse constructor defaults
  applyDefaults(props, source);

  // Parse CSS from static styles
  const css = extractCSS(source);

  // Read documented unions first — they are authored intent, and the CSS pass
  // below is only a fallback for props with no `@prop` union to go on.
  applyDocTypes(props, source);
  detectEnumValues(props, css, tag, warn);

  // Parse template from render(). Defaults are needed to pick the branch of a
  // conditionally-built element, so this must run after applyDefaults above.
  const propDefaults = Object.fromEntries(props.map((p) => [p.name, p.default]));
  const template = extractTemplate(source, propDefaults);

  // Parse custom events from dispatchEvent calls
  const { events, eventDetails } = extractEvents(source, warn, tag);

  // Detect interactivity level
  const classification = classify(source, events, tag, overrides);
  const interactivity = classification.level;

  // Extract host display value from :host { display: ... }
  const hostDisplay = extractHostDisplay(css);

  return {
    tag, className, pascalName, tier, props, css, template, events, eventDetails,
    interactivity, classification, hostDisplay,
  };
}

/**
 * Given the index just past an opening `{`, return the substring up to the
 * matching close brace (exclusive), accounting for nesting.
 */
function extractBalanced(source, startIdx) {
  let depth = 1;
  let i = startIdx;
  while (i < source.length && depth > 0) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    i++;
  }
  return source.slice(startIdx, i - 1);
}

/**
 * Parse Lit property declarations. Supports all three common styles:
 *   - `static properties = { ... }` (class field)
 *   - `static get properties() { return { ... }; }` (legacy getter)
 *   - `@property({ type: String }) name;` (decorators)
 */
function parseProperties(source) {
  const props = [];

  // Class-field or legacy-getter object literal.
  const fieldMatch = source.match(/static\s+properties\s*=\s*\{/);
  const getterMatch = source.match(/static\s+get\s+properties\s*\(\s*\)\s*\{\s*return\s*\{/);
  const objStart = fieldMatch ?? getterMatch;
  if (objStart) {
    const block = extractBalanced(source, objStart.index + objStart[0].length);
    parsePropertyBlock(block, props);
  }

  // Decorator style (coexists with the above; skips names already found).
  parseDecoratorProps(source, props);

  return props;
}

/** Parse the `{ name: { type, reflect } }` object body into prop entries. */
function parsePropertyBlock(block, props) {
  const seen = new Set(props.map((p) => p.name));
  // Match each property: name: { type: Type, reflect: true } (or shorthand).
  const propPattern = /(\w+)\s*:\s*\{([^}]*)\}/g;
  let match;
  while ((match = propPattern.exec(block)) !== null) {
    const name = match[1];
    const config = match[2];
    if (seen.has(name)) continue;

    // Internal reactive state ({ state: true }) is not public API — never
    // expose it in generated wrapper props/types.
    if (/state\s*:\s*true/.test(config)) continue;

    props.push(makeProp(name, config));
    seen.add(name);
  }
}

/** Parse `@property(...)` decorators into prop entries. */
function parseDecoratorProps(source, props) {
  const seen = new Set(props.map((p) => p.name));
  // @property({ ... }) [accessor] name  — `@state()` decorators are internal
  // and intentionally not matched here.
  const decoratorPattern = /@property\(\s*(\{[^}]*\})?\s*\)\s*(?:accessor\s+)?(\w+)/g;
  let match;
  while ((match = decoratorPattern.exec(source)) !== null) {
    const config = match[1] ?? '';
    const name = match[2];
    if (seen.has(name)) continue;
    if (/state\s*:\s*true/.test(config)) continue;

    props.push(makeProp(name, config));
    seen.add(name);
  }
}

/** Build a prop entry from a name and its `{ type, reflect }` config text. */
function makeProp(name, config) {
  const typeMatch = config.match(/type\s*:\s*(\w+)/);
  const reflectMatch = config.match(/reflect\s*:\s*(true|false)/);
  return {
    name,
    type: typeMatch ? typeMatch[1] : 'String',
    default: '',
    reflect: reflectMatch ? reflectMatch[1] === 'true' : false,
    values: [],
  };
}

/**
 * Apply default values from constructor `this.prop = value` assignments.
 */
function applyDefaults(props, source) {
  const ctorMatch = source.match(/constructor\s*\(\s*\)\s*\{/);
  if (!ctorMatch) return;

  // Brace-balance to the true end of the constructor so default assignments
  // that follow a nested block (if/for/try) aren't truncated.
  const body = extractBalanced(source, ctorMatch.index + ctorMatch[0].length);
  for (const prop of props) {
    const defaultMatch = body.match(
      new RegExp(`this\\.${prop.name}\\s*=\\s*([^;]+)`)
    );
    if (defaultMatch) {
      prop.default = defaultMatch[1].trim();
    }
  }
}

/**
 * Read documented string-literal unions from the class JSDoc.
 *
 * Authored intent beats CSS inference on both counts it gets wrong: the default
 * member usually carries no `:host([x="…"])` rule to be inferred from — it is
 * the unqualified base style — and a variant driven from JS leaves no CSS
 * attribute selector at all, so the union comes back empty and the prop
 * collapses to a bare `string` in every wrapper.
 *
 * @param {PropMeta[]} props
 * @param {string} source
 */
function applyDocTypes(props, source) {
  const byName = new Map(props.map((p) => [p.name, p]));
  for (const m of source.matchAll(/@prop\s+\{([^}]+)\}\s+(\w+)/g)) {
    const [, typeText, name] = m;
    const prop = byName.get(name);
    if (!prop) continue;
    // Only literal unions — leave `{string}`, `{number}` etc. to the type map.
    if (!/^\s*'[^']*'(\s*\|\s*'[^']*')*\s*$/.test(typeText)) continue;
    prop.values = [...new Set([...typeText.matchAll(/'([^']*)'/g)].map((v) => v[1]))];
  }
}

/**
 * Extract CSS from `css\`...\`` template literals in static styles.
 */
function extractCSS(source) {
  const cssBlocks = [];
  // Match css`...` template literals (handle nested backticks carefully)
  const cssPattern = /css`([\s\S]*?)`/g;
  let match;
  while ((match = cssPattern.exec(source)) !== null) {
    cssBlocks.push(match[1]);
  }
  return cssBlocks.join('\n');
}

/**
 * Detect enum values from CSS :host([prop="value"]) patterns.
 *
 * A fallback for props with no documented union — see applyDocTypes. Where both
 * sources exist the documented one wins, but the CSS is still read so the two
 * can be compared: a styled value the docs don't list is genuine drift, and
 * this is the only pass positioned to see both.
 *
 * @param {PropMeta[]} props
 * @param {string} css
 * @param {string} [tag] - component tag, for drift warnings
 * @param {(code: string, message: string, extra?: object) => void} warn
 */
function detectEnumValues(props, css, tag, warn) {
  for (const prop of props) {
    if (prop.type !== 'String') continue;

    const values = new Set();
    // Match :host([propName="value"]) patterns (single or double quotes)
    const enumPattern = new RegExp(
      `:host\\(\\[${prop.name}=["']([^"']+)["']\\]\\)`,
      'g'
    );
    let match;
    while ((match = enumPattern.exec(css)) !== null) {
      values.add(match[1]);
    }

    if (prop.values.length > 0) {
      const documented = new Set(prop.values);
      const undocumented = [...values].filter((v) => !documented.has(v));
      if (undocumented.length > 0) {
        warn(
          'doc-drift',
          `${tag ?? 'component'} styles ${prop.name} value(s) ` +
          `${undocumented.map((v) => `"${v}"`).join(', ')} that its documented union omits`,
          { tag, prop: prop.name, values: undocumented }
        );
      }
      continue;   // documented union wins
    }

    if (values.size > 0) {
      prop.values = [...values];
    }
  }
}

/**
 * Strip the common leading whitespace from all non-empty lines in a template string,
 * and trim leading/trailing blank lines. Used when inlining variable templates so that
 * the source indentation level doesn't pollute the combined output.
 */
function dedentTemplate(str) {
  const lines = str.split('\n');

  // The first line is measured separately: when a template opens inline with
  // its backtick (html`<input\n  class="x"\n/>`) that line carries no
  // indentation, and counting it would pin the common indent at 0 and dedent
  // nothing — leaving every continuation line at its source depth.
  let minIndent = Infinity;
  for (const line of lines.slice(1)) {
    if (line.trim().length === 0) continue;
    const spaces = line.match(/^(\s*)/)[1].length;
    if (spaces < minIndent) minIndent = spaces;
  }
  if (!isFinite(minIndent)) minIndent = 0;

  const dedented = lines.map((line, idx) => {
    if (line.trim().length === 0) return '';
    return idx === 0 ? line : line.slice(minIndent);
  });

  // Trim leading/trailing blank lines
  while (dedented.length > 0 && dedented[0].trim() === '') dedented.shift();
  while (dedented.length > 0 && dedented[dedented.length - 1].trim() === '') dedented.pop();

  return dedented.join('\n');
}

/**
 * Extract the content of a template literal starting at the given backtick position.
 * Handles nested template literals (e.g. html`...${x ?? html`nested`}...`).
 * @param {string} str - the source string
 * @param {number} startIdx - index of the opening backtick
 * @returns {{ content: string, endIdx: number }} content between backticks and end position
 */
function extractTemplateLiteral(str, startIdx) {
  let i = startIdx + 1; // skip opening backtick
  let depth = 0; // depth of ${...} expressions
  let content = '';

  while (i < str.length) {
    if (str[i] === '`' && depth === 0) {
      // Closing backtick at top level — end of this template literal
      return { content, endIdx: i };
    } else if (str[i] === '$' && str[i + 1] === '{') {
      depth++;
      content += '${';
      i += 2;
    } else if (str[i] === '}' && depth > 0) {
      depth--;
      content += '}';
      i++;
    } else if (str[i] === '`' && depth > 0) {
      // Nested template literal inside an expression — skip it entirely
      const nested = extractTemplateLiteral(str, i);
      // Don't include nested template content — just skip past it
      i = nested.endIdx + 1;
    } else {
      content += str[i];
      i++;
    }
  }

  return { content, endIdx: i };
}

/** True if a prop's recorded default is truthy. Mirrors the HTML generator. */
function isDefaultTruthy(defaults, prop) {
  const d = defaults[prop];
  if (d === undefined) return false;
  return !['', 'false', '0', 'null', 'undefined', "''", '""'].includes(String(d).trim());
}

/**
 * Read a declaration's initializer: everything from `=` to the terminating `;`,
 * stepping over template literals, strings and bracket pairs so a `;` inside any
 * of them doesn't end it early.
 * @returns {{ text: string, endIdx: number }}
 */
function readInitializer(str, startIdx) {
  let i = startIdx;
  let depth = 0;
  while (i < str.length) {
    const ch = str[i];
    if (ch === '`') { i = extractTemplateLiteral(str, i).endIdx + 1; continue; }
    if (ch === "'" || ch === '"') {
      const q = ch;
      i++;
      while (i < str.length && str[i] !== q) { if (str[i] === '\\') i++; i++; }
      i++;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') { depth++; i++; continue; }
    if (ch === ')' || ch === ']' || ch === '}') { depth--; i++; continue; }
    if (ch === ';' && depth === 0) break;
    i++;
  }
  return { text: str.slice(startIdx, i), endIdx: i };
}

/** Advance past a string or template literal starting at `i`; else return null. */
function skipLiteral(expr, i) {
  const ch = expr[i];
  if (ch === '`') return extractTemplateLiteral(expr, i).endIdx + 1;
  if (ch === "'" || ch === '"') {
    let j = i + 1;
    while (j < expr.length && expr[j] !== ch) { if (expr[j] === '\\') j++; j++; }
    return j + 1;
  }
  return null;
}

/**
 * Split `cond ? A : B` into its parts, or null if `expr` isn't a ternary.
 * Both delimiters are found by scanning rather than regex so a `?` or `:` inside
 * a template, string, object literal or nested ternary doesn't split in the
 * wrong place. `?.` and `??` are not ternary operators.
 */
function splitTernary(expr) {
  const scan = (from, stopAt) => {
    let i = from;
    let depth = 0;
    while (i < expr.length) {
      const skipped = skipLiteral(expr, i);
      if (skipped !== null) { i = skipped; continue; }
      const ch = expr[i];
      if (ch === '(' || ch === '[' || ch === '{') { depth++; i++; continue; }
      if (ch === ')' || ch === ']' || ch === '}') { depth--; i++; continue; }
      if (ch === '?' && expr[i + 1] === '?') { i += 2; continue; }
      if (ch === '?' && expr[i + 1] === '.') { i += 2; continue; }
      if (ch === '?') {
        if (stopAt === '?' && depth === 0) return i;
        depth++; // a nested ternary opens a level its own `:` closes
        i++;
        continue;
      }
      if (ch === ':') {
        if (stopAt === ':' && depth === 0) return i;
        depth--;
        i++;
        continue;
      }
      i++;
    }
    return -1;
  };

  const q = scan(0, '?');
  if (q === -1) return null;
  const c = scan(q + 1, ':');
  if (c === -1) return null;
  return {
    cond: expr.slice(0, q),
    whenTrue: expr.slice(q + 1, c),
    whenFalse: expr.slice(c + 1),
  };
}

/**
 * Evaluate a ternary condition against prop defaults. Returns true/false, or
 * null when it can't be decided — which callers must treat as "emit nothing"
 * rather than guessing a branch, since inventing markup for a condition that is
 * false by default puts an element in the example that never renders.
 *
 * Resolves `this.prop`, any number of leading `!`, and local aliases such as
 * `const hasText = !!this.text` that components commonly compute first.
 */
function evalCondition(cond, defaults, locals, seen = new Set()) {
  let t = cond.trim();
  let negate = false;
  while (t.startsWith('!')) { negate = !negate; t = t.slice(1).trim(); }

  const prop = t.match(/^this\.(\w+)$/);
  if (prop) {
    const value = isDefaultTruthy(defaults, prop[1]);
    return negate ? !value : value;
  }

  const local = t.match(/^(\w+)$/);
  if (local && locals.has(local[1]) && !seen.has(local[1])) {
    seen.add(local[1]);
    const inner = evalCondition(locals.get(local[1]), defaults, locals, seen);
    if (inner === null) return null;
    return negate ? !inner : inner;
  }

  return null;
}

/** Content of the first top-level ``html`…` `` in an expression, or null. */
function firstHtmlTemplate(expr) {
  const m = expr.match(/\bhtml\s*`/);
  if (!m) return null;
  return extractTemplateLiteral(expr, m.index + m[0].length - 1).content;
}

/**
 * Resolve a declaration initializer to the markup it contributes.
 *
 * Returns the template content, `''` when the selected branch contributes no
 * markup, or null when the initializer has nothing to do with html.
 */
function resolveInitializer(init, defaults, locals) {
  const ternary = splitTernary(init);
  if (!ternary) return firstHtmlTemplate(init);

  // Nothing to contribute if the initializer has no markup at all.
  const anyHtml = firstHtmlTemplate(init);
  if (anyHtml === null) return null;

  // A branch is chosen by the condition's default, so
  // `this.multiline ? html`<textarea>` : html`<input>`` yields the input when
  // `multiline` defaults false, and `this.show ? html`…` : ''` yields nothing.
  //
  // An undecidable condition resolves to nothing at all — not an empty string.
  // Leaving the reference unresolved hands it back to the interpolation pass,
  // which already substitutes a placeholder or the component label for an
  // otherwise-empty element. Collapsing it to '' here would suppress that and
  // leave a blank element behind.
  const decided = evalCondition(ternary.cond, defaults, locals);
  if (decided === null) return null;

  const content = firstHtmlTemplate(decided ? ternary.whenTrue : ternary.whenFalse);
  return content === null ? '' : content;
}

/**
 * Extract template HTML from render() method.
 * Handles patterns like:
 *   const inner = html`<div>...</div>`;
 *   return html`<wrapper>${inner}</wrapper>`;
 * by inlining the variable template into the final return template.
 *
 * The initializer doesn't have to be a bare template — a component that builds
 * an element conditionally (`const field = this.multiline ? html`…` : html`…``)
 * is resolved against prop defaults. Without that the reference can't be
 * resolved, and the interpolation-dropping pass deletes the element outright,
 * leaving a styled wrapper with nothing inside it.
 *
 * @param {string} source - file contents
 * @param {Record<string, string>} [defaults={}] - prop name → default, for ternaries
 */
function extractTemplate(source, defaults = {}) {
  // Find `render() {` and use brace-matching to extract the full method body
  const renderStart = source.match(/render\s*\(\s*\)\s*\{/);
  if (!renderStart) return '';

  const openBraceIdx = renderStart.index + renderStart[0].length - 1;
  let depth = 1;
  let i = openBraceIdx + 1;
  // Track template literals to avoid counting braces inside them
  while (i < source.length && depth > 0) {
    if (source[i] === '`') {
      // Skip template literal (including nested ${...} expressions)
      i++;
      let exprDepth = 0;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === '$' && source[i + 1] === '{') { exprDepth++; i += 2; continue; }
        if (source[i] === '}' && exprDepth > 0) { exprDepth--; i++; continue; }
        if (source[i] === '`' && exprDepth === 0) { i++; break; }
        i++;
      }
      continue;
    }
    if (source[i] === "'" || source[i] === '"') {
      const q = source[i];
      i++;
      while (i < source.length && source[i] !== q) {
        if (source[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    i++;
  }

  const body = source.slice(openBraceIdx + 1, i - 1);

  // Collect variable assignments whose initializer produces markup. The whole
  // initializer is read rather than requiring `= html\`` directly, so a template
  // built through a conditional is still resolvable.
  const varTemplates = new Map();
  // Every declaration is recorded, not just the markup-producing ones: a
  // template's condition is often a local computed a line earlier
  // (`const hasText = !!this.text`), and resolving it needs that binding.
  const locals = new Map();
  const varPattern = /(?:const|let|var)\s+(\w+)\s*=/g;
  let varMatch;
  while ((varMatch = varPattern.exec(body)) !== null) {
    const init = readInitializer(body, varMatch.index + varMatch[0].length);
    locals.set(varMatch[1], init.text);
    const content = resolveInitializer(init.text, defaults, locals);
    if (content !== null) varTemplates.set(varMatch[1], content);
    // Resume past the initializer so its internals aren't rescanned.
    varPattern.lastIndex = init.endIdx;
  }

  // Find return html`...` — prefer the last return statement (default branch)
  const returnPattern = /return\s+html`/g;
  let returnMatch;
  const returnTemplates = [];
  while ((returnMatch = returnPattern.exec(body)) !== null) {
    const backtickIdx = returnMatch.index + returnMatch[0].length - 1;
    const { content } = extractTemplateLiteral(body, backtickIdx);
    returnTemplates.push(content);
  }

  if (returnTemplates.length === 0) {
    // No return — fall back to extracting all html`` blocks
    const htmlPattern = /html`/g;
    let match;
    const parts = [];
    while ((match = htmlPattern.exec(body)) !== null) {
      const backtickIdx = match.index + match[0].length - 1;
      const { content } = extractTemplateLiteral(body, backtickIdx);
      parts.push(content);
    }
    return parts.join('\n');
  }

  // Use the last return template (typically the non-conditional / default branch)
  let template = returnTemplates[returnTemplates.length - 1];

  // Inline variable templates: replace ${varName} with the variable's dedented
  // html content. A multi-line block is re-indented to the interpolation's own
  // column first — dedenting alone aligns the opening tag but leaves every
  // continuation line at the variable declaration's original indentation.
  for (const [name, content] of varTemplates) {
    const dedented = dedentTemplate(content);
    template = template.replace(
      new RegExp(`^([ \\t]*)\\$\\{${name}\\}`, 'gm'),
      (_m, indent) => indent + dedented.split('\n').join('\n' + indent)
    );
    template = template.replace(new RegExp(`\\$\\{${name}\\}`, 'g'), dedented);
  }

  return template;
}

/**
 * Detect a component's interactivity level.
 * Three tiers:
 *   - 'static'      — pure display, no JS needed
 *   - 'hybrid'      — visual works without JS, but JS adds features (e.g. copy button)
 *   - 'interactive'  — needs JS to function at all
 *
 * Layer 0: config.interactivity overrides (checked first)
 * Layer 1: explicit comment overrides
 * Layer 2: auto-detection (fallback, only distinguishes static vs interactive)
 *
 * Returns the level alongside *why* it was reached. The provenance matters
 * downstream: an auto-detected `interactive` is a guess that may be wrong,
 * whereas a config- or JSDoc-sourced one is a decision someone made, and
 * reporting must never second-guess the latter.
 *
 * @param {string} source - file contents
 * @param {string[]} events - custom event names already extracted
 * @param {string} [tag] - component tag, for config lookup
 * @param {Record<string, string>} [overrides={}] - config.interactivity, tag → level
 * @returns {{ level: 'static'|'hybrid'|'interactive', origin: 'config'|'jsdoc'|'auto', signals: object }}
 */
function classify(source, events, tag, overrides = {}) {
  // The raw evidence, gathered regardless of which layer decides. Kept on the
  // meta so a later pass can ask "how interactive is this really?" without
  // re-reading the file.
  const handlerRe = /@(click|input|change|keydown|keyup|submit|focus(?:in|out)?|blur)\s*=/g;
  const matches = [...source.matchAll(handlerRe)];
  const signals = {
    handlers: [...new Set(matches.map((m) => m[1]))],
    handlerCount: matches.length,
    events: events.length,
    imperativeDOM: /this\.shadowRoot\.querySelector/.test(source),
    hostDisplayNone: /:host\s*\{[^}]*display:\s*none/.test(source),
  };

  // Layer 0: config overrides. Durable — unlike the JSDoc tag below, this can't
  // be clobbered by a pass that rewrites component doc comments, which has
  // silently dropped classification twice. normalizeConfig has already checked
  // the value, so anything present here is a valid level.
  if (overrides[tag]) return { level: overrides[tag], origin: 'config', signals };

  // Layer 1: Manual overrides via JSDoc tag on class (retained for
  // back-compat; prefer config.interactivity)
  //   /** @arc-prism interactive */
  //   /** @arc-prism hybrid — display works without JS; copy requires JS */
  const jsdoc = source.match(/@arc-prism\s+(interactive|hybrid|static)\b/);
  if (jsdoc) return { level: jsdoc[1], origin: 'jsdoc', signals };

  // Layer 2: Auto-detection (binary — hybrid requires manual override).
  // `focus`/`blur` carry optional `in`/`out` suffixes — without them `@focusin=`
  // slips through (the `\s*=` can't span the `in`), so a component whose only
  // handler is `@focusin` reads as static and ships CSS for behaviour it can't
  // perform without JS.
  const auto = (level) => ({ level, origin: 'auto', signals });
  if (signals.handlerCount > 0) return auto('interactive');
  // Dispatches custom events
  if (signals.events > 0) return auto('interactive');
  // Imperative DOM manipulation
  if (signals.imperativeDOM) return auto('interactive');
  // Data container: :host { display: none } — child-only component for interactive parent
  if (signals.hostDisplayNone) return auto('interactive');

  return auto('static');
}

/**
 * Extract the display value from the :host { display: ... } rule.
 * Returns 'block' as default if not found.
 */
function extractHostDisplay(css) {
  // Match `:host {` that is NOT followed by `(` (i.e. plain :host, not :host([...]))
  const hostBlockPattern = /:host\s*\{([^}]*)\}/g;
  let match;
  while ((match = hostBlockPattern.exec(css)) !== null) {
    // Make sure this is plain :host, not :host([variant="..."]) etc
    const afterHost = css.slice(match.index + 5, match.index + 6);
    if (afterHost === '(') continue;

    const block = match[1];
    const displayMatch = block.match(/display\s*:\s*([^;]+)/);
    if (displayMatch) {
      return displayMatch[1].trim();
    }
  }
  return 'block';
}

/**
 * Extract custom event names — and the keys of each event's `detail` payload —
 * from dispatchEvent(new CustomEvent('...', { detail: { ... } })) calls.
 *
 * The detail keys are what let wrappers derive two-way bindings: an event whose
 * detail carries a key matching a declared prop is that prop's write-back path.
 *
 * @param {string} source
 * @param {(code: string, message: string, extra?: object) => void} warn
 * @param {string} [tag]
 * @returns {{ events: string[], eventDetails: Record<string, string[]> }}
 */
function extractEvents(source, warn, tag) {
  const events = new Set();
  const eventDetails = {};
  const eventPattern = /dispatchEvent\(\s*new\s+CustomEvent\(\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = eventPattern.exec(source)) !== null) {
    const name = match[1];
    // Drop event names that aren't valid identifiers — they would otherwise be
    // interpolated unescaped (including as an unquoted object key) into the
    // generated wrappers, allowing code injection from an untrusted source.
    if (!VALID_EVENT.test(name)) {
      warn('invalid-event', `ignoring event with invalid name "${name}"`, { tag });
      continue;
    }
    events.add(name);

    // A component may dispatch the same event from several code paths with
    // different payloads (a clear button sending `{ value: '' }`, the input
    // handler sending `{ value, valid }`); union the keys across all of them.
    const keys = extractDetailKeys(source, eventPattern.lastIndex, warn, tag);
    if (keys.length === 0) continue;
    const seen = eventDetails[name] ?? (eventDetails[name] = []);
    for (const key of keys) {
      if (!seen.includes(key)) seen.push(key);
    }
  }
  return { events: [...events], eventDetails };
}

/**
 * Given the index just past a CustomEvent's name literal, return the top-level
 * keys of its `detail` object literal.
 *
 * The search is bounded to this call's own options object rather than scanning
 * forward for the next `detail:` — otherwise an event dispatched without a
 * payload would inherit the keys of whichever event happens to follow it.
 *
 * @param {string} source
 * @param {number} afterName - index just past the closing quote of the name
 * @param {(code: string, message: string, extra?: object) => void} warn
 * @param {string} [tag]
 * @returns {string[]}
 */
function extractDetailKeys(source, afterName, warn, tag) {
  let i = afterName;
  while (i < source.length && /\s/.test(source[i])) i++;
  if (source[i] !== ',') return [];   // `new CustomEvent('x')` — no options
  i++;
  while (i < source.length && /\s/.test(source[i])) i++;
  if (source[i] !== '{') return [];   // options passed as a variable

  const options = extractBalanced(source, i + 1);
  const detail = options.match(/(?:^|[,{[(\s])detail\s*:\s*\{/);
  if (!detail) return [];             // no detail, or detail is a variable

  const body = extractBalanced(options, detail.index + detail[0].length);
  return extractObjectKeys(body).filter((key) => {
    if (VALID_DETAIL_KEY.test(key)) return true;
    warn('invalid-detail-key', `ignoring detail key with invalid name "${key}"`, { tag });
    return false;
  });
}

/**
 * Collect the top-level keys of an object-literal body (braces already
 * stripped). Handles `key: value`, shorthand `key`, and skips over nested
 * objects, strings, template literals, comments and spreads — anything whose
 * name isn't statically known can't become a binding anyway.
 */
function extractObjectKeys(body) {
  const keys = [];
  let depth = 0;
  let atEntryStart = true;
  let i = 0;

  while (i < body.length) {
    const ch = body[i];

    // Comments — a `//` line comment may contain a comma that would otherwise
    // read as an entry separator.
    if (ch === '/' && body[i + 1] === '/') {
      const nl = body.indexOf('\n', i);
      i = nl === -1 ? body.length : nl + 1;
      continue;
    }
    if (ch === '/' && body[i + 1] === '*') {
      const end = body.indexOf('*/', i + 2);
      i = end === -1 ? body.length : end + 2;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(body, i);
      atEntryStart = false;
      continue;
    }
    if (ch === '{' || ch === '[' || ch === '(') { depth++; atEntryStart = false; i++; continue; }
    if (ch === '}' || ch === ']' || ch === ')') { depth--; atEntryStart = false; i++; continue; }
    if (ch === ',' && depth === 0) { atEntryStart = true; i++; continue; }
    if (/\s/.test(ch)) { i++; continue; }

    if (atEntryStart && depth === 0) {
      const entry = /^([A-Za-z_$][\w$]*)\s*(?::|,|$)/.exec(body.slice(i));
      if (entry) keys.push(entry[1]);
      atEntryStart = false;
    }
    i++;
  }

  return keys;
}

/**
 * Given the index of an opening quote or backtick, return the index just past
 * the matching close. Template literals may nest `${ ... }` containing further
 * strings, so those are followed recursively.
 */
function skipString(source, start) {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === quote) return i + 1;
    if (quote === '`' && ch === '$' && source[i + 1] === '{') {
      let depth = 1;
      i += 2;
      while (i < source.length && depth > 0) {
        const c = source[i];
        if (c === '"' || c === "'" || c === '`') { i = skipString(source, i); continue; }
        if (c === '{') depth++;
        else if (c === '}') depth--;
        i++;
      }
      continue;
    }
    i++;
  }
  return i;
}
