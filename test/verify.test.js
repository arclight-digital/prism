/**
 * The post-generate check. Its whole job is to notice that a generated file
 * stopped carrying something the component declares — the class of failure that
 * every input-side check in prism is blind to by construction.
 */
import { describe, it, expect } from 'vitest';
import { verifyWrapper, describeMissing, VERIFIABLE } from '../src/verify.js';

const meta = (over = {}) => ({
  tag: 'arc-button', slots: [], hasDefaultSlot: true, ...over,
});

const GOOD = {
  react:   'export interface ButtonProps {\n  children?: React.ReactNode;\n}',
  vue:     '<template>\n  <arc-button>\n    <slot />\n  </arc-button>\n</template>',
  svelte:  '<arc-button>\n  {@render children?.()}\n</arc-button>',
  angular: 'template: `<arc-button><ng-content /></arc-button>`,',
  solid:   '<arc-button>{local.children}</arc-button>',
  preact:  '<arc-button>{children}</arc-button>',
};

describe('default slot', () => {
  for (const framework of VERIFIABLE) {
    it(`${framework} passes when the outlet is present`, () => {
      expect(verifyWrapper(framework, GOOD[framework], meta())).toEqual([]);
    });

    it(`${framework} reports the outlet missing`, () => {
      const missing = verifyWrapper(framework, '<arc-button></arc-button>', meta());
      expect(missing).toEqual([{ kind: 'default' }]);
    });

    it(`${framework} says nothing when the component has no default slot`, () => {
      const m = meta({ hasDefaultSlot: false });
      expect(verifyWrapper(framework, '<arc-button></arc-button>', m)).toEqual([]);
    });
  }
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
