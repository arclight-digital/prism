#!/usr/bin/env node
/**
 * @arclux/prism CLI
 * Auto-generate React wrappers and HTML/CSS from Lit web components.
 *
 * Usage:
 *   prism                          # Generate all (reports stale output)
 *   prism --prune                  # Generate all, delete stale output
 *   prism --strict                 # Exit 1 if anything was reported
 *   prism --report-json out.json   # Write findings as JSON
 *   prism --watch                  # Watch mode
 *   prism --config ./my.config.js  # Custom config
 *   prism path/to/component.js     # Single component
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
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
import { reservedCollisions, slotSnippetNames } from './generators/identifiers.js';
import {
  verifyWrapper, describeMissing, verifyRegistration, describeMissingRegister,
  verifyAccessor, describeMissingAccessor,
} from './verify.js';
import { registerImport } from './generators/imports.js';
import { VERSION } from './generators/header.js';
import { formBinding } from './generators/form-control.js';
import { scanForNewerOutput, downgradeFinding, describeDowngrade } from './preflight.js';
import { resolveRuntimeProps } from './runtime-props.js';
import { generateJSXTypes } from './generators/jsx-types.js';
import { generateExportsMap, EXPORTABLE } from './generators/exports-map.js';
import {
  outputSummary, misclassified, formatBytes, strictFailures, groupDiagnostics,
  partitionAcknowledged,
} from './report.js';
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
  pruneBarrels,
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
// Turn everything prism reports into an exit code. A caller that pipes stdout
// and only surfaces it when a step fails — which is how prism is actually run —
// cannot observe a warning any other way, so on a normal run the entire report
// is invisible. This is the flag that makes it observable.
let strict = false;
// Machine-readable findings. Grepping the human block means matching prose that
// changes between releases — 2.5.0's regrouping silently broke a downstream
// filter that had keyed on the word "warning". This is the contract that
// doesn't move.
let reportJsonPath = null;

// What the component classes themselves said, when `config.runtime` is on:
// file path → the classes that module exports. Resolved once, before any
// parsing, because the parser is synchronous and importing is not — and because
// one pass over the catalog with error isolation per file is easier to reason
// about than an import interleaved with every parse.
let runtimeProps = new Map();

// Diagnostics collected from every parse this run. Passing a collector to
// parseComponent suppresses its own console output, so these print once, here,
// grouped, instead of interleaved through hundreds of per-component lines.
const diagnostics = [];

// Paths the pre-flight already reported as written by a newer prism. The
// per-file check in `verifyGenerated` looks at the same stamp from the other
// side of the write, so without this every downgraded file is reported twice —
// once as what would happen, once as what did.
const reportedDowngrades = new Set();

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--watch' || args[i] === '-w') {
    watchMode = true;
  } else if (args[i] === '--prune') {
    prune = true;
  } else if (args[i] === '--strict') {
    strict = true;
  } else if (args[i] === '--report-json') {
    reportJsonPath = args[++i];
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
  const meta = parseComponent(source, filePath, config.prefix, config.interactivity, diagnostics, {
    propsFrom: config.propsFrom,
    formAssociated: config.formAssociated,
    runtime: runtimeProps.get(filePath),
  });

  if (!meta) {
    console.log(`  skip: ${relative(root, filePath)} (no component found)`);
    return null;
  }

  // Only frameworks actually being generated are checked — a React collision
  // isn't a finding for a project that doesn't emit React wrappers.
  const enabled = ['react', 'vue', 'svelte', 'angular', 'solid', 'preact'].filter((f) => config[f]);
  for (const { prop, frameworks } of reservedCollisions(meta.props, enabled)) {
    // The remedy is an alias, not a rename. The prop works everywhere else, so
    // renaming it would break every working consumer to fix the broken ones —
    // adding a second name the component falls back to breaks nobody.
    const unaffected = enabled.filter((f) => !frameworks.includes(f));
    const stillWorks = unaffected.length > 0
      ? ` It still works in ${unaffected.join(', ')}, so prefer adding an alias prop the component falls back to over renaming.`
      : '';
    diagnostics.push({
      code: 'framework-reserved',
      message:
        `${meta.tag} prop "${prop}" is reserved by ${frameworks.join(', ')} — ` +
        'it is intercepted before the component sees it, so the prop silently ' +
        `does nothing there.${stillWorks} Prism cannot work around this in the wrapper.`,
      file: filePath,
      tag: meta.tag,
      prop,
      frameworks,
      unaffected,
    });
  }

  // Slot names the Svelte wrapper had to rename. Svelte derives a snippet prop
  // name from the `slot` attribute verbatim, and `icon-left` is a legal slot name
  // but not a legal identifier — so the prop is `iconLeft` and the legacy
  // `<x slot="icon-left">` form has no prop to route to. The `{#snippet}` form
  // works; the attribute form silently doesn't, which is worth saying out loud.
  if (config.svelte && meta.slots.length > 0) {
    const propNames = new Set(meta.props.map((p) => p.name));
    for (const [slot, ident] of slotSnippetNames(meta.slots, meta.props)) {
      if (slot === ident) continue;
      // Two different causes, and only one of them has a fix worth making.
      // `icon-left` isn't a legal identifier, so renaming the slot is reasonable
      // advice. `eyebrow` is a perfectly good identifier that a prop of the same
      // name already occupies — a deliberate pairing (prop for the string case,
      // slot to override with markup) — and renaming it would put a trailing
      // underscore in the public HTML API of six frameworks to satisfy one.
      const collides = propNames.has(slot);
      diagnostics.push(collides ? {
        code: 'slot-name-collides-with-prop',
        message:
          `${meta.tag} slot "${slot}" shares its name with a prop, so the Svelte wrapper exposes ` +
          `the snippet as \`${ident}\`. No action needed — the slot keeps its real name everywhere ` +
          `else; Svelte consumers write \`{#snippet ${ident}()}\`.`,
        file: filePath,
        tag: meta.tag,
        slot,
        prop: ident,
      } : {
        code: 'slot-name-not-identifier',
        message:
          `${meta.tag} slot "${slot}" is not a valid identifier, so the Svelte wrapper exposes it ` +
          `as \`${ident}\`. \`{#snippet ${ident}()}\` reaches it; \`slot="${slot}"\` on a child does ` +
          'not, because Svelte takes the prop name from the attribute verbatim. Rename the slot to ' +
          `"${ident}" on the component if both forms need to work.`,
        file: filePath,
        tag: meta.tag,
        slot,
        prop: ident,
      });
    }
  }

  // Wrappers that advertise `children` for an element with no default slot to
  // put them in. Reported rather than acted on: the only evidence prism has is
  // that it found no `<slot>` in this file, and a default slot rendered by a
  // base class, a mixin or an imported helper looks exactly the same from here.
  // 2.7.0 acted on evidence this weak and deleted content from 90 wrappers, so
  // this states the case and leaves the call to someone who can see the whole
  // component. `@slot none` is how they record it.
  if (
    !meta.hasDefaultSlot &&
    !meta.noDefaultSlot &&
    (meta.slotsInMarkup?.length ?? 0) === 0 &&
    enabled.length > 0
  ) {
    diagnostics.push({
      code: 'children-without-default-slot',
      message:
        `${meta.tag} has no default <slot> that prism could find, but its wrappers still accept ` +
        '`children` — content passed there lands unassigned in the light DOM and renders nothing. ' +
        'If the component really has no default slot, document `@slot none` and the wrappers will ' +
        'stop accepting children; if it inherits one, this is expected and needs nothing.',
      file: filePath,
      tag: meta.tag,
    });
  }

  // A form-associated element whose wrapper cannot take a ControlValueAccessor.
  // Reported rather than passed over, because the failure it prevents is silent:
  // `<arc-input formControlName="email">` on a wrapper without an accessor binds
  // nothing and reports nothing, and the control stays pristine and empty while
  // the element on screen holds the user's text. Angular-gated, like the
  // reserved-name check above — this is not a finding for a project generating
  // no Angular wrappers. The same function the generator uses, so the report and
  // the output can't disagree.
  if (config.angular) {
    const form = formBinding(meta, config.angular);
    if (form?.problem) {
      diagnostics.push({
        code: 'form-control-unbindable',
        message: form.problem,
        file: filePath,
        tag: meta.tag,
      });
    }
  }

  // `@slot none` next to a rendered `<slot>`. The markup wins — children are
  // kept — but one of the two is wrong and only the author knows which.
  if (meta.hasDefaultSlot && meta.noDefaultSlot) {
    diagnostics.push({
      code: 'slot-none-contradicted',
      message:
        `${meta.tag} documents \`@slot none\` but renders a default <slot>. The markup wins and the ` +
        'wrappers still accept children — either the tag is stale, or the slot is.',
      file: filePath,
      tag: meta.tag,
    });
  }

  // Read each wrapper back and check it still carries what the component
  // declares. Cheap, and it is the check whose absence let 2.7.0 ship wrappers
  // with the default slot deleted — every input-side check passed, because the
  // inputs were fine and the output was not.
  const slotIdents = slotSnippetNames(meta.slots ?? [], meta.props);
  const verifyGenerated = (framework, result) => {
    if (!result?.written) return result;   // manual file — not ours to judge

    // The file that was just overwritten carried a *newer* version stamp than
    // the generator doing the overwriting. Nothing errors in that situation —
    // prism rewrites every wrapper it owns from whatever version is installed,
    // so an older one silently reverts 235 files and the only signal is a large
    // diff in generated output nobody reads. CI then reports it as "generated
    // files are out of date", which reads as stale committed output and invites
    // the exact wrong fix: commit the revert. This is the run that can say
    // otherwise, and the only one — the files now carry the older stamp, so the
    // next run has nothing left to notice.
    if (result.priorVersion && !reportedDowngrades.has(result.path)) {
      diagnostics.push({
        code: 'generator-downgrade',
        message:
          `${meta.tag}: the ${framework} wrapper on disk was generated by prism ${result.priorVersion}, ` +
          `and this run has rewritten it with ${VERSION}. A downgrade does not fail — it reverts, so ` +
          'everything the newer generator emitted into this file is now gone. Check the diff before ' +
          `committing, and install ${result.priorVersion} or later if the revert wasn't intended.`,
        file: result.path,
        tag: meta.tag,
        framework,
        priorVersion: result.priorVersion,
        version: VERSION,
      });
    }

    const content = readFileSync(result.path, 'utf-8');
    const missing = verifyWrapper(framework, content, meta, slotIdents);
    if (missing.length > 0) {
      diagnostics.push({
        code: 'wrapper-missing-slot',
        message: describeMissing(framework, meta, missing),
        file: result.path,
        tag: meta.tag,
        framework,
        missing,
      });
    }

    const accessor = verifyAccessor(framework, content, formBinding(meta, config[framework]));
    if (accessor) {
      diagnostics.push({
        code: 'wrapper-missing-accessor',
        message: describeMissingAccessor(meta),
        file: result.path,
        tag: meta.tag,
        framework,
        marker: accessor,
      });
    }

    // The framework key is the config section's name, so the register subpath
    // is derived from the same config the generator was handed.
    const marker = verifyRegistration(framework, content, meta, registerImport(meta, config[framework]));
    if (marker) {
      diagnostics.push({
        code: 'wrapper-missing-register',
        message: describeMissingRegister(framework, meta, marker),
        file: result.path,
        tag: meta.tag,
        framework,
        marker,
      });
    }
    return result;
  };

  const componentsDir = join(root, config.components);

  // React wrapper
  if (config.react) {
    const reactResult = verifyGenerated('react', generateReact(meta, config.react, root));
    if (reactResult.written) {
      console.log(`  react: ${relative(root, reactResult.path)}`);
    } else {
      console.log(`  react: ${relative(root, reactResult.path)} (skipped — manual file)`);
    }
  }

  // Vue wrapper
  if (config.vue) {
    const vueResult = verifyGenerated('vue', generateVue(meta, config.vue, root));
    if (vueResult.written) {
      console.log(`  vue:   ${relative(root, vueResult.path)}`);
    } else {
      console.log(`  vue:   ${relative(root, vueResult.path)} (skipped — manual file)`);
    }
  }

  // Svelte wrapper
  if (config.svelte) {
    const svelteResult = verifyGenerated('svelte', generateSvelte(meta, config.svelte, root));
    if (svelteResult.written) {
      console.log(`  svelte: ${relative(root, svelteResult.path)}`);
    } else {
      console.log(`  svelte: ${relative(root, svelteResult.path)} (skipped — manual file)`);
    }
  }

  // Angular wrapper
  if (config.angular) {
    const angularResult = verifyGenerated('angular', generateAngular(meta, config.angular, root));
    if (angularResult.written) {
      console.log(`  angular: ${relative(root, angularResult.path)}`);
    } else {
      console.log(`  angular: ${relative(root, angularResult.path)} (skipped — manual file)`);
    }
  }

  // Solid wrapper
  if (config.solid) {
    const solidResult = verifyGenerated('solid', generateSolid(meta, config.solid, root));
    if (solidResult.written) {
      console.log(`  solid:  ${relative(root, solidResult.path)}`);
    } else {
      console.log(`  solid:  ${relative(root, solidResult.path)} (skipped — manual file)`);
    }
  }

  // Preact wrapper
  if (config.preact) {
    const preactResult = verifyGenerated('preact', generatePreact(meta, config.preact, root));
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
  // …except a component config.barrelExclude keeps out of them: its dependency
  // must not become everyone's just by being reachable from the barrel. The
  // component is still generated; it is reached by its own subpath.
  const inBarrels = !(config.barrelExclude ?? []).includes(meta.tag);
  if (inBarrels && config.react && config.react.barrels) {
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
  if (inBarrels && config.vue && config.vue.barrels) {
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
  if (inBarrels && config.svelte && config.svelte.barrels) {
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
  if (inBarrels && config.angular && config.angular.barrels) {
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
  if (inBarrels && config.solid && config.solid.barrels) {
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
  if (inBarrels && config.preact && config.preact.barrels) {
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
 * Import the component modules and read their classes, if `config.runtime` is
 * on. A no-op otherwise, which is the default.
 *
 * Its findings go through the same collector as everything else, so a module
 * that wouldn't import is reported alongside the run it degraded rather than
 * printed loose above it.
 */
