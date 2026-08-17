/**
 * Writes each wrapper package's `exports` map from the file tree prism just
 * generated — prism decided that tree, so a second program re-inferring it
 * would only re-derive facts known at the point they were decided.
 *
 * Every component gets its own subpath (`@arclux/arc-ui-react/Button`), so a
 * consumer that can't tree-shake a large barrel imports one component without
 * the rest. Deliberately no `"./*"` wildcard: it publishes every internal file
 * as unversioned API and is exempt from the existence check below.
 *
 * Angular is absent on purpose: ng-packagr owns the published package.json for
 * an Angular library and copies a source `exports` map verbatim into dist,
 * where it ships broken — so prism refuses the configuration (see config.js).
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

/**
 * What each package's build emits, and therefore what its subpaths point at.
 *
 *   dist        — tsc/vite output: a .d.ts beside a .js per module
 *   dist-vue    — vite preserveModules (X.vue.js) + vue-tsc (X.vue.d.ts)
 *   dist-svelte — svelte-package: the shipped .svelte plus svelte2tsx
 *                 declarations, under the `svelte` condition its tooling
 *                 resolves
 *   dist-solid  — compiled fallback and declarations, plus a `solid` condition
 *                 pointing at the source .tsx so Solid's own compiler — which
 *                 owns reactivity — processes the JSX rather than a prebuilt
 *                 copy of it
 *   src         — no build step; the source is what ships
 */
const MODES = {
  dist: (rel, base) => ({ types: `./dist/${base}.d.ts`, default: `./dist/${base}.js` }),
  'dist-solid': (rel, base) => ({
    types: `./dist/${base}.d.ts`,
    solid: `./src/${rel}`,
    default: `./dist/${base}.js`,
  }),
  'dist-svelte': (rel, base) => (rel.endsWith('.svelte')
    ? {
        types: `./dist/${base}.svelte.d.ts`,
        svelte: `./dist/${base}.svelte`,
        default: `./dist/${base}.svelte`,
      }
    : { types: `./dist/${base}.d.ts`, svelte: `./dist/${base}.js`, default: `./dist/${base}.js` }),
  'dist-vue': (rel, base) => (rel.endsWith('.vue')
    ? { types: `./dist/${base}.vue.d.ts`, default: `./dist/${base}.vue.js` }
    : { types: `./dist/${base}.d.ts`, default: `./dist/${base}.js` }),
  src: (rel) => ({ types: `./src/${rel}`, default: `./src/${rel}` }),
};

/** The default build mode and file extension per framework. */
const FRAMEWORKS = {
  react: { ext: '.ts', mode: 'dist' },
  preact: { ext: '.tsx', mode: 'dist' },
  solid: { ext: '.tsx', mode: 'dist-solid' },
  svelte: { ext: '.svelte', mode: 'dist-svelte' },
  vue: { ext: '.vue', mode: 'dist-vue' },
};

/** Frameworks an exports map can be written for. */
export const EXPORTABLE = Object.keys(FRAMEWORKS);
/** Modes `config.<framework>.exportsMode` may name. */
export const EXPORT_MODES = Object.keys(MODES);

const SOURCE_EXT = /\.(tsx|ts|svelte|vue)$/;

/** One subpath's target, in whichever shape the package's build produces. */
function entry(mode, rel) {
  return MODES[mode](rel, rel.replace(SOURCE_EXT, ''));
}

/**
 * Build one package's exports map from the generated tree.
 *
 * @param {string} framework
 * @param {object} section - that framework's config section
 * @param {object} config - the normalized config, for `tiers`
 * @param {string} root - project root
 * @returns {{ path: string, written: boolean, subpaths: number, missing: string[],
 *   collisions: string[] }}
 */
export function generateExportsMap(framework, section, config, root) {
  const spec = FRAMEWORKS[framework];
  const mode = section.exportsMode ?? spec.mode;
  const pkgJsonPath = join(root, section.packageJson);
  const pkgDir = dirname(pkgJsonPath);
  const srcDir = join(root, section.outDir);

  const exports = { '.': entry(mode, 'index.ts') };

  // Subpaths are named after the component, not its tier, so two components
  // sharing a name in different tiers want the same one — reported rather than
  // letting whichever tier scans last win silently.
  const collisions = [];

  for (const tier of config.tiers) {
    const tierDir = join(srcDir, tier);
    if (!existsSync(tierDir)) continue;
    exports[`./${tier}`] = entry(mode, `${tier}/index.ts`);
    // Sorted, so a package.json diff shows what changed rather than what the
    // filesystem happened to hand back in what order.
    for (const file of readdirSync(tierDir).sort()) {
      if (file.startsWith('index.')) continue;
      if (!file.endsWith(spec.ext)) continue;
      const subpath = `./${file.replace(SOURCE_EXT, '')}`;
      if (subpath in exports) {
        collisions.push(`${subpath} (${tier}/${file})`);
        continue;
      }
      exports[subpath] = entry(mode, `${tier}/${file}`);
    }
  }

  // Only source targets are checked — a dist target names a file that doesn't
  // exist until the package is built, and asserting it here would mean a clean
  // checkout could never generate.
  const missing = [];
  for (const [subpath, target] of Object.entries(exports)) {
    for (const t of Object.values(target)) {
      if (!t.startsWith('./src/')) continue;
      if (!existsSync(join(pkgDir, t))) missing.push(`${subpath} → ${t}`);
    }
  }

  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
  pkgJson.exports = exports;
  if (mode !== 'src') {
    pkgJson.main = 'dist/index.js';
    pkgJson.module = 'dist/index.js';
    pkgJson.types = 'dist/index.d.ts';
  }
  // Two spaces and a trailing newline, matching npm itself, so regeneration
  // never reformats the parts of the manifest prism doesn't own.
  writeFileSync(pkgJsonPath, `${JSON.stringify(pkgJson, null, 2)}\n`);

  return {
    path: pkgJsonPath,
    written: true,
    subpaths: Object.keys(exports).length,
    missing,
    collisions,
  };
}
