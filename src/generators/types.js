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
 * The absence of a default slot is only trusted when a template was actually
 * parsed. An unextractable render() yields an empty template, which would look
 * identical to "this component has no slots" and would strip children from
 * wrappers that need them — a worse failure than the one being fixed.
 *
 * @param {import('../parser.js').ComponentMeta} meta
 * @returns {boolean}
 */
export function acceptsChildren(meta) {
  if (!meta.template) return true;
  return meta.hasDefaultSlot !== false;
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
