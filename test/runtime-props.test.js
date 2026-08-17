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