async function loadRuntimeProps(files, config) {
  if (!config.runtime) return;
  const warn = (code, message, extra = {}) => diagnostics.push({ code, message, ...extra });
  runtimeProps = await resolveRuntimeProps(
    files,
    // Resolved against the project root here, so the config file can say
    // './scripts/dom-shim.js' and mean the same thing every other path there
    // means.
    { ...config.runtime, setup: config.runtime.setup && resolve(root, config.runtime.setup) },
    warn
  );
  const resolved = runtimeProps.size;
  if (resolved > 0) {
    console.log(`runtime: ${resolved} of ${files.length} component modules resolved from the class\n`);
  }
}

/**
 * Look for output written by a newer prism before writing anything, and decide
 * whether this run should happen at all.
 *
 * Only for the modes that rewrite the whole tree. Single-file mode is left to
 * the per-file check: it touches one file, and a whole-tree scan there would
 * report on files the run will never go near.
 *
 * Under `--strict` this refuses rather than reports, which is the only version
 * of this check that actually prevents anything — every other route reports the
 * revert after making it, and then clears itself on the next run because the
 * files now carry the older stamp. Not in watch mode: exiting a long-running
 * watcher on a finding would be hostile, and `--strict` is already a no-op
 * there.
 *
 * @returns {boolean} true if the run should stop before generating
 */
