#!/usr/bin/env node
/**
 * @arclux/prism CLI
 * Auto-generate React wrappers and HTML/CSS from Lit web components.
 *
 * Usage:
 *   prism                          # Generate all (reports stale output)
 *   prism --prune                  # Generate all, delete stale output
 *   prism --watch                  # Watch mode
 *   prism --config ./my.config.js  # Custom config
 *   prism path/to/component.js     # Single component
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { parseComponent } from './parser.js';
import { normalizeConfig, isIgnored, discoverComponents as _discoverComponents } from './config.js';
import { generateReact } from './generators/react.js';
import { generateVue } from './generators/vue.js';
import { generateSvelte } from './generators/svelte.js';
import { generateAngular } from './generators/angular.js';
import { generateSolid } from './generators/solid.js';
import { generatePreact } from './generators/preact.js';
import { generateHTML } from './generators/html.js';
import { generateCSS, generateCSSBundle } from './generators/css.js';
import { sweepOrphans } from './generators/prune.js';
import {
  updateWCBarrel,
  updateReactTierBarrel,
  updateReactRootBarrel,
  updateWCRootBarrel,
  updateVueTierBarrel,
  updateVueRootBarrel,
  updateSvelteTierBarrel,
  updateSvelteRootBarrel,
  updateAngularTierBarrel,
  updateAngularRootBarrel,
  updateSolidTierBarrel,
  updateSolidRootBarrel,
  updatePreactTierBarrel,
  updatePreactRootBarrel,
} from './generators/barrel.js';

// ── Parse CLI args ──────────────────────────────────────────
const args = process.argv.slice(2);
let watchMode = false;
let configPath = null;
let singleFile = null;
// Stale output is reported but kept unless --prune is passed. Prism can no
// longer regenerate these files (that is what makes them stale), so deleting
// them is irreversible outside version control — too destructive to be implicit.
let prune = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--watch' || args[i] === '-w') {
    watchMode = true;
  } else if (args[i] === '--prune') {
    prune = true;
  } else if (args[i] === '--config' || args[i] === '-c') {
    configPath = args[++i];
  } else if (args[i] && !args[i].startsWith('-')) {
    singleFile = args[i];
  }
}

/** Report stale/removed paths from a generator result. */
function reportStale(paths, removedPaths) {
  for (const p of paths) {
    const done = removedPaths.includes(p);
    console.log(`  ${done ? 'pruned' : 'stale'}: ${relative(root, p)}${done ? '' : ' (run with --prune to remove)'}`);
  }
}

// ── Load config ─────────────────────────────────────────────
const root = process.cwd();

async function loadConfig() {
  const searchPaths = configPath
    ? [resolve(root, configPath)]
    : [
        join(root, 'prism.config.js'),
      ];

  for (const p of searchPaths) {
    // Distinguish "no config here" from "config exists but is broken": only the
    // former should fall through to the next path. A syntax error or throwing
    // import must surface its real cause instead of the generic not-found below.
    if (!existsSync(p)) continue;
    try {
      const mod = await import(`file://${p}`);
      return mod.default;
    } catch (err) {
      console.error(`Error: failed to load config at ${p}:\n  ${err.message}`);
      process.exit(1);
    }
  }

  console.error('Error: No prism.config.js found');
  process.exit(1);
}

// ── Discover component files ────────────────────────────────
function discoverComponents(config) {
  return _discoverComponents(config, root);
}

