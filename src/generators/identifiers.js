/**
 * Safe local binding names for props.
 *
 * A prop called `for`, `class` or `default` is a perfectly good attribute name
 * but not a legal identifier, so any wrapper that binds it to a local —
 * `let { for } = $props()`, `({ for, ...rest }) =>` — fails to parse. The
 * attribute name is public API and must not change; only the local does.
 */

const RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete',
  'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if',
  'import', 'in', 'instanceof', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw',
  'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'let', 'static', 'await',
]);

/**
 * Safe local binding name for a prop. The attribute name is unaffected.
 *
 * No `$` prefix — `$`-leading identifiers are reserved by Svelte 5 runes.
 *
 * @param {string} name
 * @param {Set<string>} [taken] - names already in scope, e.g. the other props
 * @returns {string}
 */
export function safeIdent(name, taken = new Set()) {
  if (!RESERVED.has(name)) return name;
  let candidate = `${name}Prop`;
  while (taken.has(candidate)) candidate += '_';
  return candidate;
}

/**
 * Map every prop name to the local it binds to. Names that are already legal
 * map to themselves, so callers can compare the two to decide whether a rename
 * needs to be spelled out (`for: forProp`) or the shorthand still works.
 *
 * The whole prop set is passed as `taken` so a component declaring both `for`
 * and `forProp` can't have the rename collide with the real prop.
 *
 * @param {import('../parser.js').PropMeta[]} props
 * @returns {Map<string, string>} prop name → local binding name
 */
export function localNames(props) {
  const taken = new Set(props.map((p) => p.name));
  const locals = new Map();
  for (const prop of props) {
    const local = safeIdent(prop.name, taken);
    taken.add(local);
    locals.set(prop.name, local);
  }
  return locals;
}