function preflight(config) {
  const scan = scanForNewerOutput(config, root);
  if (scan.newer.length === 0) return false;

  const aborting = strict && !watchMode;
  console.error(describeDowngrade(scan, aborting));
  for (const entry of scan.newer) {
    reportedDowngrades.add(entry.path);
    diagnostics.push(downgradeFinding(entry, relative(root, entry.path)));
  }
  return aborting;
}

/**
 * Output that describes the whole catalog rather than one component: the JSX
 * declaration files and the wrapper packages' export maps.
 *
 * Both need the complete meta set, so like the CSS bundle and the orphan sweep
 * they never run in single-file mode — where every component except one would
 * look as though it had been deleted.
 *
 * @param {import('./parser.js').ComponentMeta[]} metas
 * @param {object} config - normalized config
 * @param {import('./parser.js').Diagnostic[]} sink - where findings go; a
 *   throwaway array on the incidental rebuilds that only exist to refresh output
 */
function generateCatalogOutputs(metas, config, sink) {
  if (config.jsxTypes) {
    for (const r of generateJSXTypes(metas, config.jsxTypes, root)) {
      // The "skipped" wording is the same safety rule as everywhere else, but
      // this is the one path a consumer reaches by *migrating* — they had their
      // own generator writing this exact file — so it says what to do rather
      // than only what happened. Read as a failure, it looks like prism can't
      // write the file; it is prism declining to clobber something it didn't
      // write.
      console.log(r.written
        ? `jsx:   ${relative(root, r.path)} (${r.framework}, ${r.tags} tags)`
        : `jsx:   ${relative(root, r.path)} (skipped — not prism's; delete it to hand the file over)`);

      // …and a log line is not enough, which is the difference between this and
      // the identical skip on a wrapper. Hand-writing one wrapper is a standing
      // arrangement — a component whose slots are built at runtime has to be
      // authored by hand, and prism stepping around it every run is the feature.
      // There is no such arrangement here: configuring `jsxTypes` says prism
      // should produce these files, so a foreign file at one of those paths is
      // near-certainly a migration that hasn't finished. Left as a log line it
      // is one of several hundred, and the failure it hides is the quiet kind —
      // a green pipeline still shipping the pre-migration copy, indefinitely,
      // because nothing ever writes over it. Reported instead, so `--strict`
      // stops once and the decision gets made; `config.acknowledge` records the
      // decision to keep your own file.
      if (!r.written) {
        sink.push({
          code: 'jsx-types-not-written',
          message:
            `${relative(root, r.path)} already exists and prism did not write it, so it was left ` +
            'alone — its content is whatever produced it, not this catalog. If you are moving off ' +
            'your own generator, delete the file and prism owns it from the next run; until then ' +
            'every run is green while the pre-migration copy is what ships. If you meant to keep ' +
            'your own, acknowledge `jsx-types-not-written`.',
          file: r.path,
          framework: r.framework,
        });
      }
    }
  }

  for (const framework of EXPORTABLE) {
    const section = config[framework];
    if (!section?.packageJson) continue;
    const r = generateExportsMap(framework, section, config, root);
    console.log(`exports: ${relative(root, r.path)} (${r.subpaths} subpaths)`);
    for (const target of r.missing) {
      // A subpath pointing at source that isn't there. Published, this is a
      // consumer's `ERR_MODULE_NOT_FOUND` on an import that reads as supported;
      // here it is a line. Only source targets are checked — a dist target names
      // a file the package build has yet to produce.
      sink.push({
        code: 'exports-target-missing',
        message:
          `${framework}: the exports map names ${target}, which does not exist. Published, that ` +
          'subpath resolves to nothing for anyone who imports it.',
        file: r.path,
        framework,
      });
    }
    for (const subpath of r.collisions) {
      sink.push({
        code: 'exports-subpath-collision',
        message:
          `${framework}: two components want the subpath ${subpath}. Subpaths are named after the ` +
          'component rather than its tier, so only one of them can have it and the other is ' +
          'unreachable by name — rename one of the components.',
        file: r.path,
        framework,
      });
    }
  }
}

