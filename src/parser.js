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
 *   plus the prop's own default
 * @property {string} docType - verbatim TS type from a non-union `@prop` JSDoc
 *   tag, e.g. `Array<{label: string}>`; empty when nothing usable was documented
 * @property {string|null} attribute - the attribute this property is reflected
 *   from, which is Lit's own lowercasing of the name unless `attribute:` says
 *   otherwise, and null for `attribute: false`
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
 * @property {Record<string, Record<string, string>>} eventWrites - event name →
 *   detail key → the prop that key carries the new value of, for payloads whose
 *   key doesn't name the prop itself (`arc-sidebar-toggle`'s `detail.value`
 *   announcing `sidebarOpen`). Read from the dispatch site, not from a table of
 *   names
 * @property {string[]} methods - public instance methods, in declaration order:
 *   what a consumer calls on the element, and so what makes a wrapper owe them a
 *   handle on it
 * @property {string[]} slots - named slots the component exposes, in template order
 * @property {string[]} slotsInMarkup - the subset seen as real `<slot name>` tags,
 *   as opposed to known only from a `@slot` JSDoc tag
 * @property {boolean} hasDefaultSlot - whether it also has an unnamed <slot>
 * @property {boolean} noDefaultSlot - whether the author declared `@slot none`,
 *   asserting the component has no default slot and takes no children
 * @property {'static'|'hybrid'|'interactive'} interactivity - how much JS the component needs
 * @property {string} hostDisplay - CSS display value from :host (e.g. 'block', 'inline-flex')
 * @property {boolean} formAssociated - whether the element participates in forms
 *   (`static formAssociated = true`), which is the platform's own definition of
 *   a form control and what decides which wrappers get a ControlValueAccessor
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
 * Build the parser's warning sink. With a collector the caller owns
 * presentation (the CLI aggregates into one end-of-run block); without one,
 * warnings print, so a library consumer calling parseComponent still sees them.
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
 * @param {{
 *   propsFrom?: (source: string, filePath: string) => PropMeta[]|undefined,
 *   formAssociated?: (source: string, filePath: string) => boolean|undefined,
 *   runtime?: { classes: Map<string, { props: PropMeta[], formAssociated: boolean, methods: string[] }> },
 * }} [opts] - `runtime` is this file's entry from `resolveRuntimeProps`, when
 *   `config.runtime` is on and the module imported
 * @returns {ComponentMeta|null}
 */
export function parseComponent(source, filePath, prefix = 'arc', overrides = {}, diagnostics = null, opts = {}) {
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

  // Resolve declared properties (config.propsFrom first, then the built-in
  // reader). Names the reader saw but couldn't type are collected so the
  // JSDoc cross-check below doesn't report the same prop a second time.
  // What the class itself says, when `config.runtime` is on and the module
  // imported. Keyed by export name, so this asks for the class the source names
  // rather than guessing which export is the component.
  const runtime = opts.runtime?.classes?.get(className) ?? null;

  const unparsed = new Set();
  const { props, fromHook } = resolveProps(
    source, filePath, opts.propsFrom, warn, tag, unparsed, runtime
  );

  // Parse constructor defaults
  applyDefaults(props, source);

  // Parse CSS from static styles
  const css = extractCSS(source);

  // Read documented unions first — they are authored intent, and the CSS pass
  // below is only a fallback for props with no `@prop` union to go on.
  const undeclared = applyDocTypes(props, source, warn, tag, unparsed);
  reportUndeclaredDocProps(undeclared, props, fromHook, warn, tag, filePath, runtime);
  detectEnumValues(props, css, tag, warn);

  // Parse template from render(). Defaults are needed to pick the branch of a
  // conditionally-built element, so this must run after applyDefaults above.
  const propDefaults = Object.fromEntries(props.map((p) => [p.name, p.default]));
  const template = extractTemplate(source, propDefaults);

  // Where each of the class's members begins and ends — what says whether an
  // assignment is a default or a write-back, and what the public methods are.
  const klass = scanClassMembers(source, className);

  // Parse custom events from dispatchEvent calls
  const { events, eventDetails, eventWrites } = extractEvents(source, warn, tag, props, klass);

  // The imperative API. A component that has one needs its element reachable
  // from every wrapper, or every capability behind these is unreachable in the
  // frameworks that hand back their own component object instead.
  //
  // The class outranks the file for the same reason it does for props: a method
  // contributed by a mixin is in no file this reader is ever handed, and
  // `checkValidity()` on 26 form controls is exactly that shape.
  const methods = runtime?.methods ?? publicMethods(klass);

  // Detect interactivity level
  const classification = classify(source, events, tag, overrides);
  const interactivity = classification.level;

  // Extract host display value from :host { display: ... }
  const hostDisplay = extractHostDisplay(css);

  // Named slots. Nothing recorded these before, so every wrapper projected a
  // single anonymous child list and named-slot content had nowhere to go.
  const { slots, slotsInMarkup, hasDefaultSlot, noDefaultSlot } = extractSlots(template, source);

  const formAssociated = resolveFormAssociated(
    source, filePath, opts.formAssociated, warn, tag, runtime
  );

  return {
    tag, className, pascalName, tier, props, css, template, events, eventDetails,
    eventWrites, methods,
    slots, slotsInMarkup, hasDefaultSlot, noDefaultSlot, interactivity, classification, hostDisplay,
    formAssociated,
  };
}

