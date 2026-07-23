#!/usr/bin/env node
/**
 * @arclux/prism CLI
 * Auto-generate React wrappers and HTML/CSS from Lit web components.
 *
 * Usage:
 *   prism                          # Generate all
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

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--watch' || args[i] === '-w') {
    watchMode = true;
  } else if (args[i] === '--config' || args[i] === '-c') {
    configPath = args[++i];
  } else if (args[i] && !args[i].startsWith('-')) {
    singleFile = args[i];
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
  const meta = parseComponent(source, filePath, config.prefix);

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
    const htmlOut = generateHTML(meta, config.html, root);
    if (htmlOut.skipped) {
      console.log(`  skip: ${meta.tag.replace(new RegExp('^' + config.prefix + '-'), '')} (interactive — use WC or React import)`);
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
    const cssOut = generateCSS(meta, config.css, root);
    if (!cssOut.skipped) {
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

    console.log('\nWatching for changes...');

    const { watch } = await import('chokidar');
    const componentsDir = join(root, config.components);
    const watcher = watch(
      config.tiers.map((t) => join(componentsDir, t, '*.js')),
      { ignoreInitial: true }
    );

    const rebuildBundle = () => {
      if (!config.css) return;
      const currentFiles = discoverComponents(config);
      const metas = currentFiles
        .map((f) => parseComponent(readFileSync(f, 'utf-8'), f, config.prefix))
        .filter(Boolean);
      if (metas.length > 0) {
        const bundleResults = generateCSSBundle(metas, config.css, root);
        for (const r of bundleResults) {
          console.log(`  bundle: ${relative(root, r.path)}`);
        }
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

    // Removing a component leaves orphaned wrappers, but the CSS bundle must at
    // least be rebuilt so the deleted component's styles drop out of it.
    watcher.on('unlink', (filePath) => {
      const rel = relative(root, filePath);
      const fileName = filePath.split(/[/\\]/).pop();
      if (isIgnored(fileName, filePath, config.ignore)) return;
      console.log(`\nRemoved: ${rel}`);
      try {
        rebuildBundle();
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

    console.log('Done.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