/**
 * State what the run did not produce. Skipping is normal, but the aggregate is
 * never visible per-component, and a component silently contributing nothing to
 * the package is exactly how a shipped-with-no-button-styles bug survives.
 */
function reportOutput(metas) {
  const s = outputSummary(metas);
  if (s.skipped === 0) return;
  console.log(
    `\n${s.emitting} of ${s.total} components produce HTML/CSS; ` +
    `${s.skipped} are interactive (${formatBytes(s.skippedCSSBytes)} of component CSS reaches no output).`
  );

  const suspects = misclassified(metas);
  if (suspects.length === 0) return;
  // Capped: this prints on every run, and a wall of 30 lines trains people to
  // scroll past it. Sorted by stylesheet size, so the truncated tail is always
  // the least consequential.
  const SHOWN = 10;
  console.log(
    `\n${suspects.length} of those ${suspects.length === 1 ? 'looks' : 'look'} presentational` +
    ' — few handlers on a substantial stylesheet:'
  );
  for (const m of suspects.slice(0, SHOWN)) {
    const sig = m.classification.signals;
    const on = sig.handlers.length ? `@${sig.handlers.join(', @')}` : 'a dispatched event';
    console.log(`  ${m.tag} — ${formatBytes(m.css.length)} CSS, classified interactive by ${on}`);
  }
  if (suspects.length > SHOWN) {
    console.log(`  … and ${suspects.length - SHOWN} more with smaller stylesheets`);
  }
  console.log("  Pin any that render without JS: config.interactivity: { '<tag>': 'hybrid' }");
}

