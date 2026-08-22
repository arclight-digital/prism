/**
 * The element handle a wrapper owes its consumer.
 *
 * A component driven by methods — `show()` returning an id, `dismiss(id)`
 * taking it back — has every one of its capabilities on the far side of the
 * wrapper, and most frameworks hand back their own component object rather than
 * the element. Svelte's `bind:this` yields the Svelte component; Vue's template
 * ref yields the SFC instance; an Angular template reference yields the wrapper
 * class, whose `ElementRef` is private to it. React is the exception, because
 * `@lit/react` forwards refs already — which is why this surfaced in an
 * application rather than in any of the six package builds.
 *
 * The condition is mechanical, so it is applied rather than configured: a
 * component with public methods gets a handle in every wrapper. What a consumer
 * would otherwise have to do instead is grow a document-level event for each
 * method, which is a fine contract for a component designed to be driven from a
 * distance and no answer at all for `edit()`, `next()` or `getCrop()`.
 */

/**
 * Whether this component's wrapper must expose the element.
 *
 * Asked per framework, so the verifier and the generator can't drift apart on
 * the two frameworks that answer differently.
 *
 * @param {import('../parser.js').ComponentMeta} meta
 * @param {string} [framework] - the config section's name
 * @returns {boolean}
 */
export function needsHandle(meta, framework) {
  if ((meta.methods?.length ?? 0) === 0) return false;
  // `@lit/react` forwards refs to the element already — the one framework where
  // an imperative API was reachable all along.
  if (framework === 'react') return false;
  // `ref` is Solid's own word for this and there is no second spelling, so a
  // component that declares a prop by that name keeps it and gets no handle.
  if (framework === 'solid' && (meta.props ?? []).some((p) => p.name === 'ref')) return false;
  return true;
}

/**
 * The marker each framework's handle can be recognized by, for reading a
 * generated file back — the shape verify.js asserts, kept beside the shapes the
 * generators emit so the two cannot drift.
 *
 * @type {Record<string, (meta: import('../parser.js').ComponentMeta) => string>}
 */
export const HANDLE_MARKER = {
  vue: (meta) => `defineExpose({ ${handleName(meta)}: __el });`,
  svelte: (meta) => `export function ${handleName(meta)}(): ${meta.className} | undefined {`,
  angular: (meta) => `get ${handleName(meta)}(): ${meta.className} {`,
  solid: (meta) => `ref?: ${meta.className} | ((el: ${meta.className}) => void);`,
  preact: (meta) => `useImperativeHandle(forwarded, () => ref.current as ${meta.className}, []);`,
};

/**
 * The methods, as a phrase for the doc comment above a handle: `show()`,
 * `dismiss()` and `clear()`. Names are identifiers by the time they reach here,
 * so nothing in them can close the comment.
 *
 * @param {import('../parser.js').ComponentMeta} meta
 * @returns {string}
 */
export function methodPhrase(meta) {
  const names = (meta.methods ?? []).map((m) => `${m}()`);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * What to call the handle, given the props already declared.
 *
 * `element` unless the component declares a prop by that name, in which case the
 * prop keeps it — the prop is part of the component's own API and the handle is
 * prism's addition.
 *
 * @param {import('../parser.js').ComponentMeta} meta
 * @returns {string}
 */
export function handleName(meta) {
  const taken = new Set((meta.props ?? []).map((p) => p.name));
  let name = 'element';
  while (taken.has(name)) name = `_${name}`;
  return name;
}
