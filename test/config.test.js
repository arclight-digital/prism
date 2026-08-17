import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { normalizeConfig, isIgnored, discoverComponents } from '../src/config.js';

describe('normalizeConfig', () => {
  it('defaults ignore to empty array', () => {
    const config = normalizeConfig({ components: 'src', tiers: ['content'] });
    expect(config.ignore).toEqual([]);
  });

  it('defaults tiers to empty array', () => {
    const config = normalizeConfig({ components: 'src', ignore: [] });
    expect(config.tiers).toEqual([]);
  });

  it('preserves existing values', () => {
    const config = normalizeConfig({
      ignore: ['**/index.js'],
      tiers: ['reactive'],
      components: 'src',
    });
    expect(config.ignore).toEqual(['**/index.js']);
    expect(config.tiers).toEqual(['reactive']);
  });

  it('throws an actionable error when components is missing', () => {
    expect(() => normalizeConfig({ tiers: ['content'] })).toThrow(/config\.components is required/);
  });

  it('throws when config is not an object', () => {
    expect(() => normalizeConfig(undefined)).toThrow(/config is missing/);
  });

  it('throws when tiers is not an array', () => {
    expect(() => normalizeConfig({ components: 'src', tiers: 'content' })).toThrow(
      /config\.tiers must be an array/
    );
  });

  it('throws when propsFrom is not a function', () => {
    // A misplaced entry that silently did nothing would drop every built prop
    // from every wrapper — the failure the hook exists to fix.
    expect(() => normalizeConfig({ components: 'src', propsFrom: {} })).toThrow(
      /config\.propsFrom must be a function/
    );
  });

  it('accepts a propsFrom function', () => {
    const propsFrom = () => undefined;
    expect(normalizeConfig({ components: 'src', propsFrom }).propsFrom).toBe(propsFrom);
  });
});

describe('isIgnored', () => {
  it('matches bare filename', () => {
    expect(isIgnored('index.js', '/src/reactive/index.js', ['index.js'])).toBe(true);
  });

  it('matches glob-prefixed filename', () => {
    expect(isIgnored('index.js', '/src/reactive/index.js', ['**/index.js'])).toBe(true);
  });

  it('does not match unrelated filename', () => {
    expect(isIgnored('button.js', '/src/reactive/button.js', ['index.js'])).toBe(false);
  });

  it('matches directory glob with forward slashes', () => {
    expect(
      isIgnored('star.js', '/src/reactive/icons/star.js', ['**/icons/**']),
    ).toBe(true);
  });

  it('matches directory glob with backslashes', () => {
    expect(
      isIgnored('star.js', '\\src\\reactive\\icons\\star.js', ['**/icons/**']),
    ).toBe(true);
  });

  it('does not match directory glob outside path', () => {
    expect(
      isIgnored('button.js', '/src/reactive/button.js', ['**/icons/**']),
    ).toBe(false);
  });

  it('matches leading wildcard pattern', () => {
    expect(
      isIgnored('accordion.register.js', '/src/reactive/accordion.register.js', ['**/*.register.js']),
    ).toBe(true);
  });

  it('does not match wildcard pattern against unrelated file', () => {
    expect(
      isIgnored('accordion.js', '/src/reactive/accordion.js', ['**/*.register.js']),
    ).toBe(false);
  });

  it('matches bare wildcard without glob prefix', () => {
    expect(
      isIgnored('button.register.js', '/src/reactive/button.register.js', ['*.register.js']),
    ).toBe(true);
  });

  it('handles empty patterns', () => {
    expect(isIgnored('button.js', '/src/button.js', [])).toBe(false);
  });
});