/**
 * Warn about `config.interactivity` keys that matched no component. A renamed
 * or deleted component silently drops its override otherwise — the entry just
 * sits in the config looking authoritative while auto-detection quietly decides
 * instead. Needs the full component set, so it runs alongside the sweep.
 */
/**
 * Acknowledge entries this version doesn't recognise. Reported, never fatal —
 * see normalizeConfig. Not a strict failure: a rollback for bisection must be
 * able to run a config written for a newer release.
 */
function warnUnknownAcknowledgeCodes(config) {
  for (const code of config.unknownAcknowledgeCodes ?? []) {
    diagnostics.push({
      code: 'unknown-acknowledge-code',
      message:
        `config.acknowledge names "${code}", which this version of prism does not emit — ` +
        'entry ignored. Expected if the config was written for a newer release.',
    });
  }
}

function warnUnmatchedOverrides(metas, config) {
  const seen = new Set(metas.map((m) => m.tag));
  for (const tag of Object.keys(config.interactivity)) {
    if (!seen.has(tag)) {
      diagnostics.push({
        code: 'unmatched-override',
        message: `config.interactivity has "${tag}" but no such component was found`,
        tag,
      });
    }
  }
}

/**
 * Print everything the parse turned up, grouped and capped, and set the exit
 * code under --strict.
 *
 * Capped for the same reason the misclassification list is: a wall of lines on
 * every run trains people to scroll past it. The count is always stated in
 * full, so a truncated list never reads as a complete one.
 */