// ── Process a single component file ─────────────────────────
function processFile(filePath, config) {
  const source = readFileSync(filePath, 'utf-8');
  const meta = parseComponent(source, filePath, config.prefix, config.interactivity);

  if (!meta) {
    console.log(`  skip: ${relative(root, filePath)} (no component found)`);
    return null;
  }

  const componentsDir = join(root, config.components);

  // React wrapper
  if (config.react) {
    const reactResult = generateReact(meta, config.react, root);
    if (reactResult.written) {
      console.log(`  react: ${relative(root, reactResult.path)}`);
    } else {
      console.log(`  react: ${relative(root, reactResult.path)} (skipped — manual file)`);
    }
  }

  // Vue wrapper
  if (config.vue) {
    const vueResult = generateVue(meta, config.vue, root);
    if (vueResult.written) {
      console.log(`  vue:   ${relative(root, vueResult.path)}`);
    } else {
      console.log(`  vue:   ${relative(root, vueResult.path)} (skipped — manual file)`);
    }
  }

  // Svelte wrapper
  if (config.svelte) {
    const svelteResult = generateSvelte(meta, config.svelte, root);
    if (svelteResult.written) {
      console.log(`  svelte: ${relative(root, svelteResult.path)}`);
    } else {
      console.log(`  svelte: ${relative(root, svelteResult.path)} (skipped — manual file)`);
    }
  }

  // Angular wrapper
  if (config.angular) {
    const angularResult = generateAngular(meta, config.angular, root);
    if (angularResult.written) {
      console.log(`  angular: ${relative(root, angularResult.path)}`);
    } else {
      console.log(`  angular: ${relative(root, angularResult.path)} (skipped — manual file)`);
    }
  }

  // Solid wrapper
  if (config.solid) {
    const solidResult = generateSolid(meta, config.solid, root);
    if (solidResult.written) {
      console.log(`  solid:  ${relative(root, solidResult.path)}`);
    } else {
      console.log(`  solid:  ${relative(root, solidResult.path)} (skipped — manual file)`);
    }
  }

  // Preact wrapper
  if (config.preact) {
    const preactResult = generatePreact(meta, config.preact, root);
    if (preactResult.written) {
      console.log(`  preact: ${relative(root, preactResult.path)}`);
    } else {
      console.log(`  preact: ${relative(root, preactResult.path)} (skipped — manual file)`);
    }
  }

  // HTML example files
  if (config.html) {
    const htmlOut = generateHTML(meta, config.html, root, { prune });
    if (htmlOut.skipped) {
      console.log(`  skip: ${meta.tag.replace(new RegExp('^' + config.prefix + '-'), '')} (interactive — use WC or React import)`);
      reportStale(htmlOut.stale, htmlOut.removed);
    } else {
      const hybridTag = meta.interactivity === 'hybrid' ? ' (hybrid)' : '';
      for (const r of htmlOut.results) {
        if (r.written) {
          console.log(`  html:  ${relative(root, r.path)}${hybridTag}`);
        } else {
          console.log(`  html:  ${relative(root, r.path)} (skipped — manual file)`);
        }
      }
    }
  }

  // Per-component CSS files
  if (config.css) {
    const cssOut = generateCSS(meta, config.css, root, { prune });
    if (cssOut.skipped) {
      reportStale(cssOut.stale, cssOut.removed);
    } else {
      for (const r of cssOut.results) {
        if (r.written) {
          console.log(`  css:   ${relative(root, r.path)}`);
        } else {
          console.log(`  css:   ${relative(root, r.path)} (skipped — manual file)`);
        }
      }
    }
  }

  // Barrel updates (only for new components)
  if (config.react && config.react.barrels) {
    const reactDir = join(root, config.react.outDir);

    const wcBarrel = updateWCBarrel(meta, componentsDir, config.prefix);
    if (wcBarrel.updated) {
      console.log(`  barrel: ${relative(root, wcBarrel.path)} (added ${meta.className})`);
    }

    const wcRootBarrel = updateWCRootBarrel(meta, componentsDir);
    if (wcRootBarrel.updated) {
      console.log(`  barrel: ${relative(root, wcRootBarrel.path)} (added ${meta.className})`);
    }

    const reactTierBarrel = updateReactTierBarrel(meta, reactDir);
    if (reactTierBarrel.updated) {
      console.log(`  barrel: ${relative(root, reactTierBarrel.path)} (added ${meta.pascalName})`);
    }

    const reactRootBarrel = updateReactRootBarrel(meta, reactDir);
    if (reactRootBarrel.updated) {
      console.log(`  barrel: ${relative(root, reactRootBarrel.path)} (added ${meta.pascalName})`);
    }
  }

  // Vue barrel updates
  if (config.vue && config.vue.barrels) {
    const vueDir = join(root, config.vue.outDir);

    const vueTierBarrel = updateVueTierBarrel(meta, vueDir);
    if (vueTierBarrel.updated) {
      console.log(`  barrel: ${relative(root, vueTierBarrel.path)} (added ${meta.pascalName})`);
    }

    const vueRootBarrel = updateVueRootBarrel(meta, vueDir);
    if (vueRootBarrel.updated) {
      console.log(`  barrel: ${relative(root, vueRootBarrel.path)} (added ${meta.pascalName})`);
    }
  }

  // Svelte barrel updates
  if (config.svelte && config.svelte.barrels) {
    const svelteDir = join(root, config.svelte.outDir);

    const svelteTierBarrel = updateSvelteTierBarrel(meta, svelteDir);
    if (svelteTierBarrel.updated) {
      console.log(`  barrel: ${relative(root, svelteTierBarrel.path)} (added ${meta.pascalName})`);
    }

    const svelteRootBarrel = updateSvelteRootBarrel(meta, svelteDir);
    if (svelteRootBarrel.updated) {
      console.log(`  barrel: ${relative(root, svelteRootBarrel.path)} (added ${meta.pascalName})`);
    }
  }

  // Angular barrel updates
  if (config.angular && config.angular.barrels) {
    const angularDir = join(root, config.angular.outDir);

    const angularTierBarrel = updateAngularTierBarrel(meta, angularDir);
    if (angularTierBarrel.updated) {
      console.log(`  barrel: ${relative(root, angularTierBarrel.path)} (added ${meta.pascalName})`);
    }

    const angularRootBarrel = updateAngularRootBarrel(meta, angularDir);
    if (angularRootBarrel.updated) {
      console.log(`  barrel: ${relative(root, angularRootBarrel.path)} (added ${meta.pascalName})`);
    }
  }

  // Solid barrel updates
  if (config.solid && config.solid.barrels) {
    const solidDir = join(root, config.solid.outDir);

    const solidTierBarrel = updateSolidTierBarrel(meta, solidDir);
    if (solidTierBarrel.updated) {
      console.log(`  barrel: ${relative(root, solidTierBarrel.path)} (added ${meta.pascalName})`);
    }

    const solidRootBarrel = updateSolidRootBarrel(meta, solidDir);
    if (solidRootBarrel.updated) {
      console.log(`  barrel: ${relative(root, solidRootBarrel.path)} (added ${meta.pascalName})`);
    }
  }

  // Preact barrel updates
  if (config.preact && config.preact.barrels) {
    const preactDir = join(root, config.preact.outDir);

    const preactTierBarrel = updatePreactTierBarrel(meta, preactDir);
    if (preactTierBarrel.updated) {
      console.log(`  barrel: ${relative(root, preactTierBarrel.path)} (added ${meta.pascalName})`);
    }

    const preactRootBarrel = updatePreactRootBarrel(meta, preactDir);
    if (preactRootBarrel.updated) {
      console.log(`  barrel: ${relative(root, preactRootBarrel.path)} (added ${meta.pascalName})`);
    }
  }

  return meta;
}