describe('discoverComponents', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'prism-discover-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('discovers .js files in tier directories', () => {
    const srcDir = join(tmpDir, 'src');
    const tierDir = join(srcDir, 'reactive');
    mkdirSync(tierDir, { recursive: true });
    writeFileSync(join(tierDir, 'button.js'), 'export class ArcButton {}');
    writeFileSync(join(tierDir, 'card.js'), 'export class ArcCard {}');
    writeFileSync(join(tierDir, 'styles.css'), 'body {}');

    const config = normalizeConfig({
      components: 'src',
      tiers: ['reactive'],
    });
    const files = discoverComponents(config, tmpDir);
    expect(files).toHaveLength(2);
    expect(files[0]).toContain('button.js');
    expect(files[1]).toContain('card.js');
  });

  it('ignores files matching ignore patterns', () => {
    const tierDir = join(tmpDir, 'src', 'reactive');
    mkdirSync(tierDir, { recursive: true });
    writeFileSync(join(tierDir, 'button.js'), '');
    writeFileSync(join(tierDir, 'index.js'), '');

    const config = normalizeConfig({
      components: 'src',
      tiers: ['reactive'],
      ignore: ['**/index.js'],
    });
    const files = discoverComponents(config, tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('button.js');
  });

  it('handles missing tier directory gracefully', () => {
    mkdirSync(join(tmpDir, 'src'), { recursive: true });

    const config = normalizeConfig({
      components: 'src',
      tiers: ['nonexistent'],
    });
    const files = discoverComponents(config, tmpDir);
    expect(files).toEqual([]);
  });

  it('scans multiple tiers', () => {
    const contentDir = join(tmpDir, 'src', 'content');
    const reactiveDir = join(tmpDir, 'src', 'reactive');
    mkdirSync(contentDir, { recursive: true });
    mkdirSync(reactiveDir, { recursive: true });
    writeFileSync(join(contentDir, 'badge.js'), '');
    writeFileSync(join(reactiveDir, 'button.js'), '');

    const config = normalizeConfig({
      components: 'src',
      tiers: ['content', 'reactive'],
    });
    const files = discoverComponents(config, tmpDir);
    expect(files).toHaveLength(2);
  });

  it('ignores files matching wildcard patterns like *.register.js', () => {
    const tierDir = join(tmpDir, 'src', 'reactive');
    mkdirSync(tierDir, { recursive: true });
    writeFileSync(join(tierDir, 'accordion.js'), '');
    writeFileSync(join(tierDir, 'accordion.register.js'), '');
    writeFileSync(join(tierDir, 'button.js'), '');
    writeFileSync(join(tierDir, 'button.register.js'), '');

    const config = normalizeConfig({
      components: 'src',
      tiers: ['reactive'],
      ignore: ['**/*.register.js'],
    });
    const files = discoverComponents(config, tmpDir);
    expect(files).toHaveLength(2);
    expect(files.map(f => f.split('/').pop())).toEqual(['accordion.js', 'button.js']);
  });

  it('returns empty for empty tiers', () => {
    const config = normalizeConfig({ components: 'src' });
    const files = discoverComponents(config, tmpDir);
    expect(files).toEqual([]);
  });
});

describe('normalizeConfig — interactivity overrides', () => {
  const base = () => ({ components: 'src', tiers: ['content'] });

  it('defaults to an empty object', () => {
    expect(normalizeConfig(base()).interactivity).toEqual({});
  });

  it('accepts all three levels', () => {
    const cfg = normalizeConfig({
      ...base(),
      interactivity: { 'arc-tab': 'interactive', 'arc-tooltip': 'hybrid', 'arc-box': 'static' },
    });
    expect(cfg.interactivity['arc-tooltip']).toBe('hybrid');
  });

  it('throws on an unknown level', () => {
    expect(() => normalizeConfig({ ...base(), interactivity: { 'arc-tab': 'interactiv' } }))
      .toThrow(/is "interactiv" — must be static, hybrid, or interactive/);
  });

  it('throws on a tag with no hyphen', () => {
    expect(() => normalizeConfig({ ...base(), interactivity: { button: 'static' } }))
      .toThrow(/is not a valid custom-element tag/);
  });

  it('throws on a tag with invalid characters', () => {
    expect(() => normalizeConfig({ ...base(), interactivity: { 'Arc-Tab': 'static' } }))
      .toThrow(/is not a valid custom-element tag/);
  });

  it('throws when interactivity is not an object', () => {
    expect(() => normalizeConfig({ ...base(), interactivity: ['arc-tab'] }))
      .toThrow(/must be an object mapping tag names to levels/);
    expect(() => normalizeConfig({ ...base(), interactivity: 'hybrid' }))
      .toThrow(/must be an object mapping tag names to levels/);
  });
});