function flushDiagnostics(config) {
  const LABELS = {
    'slot-name-not-identifier': 'slot names that are not valid identifiers',
    'slot-name-collides-with-prop': 'slots sharing a name with a prop — informational, no action',
    'unparsed-prop-declaration': "declared props prism's reader could not type — missing from every wrapper",
    'doc-prop-undeclared': 'documented @prop names with no reactive property behind them',
    'invalid-props-from': 'config.propsFrom returning something prism could not use',
    'props-from-under-reports': 'config.propsFrom answering with fewer props than the file documents',
    'invalid-form-associated': 'config.formAssociated returning something prism could not use',
    'runtime-unavailable': 'component modules that would not import — read from source instead',
    'form-control-unbindable': 'form-associated elements whose wrappers get no ControlValueAccessor',
    'generator-downgrade': 'generated files written by a newer prism than the one running',
    'framework-reserved': 'prop names a framework reserves — silently dropped at runtime',
    'doc-drift': 'documented @prop unions contradicted by the CSS or the default',
    'unportable-doc-type': 'documented @prop types naming symbols prism cannot import',
    'unusable-doc-type': 'documented @prop types prism could not emit safely',
    'unmatched-override': 'config.interactivity entries matching no component',
    'unmatched-acknowledge': 'config.acknowledge entries matching no finding',
    'wrapper-missing-register': 'generated wrappers that never register their element — inert at runtime',
    'wrapper-missing-slot': 'generated wrappers missing an outlet the component declares',
    'wrapper-missing-accessor': 'form controls whose Angular wrapper lost its ControlValueAccessor',
    'exports-target-missing': 'exports-map subpaths pointing at files that do not exist',
    'exports-subpath-collision': 'components whose names want the same package subpath',
    'jsx-types-not-written': 'configured JSX declaration files something else already owns',
    'children-without-default-slot': 'wrappers accepting children for elements with no default slot',
    'slot-none-contradicted': '`@slot none` on components that do render a default slot',
    'unknown-acknowledge-code': 'config.acknowledge codes this version does not emit — ignored',
    'invalid-tag': 'components skipped for an invalid tag name',
    'invalid-event': 'events dropped for an invalid name',
    'invalid-detail-key': 'detail keys dropped for an invalid name',
  };
  const SHOWN = 10;

  const { active, accepted, stale } = partitionAcknowledged(diagnostics, config.acknowledge);
  const open = [...active, ...stale];

  // Every heading carries the same literal prefix. The wording after it is
  // prose and will keep changing; `prism: warning:` is the part downstream
  // filters can rely on. `--report-json` is the sturdier answer still.
  for (const { code, entries } of groupDiagnostics(open)) {
    console.log(`\nprism: warning: ${entries.length} ${LABELS[code] ?? code}:`);
    for (const d of entries.slice(0, SHOWN)) console.log(`  ${d.message}`);
    if (entries.length > SHOWN) console.log(`  … and ${entries.length - SHOWN} more`);
  }

  // Accepted findings are stated, not hidden. An allowlist that makes output
  // disappear is how a genuine regression ends up sheltering behind an old
  // decision — but they're one line each, since nothing is being asked of you.
  if (accepted.length > 0) {
    console.log(`\nprism: accepted: ${accepted.length} known finding(s) waived by config.acknowledge:`);
    for (const d of accepted.slice(0, SHOWN)) {
      const where = [d.tag, d.prop].filter(Boolean).join('.');
      console.log(`  ${d.code}${where ? ` ${where}` : ''}${d.note ? ` — ${d.note}` : ''}`);
    }
    if (accepted.length > SHOWN) console.log(`  … and ${accepted.length - SHOWN} more`);
  }

  writeReportJson({ active, accepted, stale });

  const failures = strictFailures(open);
  // Cleared once printed: in watch mode this runs on every reconcile, and a
  // growing array would re-report the same drift on each pass.
  diagnostics.length = 0;
  if (failures.length === 0) return;

  // Exiting a long-running watcher on a warning would be hostile, and an exit
  // code nothing reads is not a signal — so --strict is a no-op in watch mode.
  if (!strict || watchMode) {
    if (!strict) console.log('\nRun with --strict to fail the build on the above.');
    return;
  }
  // Not process.exit() — that can truncate buffered stdout on a pipe, which is
  // exactly the configuration this flag exists to serve.
  console.error(`\nprism: --strict — ${failures.length} issue(s) reported above.`);
  process.exitCode = 1;
}