/**
 * Warn about `config.interactivity` keys that matched no component. A renamed
 * or deleted component silently drops its override otherwise — the entry just
 * sits in the config looking authoritative while auto-detection quietly decides
 * instead. Needs the full component set, so it runs alongside the sweep.
 */
function warnUnmatchedOverrides(metas, config) {
  const seen = new Set(metas.map((m) => m.tag));
  for (const tag of Object.keys(config.interactivity)) {
    if (!seen.has(tag)) {
      console.warn(`prism: config.interactivity has "${tag}" but no such component was found`);
    }
  }
}

/**
 * Remove output for components that no longer exist. Safe only with the full
 * component set — never call this from single-file mode, where every component
 * except one would look deleted.
 */
function runSweep(metas, config) {
  const { stale, removed } = sweepOrphans(metas, config, root, { apply: prune });
  if (stale.length === 0) return;
  console.log(prune ? '\nRemoved orphaned output:' : '\nOrphaned output (no matching component):');
  reportStale(stale, removed);
}

// ── Main ────────────────────────────────────────────────────
async function main() {
  const config = normalizeConfig(await loadConfig());

  if (singleFile) {
    console.log(`@arclux/prism — processing ${singleFile}`);
    processFile(resolve(root, singleFile), config);
    console.log('Done.');
    return;
  }

  if (watchMode) {
    console.log('@arclux/prism — watch mode');
    const files = discoverComponents(config);
    console.log(`Found ${files.length} components, generating...`);
    const allMetas = [];
    for (const f of files) {
      console.log(`\n${relative(root, f)}:`);
      const meta = processFile(f, config);
      if (meta) allMetas.push(meta);
    }

    // Initial CSS bundle
    if (config.css && allMetas.length > 0) {
      const bundleResults = generateCSSBundle(allMetas, config.css, root);
      for (const r of bundleResults) {
        console.log(`\nbundle: ${relative(root, r.path)}`);
      }
    }

    if (allMetas.length > 0) {
      warnUnmatchedOverrides(allMetas, config);
      runSweep(allMetas, config);
    }

    console.log('\nWatching for changes...');

    const { watch } = await import('chokidar');
    const componentsDir = join(root, config.components);
    const watcher = watch(
      config.tiers.map((t) => join(componentsDir, t, '*.js')),
      { ignoreInitial: true }
    );

    // Re-discovers every component, so it doubles as the place to reconcile
    // orphaned output — the only point in watch mode with a complete meta set.
    const rebuildBundle = ({ sweep = false } = {}) => {
      const currentFiles = discoverComponents(config);
      const metas = currentFiles
        .map((f) => parseComponent(readFileSync(f, 'utf-8'), f, config.prefix, config.interactivity))
        .filter(Boolean);
      if (metas.length === 0) return;
      if (config.css) {
        const bundleResults = generateCSSBundle(metas, config.css, root);
        for (const r of bundleResults) {
          console.log(`  bundle: ${relative(root, r.path)}`);
        }
      }
      if (sweep) {
        warnUnmatchedOverrides(metas, config);
        runSweep(metas, config);
      }
    };

    // Handlers run outside the main() promise chain, so an unguarded throw here
    // (a malformed file, a write/permission error) would be an uncaught
    // exception that kills the whole watcher. Catch, log, and keep watching.
    const handleChange = (label, filePath) => {
      const rel = relative(root, filePath);
      const fileName = filePath.split(/[/\\]/).pop();
      if (isIgnored(fileName, filePath, config.ignore)) return;
      console.log(`\n${label}: ${rel}`);
      try {
        processFile(filePath, config);
        rebuildBundle();
      } catch (err) {
        console.error(`  error processing ${rel}: ${err.message}`);
      }
    };

    watcher.on('change', (filePath) => handleChange('Changed', filePath));
    watcher.on('add', (filePath) => handleChange('New', filePath));

    // Removing a component drops its styles from the rebuilt bundle and leaves
    // its per-framework wrappers orphaned — sweep so both stay in step.
    watcher.on('unlink', (filePath) => {
      const rel = relative(root, filePath);
      const fileName = filePath.split(/[/\\]/).pop();
      if (isIgnored(fileName, filePath, config.ignore)) return;
      console.log(`\nRemoved: ${rel}`);
      try {
        rebuildBundle({ sweep: true });
      } catch (err) {
        console.error(`  error rebuilding bundle: ${err.message}`);
      }
    });

    watcher.on('error', (err) => {
      console.error('Watch error:', err.message);
    });
  } else {
    console.log('@arclux/prism — generating all');
    const files = discoverComponents(config);
    console.log(`Found ${files.length} components\n`);

    const allMetas = [];
    for (const f of files) {
      console.log(`${relative(root, f)}:`);
      const meta = processFile(f, config);
      if (meta) allMetas.push(meta);
      console.log('');
    }

    // Generate CSS bundle (prefix-ui.css)
    if (config.css && allMetas.length > 0) {
      const bundleResults = generateCSSBundle(allMetas, config.css, root);
      for (const r of bundleResults) {
        console.log(`bundle: ${relative(root, r.path)}`);
      }
      console.log('');
    }

    if (allMetas.length > 0) {
      warnUnmatchedOverrides(allMetas, config);
      runSweep(allMetas, config);
    }

    console.log('\nDone.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