/** `static formAssociated = true`, in either of the two ways it can be written. */
const FORM_ASSOCIATED =
  /static\s+formAssociated\s*=\s*true|static\s+get\s+formAssociated\s*\(\s*\)\s*\{\s*return\s+true/;

/**
 * Whether the element participates in forms.
 *
 * `static formAssociated = true` is the platform's own definition of a form
 * control, so no configuration decides which components get a
 * ControlValueAccessor — anything softer ("emits a change event") sweeps in
 * tabs and toggles. The hook exists for libraries that contribute the static
 * from a mixin, in a file prism was never handed; returning undefined falls
 * through, so a hook only answers for the files it knows. `config.runtime`
 * reads the static off the class directly and removes the need for the hook,
 * though a configured hook still wins — explicit configuration is a decision.
 */
function resolveFormAssociated(source, filePath, hook, warn, tag, runtime) {
  if (typeof hook === 'function') {
    let answered;
    try {
      answered = hook(source, filePath);
    } catch (err) {
      // Same contract as propsFrom: a throwing hook loses its answer, not the
      // run. Falling back to prism's own reader is the conservative direction —
      // it can only decline to emit an accessor, never invent one.
      warn(
        'invalid-form-associated',
        `config.formAssociated threw on ${filePath}: ${err.message} — falling back to prism's own reader.`,
        { tag }
      );
      answered = undefined;
    }
    if (answered !== undefined) {
      if (typeof answered !== 'boolean') {
        warn(
          'invalid-form-associated',
          `config.formAssociated returned ${typeof answered} for ${filePath} — expected true, false, or undefined to fall through to prism's own reader. Ignoring it.`,
          { tag }
        );
      } else {
        return answered;
      }
    }
  }
  if (runtime) return runtime.formAssociated;
  return FORM_ASSOCIATED.test(source);
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

/** Property names prism can emit into a wrapper. */
const VALID_PROP_NAME = /^[A-Za-z_$][\w$]*$/;

/** The `type` values Lit's property map uses, and prism knows how to render. */
const KNOWN_PROP_TYPES = new Set(['String', 'Boolean', 'Number', 'Array', 'Object']);

/**
 * Resolve a component's property declarations.
 *
 * `config.propsFrom` gets first refusal: a repo whose declarations are built by
 * helpers (`selected: int({ min: 0 })`) answers for its own vocabulary rather
 * than prism re-implementing it. Returning undefined falls through to the
 * built-in reader, so a hook only handles the files it knows about.
 */
function resolveProps(source, filePath, propsFrom, warn, tag, unparsed, runtime) {
  if (typeof propsFrom === 'function') {
    let returned;
    try {
      returned = propsFrom(source, filePath);
    } catch (err) {
      // A throwing hook must not take the run down with it: the built-in
      // reader is still a usable answer, and the fallback is reported.
      warn(
        'invalid-props-from',
        `config.propsFrom threw on ${filePath}: ${err.message} — falling back to prism's own reader.`,
        { tag }
      );
      returned = undefined;
    }
    if (returned !== undefined && returned !== null) {
      const resolved = normalizeHookProps(returned, filePath, warn, tag);
      // `fromHook` travels with the props: what a hook *didn't* return can't be
      // validated, and knowing it answered is what enables the cross-checks.
      if (resolved) {
        // The hook stays authoritative — explicit configuration — but where the
        // class was also read, it is checked against it: a hook reading one
        // file cannot see what a mixin contributed, and reports a complete
        // answer anyway.
        reportHookOmissions(resolved, runtime, warn, tag, filePath);
        return { props: resolved, fromHook: true };
      }
    }
  }

  // The class beats the file: the source reader pattern-matches declarations it
  // hopes it recognises, `elementProperties` is the flattened truth, mixins and
  // base classes included. This also retires `unparsed-prop-declaration` — a
  // declaration the reader couldn't parse is on the class either way.
  //
  // The copy is load-bearing, not tidy. The runtime map is resolved once per
  // run and read by every parse of this file, and the props are written to all
  // the way down this function (defaults, unions, inherited facts). Handing out
  // the cached objects would let one parse's conclusions leak into the next —
  // an ancestor's default surviving into a component that never had one.
  if (runtime) {
    return { props: runtime.props.map((p) => ({ ...p, values: [...p.values] })), fromHook: false };
  }

  return { props: parseProperties(source, warn, tag, unparsed), fromHook: false };
}

/**
 * Props the class has that the hook did not return — the under-reporting
 * failure seen with certainty instead of inference. The JSDoc cross-check can
 * only compare against what someone remembered to document; this compares
 * against the property map Lit built from the class, where a mixin-contributed
 * prop the hook never saw is an ordinary entry.
 */
function reportHookOmissions(resolved, runtime, warn, tag, filePath) {
  if (!runtime) return;
  const returned = new Set(resolved.map((p) => p.name));
  const missing = runtime.props.map((p) => p.name).filter((name) => !returned.has(name));
  if (missing.length === 0) return;

  warn(
    'props-from-under-reports',
    `config.propsFrom answered for ${filePath} with ${resolved.length} prop(s), but the class declares ` +
    `${missing.map((n) => `"${n}"`).join(', ')} as well — read from ${tag ?? 'the component'}'s own ` +
    'elementProperties, so this is what the element has rather than what its file says. Those props ' +
    'reach no wrapper. A mixin or base class is the usual cause, since a hook reading one file cannot ' +
    'see them. Removing the hook lets prism resolve every property from the class.',
    { tag, props: missing }
  );
}

/**
 * Documented `@prop` names with no property behind them, reported at the
 * altitude that fits how the props were resolved.
 *
 * Where prism read the declarations itself, each name is its own finding: the
 * JSDoc describes a component the wrappers no longer match.
 *
 * Where `config.propsFrom` answered, the same absence means something sharper.
 * Prism validates every entry a hook *returns*; there is nothing to validate
 * about an entry it never returned, so an under-reporting hook looks correct
 * while silently removing props from every wrapper. The `@prop` tags are the
 * one independent account of the component prism has, so a hook returning
 * strictly fewer props than the file documents gets a finding — one per file,
 * not per name, because the fault is the hook's rather than any one prop's.
 */
function reportUndeclaredDocProps(undeclared, props, fromHook, warn, tag, filePath, runtime) {
  if (undeclared.length === 0) return;

  if (!fromHook) {
    for (const name of undeclared) {
      warn(
        'doc-prop-undeclared',
        runtime
          ? `${tag ?? 'component'} documents \`@prop ${name}\` but the class has no reactive property by that name — checked against its own elementProperties, mixins and base classes included, so the tag is describing something that does not exist. Nothing called "${name}" reaches the generated wrappers.`
          : `${tag ?? 'component'} documents \`@prop ${name}\` but declares no reactive property by that name — nothing called "${name}" reaches the generated wrappers.`,
        // Strictness follows the evidence. Read from source, "no declaration
        // here" is routinely untrue for mixin-contributed props; read from the
        // class, a documented prop that is not on it is simply a stale tag.
        { tag, prop: name, strict: Boolean(runtime) }
      );
    }
    return;
  }

  warn(
    'props-from-under-reports',
    `config.propsFrom answered for ${filePath} with ${props.length} prop(s), but the file documents ` +
    `\`@prop\` ${undeclared.map((n) => `"${n}"`).join(', ')} with nothing matching in what came back — ` +
    'so those props reach no wrapper. A prop your hook omits looks exactly like a prop that does not ' +
    'exist, which is why this is reported rather than trusted: either the hook is dropping them, or ' +
    'the tags are stale. Prefer throwing over returning a partial array.',
    { tag, props: undeclared }
  );
}

/**
 * Validate and fill in what `propsFrom` handed back.
 *
 * Everything downstream — six generators and the type emitters — assumes a
 * fully-populated PropMeta, so a hook is held to the shape without being made
 * to write all of it. Returns null when the value isn't usable at all, which
 * puts the built-in reader back in play.
 */
function normalizeHookProps(returned, filePath, warn, tag) {
  if (!Array.isArray(returned)) {
    warn(
      'invalid-props-from',
      `config.propsFrom returned ${returned === null ? 'null' : typeof returned} for ${filePath} — expected an array of props, or undefined to fall through to prism's reader. Ignoring it.`,
      { tag }
    );
    return null;
  }

  const out = [];
  const seen = new Set();
  for (const [i, entry] of returned.entries()) {
    if (typeof entry !== 'object' || entry === null || !VALID_PROP_NAME.test(entry.name ?? '')) {
      warn(
        'invalid-props-from',
        `config.propsFrom returned an entry at index ${i} for ${filePath} with no usable "name" — dropped.`,
        { tag }
      );
      continue;
    }
    // A hook is the only thing that knows a built declaration is internal
    // state, so it gets the same opt-out `{ state: true }` gives a literal.
    if (entry.state === true) continue;
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);

    // An unrecognised type silently becoming String is the failure this whole
    // change exists to stop, so it is named rather than absorbed.
    let type = entry.type ?? 'String';
    if (!KNOWN_PROP_TYPES.has(type)) {
      warn(
        'invalid-props-from',
        `config.propsFrom typed "${entry.name}" as ${JSON.stringify(type)} in ${filePath}, which is not one of ${[...KNOWN_PROP_TYPES].join(', ')} — treating it as String.`,
        { tag, prop: entry.name }
      );
      type = 'String';
    }

    out.push({
      name: entry.name,
      type,
      // `default` is *source text*, not a value — it is emitted verbatim into
      // generated code. A plain primitive is the easy mistake, so it's
      // converted rather than rejected.
      default: typeof entry.default === 'string' ? entry.default
        : entry.default === undefined ? ''
          : JSON.stringify(entry.default),
      reflect: entry.reflect === true,
      values: Array.isArray(entry.values) ? entry.values.filter((v) => typeof v === 'string') : [],
      docType: typeof entry.docType === 'string' ? entry.docType : '',
      // A hook that says nothing about the attribute gets Lit's own default,
      // which is what its declaration would have got had prism read it.
      attribute: entry.attribute === false ? null
        : typeof entry.attribute === 'string' ? entry.attribute
          : entry.name.toLowerCase(),
    });
  }
  return out;
}

/**
 * Parse Lit property declarations. Supports all three common styles:
 *   - `static properties = { ... }` (class field)
 *   - `static get properties() { return { ... }; }` (legacy getter)
 *   - `@property({ type: String }) name;` (decorators)
 */
function parseProperties(source, warn, tag, unparsed) {
  const props = [];

  // Class-field or legacy-getter object literal.
  const fieldMatch = source.match(/static\s+properties\s*=\s*\{/);
  const getterMatch = source.match(/static\s+get\s+properties\s*\(\s*\)\s*\{\s*return\s*\{/);
  const objStart = fieldMatch ?? getterMatch;
  if (objStart) {
    const block = extractBalanced(source, objStart.index + objStart[0].length);
    parsePropertyBlock(block, props, warn, tag, unparsed);
  }

  // Decorator style (coexists with the above; skips names already found).
  parseDecoratorProps(source, props);

  return props;
}

/**
 * Index of the delimiter closing the group that opened just before `start`.
 *
 * Quoted text is stepped over so a brace inside a string can't unbalance it,
 * and so are comments — a class body is mostly prose here, and one apostrophe
 * in `// the drawer's state` would otherwise open a string that swallows
 * everything to the next quote.
 */
function endOfGroup(source, start) {
  let depth = 1;
  let i = start;
  while (i < source.length) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i);
      i = nl === -1 ? source.length : nl + 1;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      i = close === -1 ? source.length : close + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { i = skipString(source, i); continue; }
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return source.length;
}

/** Index of the top-level `,` ending the value that starts at `start`. */
function endOfValue(source, start) {
  let depth = 0;
  let i = start;
  while (i < source.length) {
    const c = source[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(source, i); continue; }
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (c === ',' && depth === 0) return i;
    i++;
  }
  return source.length;
}

/**
 * Yield each top-level `name: value` pair of an object body, with the value's
 * source text.
 *
 * Brace-balanced rather than regex-matched. The pattern this replaces,
 * `(\w+)\s*:\s*\{([^}]*)\}`, ended its capture at the *first* `}` — so a
 * nested option (`converter: { fromAttribute }`) both truncated the config it
 * read and left the tail to be rescanned as though it were more properties.
 */
function* scanEntries(block) {
  // Leading separators, line and block comments are consumed with the key so
  // a commented-out property doesn't derail the walk.
  const KEY = /(?:\s|,|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*([A-Za-z_$][\w$]*|'[^']*'|"[^"]*"|\[[^\]]*\])\s*:\s*/y;
  let i = 0;
  while (i < block.length) {
    KEY.lastIndex = i;
    const m = KEY.exec(block);
    if (!m) {
      // Shorthand (`{ label }`) or a spread — skip to the next entry rather
      // than abandoning the rest of the block.
      const next = endOfValue(block, i);
      if (next >= block.length) return;
      i = next + 1;
      continue;
    }
    const valueStart = KEY.lastIndex;
    const end = endOfValue(block, valueStart);
    // A computed key names nothing prism can emit an attribute for.
    if (!m[1].startsWith('[')) {
      yield { name: m[1].replace(/^['"]|['"]$/g, ''), value: block.slice(valueStart, end).trim() };
    }
    i = end + 1;
  }
}

/**
 * Blank out everything nested inside the config, leaving only its own keys.
 *
 * `state`, `type` and `reflect` are read by regex, and a regex over the whole
 * config answers for the wrong object: `{ type: Object, converter: { ... } }`
 * would let a nested `state: true` mark a public prop internal.
 */
function stripNested(config) {
  let out = '';
  let depth = 0;
  let i = 0;
  while (i < config.length) {
    const c = config[i];
    if (c === '"' || c === "'" || c === '`') {
      const end = skipString(config, i);
      if (depth === 0) out += config.slice(i, end);
      i = end;
      continue;
    }
    if (c === '{' || c === '[' || c === '(') { depth++; i++; continue; }
    if (c === '}' || c === ']' || c === ')') { depth--; i++; continue; }
    if (depth === 0) out += c;
    i++;
  }
  return out;
}

/** One-line form of a declaration, for a diagnostic message. */
function summarize(value) {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > 48 ? `${flat.slice(0, 47)}…` : flat;
}

/** Parse the `{ name: { type, reflect } }` object body into prop entries. */
function parsePropertyBlock(block, props, warn, tag, unparsed) {
  const seen = new Set(props.map((p) => p.name));
  for (const { name, value } of scanEntries(block)) {
    if (seen.has(name)) continue;
    seen.add(name);

    // Anything that isn't an inline object literal — a helper call, a shared
    // constant, a spread — keeps its meaning somewhere prism cannot follow.
    // Reported rather than skipped: a silent skip is a prop missing from every
    // wrapper with an exit code of 0.
    if (!value.startsWith('{') || !value.endsWith('}')) {
      warn(
        'unparsed-prop-declaration',
        `${tag ?? 'component'} declares "${name}" as \`${summarize(value)}\`, which prism's reader cannot type — the prop reaches no generated wrapper. Declare it as an object literal, or resolve it with config.propsFrom.`,
        { tag, prop: name }
      );
      unparsed?.add(name);
      continue;
    }

    const config = stripNested(value.slice(1, -1));

    // Internal reactive state ({ state: true }) is not public API — never
    // expose it in generated wrapper props/types.
    if (/\bstate\s*:\s*true/.test(config)) continue;

    props.push(makeProp(name, config));
  }
}

/** Parse `@property(...)` decorators into prop entries. */
function parseDecoratorProps(source, props) {
  const seen = new Set(props.map((p) => p.name));
  // @property({ ... }) [accessor] name  — `@state()` decorators are internal
  // and intentionally not matched here.
  const decoratorPattern = /@property\s*\(/g;
  let match;
  while ((match = decoratorPattern.exec(source)) !== null) {
    const argsStart = match.index + match[0].length;
    const argsEnd = endOfGroup(source, argsStart);
    decoratorPattern.lastIndex = argsEnd + 1;

    const args = source.slice(argsStart, argsEnd).trim();
    const after = /^\s*(?:accessor\s+)?(\w+)/.exec(source.slice(argsEnd + 1, argsEnd + 160));
    if (!after) continue;
    const name = after[1];
    if (seen.has(name)) continue;

    const config = args.startsWith('{') && args.endsWith('}')
      ? stripNested(args.slice(1, -1))
      : '';
    if (/\bstate\s*:\s*true/.test(config)) continue;

    props.push(makeProp(name, config));
    seen.add(name);
  }
}

/** Build a prop entry from a name and its `{ type, reflect }` config text. */
function makeProp(name, config) {
  const typeMatch = config.match(/\btype\s*:\s*(\w+)/);
  const reflectMatch = config.match(/\breflect\s*:\s*(true|false)/);
  return {
    name,
    type: typeMatch ? typeMatch[1] : 'String',
    default: '',
    reflect: reflectMatch ? reflectMatch[1] === 'true' : false,
    values: [],
    docType: '',
    attribute: attributeName(name, config),
  };
}

/**
 * The attribute a property is reachable from in markup.
 *
 * Lit lowercases the property name unless told otherwise, which is why
 * `confirmLabel` is `confirmlabel` and not `confirm-label` — a distinction that
 * matters to anything typing the element's markup surface, because the wrong one
 * is a name nothing responds to. `attribute: false` means the property has no
 * markup spelling at all.
 *
 * @param {string} name
 * @param {string} config - the declaration's own keys, nested objects stripped
 * @returns {string|null}
 */
function attributeName(name, config) {
  const match = config.match(/\battribute\s*:\s*(false|'[^']*'|"[^"]*")/);
  if (!match) return name.toLowerCase();
  if (match[1] === 'false') return null;
  return match[1].slice(1, -1);
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

// Types the existing `static properties` map already covers exactly. Recording
// these as a docType would change nothing, so they're left alone — which also
// keeps `@prop {string} label` from suppressing CSS enum inference.
const TRIVIAL_DOC_TYPES = new Set([
  'string', 'number', 'boolean', 'any', 'unknown', 'object', 'void', 'null',
  'undefined', '*', 'Object', 'String', 'Number', 'Boolean', 'Array',
]);

// Type text is emitted verbatim into a TS type position, so it is held to a
// conservative grammar. Braces are already balanced by extraction; `;` and
// backticks are excluded because either could end the declaration early.
const SAFE_DOC_TYPE = /^[\w\s<>[\]{}(),.|&'"?:=>-]+$/;
// Generous rather than tight — a sanity bound on runaway input, not a style
// rule. The props with real shape are exactly the long ones, and a nested menu
// item type is legitimately ~180 characters.
const MAX_DOC_TYPE = 500;

// Types resolvable without an import. A documented type naming anything else
// generates a wrapper referring to a symbol prism cannot import for it.
const PORTABLE_TYPE_NAMES = new Set([
  'Array', 'ReadonlyArray', 'Record', 'Partial', 'Required', 'Readonly', 'Pick',
  'Omit', 'Exclude', 'Extract', 'NonNullable', 'ReturnType', 'Parameters',
  'InstanceType', 'Awaited', 'Uppercase', 'Lowercase', 'Capitalize',
  'Date', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'RegExp', 'Error',
  'Function', 'Object', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt',
  'JSON', 'Math', 'Iterable', 'Iterator', 'ArrayBuffer', 'Blob', 'File', 'URL',
  'Element', 'HTMLElement', 'Node', 'Event', 'CustomEvent', 'EventTarget',
]);

/**
 * Read documented types from the class JSDoc.
 *
 * Two things come out of a `@prop {…} name` tag:
 *
 *   - a **string-literal union** becomes the prop's enum values. Authored
 *     intent beats CSS inference where inference fails: the default member has
 *     no `:host([x="…"])` rule (it is the unqualified base style), and a
 *     variant driven from JS leaves no attribute selector at all.
 *
 *   - **any other non-trivial type** is kept verbatim as `prop.docType`.
 *     `static properties` can only say `Array`, which renders as `unknown[]` —
 *     and the props with real shape (chart series, table rows) are exactly the
 *     ones a consumer most needs typed.
 *
 * @param {PropMeta[]} props
 * @param {string} source
 * @param {(code: string, message: string, extra?: object) => void} warn
 * @param {string} [tag]
 * @returns {string[]} documented names with no property behind them, left for
 *   `reportUndeclaredDocProps` to describe — the right wording depends on
 *   whether a hook resolved the props, which this function has no view of
 */
function applyDocTypes(props, source, warn, tag, unparsed = new Set()) {
  const byName = new Map(props.map((p) => [p.name, p]));
  const undeclared = [];
  // Braces are matched rather than regex-captured: a nested object type such as
  // `{Array<{label: string}>}` ends at its *matching* brace, and `[^}]+` would
  // truncate it to `Array<{label: string` — emitting a broken type.
  const tagPattern = /@prop\s*\{/g;
  let m;
  while ((m = tagPattern.exec(source)) !== null) {
    const bodyStart = m.index + m[0].length;
    const raw = extractBalanced(source, bodyStart);
    const afterBrace = bodyStart + raw.length + 1;
    tagPattern.lastIndex = afterBrace;

    const nameMatch = /^\s+(\w+)/.exec(source.slice(afterBrace, afterBrace + 80));
    if (!nameMatch) continue;
    const prop = byName.get(nameMatch[1]);
    // A documented prop with no declaration behind it is the shape a silent
    // prop loss takes: the JSDoc still describes the component, the wrappers
    // no longer have the prop.
    if (!prop) {
      // Already reported, in more detail, as an unreadable declaration.
      if (unparsed.has(nameMatch[1])) continue;
      undeclared.push(nameMatch[1]);
      continue;
    }

    const typeText = raw.trim();

    // A string-literal union drives the enum values, as before.
    if (/^'[^']*'(\s*\|\s*'[^']*')*$/.test(typeText)) {
      prop.values = [...new Set([...typeText.matchAll(/'([^']*)'/g)].map((v) => v[1]))];
      continue;
    }

    if (TRIVIAL_DOC_TYPES.has(typeText)) continue;

    // All rejections name the actual cause. "Can't emit safely" on its own
    // sends you to the source to find out which rule you hit.
    //
    // Multi-line comes first: the braces' text is read verbatim, so a wrapped
    // type arrives with the comment's ` * ` continuation markers embedded, and
    // reporting that as "contains '*'" makes the reader decode the symptom.
    if (/\n/.test(typeText)) {
      warn(
        'unusable-doc-type',
        `${tag ?? 'component'} prop "${prop.name}" has a documented type written across multiple lines — prism reads the text between the braces verbatim, comment markers included. Keep the whole type on one line — falling back to ${prop.type}.`,
        { tag, prop: prop.name, reason: 'multi-line' }
      );
      continue;
    }
    if (typeText.length > MAX_DOC_TYPE) {
      warn(
        'unusable-doc-type',
        `${tag ?? 'component'} prop "${prop.name}" has a documented type of ${typeText.length} characters, over prism's ${MAX_DOC_TYPE}-character limit — falling back to ${prop.type}. Extract the repeated parts or shorten the shape.`,
        { tag, prop: prop.name, reason: 'too-long', length: typeText.length, limit: MAX_DOC_TYPE }
      );
      continue;
    }
    if (!SAFE_DOC_TYPE.test(typeText)) {
      const offending = [...new Set(typeText.split('').filter((c) => !SAFE_DOC_TYPE.test(c)))];
      warn(
        'unusable-doc-type',
        `${tag ?? 'component'} prop "${prop.name}" has a documented type containing ${offending.map((c) => JSON.stringify(c)).join(', ')}, which prism won't emit into a type position — falling back to ${prop.type}.`,
        { tag, prop: prop.name, reason: 'unsafe-characters', characters: offending }
      );
      continue;
    }

    const unportable = [...new Set([...typeText.matchAll(/\b([A-Z]\w*)/g)].map((x) => x[1]))]
      .filter((n) => !PORTABLE_TYPE_NAMES.has(n));
    if (unportable.length > 0) {
      warn(
        'unportable-doc-type',
        `${tag ?? 'component'} prop "${prop.name}" documents ${unportable.map((n) => `"${n}"`).join(', ')}, which prism cannot import — generated wrappers take no imports, so inline the shape (\`Array<{id: string}>\` rather than \`${unportable[0]}[]\`) or the generated types won't compile.`,
        { tag, prop: prop.name, names: unportable }
      );
    }

    prop.docType = typeText;
  }

  // Deduped: a name documented twice is one absence, not two.
  return [...new Set(undeclared)];
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
 * The literal value of a prop's default, or null when it isn't a plain
 * non-empty string. `this.size = 'md'` yields `md`; a computed default, a
 * number, or `''` yields null.
 */
function defaultStringValue(prop) {
  const m = /^(['"])(.*)\1$/.exec((prop.default ?? '').trim());
  return m && m[2].length > 0 ? m[2] : null;
}

/**
 * Detect enum values from CSS :host([prop="value"]) patterns.
 *
 * A fallback for props with no documented union — see applyDocTypes. Where both
 * sources exist the documented one wins, but the CSS is still read so the two
 * can be compared: a styled value the docs don't list is drift, and this is the
 * only pass that sees both. On the fallback path the prop's own default is
 * unioned in — it is by construction a legal value, and the default member has
 * no attribute selector to be inferred from.
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

    const def = defaultStringValue(prop);

    if (prop.values.length > 0) {
      // Documented union wins, but both other sources are checked against it —
      // either mismatch is drift the author would want to know about.
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
      if (def !== null && !documented.has(def)) {
        warn(
          'doc-drift',
          `${tag ?? 'component'} defaults ${prop.name} to "${def}", which its documented union omits`,
          { tag, prop: prop.name, values: [def] }
        );
      }
      continue;
    }

    if (values.size > 0) {
      // Appended, not prepended: a prop whose default the CSS already styles is
      // unchanged, so this only ever adds the member that was missing.
      if (def !== null) values.add(def);
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
 * Named slots a component exposes, in template order, and whether it also has
 * an unnamed default slot.
 *
 * Two sources, unioned. The template is authoritative and ordered, so it comes
 * first. But `render()` isn't always extractable — a template assembled through
 * helpers or held in a field yields nothing — and a component that documents
 * `@slot start` has said the slot exists regardless of whether this parser could
 * see it. Reading both means a slot has to be hidden from both to be missed.
 *
 * A slot name is legal HTML but not necessarily a legal identifier — `slot="a-b"`
 * is common and can't be a Svelte snippet prop — so names are recorded verbatim
 * and it's the consumer's job to decide what it can do with each one.
 *
 * @param {string} template
 * @param {string} [source] - full file, for `@slot` JSDoc tags
 * @returns {{ slots: string[], hasDefaultSlot: boolean }}
 */
function extractSlots(template, source = '') {
  // Scanned over the raw source, not just the extracted template.
  // `extractTemplate` skips nested html`` inside `${}`, so a default slot in a
  // conditional branch does not appear there at all — and reading that absence
  // as "no default slot" deletes children from every wrapper. The source
  // contains every template in the file, branches included.
  const haystack = `${template}\n${source}`;

  // Names built at runtime — `name="item-${index}"` on a virtualised list — are
  // one dynamic family, not a slot a wrapper can declare. Recording the literal
  // text, or the `item-` prefix left after the expression, invents slots that
  // don't exist.
  const isDynamic = (name) => name.includes('${');

  // Slots seen as real markup, kept apart from ones known only from JSDoc.
  // Dropping `children` is gated on this stricter set: a `@slot header` tag
  // proves a named slot exists, but says nothing about whether the default slot
  // is rendered somewhere this parser can't see — a base class, a mixin, an
  // imported helper. Only markup we actually read justifies removing anything.
  const inMarkup = new Set();
  // Template first so the common case keeps render order; the source pass then
  // adds anything the template didn't show.
  for (const text of [template, haystack]) {
    for (const m of text.matchAll(/<slot\b[^>]*?\bname\s*=\s*["']([^"']+)["']/g)) {
      if (!isDynamic(m[1])) inMarkup.add(m[1]);
    }
  }
  const named = new Set(inMarkup);
  // `@slot name — description`. The name must start with a word character, so a
  // bare `@slot - the default content` documents the default slot and adds no
  // named one.
  // `@slot item-${index}` documents a dynamic family; the name regex would stop
  // at the `$` and record a phantom `item-` slot. JSDoc has no grammar for this,
  // so anything followed by an expression is skipped rather than guessed at.
  for (const m of source.matchAll(/@slot\s+([A-Za-z_][\w-]*)(\$\{)?/g)) {
    if (!m[2]) named.add(m[1]);
  }
  // `@slot none` is the author asserting there is no default slot — the one
  // piece of evidence this parser cannot gather for itself. Absence of a
  // `<slot>` in the file is not the same claim (a base class or an imported
  // helper renders one just as invisibly), which is why children are otherwise
  // kept. `none` is reserved: it names the absence, never a slot.
  const noDefaultSlot = /@slot\s+none\b/.test(source);
  named.delete('none');
  // A `<slot>` with no name attribute anywhere in its tag is the default slot.
  const hasDefaultSlot = [...haystack.matchAll(/<slot\b([^>]*)>/g)]
    .some((m) => !/\bname\s*=/.test(m[1]));
  return { slots: [...named], slotsInMarkup: [...inMarkup], hasDefaultSlot, noDefaultSlot };
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
 * Class members that exist because Lit or the browser calls them. A consumer
 * never does, so none of them is the imperative API a wrapper has to expose.
 * `*Callback` covers the platform's own reactions along with Lit's
 * `formResetCallback` family.
 */
const LIFECYCLE_METHODS = new Set([
  'constructor', 'render', 'update', 'willUpdate', 'firstUpdated', 'updated',
  'shouldUpdate', 'performUpdate', 'scheduleUpdate', 'requestUpdate',
  'createRenderRoot', 'getUpdateComplete', 'addController', 'removeController',
]);

/**
 * Walk the component class's body and record where each member begins and ends.
 *
 * Two questions need this and neither survives a regex over the whole file.
 * Which props the component assigns *outside its constructor* — a constructor
 * assignment is a default, the same assignment inside a keydown handler is the
 * component moving state its consumer also holds. And which public methods it
 * has, which is what says every wrapper owes its consumer a handle on the
 * element.
 *
 * Scanned rather than parsed, like the rest of this file: strings, template
 * literals, comments and decorators are stepped over, which is what a
 * `render()` full of `` html`…` `` requires — those braces are not the class's.
 *
 * The scan answers nothing rather than something wrong: a member whose head it
 * cannot read (a computed key, a `static {}` block) abandons the whole walk,
 * because a mis-placed member boundary would put a method's body in the
 * constructor's range and turn a default into a write-back.
 *
 * @param {string} source
 * @param {string} className
 * @returns {null | { start: number, end: number, members: Array<{
 *   name: string, kind: 'method'|'accessor'|'field', isStatic: boolean,
 *   start: number, end: number }> }}
 */
function scanClassMembers(source, className) {
  const header = new RegExp(`class\\s+${className}\\b[^{]*\\{`).exec(source);
  if (!header) return null;
  const start = header.index + header[0].length;
  const end = endOfGroup(source, start);
  const members = [];

  // `static`, `async`, a generator star and an accessor keyword, then the name.
  // `get` only counts as a keyword when whitespace follows it, so a method
  // actually named `get(key)` keeps its name.
  const HEAD = /(static\s+)?(?:async\s+)?(?:\*\s*)?(get\s+|set\s+)?(#?[A-Za-z_$][\w$]*)\s*/y;
  let i = start;
  while (i < end) {
    i = skipTrivia(source, i, end);
    if (i >= end) break;

    HEAD.lastIndex = i;
    const head = HEAD.exec(source);
    if (!head) {
      const c = source[i];
      // A balanced token where a name was expected — a computed key, or the
      // parameter list and body that follow one. Stepping over each in turn
      // keeps the walk on the member boundaries.
      if (c === '[' || c === '(' || c === '{') { i = endOfGroup(source, i + 1) + 1; continue; }
      if (c === '"' || c === "'" || c === '`') { i = skipString(source, i); continue; }
      return null;
    }

    const memberStart = head.index;
    const isStatic = Boolean(head[1]);
    const accessor = Boolean(head[2]);
    const name = head[3];
    const after = HEAD.lastIndex;

    if (source[after] === '(') {
      const params = endOfGroup(source, after + 1);
      let brace = params + 1;
      while (brace < end && /\s/.test(source[brace])) brace++;
      if (source[brace] !== '{') return null;
      const close = endOfGroup(source, brace + 1);
      members.push({
        name, kind: accessor ? 'accessor' : 'method', isStatic,
        start: memberStart, end: close + 1,
      });
      i = close + 1;
    } else if (source[after] === '=') {
      const stop = endOfFieldValue(source, after + 1, end);
      members.push({ name, kind: 'field', isStatic, start: memberStart, end: stop });
      i = stop;
    } else {
      // A bare declaration (`accessor foo;`, `#queue;`). Its own name is all of it.
      members.push({ name, kind: 'field', isStatic, start: memberStart, end: after });
      i = after;
    }
  }

  return { start, end, members };
}

/** Advance past whitespace, separators, comments and decorators. */
function skipTrivia(source, i, end) {
  while (i < end) {
    const c = source[i];
    if (c === ';' || /\s/.test(c)) { i++; continue; }
    if (c === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i);
      i = nl === -1 ? end : nl + 1;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      i = close === -1 ? end : close + 2;
      continue;
    }
    // A decorator belongs to the member below it, arguments and all.
    if (c === '@') {
      const NAME = /@[A-Za-z_$][\w$.]*\s*/y;
      NAME.lastIndex = i;
      if (!NAME.exec(source)) return i;
      i = NAME.lastIndex;
      if (source[i] === '(') i = endOfGroup(source, i + 1) + 1;
      continue;
    }
    return i;
  }
  return i;
}

/**
 * Index just past a class field's initializer — the `;` that ends it, or the
 * newline that ends it without one.
 */
function endOfFieldValue(source, from, end) {
  let depth = 0;
  let i = from;
  while (i < end) {
    const c = source[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(source, i); continue; }
    if (c === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i);
      if (depth === 0) return nl === -1 ? end : nl;
      i = nl === -1 ? end : nl + 1;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      i = close === -1 ? end : close + 2;
      continue;
    }
    if (c === '{' || c === '[' || c === '(') { depth++; i++; continue; }
    if (c === '}' || c === ']' || c === ')') { depth--; i++; continue; }
    if (depth === 0 && (c === ';' || c === '\n')) return i;
    i++;
  }
  return end;
}

/**
 * Whether a method name is one a consumer is meant to call.
 *
 * The same terms the reference catalog's own docs use: nothing the platform or
 * Lit calls, and nothing marked private by `#` or by the `_` convention every
 * component in the catalog follows. Exported because `config.runtime` applies
 * the same rule to the prototype chain, where a mixin's methods are visible and
 * a source reader's are not.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isPublicMethod(name) {
  // The name is emitted into a doc comment in every wrapper.
  if (typeof name !== 'string' || !VALID_PROP_NAME.test(name)) return false;
  if (name.startsWith('_') || name.startsWith('#')) return false;
  if (name.endsWith('Callback') || LIFECYCLE_METHODS.has(name)) return false;
  return true;
}

/**
 * The methods a consumer is meant to call, from the class body.
 *
 * Instance methods only — a static is not reachable through an element
 * reference — and a component with any of them is a component whose wrapper
 * must hand back the element.
 *
 * @param {ReturnType<typeof scanClassMembers>} klass
 * @returns {string[]}
 */
function publicMethods(klass) {
  if (!klass) return [];
  const names = [];
  for (const member of klass.members) {
    if (member.kind !== 'method' || member.isStatic) continue;
    if (!isPublicMethod(member.name)) continue;
    if (!names.includes(member.name)) names.push(member.name);
  }
  return names;
}

/**
 * Props the component assigns to itself somewhere other than its constructor.
 *
 * Half of what makes a prop two-way. The constructor's assignments are the
 * component's own defaults; the same assignment in an Escape handler is state
 * the consumer holds a copy of, moving without the consumer's knowledge.
 *
 * @param {string} source
 * @param {ReturnType<typeof scanClassMembers>} klass
 * @param {Set<string>} propNames
 * @returns {Set<string>}
 */
function selfAssignedProps(source, klass, propNames) {
  const assigned = new Set();
  if (!klass) return assigned;
  const ctor = klass.members.find((m) => m.kind === 'method' && m.name === 'constructor');
  // `=(?!=)` so a comparison isn't read as a write. Nothing else can reach the
  // `=`: the name has already been consumed, so `>=` and `!==` never match.
  const ASSIGN = /this\.([A-Za-z_$][\w$]*)\s*=(?!=)/g;
  ASSIGN.lastIndex = klass.start;
  let match;
  while ((match = ASSIGN.exec(source)) !== null && match.index < klass.end) {
    if (ctor && match.index >= ctor.start && match.index < ctor.end) continue;
    if (propNames.has(match[1])) assigned.add(match[1]);
  }
  return assigned;
}

/**
 * The prop a `detail` entry carries the new value of, when its key doesn't say.
 *
 * `detail: { value }` inside `_setOpen(value) { this.sidebarOpen = value; … }`
 * is the same write-back path as `detail: { value }` on a component whose prop
 * is called `value` — the payload just names the argument instead of the
 * property. Two spellings are read, both statically visible:
 *
 *   - `detail: { open: this.sidebarOpen }` — the property outright, once it is
 *     known to be assigned outside the constructor.
 *   - `detail: { value }` where the enclosing method assigns that identifier to
 *     exactly one declared prop. Ambiguity answers nothing: two props taking the
 *     same local means neither can be said to be the one the event announces.
 *
 * @returns {string|null} the prop name, or null if this entry announces none
 */
function announcedProp(source, klass, propNames, assigned, at, value) {
  const direct = /^this\.([A-Za-z_$][\w$]*)$/.exec(value);
  if (direct) {
    return propNames.has(direct[1]) && assigned.has(direct[1]) ? direct[1] : null;
  }
  if (!klass || !/^[A-Za-z_$][\w$]*$/.test(value)) return null;

  // The assignment has to be in the same method as the dispatch. A component
  // that happens to assign a `value` local to a prop somewhere else in the file
  // is not this event's write-back path, and searching the whole class would
  // find it.
  const member = klass.members.find((m) => at >= m.start && at < m.end);
  if (!member || member.name === 'constructor') return null;

  const body = source.slice(member.start, member.end);
  // `value` is already known to be a plain identifier, so it is safe to build
  // a pattern from.
  const pattern = new RegExp(`this\\.([A-Za-z_$][\\w$]*)\\s*=\\s*${value}\\s*(?:[;,)\\]}]|$)`, 'gm');
  const found = new Set();
  for (const m of body.matchAll(pattern)) {
    if (propNames.has(m[1])) found.add(m[1]);
  }
  return found.size === 1 ? [...found][0] : null;
}

/**
 * Extract custom event names — and the `detail` payload of each — from
 * dispatchEvent(new CustomEvent('...', { detail: { ... } })) calls.
 *
 * The payload is what lets wrappers derive two-way bindings, in two ways. A
 * detail key matching a declared prop is that prop's write-back path by name.
 * And where the key names something else — an argument, a generic `value` — the
 * dispatch site is read for which prop it announces, because a component that
 * assigns a prop outside its constructor and says so in an event owns that
 * state as much as its consumer does, whatever the payload calls it. Keying on
 * names alone cannot see `arc-sidebar-toggle` carrying `sidebarOpen` as
 * `detail.value`, and would keep needing new names.
 *
 * @param {string} source
 * @param {(code: string, message: string, extra?: object) => void} warn
 * @param {string} [tag]
 * @param {import('./parser.js').PropMeta[]} [props] - declared props, for the
 *   behavioural half above
 * @param {ReturnType<typeof scanClassMembers>} [klass]
 * @returns {{ events: string[], eventDetails: Record<string, string[]>,
 *   eventWrites: Record<string, Record<string, string>> }}
 */
function extractEvents(source, warn, tag, props = [], klass = null) {
  const events = new Set();
  const eventDetails = {};
  const eventWrites = {};
  const propNames = new Set(props.map((p) => p.name));
  const assigned = selfAssignedProps(source, klass, propNames);
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
    // handler sending `{ value, valid }`); union the entries across all of them.
    const entries = extractDetailEntries(source, eventPattern.lastIndex, warn, tag);
    if (entries.length === 0) continue;
    const seen = eventDetails[name] ?? (eventDetails[name] = []);
    for (const { key, value } of entries) {
      if (!seen.includes(key)) seen.push(key);

      // Which prop this key carries the new value of, where the key itself
      // doesn't say. First dispatch site to answer wins: a later path sending a
      // literal (`{ value: '' }`) says nothing about the prop and must not
      // unsay what the path that assigns it established.
      const prop = announcedProp(source, klass, propNames, assigned, match.index, value);
      if (!prop) continue;
      const writes = eventWrites[name] ?? (eventWrites[name] = {});
      if (!writes[key]) writes[key] = prop;
    }
  }

  // Documented events prism found no dispatch for. Dispatch sites stay
  // authoritative — they carry the `detail` shape two-way bindings derive from,
  // a `@fires` tag carries nothing — but absence of dispatch sites is not
  // evidence of absence: a component dispatching from a helper module, or from
  // a base class prism was never pointed at, fires the events anyway. And the
  // two ways of being wrong are not equal: a handler prop for an event that
  // never fires is an unused optional member; a missing one is a consumer's
  // handler that silently never runs. So a documented event is believed.
  for (const name of source.matchAll(/@fires\s+(?:\{[^}]*\}\s+)?([\w-]+)/g)) {
    const event = name[1];
    if (events.has(event)) continue;
    if (!VALID_EVENT.test(event)) {
      warn('invalid-event', `ignoring documented event with invalid name "${event}"`, { tag });
      continue;
    }
    events.add(event);
    // No detail keys, deliberately: the tag doesn't state a payload, and
    // inventing one would derive a two-way binding from nothing.
  }

  return { events: [...events], eventDetails, eventWrites };
}

/**
 * Given the index just past a CustomEvent's name literal, return the top-level
 * entries of its `detail` object literal — each key with the source text of the
 * expression it carries.
 *
 * The search is bounded to this call's own options object rather than scanning
 * forward for the next `detail:` — otherwise an event dispatched without a
 * payload would inherit the keys of whichever event happens to follow it.
 *
 * @param {string} source
 * @param {number} afterName - index just past the closing quote of the name
 * @param {(code: string, message: string, extra?: object) => void} warn
 * @param {string} [tag]
 * @returns {Array<{ key: string, value: string }>}
 */
function extractDetailEntries(source, afterName, warn, tag) {
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
  return extractObjectEntries(body).filter(({ key }) => {
    if (VALID_DETAIL_KEY.test(key)) return true;
    warn('invalid-detail-key', `ignoring detail key with invalid name "${key}"`, { tag });
    return false;
  });
}

/**
 * Collect the top-level entries of an object-literal body (braces already
 * stripped), each as its key and the source text of its value.
 *
 * Handles `key: value`, shorthand `key` — whose value is the key, which is the
 * whole point for `detail: { value }` — and skips over nested objects, strings,
 * template literals, comments and spreads: anything whose name isn't statically
 * known can't become a binding anyway.
 *
 * @param {string} body
 * @returns {Array<{ key: string, value: string }>}
 */
function extractObjectEntries(body) {
  const entries = [];
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
      const entry = /^([A-Za-z_$][\w$]*)\s*(:|,|$)/.exec(body.slice(i));
      if (entry) {
        const key = entry[1];
        if (entry[2] === ':') {
          const from = i + entry[0].length;
          entries.push({ key, value: body.slice(from, endOfValue(body, from)).trim() });
        } else {
          entries.push({ key, value: key });
        }
      }
      atEntryStart = false;
    }
    i++;
  }

  return entries;
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
