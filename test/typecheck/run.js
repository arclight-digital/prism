#!/usr/bin/env node
/**
 * Compile the corpus's generated wrappers with each framework's own checker.
 *
 * Every other test here asserts what prism *wrote*. This one asks the only
 * question that matters to a consumer: does the file compile where it lands.
 * Nothing else in this repo can answer it — a generator that tests its output
 * for shape agrees with itself by construction, and the failures in this class
 * are exactly the ones that pass every string assertion. The first run of this
 * harness found a Solid wrapper importing a type it no longer used, which fails
 * `noUnusedLocals` in the template every Solid consumer starts from.
 *
 * Kept out of `npm test` deliberately. It needs six framework toolchains, and
 * prism's own dependency list is one package — a contributor should not install
 * TypeScript, Vue, Svelte, Solid, Preact, React and Angular to fix a regex. CI
 * installs them for this job; see .github/workflows/ci.yml and CONTRIBUTING.md.
 *
 *   npm run test:types
 *
 * The element package the wrappers import is stubbed from the corpus metas
 * themselves — the class, its props and its methods — so the check covers the
 * wrapper's use of the element's own type: the handle's return type, the
 * accessor's property writes, and the `elementClass` React binds.
 *
 * Every framework is then checked a second time against a file with a
 * deliberate type error in it, and has to fail. A checker that silently reads
 * no files reports the same clean exit as one that read all seven and was
 * happy — which is not a hypothetical: the first working version of this put
 * the generated tree under `node_modules/`, where svelte-check does not look,
 * and it reported zero errors on a file that could not compile.
 */

import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { parseComponent } from '../../src/parser.js';
import { generateReact } from '../../src/generators/react.js';
import { generateVue } from '../../src/generators/vue.js';
import { generateSvelte } from '../../src/generators/svelte.js';
import { generateAngular } from '../../src/generators/angular.js';
import { generateSolid } from '../../src/generators/solid.js';
import { generatePreact } from '../../src/generators/preact.js';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORPUS = join(ROOT, 'test', 'fixtures', 'corpus');

/** What each framework needs installed, and how it is checked. */
const FRAMEWORKS = {
  react: {
    generate: generateReact,
    needs: ['typescript', 'react', '@types/react', '@lit/react'],
    compilerOptions: { jsx: 'react-jsx' },
    include: ['src/react/**/*.ts'],
  },
  preact: {
    generate: generatePreact,
    needs: ['typescript', 'preact'],
    compilerOptions: { jsx: 'react-jsx', jsxImportSource: 'preact' },
    include: ['src/preact/**/*.tsx'],
  },
  solid: {
    generate: generateSolid,
    needs: ['typescript', 'solid-js'],
    // What a Solid consumer's own tsconfig says, and the reason the
    // IntrinsicElements augmentation has to name `solid-js/jsx-runtime`.
    compilerOptions: { jsx: 'preserve', jsxImportSource: 'solid-js' },
    include: ['src/solid/**/*.tsx'],
  },
  angular: {
    generate: generateAngular,
    needs: ['typescript', '@angular/core', '@angular/forms'],
    compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false },
    include: ['src/angular/**/*.ts'],
  },
  vue: {
    generate: generateVue,
    needs: ['typescript', 'vue', 'vue-tsc'],
    include: ['src/vue/**/*.vue'],
    // vue-tsc rather than tsc: the template is half the file, and the string
    // template ref the handle is bound through only exists in it.
    command: (dir, config) => ['vue-tsc', ['-p', join(dir, config)]],
  },
  svelte: {
    generate: generateSvelte,
    needs: ['typescript', 'svelte', 'svelte-check'],
    include: ['src/svelte/**/*.svelte'],
    command: (dir, config) => ['svelte-check', ['--tsconfig', join(dir, config), '--output', 'human']],
  },
};

const BASE_OPTIONS = {
  target: 'ES2022',
  module: 'ESNext',
  moduleResolution: 'bundler',
  lib: ['ES2022', 'DOM'],
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  // Both are on in the starter template of at least one framework here, and
  // both have caught a generated import that had stopped being used.
  noUnusedLocals: true,
  noUnusedParameters: true,
  types: [],
  paths: { '@arclux/arc-ui/*': ['./stubs/*'] },
};

/** Every corpus component, parsed from its own source. */
function corpusMetas() {
  return readdirSync(CORPUS).flatMap((tier) =>
    readdirSync(join(CORPUS, tier))
      .filter((f) => f.endsWith('.js'))
      .map((f) => {
        const path = join(CORPUS, tier, f);
        return parseComponent(readFileSync(path, 'utf-8'), path, 'arc');
      })
  );
}

/**
 * A stand-in for the element package: the class each wrapper imports, with the
 * props and methods the corpus says it has. Declared rather than implemented —
 * the wrappers only ever name the type.
 */
