/**
 * Wrapper package export maps, written from the tree prism generated.
 *
 * The interesting cases are the ones a second program would have to re-infer:
 * which condition a package's toolchain resolves, and which targets can be
 * asserted to exist at generate time (source ones) versus which cannot (dist
 * ones, which the package build produces later and fails loudly about).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateExportsMap } from '../src/generators/exports-map.js';
import { normalizeConfig } from '../src/config.js';

let tmpDir;
beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'prism-exports-')); });
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

/** Lay out a wrapper package with the files a generator would have written. */
function scaffold(framework, ext, files = ['Button', 'Input']) {
  const pkgDir = join(tmpDir, 'packages', framework);
  const srcDir = join(pkgDir, 'src');
  mkdirSync(join(srcDir, 'input'), { recursive: true });
  writeFileSync(join(srcDir, 'index.ts'), '');
  writeFileSync(join(srcDir, 'input', 'index.ts'), '');
  for (const name of files) writeFileSync(join(srcDir, 'input', `${name}${ext}`), '');
  writeFileSync(join(pkgDir, 'package.json'), `${JSON.stringify({ name: `pkg-${framework}` }, null, 2)}\n`);
  return {
    section: {
      outDir: `packages/${framework}/src`,
      packageJson: `packages/${framework}/package.json`,
    },
    read: () => JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8')),
  };
}

const config = { tiers: ['input'] };

describe('generateExportsMap', () => {
  it('gives every component its own subpath', () => {
    const { section, read } = scaffold('react', '.ts');
    const result = generateExportsMap('react', section, config, tmpDir);

    expect(Object.keys(read().exports).sort()).toEqual(['.', './Button', './Input', './input']);
    expect(result.subpaths).toBe(4);
    // No `"./*"` wildcard: it publishes every internal file as unversioned API
    // and is exempt from the existence check below.
    expect(Object.keys(read().exports)).not.toContain('./*');
  });

  it('points a built package at dist, with types beside the code', () => {
    const { section, read } = scaffold('react', '.ts');
    generateExportsMap('react', section, config, tmpDir);
    expect(read().exports['./Button']).toEqual({
      types: './dist/input/Button.d.ts',
      default: './dist/input/Button.js',
    });
    expect(read().main).toBe('dist/index.js');
  });

  it('keeps a `solid` condition pointing at source, so Solid compiles the JSX itself', () => {
    const { section, read } = scaffold('solid', '.tsx');
    generateExportsMap('solid', section, config, tmpDir);
    expect(read().exports['./Button'].solid).toBe('./src/input/Button.tsx');
    expect(read().exports['./Button'].default).toBe('./dist/input/Button.js');
  });

  it('gives Svelte the condition its tooling resolves', () => {
    const { section, read } = scaffold('svelte', '.svelte');
    generateExportsMap('svelte', section, config, tmpDir);
    expect(read().exports['./Button']).toEqual({
      types: './dist/input/Button.svelte.d.ts',
      svelte: './dist/input/Button.svelte',
      default: './dist/input/Button.svelte',
    });
  });

  it('matches vue-tsc’s declaration naming', () => {
    const { section, read } = scaffold('vue', '.vue');
    generateExportsMap('vue', section, config, tmpDir);
    expect(read().exports['./Button'].types).toBe('./dist/input/Button.vue.d.ts');
  });

  it('ships source, and no dist fields, for a package with no build', () => {
    const { section, read } = scaffold('react', '.ts');
    generateExportsMap('react', { ...section, exportsMode: 'src' }, config, tmpDir);
    expect(read().exports['./Button']).toEqual({
      types: './src/input/Button.ts',
      default: './src/input/Button.ts',
    });
    expect(read().main).toBeUndefined();
  });

  it('reports a source target that is not there', () => {
    const { section } = scaffold('solid', '.tsx');
    // A tier with components but no barrel — what `barrels: false` leaves
    // behind. The subpath is still published, and resolves to nothing for
    // anyone who imports it.
    rmSync(join(tmpDir, 'packages', 'solid', 'src', 'input', 'index.ts'));
    const result = generateExportsMap('solid', section, config, tmpDir);
    expect(result.missing).toEqual(['./input → ./src/input/index.ts']);
  });

  it('reports two components that want the same subpath rather than losing one', () => {
    const { section, read } = scaffold('react', '.ts');
    // A second tier with a component of the same name. Whichever is scanned last
    // would win, and the other would have no subpath at all.
    mkdirSync(join(tmpDir, 'packages', 'react', 'src', 'content'), { recursive: true });
    writeFileSync(join(tmpDir, 'packages', 'react', 'src', 'content', 'index.ts'), '');
    writeFileSync(join(tmpDir, 'packages', 'react', 'src', 'content', 'Button.ts'), '');

    const result = generateExportsMap('react', section, { tiers: ['input', 'content'] }, tmpDir);

    expect(result.collisions).toEqual(['./Button (content/Button.ts)']);
    // The first one keeps the subpath — deterministically, by tier order.
    expect(read().exports['./Button'].default).toBe('./dist/input/Button.js');
  });

  it('says nothing about dist targets, which the package build has yet to produce', () => {
    const { section } = scaffold('react', '.ts');
    expect(generateExportsMap('react', section, config, tmpDir).missing).toEqual([]);
  });

  it('leaves the rest of package.json alone', () => {
    const { section, read } = scaffold('react', '.ts');
    const pkgPath = join(tmpDir, 'packages', 'react', 'package.json');
    writeFileSync(pkgPath, `${JSON.stringify({ name: 'pkg', peerDependencies: { react: '^19' } }, null, 2)}\n`);
    generateExportsMap('react', section, config, tmpDir);
    expect(read().peerDependencies).toEqual({ react: '^19' });
  });

  it('is stable across runs', () => {
    const { section, read } = scaffold('react', '.ts');
    generateExportsMap('react', section, config, tmpDir);
    const first = JSON.stringify(read());
    generateExportsMap('react', section, config, tmpDir);
    expect(JSON.stringify(read())).toBe(first);
  });
});

describe('config validation', () => {
  const base = { components: 'src', tiers: ['input'] };

  it('refuses to write an exports map for Angular', () => {
    // ng-packagr owns the published manifest and copies the source one into
    // dist verbatim, so anything written here ships broken.
    expect(() => normalizeConfig({
      ...base,
      angular: { outDir: 'packages/angular/src', packageJson: 'packages/angular/package.json' },
    })).toThrow(/ng-packagr owns the published package\.json/);
  });

  it('rejects an unknown build mode', () => {
    expect(() => normalizeConfig({
      ...base,
      react: { outDir: 'packages/react/src', packageJson: 'packages/react/package.json', exportsMode: 'rollup' },
    })).toThrow(/must be one of/);
  });

  it('accepts a valid section', () => {
    expect(() => normalizeConfig({
      ...base,
      react: { outDir: 'packages/react/src', packageJson: 'packages/react/package.json' },
    })).not.toThrow();
  });
});
