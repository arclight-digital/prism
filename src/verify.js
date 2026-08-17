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

import { acceptsChildren, projectsChildren } from './generators/types.js';

/**
 * How each framework spells the two things a wrapper has to carry: an outlet
 * for the component's content, and the import that registers the element.
 *
 * `carriesNamedSlots` splits the frameworks into their two families. React,
 * Preact, Solid and Angular project children into the light DOM as-is and let
 * the browser do the slotting from the `slot` attribute — so they need no
 * per-named-slot outlet, and their single children outlet is the route for
 * named-slot content too. Svelte and Vue interpose their own slot handling, so
 * they need an explicit outlet per named slot and their children outlet carries
 * only the default one.
 *
 * `registers` is the marker that survives TypeScript's elision of type-only
 * imports. Five frameworks emit a bare side-effect import; React's is a value
 * import, kept alive by `elementClass`.
 */
const FRAMEWORKS = {
  react: {
    childrenMarker: 'children?: React.ReactNode;',
    carriesNamedSlots: true,
    namedOutlet: null,
    registers: (register, meta) => `elementClass: ${meta.className},`,
  },
  vue: {
    childrenMarker: '<slot />',
    carriesNamedSlots: false,
    namedOutlet: (slot) => `<slot name="${slot}" />`,
    registers: (register) => `import '${register}';`,
  },
  svelte: {
    childrenMarker: '{@render children?.()}',
    carriesNamedSlots: false,
    namedOutlet: (slot, ident) => `{@render ${ident}?.()}`,
    registers: (register) => `import '${register}';`,
  },
  angular: {
    childrenMarker: '<ng-content />',
    carriesNamedSlots: true,
    namedOutlet: null,
    registers: (register) => `import '${register}';`,
  },
  solid: {
    childrenMarker: '{local.children}',
    carriesNamedSlots: true,
    namedOutlet: null,
    registers: (register) => `import '${register}';`,
  },
  preact: {
    // h('arc-x', props, children) — the JSX literal doesn't compile for
    // custom elements, so the outlet is h()'s third argument.
    childrenMarker: ', children)',
    carriesNamedSlots: true,
    namedOutlet: null,
    registers: (register) => `import '${register}';`,
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
  // wrapper without children is correct for a component with nowhere to put
  // them; the failure being caught is the opposite one.
  //
  // For the frameworks whose children outlet also carries named-slot content,
  // "declares" means any slot at all. Reading it as "declares a *default* slot"
  // is what left `<arc-top-bar>` — four named slots, no default — with an empty
  // Angular template and no `children` in its Solid props, discarding every
  // child a consumer wrote. This check ran on both and saw nothing to say.
  //
  // Both predicates are the generators' own, so this asks the question that
  // actually matters — did the file come out the way the rule says — rather than
  // re-deriving a weaker rule here and agreeing with itself. It used to test
  // `meta.hasDefaultSlot` directly, which is not the rule either half follows:
  // finding no slots at all is not evidence a component has none, so every
  // wrapper keeps children in that case and nothing checked that they had.
  const needsChildren = spec.carriesNamedSlots ? projectsChildren(meta) : acceptsChildren(meta);
  if (needsChildren && !content.includes(spec.childrenMarker)) {
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
  const parts = missing.map((m) => {
    if (m.kind === 'named') return `its "${m.slot}" slot`;
    // The same `kind` covers two shapes: no outlet for the default slot, and —
    // where one outlet serves every slot — no outlet at all.
    return meta.hasDefaultSlot ? 'its default slot' : 'its named slots';
  });
  return (
    `${meta.tag}: the generated ${framework} wrapper has no outlet for ` +
    `${parts.join(' or ')} — content passed there renders nowhere. ` +
    'This is a prism bug, not a component one.'
  );
}

/**
 * Whether a generated wrapper still registers its custom element.
 *
 * The check that would have caught the worst defect prism has shipped: every
 * Angular wrapper imported the element class in type position only, TypeScript
 * elided the import, and `customElements.define` never ran. The built package
 * contained zero imports of the element library. Nothing static objected —
 * `tsc`, `ng-packagr --strictTemplates`, a production build and a consumer that
 * renders a component all pass against wrappers that render an unupgraded
 * `HTMLUnknownElement`, because setting a property on one and reading it back
 * works fine. It writes an expando.
 *
 * Kept apart from the slot check because it is a different failure with a
 * different fix, and because it is the one that makes a package inert rather
 * than incomplete.
 *
 * @param {string} framework - one of VERIFIABLE
 * @param {string} content - the generated file's contents
 * @param {import('./parser.js').ComponentMeta} meta
 * @param {string} register - the register subpath the wrapper should import
 * @returns {string|null} the marker that is missing, or null if it is present
 */
export function verifyRegistration(framework, content, meta, register) {
  const spec = FRAMEWORKS[framework];
  if (!spec || !register) return null;
  const marker = spec.registers(register, meta);
  return content.includes(marker) ? null : marker;
}

/**
 * Whether a form control's generated wrapper still carries its accessor.
 *
 * The same shape of check as the registration one above, for the same reason: a
 * missing ControlValueAccessor is invisible from every direction that isn't the
 * file itself. The wrapper compiles, `ng-packagr --strictTemplates` passes, and
 * a consumer writing `<arc-input formControlName="email">` gets no error — the
 * binding simply does nothing, and the control stays pristine and empty while
 * the element on screen holds the user's text.
 *
 * Only Angular. Nothing else prism generates has an equivalent — Vue's
 * `v-model` and Svelte's `bind:` are two-way bindings on a prop, which the
 * generators already emit.
 *
 * @param {string} framework
 * @param {string} content - the generated file's contents
 * @param {null | { problem?: string }} binding - `formBinding`'s answer for this
 *   component; null when it isn't form-associated, `problem` when prism knows it
 *   is one but not what a form should bind
 * @returns {string|null} the marker that is missing, or null
 */
export function verifyAccessor(framework, content, binding) {
  if (framework !== 'angular' || !binding || binding.problem) return null;
  // The provider registration rather than the `implements` clause: a class whose
  // name collides with an Angular symbol has its imports aliased, and the token
  // is the one part of the shape no alias can move.
  const marker = 'provide: NG_VALUE_ACCESSOR,';
  return content.includes(marker) ? null : marker;
}

/**
 * Human-readable diagnostic for a form control with no accessor in its wrapper.
 *
 * @param {import('./parser.js').ComponentMeta} meta
 * @returns {string}
 */
export function describeMissingAccessor(meta) {
  return (
    `${meta.tag}: the generated Angular wrapper is form-associated but registers no ` +
    'ControlValueAccessor, so `formControlName`, `formControl` and `[(ngModel)]` bind nothing on it. ' +
    'The binding compiles and reports nothing — the control stays pristine and empty while the ' +
    'element holds the user\'s value. This is a prism bug, not a component one.'
  );
}

/**
 * Human-readable diagnostic for a wrapper that registers nothing.
 *
 * @param {string} framework
 * @param {import('./parser.js').ComponentMeta} meta
 * @param {string} marker - what `verifyRegistration` expected to find
 * @returns {string}
 */
export function describeMissingRegister(framework, meta, marker) {
  return (
    `${meta.tag}: the generated ${framework} wrapper is missing \`${marker}\`, so it never ` +
    'registers the element. Consumers get an unupgraded element — no shadow root, no styles, ' +
    'no behaviour — and every prop writes an expando that reads back correctly. ' +
    'This is a prism bug, not a component one.'
  );
}