function writeStubs(dir, metas) {
  mkdirSync(join(dir, 'stubs'), { recursive: true });
  const tsType = (prop) => (
    prop.values?.length ? prop.values.map((v) => `'${v}'`).join(' | ')
      : prop.type === 'Boolean' ? 'boolean'
      : prop.type === 'Number' ? 'number'
      : prop.type === 'Array' ? 'unknown[]'
      : prop.type === 'Object' ? 'Record<string, unknown>'
      : 'string'
  );
  for (const meta of metas) {
    const members = [
      ...meta.props.map((p) => `  ${p.name}: ${tsType(p)};`),
      ...(meta.methods ?? []).map((m) => `  ${m}(...args: unknown[]): unknown;`),
    ];
    writeFileSync(
      join(dir, 'stubs', `${meta.tag.replace(/^arc-/, '')}.ts`),
      `export declare class ${meta.className} extends HTMLElement {\n${members.join('\n')}\n}\n`
    );
  }
}

/** The packages a framework needs, that aren't installed. */
function missing(needs) {
  return needs.filter((pkg) => {
    try {
      require.resolve(`${pkg}/package.json`, { paths: [ROOT] });
      return false;
    } catch {
      // Not every package exports its manifest; fall back to the entry point.
      try {
        require.resolve(pkg, { paths: [ROOT] });
        return false;
      } catch { return true; }
    }
  });
}

/** A line no checker can accept, put where each file type keeps its script. */
const BAD_LINE = "const __prismProbe: number = 'not a number';";

/**
 * Break one generated file, and hand back what it takes to put it right.
 * @returns {{ path: string, original: string }}
 */
function poison(dir, framework, spec) {
  // The first file the checker's own include glob matches, so a framework
  // cannot be poisoned somewhere it wasn't looking.
  const [pattern] = spec.include;
  const [, subdir] = /^src\/([^/]+)\//.exec(pattern);
  const base = join(dir, 'src', subdir);
  const tier = readdirSync(base)[0];
  const file = readdirSync(join(base, tier))[0];
  const path = join(base, tier, file);

  const original = readFileSync(path, 'utf-8');
  const close = original.indexOf('</script>');
  const broken = close === -1
    ? `${original}\n${BAD_LINE}\n`
    : `${original.slice(0, close)}${BAD_LINE}\n${original.slice(close)}`;
  writeFileSync(path, broken);
  return { path, original };
}

/** @param {{ path: string, original: string }} target */
function restore(target) {
  writeFileSync(target.path, target.original);
}

function run(name, args) {
  const bin = join(ROOT, 'node_modules', '.bin', name);
  return spawnSync(bin, args, { encoding: 'utf-8', cwd: ROOT });
}

const only = process.argv.slice(2);
const metas = corpusMetas();

// Inside the repo, not in a temp directory: every framework here resolves its
// own package by walking up from the file being checked, and from /tmp there is
// nothing to walk up to. Not under `node_modules/` either — svelte-check skips
// it. Gitignored, and removed at the end of a clean run.
const dir = join(ROOT, '.typecheck');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
writeStubs(dir, metas);

let failed = 0;
let checked = 0;
const skipped = [];

for (const [name, spec] of Object.entries(FRAMEWORKS)) {
  if (only.length > 0 && !only.includes(name)) continue;

  const absent = missing(spec.needs);
  if (absent.length > 0) {
    skipped.push(`${name} (needs ${absent.join(', ')})`);
    continue;
  }

  for (const meta of metas) {
    spec.generate(meta, { outDir: `src/${name}`, wcPackage: '@arclux/arc-ui', prefix: 'arc', barrels: false }, dir);
  }

  const config = `tsconfig.${name}.json`;
  writeFileSync(join(dir, config), JSON.stringify({
    compilerOptions: { ...BASE_OPTIONS, ...spec.compilerOptions },
    include: spec.include,
  }, null, 2));

  const [bin, args] = spec.command
    ? spec.command(dir, config)
    : ['tsc', ['-p', join(dir, config)]];
  const check = () => {
    const result = run(bin, args);
    return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
  };

  const clean = check();
  if (!clean.ok) {
    failed++;
    console.error(`✗ ${name}\n${clean.output}\n`);
    continue;
  }

  // The same run against a file that cannot compile. Without this, a checker
  // reading no files at all is indistinguishable from one that passed.
  const target = poison(dir, name, spec);
  const poisoned = check();
  restore(target);
  if (poisoned.ok) {
    failed++;
    console.error(
      `✗ ${name} — reported no error on a file with a deliberate type error in it.\n` +
      `  ${target.path}\n` +
      '  The checker is reading no files, so its clean run said nothing.\n'
    );
    continue;
  }

  checked++;
  console.log(`✓ ${name} — ${metas.length} wrappers, and it fails when it should`);
}

// Left in place after a failure, so the file a checker complained about can be
// opened and read.
if (failed === 0) rmSync(dir, { recursive: true, force: true });
else console.error(`The generated files are in ${dir}`);

if (skipped.length > 0) {
  console.error(
    `\nNot checked: ${skipped.join('; ')}.\n` +
    'Install the toolchains and run again — this job exists to be run, and a\n' +
    'skipped framework is a framework nothing compiled:\n\n' +
    '  npm install --no-save typescript@5 vue vue-tsc svelte svelte-check \\\n' +
    '    solid-js preact react @types/react @lit/react @angular/core @angular/forms\n'
  );
}

if (failed > 0 || skipped.length > 0) process.exit(1);
console.log(`\n${checked} frameworks compiled the corpus clean.`);