/**
 * Write the run's findings as JSON, if asked.
 *
 * The human block is prose and reworded between releases; anything parsing it
 * is one release away from silently matching nothing. This is the stable shape:
 * `code` is the contract, the rest is detail.
 */
function writeReportJson({ active, accepted, stale }) {
  if (!reportJsonPath) return;
  const payload = {
    version: 1,
    strict,
    findings: [...active, ...stale].map((d) => ({ ...d, accepted: false })),
    accepted: accepted.map((d) => ({ ...d, accepted: true })),
  };
  const out = resolve(root, reportJsonPath);
  try {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(`\nreport: ${relative(root, out)}`);
  } catch (err) {
    // A failed report must not take the generate run down with it.
    console.error(`prism: could not write ${reportJsonPath}: ${err.message}`);
  }
}

/**
 * Remove output for components that no longer exist. Safe only with the full
 * component set — never call this from single-file mode, where every component
 * except one would look deleted.
 */
function runSweep(metas, config) {
  const { stale, removed } = sweepOrphans(metas, config, root, { apply: prune });
  if (stale.length > 0) {
    console.log(prune ? '\nRemoved orphaned output:' : '\nOrphaned output (no matching component):');
    reportStale(stale, removed);
  }

  // Barrels after the sweep, never before. `pruneBarrels` decides what to drop
  // by asking the filesystem whether a specifier still resolves, so it has to
  // see the tree the sweep leaves behind: run first, the orphaned wrappers are
  // all still on disk, every specifier resolves, nothing is removed — and then
  // they are deleted underneath barrels that still name them. Deleting a
  // component broke every wrapper package's build (TS2307) until the run after.
  //
  // Still unconditional, unlike the sweep itself: a barrel export whose file is
  // genuinely gone breaks the build of whoever imports it, which is not
  // something to merely report and leave behind --prune.
  for (const barrel of pruneBarrels(config, root, metas)) {
    console.log(`  barrel: ${relative(root, barrel.path)} (removed ${barrel.removed.join(', ')})`);
  }
}

