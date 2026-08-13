/**
 * The post-generate check. Its whole job is to notice that a generated file
 * stopped carrying something the component declares — the class of failure that
 * every input-side check in prism is blind to by construction.
 */
import { describe, it, expect } from 'vitest';
import {
  verifyWrapper, describeMissing, verifyRegistration, describeMissingRegister, VERIFIABLE,
} from '../src/verify.js';

const meta = (over = {}) => ({
  tag: 'arc-button', className: 'ArcButton', slots: [], hasDefaultSlot: true, ...over,
});

const GOOD = {
  react:   'export interface ButtonProps {\n  children?: React.ReactNode;\n}',
  vue:     '<template>\n  <arc-button>\n    <slot />\n  </arc-button>\n</template>',
  svelte:  '<arc-button>\n  {@render children?.()}\n</arc-button>',
  angular: 'template: `<arc-button><ng-content /></arc-button>`,',
  solid:   '<arc-button>{local.children}</arc-button>',
  preact:  "h('arc-button', { ...rest }, children)",
};

/** The four whose single children outlet also carries named-slot content. */
const VERBATIM = ['react', 'preact', 'solid', 'angular'];

describe('default slot', () => {
  for (const framework of VERIFIABLE) {
    it(`${framework} passes when the outlet is present`, () => {
      expect(verifyWrapper(framework, GOOD[framework], meta())).toEqual([]);
    });

    it(`${framework} reports the outlet missing`, () => {
      const missing = verifyWrapper(framework, '<arc-button></arc-button>', meta());
      expect(missing).toEqual([{ kind: 'default' }]);
    });

    it(`${framework} says nothing when the component declares no slot at all`, () => {
      // `@slot none` — the author's assertion, which is the only evidence that
      // justifies a wrapper without children. `hasDefaultSlot: false` on its own
      // is not: every generator keeps children when it found no slots, so
      // requiring the outlet there is what the generators actually do.
      const m = meta({ hasDefaultSlot: false, noDefaultSlot: true });
      expect(verifyWrapper(framework, '<arc-button></arc-button>', m)).toEqual([]);
    });
  }
});

describe('a component whose slots are all named', () => {
  // The shape behind arc-ui findings #81 and #82: four named slots, no default.
  const m = meta({ slots: ['logo'], slotsInMarkup: ['logo'], hasDefaultSlot: false });

  for (const framework of VERBATIM) {
    it(`${framework} still needs its children outlet`, () => {
      // One bare outlet is the only route named-slot content has into the light
      // DOM, so its absence is the whole defect — and this check used to pass.
      expect(verifyWrapper(framework, '<arc-button></arc-button>', m), framework)
        .toEqual([{ kind: 'default' }]);
      expect(verifyWrapper(framework, GOOD[framework], m), framework).toEqual([]);
    });
  }

  for (const framework of ['vue', 'svelte']) {
    it(`${framework} needs its per-slot outlet instead`, () => {
      // These two interpose their own slot handling, so the default outlet stays
      // gated on a default slot and the named one is what's required.
      expect(verifyWrapper(framework, GOOD[framework], m), framework)
        .toEqual([{ kind: 'named', slot: 'logo' }]);
    });
  }

  it('describes the missing outlet as the named slots, not a default one', () => {
    const text = describeMissing('angular', m, [{ kind: 'default' }]);
    expect(text).toContain('its named slots');
    expect(text).not.toContain('its default slot');
  });
});

describe('registration', () => {
  // arc-ui finding #80. Five frameworks keep the element alive with a bare
  // side-effect import; React's value import survives on `elementClass`.
  const EXPECTED = {
    react:   'elementClass: ArcButton,',
    vue:     "import '@arclux/arc-ui/button';",
    svelte:  "import '@arclux/arc-ui/button';",
    angular: "import '@arclux/arc-ui/button';",
    solid:   "import '@arclux/arc-ui/button';",
    preact:  "import '@arclux/arc-ui/button';",
  };
  const register = '@arclux/arc-ui/button';

  for (const framework of VERIFIABLE) {
    it(`${framework} passes when the wrapper registers the element`, () => {
      expect(verifyRegistration(framework, EXPECTED[framework], meta(), register)).toBe(null);
    });

    it(`${framework} reports a wrapper that registers nothing`, () => {
      // What Angular shipped: the class named in type position only, which
      // TypeScript erases along with the `customElements.define` side effect.
      const typeOnly = `import type { ArcButton } from '${register}';`;
      expect(verifyRegistration(framework, typeOnly, meta(), register)).toBe(EXPECTED[framework]);
    });
  }

  it('says nothing when there is no subpath to check against', () => {
    expect(verifyRegistration('angular', '', meta(), undefined)).toBe(null);
  });

  it('describeMissingRegister names the marker and the consequence', () => {
    const text = describeMissingRegister('angular', meta(), "import '@arclux/arc-ui/button';");
    expect(text).toContain('arc-button');
    expect(text).toContain("import '@arclux/arc-ui/button';");
    expect(text).toContain('unupgraded');
    expect(text).toContain('prism bug');
  });
});

describe('named slots', () => {
  const m = meta({ slots: ['start', 'icon-left'], hasDefaultSlot: false });
  const idents = new Map([['start', 'start'], ['icon-left', 'iconLeft']]);

  it('Svelte needs a snippet render per slot', () => {
    expect(verifyWrapper('svelte', '{@render start?.()}{@render iconLeft?.()}', m, idents)).toEqual([]);
    expect(verifyWrapper('svelte', '{@render start?.()}', m, idents))
      .toEqual([{ kind: 'named', slot: 'icon-left' }]);
  });

  it('Vue needs a forwarded slot per name', () => {
    expect(verifyWrapper('vue', '<slot name="start" /><slot name="icon-left" />', m, idents)).toEqual([]);
    expect(verifyWrapper('vue', '<slot name="start" />', m, idents))
      .toEqual([{ kind: 'named', slot: 'icon-left' }]);
  });

  it('React, Preact, Solid and Angular need no per-slot outlet', () => {
    // Children are projected into the light DOM as-is and the browser does the
    // slotting from the `slot` attribute — there is nothing for prism to emit.
    for (const framework of ['react', 'preact', 'solid', 'angular']) {
      expect(verifyWrapper(framework, GOOD[framework], meta({ slots: ['start'] })), framework).toEqual([]);
    }
  });
});

describe('describeMissing', () => {
  it('names the component, the framework and every missing outlet', () => {
    const text = describeMissing('svelte', meta({ slots: ['start'] }), [
      { kind: 'default' }, { kind: 'named', slot: 'start' },
    ]);
    expect(text).toContain('arc-button');
    expect(text).toContain('svelte');
    expect(text).toContain('its default slot');
    expect(text).toContain('its "start" slot');
    expect(text).toContain('prism bug');
  });
});

describe('unknown frameworks are ignored rather than guessed at', () => {
  it('returns nothing for a framework it has no predicate for', () => {
    expect(verifyWrapper('ember', '', meta())).toEqual([]);
  });
});
