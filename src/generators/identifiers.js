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
 * Prop names each framework takes for itself.
 *
 * A different failure mode from the JS reserved words above, and a worse one.
 * `for` is illegal syntax and fails at build; these are legal everywhere and
 * fail at runtime, silently. React and Preact strip `key` and `ref` in the
 * reconciler, so `<Column key="name" />` sets the list key and the component
 * never receives the prop — no syntax error, no type error, no warning, just a
 * column with no field to read. `key=` is also exactly what a developer writes
 * by reflex on a component that renders in a list, so the collision is close to
 * certain rather than hypothetical.
 *
 * Prism cannot fix this in the wrapper: the value is taken before the component
 * function is called. The only remedy is renaming the prop at source, so all
 * prism can do is say so.
 *
 * The `children` entries are a different mechanism with the same cause — those
 * generators inject their own `children` member, so a prop of that name
 * collides with it. `className` is React's own always-added prop.
 */
export const FRAMEWORK_RESERVED = {
  react: ['key', 'ref', 'children', 'className', 'dangerouslySetInnerHTML'],
  preact: ['key', 'ref', 'children', 'dangerouslySetInnerHTML'],
  svelte: ['children'],
  solid: ['ref', 'children'],
  // Vue and Angular take nothing: slots and ng-content carry children, and
  // neither framework reserves a prop name out of the component's own surface.
  vue: [],
  angular: [],
};

/**
 * Props whose names collide with a framework's own reserved set.
 *
 * @param {import('../parser.js').PropMeta[]} props
 * @param {string[]} frameworks - framework keys actually being generated
 * @returns {Array<{ prop: string, frameworks: string[] }>}
 */
export function reservedCollisions(props, frameworks) {
  const out = [];
  for (const prop of props) {
    const hit = frameworks.filter((f) => (FRAMEWORK_RESERVED[f] ?? []).includes(prop.name));
    if (hit.length > 0) out.push({ prop: prop.name, frameworks: hit });
  }
  return out;
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