// ── Main ────────────────────────────────────────────────────
async function main() {
  const config = normalizeConfig(await loadConfig());

  if (singleFile) {
    console.log(`@arclux/prism — processing ${singleFile}`);
    await loadRuntimeProps([resolve(root, singleFile)], config);
    processFile(resolve(root, singleFile), config);
    warnUnknownAcknowledgeCodes(config);
    flushDiagnostics(config);
    console.log('Done.');
    return;
  }

  if (watchMode) {
    console.log('@arclux/prism — watch mode');
    preflight(config);
    const files = discoverComponents(config);
    await loadRuntimeProps(files, config);
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
      generateCatalogOutputs(allMetas, config, diagnostics);
      warnUnknownAcknowledgeCodes(config);
      warnUnmatchedOverrides(allMetas, config);
      flushDiagnostics(config);
      reportOutput(allMetas);
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
      // These re-parses are incidental — they exist to rebuild the bundle, and
      // their diagnostics duplicate what the changed file already reported. They
      // go to a throwaway collector unless this is the full reconcile.
      const sink = sweep ? diagnostics : [];
      const metas = currentFiles
        .map((f) => parseComponent(readFileSync(f, 'utf-8'), f, config.prefix, config.interactivity, sink,
          {
            propsFrom: config.propsFrom,
            formAssociated: config.formAssociated,
            runtime: runtimeProps.get(f),
          }))
        .filter(Boolean);
      if (metas.length === 0) return;
      if (config.css) {
        const bundleResults = generateCSSBundle(metas, config.css, root);
        for (const r of bundleResults) {
          console.log(`  bundle: ${relative(root, r.path)}`);
        }
      }
      generateCatalogOutputs(metas, config, sink);
      if (sweep) {
        warnUnknownAcknowledgeCodes(config);
        warnUnmatchedOverrides(metas, config);
        flushDiagnostics(config);
        reportOutput(metas);
        runSweep(metas, config);
      }
    };

    // Handlers run outside the main() promise chain, so an unguarded throw here
    // (a malformed file, a write/permission error) would be an uncaught
    // exception that kills the whole watcher. Catch, log, and keep watching.
    const handleChange = async (label, filePath) => {
      const rel = relative(root, filePath);
      const fileName = filePath.split(/[/\\]/).pop();
      if (isIgnored(fileName, filePath, config.ignore)) return;
      console.log(`\n${label}: ${rel}`);
      try {
        // Re-import the edited module before re-reading it. Node caches modules
        // for the life of the process, so without this the watcher would keep
        // reporting on the class as it was when it started — confidently, and
        // about a file it can no longer see. `loadModule` cache-busts by mtime.
        if (config.runtime) {
          const fresh = await resolveRuntimeProps(
            [filePath],
            { ...config.runtime, setup: undefined },
            (code, message, extra = {}) => diagnostics.push({ code, message, ...extra })
          );
          const entry = fresh.get(filePath);
          if (entry) runtimeProps.set(filePath, entry);
          else runtimeProps.delete(filePath);
        }
        processFile(filePath, config);
        // Flushed per change, so an edit that introduces drift says so at the
        // moment it's made rather than waiting for the next full reconcile.
        flushDiagnostics(config);
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
    // Before the first write, not after the last one.
    if (preflight(config)) {
      flushDiagnostics(config);
      return;
    }
    const files = discoverComponents(config);
    console.log(`Found ${files.length} components\n`);
    await loadRuntimeProps(files, config);

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
      generateCatalogOutputs(allMetas, config, diagnostics);
      warnUnknownAcknowledgeCodes(config);
      warnUnmatchedOverrides(allMetas, config);
      flushDiagnostics(config);
      reportOutput(allMetas);
      runSweep(allMetas, config);
    }

    console.log('\nDone.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