describe('normalizeConfig — binding overrides', () => {
  const base = () => ({ components: 'src', tiers: ['content'] });

  it('defaults to an empty object', () => {
    expect(normalizeConfig(base()).bindings).toEqual({});
  });

  it('accepts an exclude list', () => {
    const cfg = normalizeConfig({ ...base(), bindings: { 'arc-select': { exclude: ['label'] } } });
    expect(cfg.bindings['arc-select'].exclude).toEqual(['label']);
  });

  it('propagates bindings to each framework section', () => {
    const cfg = normalizeConfig({
      ...base(),
      bindings: { 'arc-select': { exclude: ['label'] } },
      svelte: { outDir: 'out' },
    });
    expect(cfg.svelte.bindings['arc-select'].exclude).toEqual(['label']);
  });

  it('throws on a malformed tag', () => {
    expect(() => normalizeConfig({ ...base(), bindings: { select: { exclude: ['label'] } } }))
      .toThrow(/is not a valid custom-element tag/);
  });

  it('throws on an unknown rule field', () => {
    expect(() => normalizeConfig({ ...base(), bindings: { 'arc-select': { exclud: ['label'] } } }))
      .toThrow(/unknown field "exclud"/);
  });

  it('throws when exclude is missing or not a string array', () => {
    expect(() => normalizeConfig({ ...base(), bindings: { 'arc-select': {} } }))
      .toThrow(/must be an array of prop names/);
    expect(() => normalizeConfig({ ...base(), bindings: { 'arc-select': { exclude: 'label' } } }))
      .toThrow(/must be an array of prop names/);
    expect(() => normalizeConfig({ ...base(), bindings: { 'arc-select': { exclude: [1] } } }))
      .toThrow(/must be an array of prop names/);
  });

  it('throws when bindings is not an object', () => {
    expect(() => normalizeConfig({ ...base(), bindings: ['arc-select'] }))
      .toThrow(/must be an object mapping tag names to binding rules/);
  });
});

describe('config.runtime', () => {
  const base = { components: 'src', tiers: ['content'] };

  it('is off unless asked for, because importing a module runs it', () => {
    expect(normalizeConfig({ ...base }).runtime).toBeUndefined();
  });

  it('accepts the shorthand', () => {
    expect(normalizeConfig({ ...base, runtime: true }).runtime).toEqual({});
  });

  it('treats false as off rather than as an empty options object', () => {
    expect(normalizeConfig({ ...base, runtime: false }).runtime).toBeUndefined();
  });

  it('accepts a setup module', () => {
    const c = normalizeConfig({ ...base, runtime: { setup: './scripts/dom-shim.js' } });
    expect(c.runtime.setup).toBe('./scripts/dom-shim.js');
  });

  it('rejects a setup that is not a path', () => {
    expect(() => normalizeConfig({ ...base, runtime: { setup: true } }))
      .toThrow(/must be a path to a module/);
  });

  it('rejects a shape it cannot use', () => {
    expect(() => normalizeConfig({ ...base, runtime: 'yes' }))
      .toThrow(/must be true, false, or an object/);
  });
});

