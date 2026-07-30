/**
 * Shared decisions about the generated component surface — prop types, the
 * passthrough escape hatch, and whether a wrapper takes children at all.
 *
 * The type mapping lived as six byte-identical copies, which meant a change to
 * how props are typed had to be made six times to take effect once.
 */

/**
 * Whether a wrapper should accept children.
 *
 * A component with no default `<slot>` has nowhere to put them: `arc-confirm`
 * declared `children` and rendered them into an element that discards them, so
 * content passed there vanished silently. Omitting the member makes it a type
 * error instead.
 *
 * The rule is deliberately asymmetric, because the two ways of being wrong are
 * not remotely equal. Keeping children a component can't use is a no-op you
 * discover by reading. Dropping children a component *can* use deletes rendered
 * content — which is exactly what 2.7.0 did to 111 components, because it read
 * "no default slot found" as "no default slot exists". Those are different
 * claims, and only the second one justifies removing anything.
 *
 * So children are dropped only on positive evidence: either slots were found
 * and none of them was the default, or the author wrote `@slot none`. Finding
 * no slots at all is not evidence a component has none — it is equally
 * consistent with having failed to look in the right place — so that case keeps
 * children until someone annotates it.
 *
 * @param {import('../parser.js').ComponentMeta} meta
 * @returns {boolean}
 */
export function acceptsChildren(meta) {
  // Markup beats annotation: a `<slot>` that is actually rendered is not made
  // to disappear by a stale doc tag, and the contradiction is reported.
  if (meta.hasDefaultSlot) return true;
  // `@slot none` supplies the evidence the parser can't: the author says there
  // is nowhere for children to go. This is the only way to drop children from
  // a component whose file contains no slots at all.
  if (meta.noDefaultSlot) return false;
  // Gated on slots seen as real markup, not on documented ones. A `@slot header`
  // tag proves a named slot exists; it says nothing about whether the default
  // slot is rendered somewhere this parser never reads — a base class, a mixin,
  // an imported helper. `slots` is the fallback for metas built before the
  // distinction existed.
  const observed = meta.slotsInMarkup ?? meta.slots;
  return !(observed?.length > 0);
}

/**
 * Map a WC property type to a TypeScript type string.
 *
 * Precedence, most authoritative first:
 *   1. a documented `@prop {…}` type — the author said what the shape is
 *   2. a detected enum union — from the docs, or inferred from CSS
 *   3. the `static properties` type, which can only say "an Array of something"
 *
 * @param {import('../parser.js').PropMeta} prop
 * @returns {string}
 */
/**
 * Global HTML attributes a consumer may reasonably pass through to the element.
 *
 * Value types are deliberately loose — the point of listing them is to accept
 * the *name*, not to validate the value. What's being bought here is that an
 * unlisted name is now an error.
 */
const GLOBAL_ATTRS = [
  ['class', 'string'],
  ['id', 'string'],
  ['style', 'string'],
  ['title', 'string'],
  ['role', 'string'],
  ['slot', 'string'],
  ['part', 'string'],
  ['exportparts', 'string'],
  ['dir', 'string'],
  ['lang', 'string'],
  ['translate', 'string'],
  ['accesskey', 'string'],
  ['enterkeyhint', 'string'],
  ['inputmode', 'string'],
  ['popover', 'string'],
  ['contenteditable', 'boolean | string'],
  ['tabindex', 'number'],
  ['hidden', 'boolean'],
  ['inert', 'boolean'],
  ['draggable', 'boolean'],
  ['spellcheck', 'boolean'],
  ['autofocus', 'boolean'],
];

/**
 * The escape-hatch members of a generated Props interface.
 *
 * A blanket `[key: string]: unknown` is what makes `...rest` type-check, but it
 * also accepts every misspelling: `<Slider valu={3} />` passed clean, which
 * defeats most of what these types are for. Pattern index signatures keep the
 * spread working while restoring excess-property checking on everything else.
 *
 * The `on${string}` signature is not optional — Svelte consumers reach custom
 * events through `onarc-input` on the spread, so narrowing without it would
 * break the two-way-binding escape hatch.
 *
 * Names the component already declares are omitted: repeating one would be a
 * duplicate interface key, which is a hard TS error.
 *
 * @param {import('../parser.js').PropMeta[]} props
 * @param {string} indent
 * @param {Iterable<string>} [alsoDeclared] - other members already in the
 *   interface, e.g. slot snippet props; a slot called `title` would otherwise
 *   collide with the global attribute of the same name
 * @returns {string[]}
 */
export function passthroughMembers(props, indent = '  ', alsoDeclared = []) {
  const declared = new Set([...props.map((p) => p.name), ...alsoDeclared]);
  const lines = GLOBAL_ATTRS
    .filter(([name]) => !declared.has(name))
    .map(([name, type]) => `${indent}${name}?: ${type};`);
  lines.push(`${indent}[key: \`data-${'${string}'}\`]: unknown;`);
  lines.push(`${indent}[key: \`aria-${'${string}'}\`]: unknown;`);
  lines.push(`${indent}[key: \`on${'${string}'}\`]: unknown;`);
  return lines;
}

export function tsType(prop) {
  if (prop.docType) return prop.docType;
  if (prop.values && prop.values.length > 0) {
    return prop.values.map((v) => `'${v}'`).join(' | ');
  }
  switch (prop.type) {
    case 'Boolean': return 'boolean';
    case 'Number':  return 'number';
    case 'Array':   return 'unknown[]';
    case 'Object':  return 'Record<string, unknown>';
    default:        return 'string';
  }
}

/**
 * A wrapper default must be a value the prop's declared type admits, or
 * nothing. The source default is documentation text, and two shapes of it
 * used to reach wrappers verbatim and only failed once the packages grew a
 * compile step: a Number prop documented as '0' (string literal against a
 * number type) and a union prop whose neutral default ('') isn't a union
 * member. The element itself always carries the real default, so omitting an
 * unrepresentable one changes nothing at runtime.
 *
 * `arrayFactory` wraps array/object defaults in `() => (…)` for frameworks
 * that require fresh references per instance (Vue's withDefaults).
 */
export function typedDefault(prop, { arrayFactory = false } = {}) {
  if (!prop.default) return undefined;
  const val = prop.default;
  const unquoted = val.replace(/^['"]|['"]$/g, '');
  if (prop.type === 'Number') {
    const n = Number(unquoted);
    return Number.isNaN(n) ? undefined : String(n);
  }
  if (prop.type === 'Boolean') {
    return unquoted === 'true' || unquoted === 'false' ? unquoted : undefined;
  }
  if (val.startsWith('[') || val.startsWith('{')) {
    // An array/object default against a prop not declared as one means the
    // prop's documented type is wrong or missing — emitting the default
    // would type-error, so the mismatch is dropped here and belongs upstream.
    if (prop.type !== 'Array' && prop.type !== 'Object' && !prop.docType) return undefined;
    return arrayFactory ? `() => (${val})` : val;
  }
  if (prop.values?.length > 0 && !prop.values.includes(unquoted)) return undefined;
  if (val.startsWith("'") || val.startsWith('"')) return val;
  if (!Number.isNaN(Number(val))) return val;
  return `'${val}'`;
}
