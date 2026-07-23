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
