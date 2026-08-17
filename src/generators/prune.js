/**
 * Reconciles generated output against the current component set.
 *
 * The per-component generators only ever look at the file they are about to
 * write, so they can clean up a component that stopped producing output (see
 * `removeGenerated`) but are blind to a component that stopped *existing*.
 * Deleting `foo.js` leaves `Foo.ts`, `Foo.vue`, `Foo.svelte`, `foo.css` and
 * `foo.html` behind across every configured target, and nothing ever revisits
 * those paths — they are exported from the barrels and ship forever.
 *
 * This sweep rebuilds the expected output set from the metas and removes any
 * sentinel-bearing file in a target directory that isn't in it.
 */

import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { removeGenerated } from './header.js';

/**
 * How each framework target names its files. `tiered` targets nest output one
 * directory deep per component tier; CSS/HTML are flat and handled separately
 * because their filenames derive from the tag rather than the class name.
 */
const FRAMEWORK_TARGETS = [
  { key: 'react', ext: '.ts' },
  { key: 'vue', ext: '.vue' },
  { key: 'svelte', ext: '.svelte' },
  { key: 'angular', ext: '.ts' },
  { key: 'solid', ext: '.tsx' },
  { key: 'preact', ext: '.tsx' },
];

/** Barrel files are generated but component-independent — never sweep them. */
function isBarrel(fileName) {
  return /^index\./.test(fileName);
}

/** Files directly inside `dir` (no recursion), or [] if it doesn't exist. */
function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => {
    try {
      return statSync(join(dir, f)).isFile();
    } catch {
      return false;
    }
  });
}

/**
 * Collect every directory a target writes into, paired with the set of file
 * names that legitimately belong there.
 * @returns {Map<string, Set<string>>} dir → expected file names
 */
function expectedOutputs(metas, config, root) {
  const expected = new Map();
  const add = (dir, name) => {
    if (!expected.has(dir)) expected.set(dir, new Set());
    if (name) expected.get(dir).add(name);
  };

  for (const { key, ext } of FRAMEWORK_TARGETS) {
    const cfg = config[key];
    if (!cfg) continue;
    // Register every configured tier directory, not just those that currently
    // have components: emptying a tier is exactly when its leftovers matter.
    for (const tier of config.tiers) add(join(root, cfg.outDir, tier), null);
    for (const meta of metas) {
      add(join(root, cfg.outDir, meta.tier), `${meta.pascalName}${ext}`);
    }
  }

  // An interactive component's leftovers are already reported (and pruned) by
  // the generator that skipped it, so the sweep treats its names as spoken for
  // — otherwise each file is claimed twice, reading as two separate problems.
  // The sweep's job is strictly the components that are gone.
  if (config.css) {
    const dir = join(root, config.css.outDir);
    add(dir, null);
    // The bundle is written from all metas at once and owns its own name.
    add(dir, `${config.prefix}-ui.css`);
    for (const meta of metas) add(dir, `${base(meta, config.prefix)}.css`);
  }

  if (config.html) {
    const dir = join(root, config.html.outDir);
    add(dir, null);
    for (const meta of metas) {
      const skipped = meta.interactivity === 'interactive';
      add(dir, `${base(meta, config.prefix)}.html`);
      if (config.html.inlineVariant || skipped) {
        add(dir, `${base(meta, config.prefix)}.inline.html`);
      }
    }
  }

  return expected;
}

function base(meta, prefix) {
  return meta.tag.replace(new RegExp('^' + prefix + '-'), '');
}

/**
 * Extensions a sweep is allowed to touch in a given directory — so an unrelated
 * file that happens to sit in an output dir (a README, a .gitkeep) is never a
 * candidate even if it somehow carried the sentinel.
 */
function sweepableExts(dir, config, root) {
  const exts = new Set();
  for (const { key, ext } of FRAMEWORK_TARGETS) {
    const cfg = config[key];
    if (!cfg) continue;
    for (const tier of config.tiers) {
      if (join(root, cfg.outDir, tier) === dir) exts.add(ext);
    }
  }
  if (config.css && join(root, config.css.outDir) === dir) exts.add('.css');
  if (config.html && join(root, config.html.outDir) === dir) exts.add('.html');
  return exts;
}

/**
 * Find (and optionally delete) generated files with no corresponding component.
 *
 * MUST be called with the complete set of metas — a partial set makes every
 * absent component look deleted. The CLI only calls it after a full discovery
 * pass, never in single-file mode.
 *
 * @param {import('../parser.js').ComponentMeta[]} metas - all current components
 * @param {object} config - normalized config
 * @param {string} root - project root
 * @param {{ apply?: boolean }} [opts] - actually delete (default: report only)
 * @returns {{ stale: string[], removed: string[] }}
 */
export function sweepOrphans(metas, config, root, { apply = false } = {}) {
  const expected = expectedOutputs(metas, config, root);
  const stale = [];
  const removed = [];

  for (const [dir, names] of expected) {
    const exts = sweepableExts(dir, config, root);
    if (exts.size === 0) continue;
    for (const fileName of listFiles(dir)) {
      if (isBarrel(fileName) || names.has(fileName)) continue;
      if (![...exts].some((e) => fileName.endsWith(e))) continue;
      const r = removeGenerated(join(dir, fileName), { apply });
      if (r.stale) stale.push(r.path);
      if (r.removed) removed.push(r.path);
    }
  }

  return { stale, removed };
}
