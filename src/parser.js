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
 * @property {string[]} values - detected enum values (from CSS :host patterns)
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
 * @property {'static'|'hybrid'|'interactive'} interactivity - how much JS the component needs
 * @property {string} hostDisplay - CSS display value from :host (e.g. 'block', 'inline-flex')
 */

// A valid custom-element tag name: lowercase, at least one hyphen, no other
// characters. This is deliberately strict — the tag flows unescaped into
// generated code, file paths, and dynamically-built RegExps, so anything
// outside this grammar is a code-injection / path-traversal / ReDoS vector.
const VALID_TAG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;

// A valid custom event name for the same reasons (used as an object key and
// string literal in generated wrappers). Custom events are conventionally
// lowercase/kebab-case; we allow word characters and hyphens.
const VALID_EVENT = /^[a-z][\w-]*$/i;

/**
 * Parse a Lit component source file into ComponentMeta.
 * @param {string} source - file contents
 * @param {string} filePath - path to the file (used to extract tier)
 * @param {string} [prefix='arc'] - component tag prefix (e.g. 'arc' for arc-button)
 * @returns {ComponentMeta|null}
 */
export function parseComponent(source, filePath, prefix = 'arc') {
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
    console.warn(`prism: skipping component with invalid tag name "${tag}" in ${filePath}`);
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

  // Detect enum values from CSS :host([prop="value"]) patterns
  detectEnumValues(props, css);

  // Parse template from render()
  const template = extractTemplate(source);

  // Parse custom events from dispatchEvent calls
  const events = extractEvents(source);

  // Detect interactivity level
  const interactivity = detectInteractivity(source, events);

  // Extract host display value from :host { display: ... }
  const hostDisplay = extractHostDisplay(css);

  return { tag, className, pascalName, tier, props, css, template, events, interactivity, hostDisplay };
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
 */
function detectEnumValues(props, css) {
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

  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const spaces = line.match(/^(\s*)/)[1].length;
    if (spaces < minIndent) minIndent = spaces;
  }
  if (!isFinite(minIndent)) minIndent = 0;

  const dedented = lines.map((line) => {
    if (line.trim().length === 0) return '';
    return line.slice(minIndent);
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

/**
 * Extract template HTML from render() method.
 * Handles patterns like:
 *   const inner = html`<div>...</div>`;
 *   return html`<wrapper>${inner}</wrapper>`;
 * by inlining the variable template into the final return template.
 */
function extractTemplate(source) {
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

  // Collect variable assignments: const/let/var name = html`...`
  const varTemplates = new Map();
  const varPattern = /(?:const|let|var)\s+(\w+)\s*=\s*html`/g;
  let varMatch;
  while ((varMatch = varPattern.exec(body)) !== null) {
    const backtickIdx = varMatch.index + varMatch[0].length - 1;
    const { content } = extractTemplateLiteral(body, backtickIdx);
    varTemplates.set(varMatch[1], content);
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

  // Inline variable templates: replace ${varName} with the variable's dedented html content
  for (const [name, content] of varTemplates) {
    const dedented = dedentTemplate(content);
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
 * Layer 1: explicit comment overrides (checked first)
 * Layer 2: auto-detection (fallback, only distinguishes static vs interactive)
 *
 * @param {string} source - file contents
 * @param {string[]} events - custom event names already extracted
 * @returns {'static'|'hybrid'|'interactive'}
 */
function detectInteractivity(source, events) {
  // Layer 1: Manual overrides via JSDoc tag on class (checked first)
  //   /** @arc-prism interactive */
  //   /** @arc-prism hybrid — display works without JS; copy requires JS */
  if (/@arc-prism\s+interactive\b/.test(source)) return 'interactive';
  if (/@arc-prism\s+hybrid\b/.test(source)) return 'hybrid';
  if (/@arc-prism\s+static\b/.test(source)) return 'static';

  // Layer 2: Auto-detection (binary — hybrid requires manual override)
  // Has event bindings in template
  if (/@(?:click|input|change|keydown|keyup|submit|focus|blur)\s*=/.test(source)) return 'interactive';
  // Dispatches custom events
  if (events.length > 0) return 'interactive';
  // Imperative DOM manipulation
  if (/this\.shadowRoot\.querySelector/.test(source)) return 'interactive';
  // Data container: :host { display: none } — child-only component for interactive parent
  if (/:host\s*\{[^}]*display:\s*none/.test(source)) return 'interactive';

  return 'static';
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
 * Extract custom event names from dispatchEvent(new CustomEvent('...')) calls.
 */
function extractEvents(source) {
  const events = new Set();
  const eventPattern = /dispatchEvent\(\s*new\s+CustomEvent\(\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = eventPattern.exec(source)) !== null) {
    const name = match[1];
    // Drop event names that aren't valid identifiers — they would otherwise be
    // interpolated unescaped (including as an unquoted object key) into the
    // generated wrappers, allowing code injection from an untrusted source.
    if (VALID_EVENT.test(name)) {
      events.add(name);
    } else {
      console.warn(`prism: ignoring event with invalid name "${name}"`);
    }
  }
  return [...events];
}
