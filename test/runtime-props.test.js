/**
 * Resolving properties from the class instead of the file.
 *
 * The case this exists for is one line of the input fixture:
 * `class ArcInput extends FormControlMixin(LitElement)`. Read from source, the
 * mixin's `readonly`, `required` and `name` are not there to be found — they are
 * in another file — and every wrapper prism generates is missing them. Read from
 * the class, they are ordinary reactive properties like any other. Everything
 * here is really a test of that one difference.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRuntimeProps } from '../src/runtime-props.js';
import { parseComponent } from '../src/parser.js';
import { strictFailures } from '../src/report.js';
import { inheritFrom } from '../src/inherit.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'runtime');
const INPUT = join(FIXTURES, 'input.js');
const BROKEN = join(FIXTURES, 'broken.js');

const parse = (path, opts = {}) =>
  parseComponent(readFileSync(path, 'utf-8'), path, 'arc', {}, opts.diagnostics ?? [], opts);

let runtime;
beforeAll(async () => {
  runtime = await resolveRuntimeProps([INPUT], {}, () => {});
});

describe('resolveRuntimeProps', () => {
  it('reads the classes a module exports, keyed by export name', () => {
    expect([...runtime.get(INPUT).classes.keys()]).toContain('ArcInput');
  });

  it('sees properties a mixin contributed', () => {
    // The whole point. These are in form-control-mixin.js, not input.js.
    const names = runtime.get(INPUT).classes.get('ArcInput').props.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['name', 'required', 'readonly']));
  });

  it('sees properties a helper built, without knowing the vocabulary', () => {
    // `size: oneOf([...])` is a call prism's reader cannot follow. By the time
    // the class exists it is an ordinary reactive property.
    const size = runtime.get(INPUT).classes.get('ArcInput').props.find((p) => p.name === 'size');
    expect(size).toMatchObject({ name: 'size', type: 'String', reflect: true });
  });

  it('takes the attribute name from Lit rather than re-deriving it', () => {
    const props = runtime.get(INPUT).classes.get('ArcInput').props;
    const attr = (name) => props.find((p) => p.name === name).attribute;
    expect(attr('confirmLabel')).toBe('confirmlabel');   // lowercased, not kebab
    expect(attr('hint')).toBe('hint-text');              // explicit
  });

  it('leaves internal state off the public surface', () => {
    const names = runtime.get(INPUT).classes.get('ArcInput').props.map((p) => p.name);
    expect(names).not.toContain('_open');
  });

  it('answers formAssociated from the class, mixin included', () => {
    expect(runtime.get(INPUT).classes.get('ArcInput').formAssociated).toBe(true);
  });

  it('sees the methods a mixin contributed, and stops at the platform', () => {
    // Same shape as `readonly` one line up: real methods of every element built
    // from this mixin, in a file the component's own source never shows. The
    // walk stops before LitElement, or every wrapper would be told the
    // component is driven by `addEventListener` and `requestUpdate`.
    const methods = runtime.get(INPUT).classes.get('ArcInput').methods;
    expect(methods).toEqual(['checkValidity', 'reportValidity']);
  });

  it('takes the methods the class has over the ones its file shows', () => {
    // Read from source this component has none, so its Svelte, Vue, Angular,
    // Solid and Preact wrappers would hand back no element to call them on.
    expect(parse(INPUT).methods).toEqual([]);
    expect(parse(INPUT, { runtime: runtime.get(INPUT) }).methods)
      .toEqual(['checkValidity', 'reportValidity']);
  });

  it('reports a module that will not import, and keeps going', () => {
    // One file's failure costs that file its runtime answer and nothing more.
    const findings = [];
    return resolveRuntimeProps(
      [BROKEN, INPUT],
      {},
      (code, message, extra) => findings.push({ code, message, ...extra })
    ).then((resolved) => {
      expect(findings.map((f) => f.code)).toEqual(['runtime-unavailable']);
      expect(findings[0].message).toContain('cannot be imported outside a browser');
      expect(resolved.has(BROKEN)).toBe(false);
      expect(resolved.has(INPUT)).toBe(true);
    });
  });

  it('reports a setup module that will not import, once rather than per file', () => {
    const findings = [];
    return resolveRuntimeProps(
      [INPUT],
      { setup: join(FIXTURES, 'no-such-shim.js') },
      (code, message) => findings.push({ code, message })
    ).then((resolved) => {
      // Every component would fail the same way, and 200 identical findings
      // describe one problem.
      expect(findings).toHaveLength(1);
      expect(findings[0].code).toBe('runtime-unavailable');
      expect(resolved.size).toBe(0);
    });
  });

  it('survives a duplicate custom element definition', async () => {
    // customElements.define throws on a repeat, exactly as a browser does, and
    // prism hits repeats routinely — a watch rebuild re-imports the same file.
    const again = await resolveRuntimeProps([INPUT], {}, () => { throw new Error('should not warn'); });
    expect(again.get(INPUT).classes.get('ArcInput').props.length).toBeGreaterThan(0);
  });
});

describe('a subclass that declares nothing of its own', () => {
  const MODAL = join(FIXTURES, 'modal.js');
  const DIALOG = join(FIXTURES, 'dialog.js');
  let modal;
  // Both files, because ancestry is resolved against the classes prism actually
  // imported — a base class that was never loaded cannot be linked to.
  beforeAll(async () => { modal = await resolveRuntimeProps([DIALOG, MODAL], {}, () => {}); });

  it('has no props at all when read from source', () => {
    // There is no `static properties` block in the file, because there is
    // nothing in the file. Every wrapper prism generated for this shape
    // accepted nothing — `<Modal open>` did nothing, in all six frameworks,
    // for as long as the packages existed.
    const meta = parse(MODAL);
    expect(meta.className).toBe('ArcModal');
    expect(meta.props).toEqual([]);
  });

  it('inherits every property of its base class when read from the class', () => {
    const props = modal.get(MODAL).classes.get('ArcModal').props.map((p) => p.name);
    expect(props).toEqual(expect.arrayContaining(['open', 'heading', 'dismissible']));
  });

  it('records which component it extends, by class identity rather than by name', () => {
    expect(modal.get(MODAL).classes.get('ArcModal').inheritsFrom)
      .toEqual({ file: DIALOG, exportName: 'ArcDialog' });
  });

  it('takes the events, slots and template its own file does not have', () => {
    // The half that `elementProperties` cannot supply. Props coming back on
    // their own is the dangerous state: a wrapper missing only its event
    // handlers passes every comparison of prop lists, which is the first thing
    // anyone checks — and the refactor that emptied arc-modal's props took
    // onArcClose and onArcOpen with them.
    const meta = parse(MODAL, { runtime: modal.get(MODAL) });
    expect(meta.slots).toEqual([]);
    // Its own `@fires` tags are believed, so the events survive a base class
    // prism was never pointed at — but with no detail keys, so no two-way
    // binding is derived from a tag that states no payload.
    expect(meta.events).toEqual(['arc-close', 'arc-open']);
    expect(meta.eventDetails).toEqual({});

    const { inherited } = inheritFrom(meta, parse(DIALOG, { runtime: modal.get(DIALOG) }));

    expect(meta.events).toEqual(['arc-close', 'arc-open']);
    // The link supplies what the tag cannot: the payload the base dispatches.
    expect(meta.eventDetails['arc-close']).toEqual(['open']);
    expect(meta.slots).toEqual(['footer']);
    expect(meta.hasDefaultSlot).toBe(true);
    expect(meta.template).toContain('<slot');
    // Reported as what it took, so a run says out loud that a component's
    // surface came from somewhere other than its own file.
    expect(inherited).toEqual(
      expect.arrayContaining(['event payloads', 'template', 'slots (footer)', 'default slot'])
    );
  });

  it('takes the defaults and documented unions its properties arrived without', () => {
    // One layer below events and slots, and the same shape. The class says
    // `size` is a reflecting String, which is all a declaration is; that it
    // starts at 'md' is an assignment in the base's constructor and that it is
    // one of three strings is words in a `@prop` tag, and neither is on the
    // class to be read. Svelte is where the first shows, because it is the only
    // emitter that puts defaults in the destructuring — `heading = ''` on the
    // base and a bare `heading` on the subclass. The union costs more quietly:
    // `size: string` instead of `size: 'sm' | 'md' | 'lg'`, in six sets of types.
    const meta = parse(MODAL, { runtime: modal.get(MODAL) });
    const prop = (name) => meta.props.find((p) => p.name === name);
    expect(prop('heading').default).toBe('');
    expect(prop('size').values).toEqual([]);

    const { inherited } = inheritFrom(meta, parse(DIALOG, { runtime: modal.get(DIALOG) }));

    expect(prop('heading').default).toBe("''");
    expect(prop('open').default).toBe('false');
    expect(prop('size').values).toEqual(['sm', 'md', 'lg']);
    expect(inherited).toEqual(
      expect.arrayContaining(['defaults (open, heading, size)', 'documented types (size)'])
    );
  });

  it('does not leave what it inherited where the next parse reads it as its own', () => {
    // The runtime map is resolved once per run and every parse of the file reads
    // it, so handing out its prop objects makes one parse's conclusions the
    // next one's input. Harmless while every conclusion was re-derived from the
    // same source, and not harmless at all once a *parent's* facts are among
    // them: in watch mode the second rebuild would call an inherited default its
    // own, and stop asking where it came from.
    const first = parse(MODAL, { runtime: modal.get(MODAL) });
    inheritFrom(first, parse(DIALOG, { runtime: modal.get(DIALOG) }));
    expect(first.props.find((p) => p.name === 'heading').default).toBe("''");

    const second = parse(MODAL, { runtime: modal.get(MODAL) });
    expect(second.props.find((p) => p.name === 'heading').default).toBe('');
    expect(second.props.find((p) => p.name === 'size').values).toEqual([]);
  });

  it('keeps a default it declared itself, even when it renders its own template', () => {
    // `super()` runs the base constructor whatever the subclass draws, so this
    // is not a rendering fact and does not stop at the template check. It is
    // still only ever filling a hole: a subclass that assigns its own default
    // has been read from its own source and is believed.
    const meta = parse(MODAL, { runtime: modal.get(MODAL) });
    meta.template = '<div></div>';
    meta.props.find((p) => p.name === 'heading').default = "'Untitled'";

    inheritFrom(meta, parse(DIALOG, { runtime: modal.get(DIALOG) }));

    expect(meta.props.find((p) => p.name === 'heading').default).toBe("'Untitled'");
    expect(meta.props.find((p) => p.name === 'size').default).toBe("'md'");
  });

  it('merges its own events with its parent’s rather than replacing them', () => {
    const meta = parse(MODAL, { runtime: modal.get(MODAL) });
    meta.events = ['arc-modal-only'];
    meta.template = '<div></div>';   // renders its own, so nothing else transfers

    inheritFrom(meta, parse(DIALOG, { runtime: modal.get(DIALOG) }));

    expect(meta.events).toEqual(['arc-modal-only', 'arc-close', 'arc-open']);
    // It answered for its own rendering, so it is believed about it.
    expect(meta.slots).toEqual([]);
    expect(meta.template).toBe('<div></div>');
  });

  it('stops reporting the documented props as undeclared, because they are not', () => {
    // The finding was true of the file and false of the component, which is
    // why it read as stale documentation and got waived. Runtime resolution
    // doesn't silence it — it makes it stop being true.
    const before = [];
    parse(MODAL, { diagnostics: before });
    expect(before.filter((d) => d.code === 'doc-prop-undeclared').map((d) => d.prop))
      .toEqual(['open', 'heading']);

    const after = [];
    parse(MODAL, { diagnostics: after, runtime: modal.get(MODAL) });
    expect(after.filter((d) => d.code === 'doc-prop-undeclared')).toEqual([]);
  });
});

describe('a component parsed with its class in hand', () => {
  it('carries the mixin props the source reader cannot see', () => {
    const fromSource = parse(INPUT).props.map((p) => p.name);
    const fromClass = parse(INPUT, { runtime: runtime.get(INPUT) }).props.map((p) => p.name);

    expect(fromSource).not.toContain('readonly');
    expect(fromClass).toEqual(expect.arrayContaining(['readonly', 'required', 'name']));
  });

  it('is form-associated without a hook saying so', () => {
    expect(parse(INPUT).formAssociated).toBe(false);
    expect(parse(INPUT, { runtime: runtime.get(INPUT) }).formAssociated).toBe(true);
  });

  it('still takes defaults, documented unions and enums from the source', () => {
    // The class knows what a property is; the file knows what the author said
    // about it. Neither substitutes for the other.
    const meta = parse(INPUT, { runtime: runtime.get(INPUT) });
    const size = meta.props.find((p) => p.name === 'size');
    expect(size.values).toEqual(['sm', 'md', 'lg']);
    expect(size.default).toBe("'md'");
  });

  it('no longer reports a documented prop the mixin really does provide', () => {
    // `@prop readonly` against a source-only read is the false positive that
    // kept this diagnostic report-only for two releases.
    const sourceOnly = [];
    parse(INPUT, { diagnostics: sourceOnly });
    expect(sourceOnly.filter((d) => d.code === 'doc-prop-undeclared').map((d) => d.prop))
      .toContain('readonly');

    const withClass = [];
    parse(INPUT, { diagnostics: withClass, runtime: runtime.get(INPUT) });
    expect(withClass.filter((d) => d.code === 'doc-prop-undeclared').map((d) => d.prop))
      .not.toContain('readonly');
  });

  it('fails the build for a documented prop the class really does not have', () => {
    const diagnostics = [];
    parse(INPUT, { diagnostics, runtime: runtime.get(INPUT) });

    const ghost = diagnostics.find((d) => d.code === 'doc-prop-undeclared' && d.prop === 'ghost');
    expect(ghost).toBeDefined();
    // Checked against elementProperties, so this is a stale tag rather than a
    // property prism couldn't see — and a one-line fix in the file complaining.
    expect(ghost.strict).toBe(true);
    expect(strictFailures(diagnostics)).toContainEqual(ghost);
  });

  it('reports the props a hook returned fewer of than the class has', () => {
    const diagnostics = [];
    parse(INPUT, {
      diagnostics,
      runtime: runtime.get(INPUT),
      // A hook reading one file — which is all arc-ui's could do, and why
      // `readonly` was missing from 25 components' wrappers for two releases.
      propsFrom: () => [{ name: 'value', type: 'String' }],
    });

    const finding = diagnostics.find((d) => d.code === 'props-from-under-reports');
    expect(finding.props).toEqual(expect.arrayContaining(['readonly', 'required', 'name']));
    expect(finding.message).toContain('elementProperties');
  });

  it('lets an explicit hook stay authoritative', () => {
    // The hook is configuration, and a repo that has one has a reason. Runtime
    // resolution reports the difference rather than overruling it.
    const meta = parse(INPUT, {
      runtime: runtime.get(INPUT),
      propsFrom: () => [{ name: 'value', type: 'String' }],
    });
    expect(meta.props.map((p) => p.name)).toEqual(['value']);
  });
});
