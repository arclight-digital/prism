/**
 * Post-generate verification: read back what was just written and check it
 * against what the component declared.
 *
 * Every check prism had before this one asked whether the *inputs* looked right
 * — a union contradicted by CSS, a prop name a framework reserves. None asked
 * whether the file on disk still carried what the component can receive. That
 * gap is how 2.7.0 shipped wrappers with the default slot deleted: the parser
 * was wrong, the generators faithfully did as told, every unit test passed, and
 * nothing compared the result to the component.
 *
 * This is deliberately the dumbest possible check — string matching against the
 * file that was just produced. It needs no framework toolchain, no consuming
 * repo, and no rendering. "Every slot a component declares appears in every
 * wrapper it generates" is a generator-side invariant, so it belongs here rather
 * than in a design system three packages downstream.
 */

/**
 * How each framework spells "the default slot's content goes here".
 *
 * React, Preact, Solid and Angular need no per-named-slot outlet: children are
 * projected into the light DOM as-is and the browser does the slotting from the
 * `slot` attribute. Svelte and Vue interpose their own slot handling, so they
 * need an explicit outlet per named slot or the content has nowhere to go.
 */
const FRAMEWORKS = {
  react: {
    childrenMarker: 'children?: React.ReactNode;',
    namedOutlet: null,
  },
  vue: {
    childrenMarker: '<slot />',
    namedOutlet: (slot) => `<slot name="${slot}" />`,
  },
  svelte: {
    childrenMarker: '{@render children?.()}',
    namedOutlet: (slot, ident) => `{@render ${ident}?.()}`,
  },
  angular: {
    childrenMarker: '<ng-content />',
    namedOutlet: null,
  },
  solid: {
    childrenMarker: '{local.children}',
    namedOutlet: null,
  },
  preact: {
    // h('arc-x', props, children) — the JSX literal doesn't compile for
    // custom elements, so the outlet is h()'s third argument.
    childrenMarker: ', children)',
    namedOutlet: null,
  },
};

/** Frameworks this module knows how to verify. */
export const VERIFIABLE = Object.keys(FRAMEWORKS);

/**
 * Check one generated wrapper against its component.
 *
 * @param {string} framework - one of VERIFIABLE
 * @param {string} content - the generated file's contents
 * @param {import('./parser.js').ComponentMeta} meta
 * @param {Map<string, string>} slotIdents - slot name → snippet prop identifier
 * @returns {Array<{ kind: 'default'|'named', slot?: string }>} missing outlets
 */
export function verifyWrapper(framework, content, meta, slotIdents = new Map()) {
  const spec = FRAMEWORKS[framework];
  if (!spec) return [];
  const missing = [];

  // Only assert the presence of something the component actually declares. A
  // wrapper without children is correct for a component without a default slot;
  // the failure being caught is the opposite one.
  if (meta.hasDefaultSlot && !content.includes(spec.childrenMarker)) {
    missing.push({ kind: 'default' });
  }

  if (spec.namedOutlet) {
    for (const slot of meta.slots ?? []) {
      const outlet = spec.namedOutlet(slot, slotIdents.get(slot) ?? slot);
      if (!content.includes(outlet)) missing.push({ kind: 'named', slot });
    }
  }

  return missing;
}

/**
 * Human-readable diagnostic for a set of missing outlets.
 *
 * @param {string} framework
 * @param {import('./parser.js').ComponentMeta} meta
 * @param {ReturnType<typeof verifyWrapper>} missing
 * @returns {string}
 */
export function describeMissing(framework, meta, missing) {
  const parts = missing.map((m) => (
    m.kind === 'default' ? 'its default slot' : `its "${m.slot}" slot`
  ));
  return (
    `${meta.tag}: the generated ${framework} wrapper has no outlet for ` +
    `${parts.join(' or ')} — content passed there renders nowhere. ` +
    'This is a prism bug, not a component one.'
  );
}