describe('config.acknowledge', () => {
  const base = { components: 'src', tiers: ['content'] };

  it('defaults to an empty list', () => {
    expect(normalizeConfig({ ...base }).acknowledge).toEqual([]);
  });

  it('accepts a well-formed entry', () => {
    const c = normalizeConfig({
      ...base,
      acknowledge: [{ code: 'framework-reserved', tag: 'arc-column', prop: 'key', note: 'aliased as field' }],
    });
    expect(c.acknowledge).toHaveLength(1);
  });

  it('rejects a non-array', () => {
    expect(() => normalizeConfig({ ...base, acknowledge: {} })).toThrow(/must be an array/);
  });

  it('rejects an unknown field', () => {
    expect(() => normalizeConfig({ ...base, acknowledge: [{ code: 'doc-drift', reason: 'x' }] }))
      .toThrow(/unknown field "reason"/);
  });

  it('rejects a narrowing field the finding never carries', () => {
    // Otherwise the entry matches nothing and the *only* feedback is
    // `unmatched-acknowledge` — "the issue is gone, or the entry no longer
    // describes it" — which names the one conclusion that isn't true while the
    // finding is still live and still failing the build.
    expect(() => normalizeConfig({
      ...base,
      acknowledge: [{ code: 'props-from-under-reports', tag: 'arc-input', prop: 'value' }],
    })).toThrow(/carry no "prop"/);
  });

  it('says why, for the code whose findings are per-file rather than per-prop', () => {
    expect(() => normalizeConfig({
      ...base,
      acknowledge: [{ code: 'props-from-under-reports', prop: 'value' }],
    })).toThrow(/the fault is the hook's rather than any one prop's/);
  });

  it('accepts the narrowing that does work', () => {
    const c = normalizeConfig({
      ...base,
      acknowledge: [{ code: 'props-from-under-reports', tag: 'arc-input', note: 'accessor pair, not reactive' }],
    });
    expect(c.acknowledge).toHaveLength(1);
  });

  it('rejects a tag on a finding that describes output rather than a component', () => {
    expect(() => normalizeConfig({
      ...base,
      acknowledge: [{ code: 'exports-target-missing', tag: 'arc-input' }],
    })).toThrow(/carry no "tag"/);
  });

  it('judges no fields on a code it does not recognise', () => {
    // That entry is dropped and reported anyway, and judging its shape would
    // version-lock the config in the direction the unknown-code rule avoids.
    expect(() => normalizeConfig({
      ...base,
      acknowledge: [{ code: 'from-a-newer-release', prop: 'value' }],
    })).not.toThrow();
  });

  it('requires a code', () => {
    expect(() => normalizeConfig({ ...base, acknowledge: [{ tag: 'arc-column' }] }))
      .toThrow(/code is required/);
  });

  it('ignores an unrecognised code instead of refusing to run', () => {
    // Codes get added and split between releases. Throwing version-locks the
    // config in both directions: a file written for 2.7 made 2.6 refuse to
    // start, so a rollback generated nothing and looked like it hadn't helped.
    // Being unable to bisect the generator is worse than a no-op entry.
    const c = normalizeConfig({
      ...base,
      acknowledge: [{ code: 'doc-drift', tag: 'arc-chip' }, { code: 'from-a-newer-release' }],
    });
    expect(c.acknowledge.map((e) => e.code)).toEqual(['doc-drift']);
    expect(c.unknownAcknowledgeCodes).toEqual(['from-a-newer-release']);
  });

  it('still refuses to waive its own staleness check', () => {
    // Dropped rather than honoured — an allowlist must not be able to hide the
    // fact that it has gone stale.
    const c = normalizeConfig({ ...base, acknowledge: [{ code: 'unmatched-acknowledge' }] });
    expect(c.acknowledge).toEqual([]);
    expect(c.unknownAcknowledgeCodes).toEqual(['unmatched-acknowledge']);
  });

  it('validates the tag', () => {
    expect(() => normalizeConfig({ ...base, acknowledge: [{ code: 'doc-drift', tag: 'nohyphen' }] }))
      .toThrow(/not a valid custom-element tag/);
  });

  it('validates prop and note types', () => {
    expect(() => normalizeConfig({ ...base, acknowledge: [{ code: 'doc-drift', prop: 3 }] }))
      .toThrow(/\.prop must be a string/);
    expect(() => normalizeConfig({ ...base, acknowledge: [{ code: 'doc-drift', note: true }] }))
      .toThrow(/\.note must be a string/);
  });
});
