/**
 * Config normalization and file-matching utilities.
 * Extracted from cli.js for testability.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { VALID_TAG } from './parser.js';
import { ACKNOWLEDGEABLE_CODES, unmatchableAckField } from './report.js';
import { JSX_FRAMEWORKS } from './generators/jsx-types.js';
import { EXPORTABLE, EXPORT_MODES } from './generators/exports-map.js';

/** The classification levels `config.interactivity` may assign. */
const LEVELS = new Set(['static', 'hybrid', 'interactive']);

/** The config sections that generate framework wrappers. */
const FRAMEWORK_SECTIONS = ['react', 'vue', 'svelte', 'angular', 'solid', 'preact'];

/** Fields an `acknowledge` entry may carry. */
const ACK_FIELDS = new Set(['code', 'tag', 'prop', 'note']);

/**
 * Normalize config — apply defaults for optional fields so downstream
 * code never has to null-check.
 */
export function normalizeConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error(
      'prism: config is missing or not an object — check the default export of your prism.config.js'
    );
  }
  if (typeof config.components !== 'string' || config.components.length === 0) {
    throw new Error(
      'prism: config.components is required and must be a path (string) to your components directory'
    );
  }
  if (config.tiers !== undefined && !Array.isArray(config.tiers)) {
    throw new Error('prism: config.tiers must be an array of tier directory names');
  }

  // Classification overrides. Validated eagerly and loudly: a misspelt level or
  // a malformed tag here would otherwise fall through to auto-detection and
  // silently do nothing — the exact failure mode that made JSDoc markers
  // unreliable in the first place.
  if (config.interactivity !== undefined
      && (typeof config.interactivity !== 'object' || config.interactivity === null
          || Array.isArray(config.interactivity))) {
    throw new Error('prism: config.interactivity must be an object mapping tag names to levels');
  }
  config.interactivity = config.interactivity || {};
  for (const [tag, level] of Object.entries(config.interactivity)) {
    if (!VALID_TAG.test(tag)) {
      throw new Error(`prism: config.interactivity key "${tag}" is not a valid custom-element tag`);
    }
    if (!LEVELS.has(level)) {
      throw new Error(
        `prism: config.interactivity["${tag}"] is "${level}" — must be static, hybrid, or interactive`
      );
    }
  }

  // Components kept out of every generated barrel. The use case is a component
  // with a heavy optional dependency: a bundler resolves the dynamic imports of
  // anything in its module graph, and a barrel drags every component into that
  // graph, so one component's optional dep is everyone's required install.
  // Excluded components are still generated — they are reached by their own
  // subpath rather than the barrel.
  if (config.barrelExclude !== undefined && !Array.isArray(config.barrelExclude)) {
    throw new Error('prism: config.barrelExclude must be an array of custom-element tag names');
  }
  config.barrelExclude = config.barrelExclude || [];
  for (const tag of config.barrelExclude) {
    if (!VALID_TAG.test(tag)) {
      throw new Error(`prism: config.barrelExclude entry "${tag}" is not a valid custom-element tag`);
    }
  }

  // Two-way binding overrides. Validated on the same terms and for the same
  // reason as `interactivity` above: bindings are derived by convention
  // (an event detail key matching a declared prop name), and the only way to
  // opt a prop out is here — a typo that silently did nothing would leave the
  // wrong binding in place, which is worse than no binding at all.
  if (config.bindings !== undefined
      && (typeof config.bindings !== 'object' || config.bindings === null
          || Array.isArray(config.bindings))) {
    throw new Error('prism: config.bindings must be an object mapping tag names to binding rules');
  }
  config.bindings = config.bindings || {};
  for (const [tag, rule] of Object.entries(config.bindings)) {
    if (!VALID_TAG.test(tag)) {
      throw new Error(`prism: config.bindings key "${tag}" is not a valid custom-element tag`);
    }
    if (typeof rule !== 'object' || rule === null || Array.isArray(rule)) {
      throw new Error(`prism: config.bindings["${tag}"] must be an object, e.g. { exclude: ['label'] }`);
    }
    for (const field of Object.keys(rule)) {
      if (field !== 'exclude') {
        throw new Error(
          `prism: config.bindings["${tag}"] has unknown field "${field}" — only "exclude" is supported`
        );
      }
    }
    if (!Array.isArray(rule.exclude) || rule.exclude.some((p) => typeof p !== 'string')) {
      throw new Error(`prism: config.bindings["${tag}"].exclude must be an array of prop names`);
    }
  }

  // Accepted findings. Some findings are correct and stay correct — the fix is
  // made and the finding remains true — and without a way to record that,
  // `--strict` could never pass. Validated like `interactivity` and `bindings`:
  // a typo here would silence nothing while looking like it had.
  if (config.acknowledge !== undefined && !Array.isArray(config.acknowledge)) {
    throw new Error(
      'prism: config.acknowledge must be an array of { code, tag?, prop?, note? } entries'
    );
  }
  config.acknowledge = config.acknowledge || [];
  const unknownCodes = [];
  for (const [i, entry] of config.acknowledge.entries()) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`prism: config.acknowledge[${i}] must be an object, e.g. { code: 'framework-reserved', tag: 'arc-column', prop: 'key' }`);
    }
    for (const field of Object.keys(entry)) {
      if (!ACK_FIELDS.has(field)) {
        throw new Error(
          `prism: config.acknowledge[${i}] has unknown field "${field}" — only ${[...ACK_FIELDS].join(', ')} are supported`
        );
      }
    }
    // `code` is required: an entry without one would accept every finding for a
    // component, which is a mute button rather than a decision.
    if (typeof entry.code !== 'string' || entry.code.length === 0) {
      throw new Error(
        `prism: config.acknowledge[${i}].code is required — one of ${ACKNOWLEDGEABLE_CODES.join(', ')}`
      );
    }
    // An unrecognised code is ignored, not fatal. Codes are added and split
    // between releases, and throwing here would make a config written for a
    // newer release block a rollback — being unable to bisect the generator is
    // worse than tolerating an entry that does nothing. `unknownCodes` keeps
    // the drop visible.
    if (!ACKNOWLEDGEABLE_CODES.includes(entry.code)) {
      unknownCodes.push(entry.code);
    }
    if (entry.tag !== undefined && !VALID_TAG.test(entry.tag)) {
      throw new Error(`prism: config.acknowledge[${i}].tag "${entry.tag}" is not a valid custom-element tag`);
    }
    for (const field of ['prop', 'note']) {
      if (entry[field] !== undefined && typeof entry[field] !== 'string') {
        throw new Error(`prism: config.acknowledge[${i}].${field} must be a string`);
      }
    }
    // A narrowing field the finding never carries can never match; said here,
    // at the moment the entry is written, rather than later as a misleading
    // `unmatched-acknowledge`.
    const unmatchable = unmatchableAckField(entry);
    if (unmatchable) {
      throw new Error(`prism: config.acknowledge[${i}] — ${unmatchable}`);
    }
  }

  // Entries naming a code this version doesn't know are dropped so they can't
  // silently pre-waive a future finding, and surfaced so the drop is visible.
  config.unknownAcknowledgeCodes = [...new Set(unknownCodes)];
  config.acknowledge = config.acknowledge
    .filter((e) => ACKNOWLEDGEABLE_CODES.includes(e.code));

  // Property resolver hook, for declarations built by helpers prism's reader
  // can't follow. Validated here rather than at call time: an entry that
  // silently did nothing would drop every built prop from every wrapper —
  // the failure the hook exists to fix.
  if (config.propsFrom !== undefined && typeof config.propsFrom !== 'function') {
    throw new Error(
      'prism: config.propsFrom must be a function (source, filePath) returning an array of props, or undefined to fall through to prism\'s own reader'
    );
  }

  // Form-association resolver hook, for libraries that contribute
  // `static formAssociated = true` from a mixin in a file prism was never
  // handed. Same shape and reasoning as propsFrom.
  if (config.formAssociated !== undefined && typeof config.formAssociated !== 'function') {
    throw new Error(
      'prism: config.formAssociated must be a function (source, filePath) returning true, false, or undefined to fall through to prism\'s own reader'
    );
  }

  // Which property a form binds on a given component — needed only where the
  // convention doesn't answer, e.g. a control whose value is a pair (start/end)
  // with no single `value` for an accessor to carry. Validated like the other
  // maps: a typo would leave the convention in place while looking overridden.
  if (config.formValue !== undefined
      && (typeof config.formValue !== 'object' || config.formValue === null
          || Array.isArray(config.formValue))) {
    throw new Error('prism: config.formValue must be an object mapping tag names to property names');
  }
  config.formValue = config.formValue || {};
  for (const [tag, value] of Object.entries(config.formValue)) {
    if (!VALID_TAG.test(tag)) {
      throw new Error(`prism: config.formValue key "${tag}" is not a valid custom-element tag`);
    }
    const names = Array.isArray(value) ? value : [value];
    if (names.length === 0 || names.some((n) => typeof n !== 'string' || n.length === 0)) {
      throw new Error(
        `prism: config.formValue["${tag}"] must be a property name, or an array of them for a compound value`
      );
    }
  }

  config.prefix = config.prefix || 'arc';
  config.ignore = config.ignore || [];
  config.tiers = config.tiers || [];

  // Resolve properties from the class rather than the file that declares it.
  // Deliberately opt-in: reading `Ctor.elementProperties` means importing the
  // module, and importing a module runs it — a config file is the right place
  // to say yes to that.
  if (config.runtime !== undefined) {
    if (config.runtime === true) config.runtime = {};
    if (config.runtime === false) {
      config.runtime = undefined;
    } else if (typeof config.runtime !== 'object' || config.runtime === null
        || Array.isArray(config.runtime)) {
      throw new Error('prism: config.runtime must be true, false, or an object, e.g. { setup: "./scripts/dom-shim.js" }');
    } else if (config.runtime.setup !== undefined) {
      if (typeof config.runtime.setup !== 'string' || config.runtime.setup.length === 0) {
        throw new Error('prism: config.runtime.setup must be a path to a module that installs whatever DOM your components need at import time');
      }
    }
  }

  // Opt-in JSX declaration files, for consumers rendering the elements directly
  // instead of through a wrapper package.
  if (config.jsxTypes !== undefined) {
    if (typeof config.jsxTypes !== 'object' || config.jsxTypes === null || Array.isArray(config.jsxTypes)) {
      throw new Error('prism: config.jsxTypes must be an object, e.g. { outDir: "packages/web-components/types" }');
    }
    if (typeof config.jsxTypes.outDir !== 'string' || config.jsxTypes.outDir.length === 0) {
      throw new Error('prism: config.jsxTypes.outDir is required and must be a path to write the declaration files to');
    }
    if (config.jsxTypes.frameworks !== undefined) {
      if (!Array.isArray(config.jsxTypes.frameworks)) {
        throw new Error(`prism: config.jsxTypes.frameworks must be an array naming any of ${JSX_FRAMEWORKS.join(', ')}`);
      }
      for (const name of config.jsxTypes.frameworks) {
        if (!JSX_FRAMEWORKS.includes(name)) {
          throw new Error(
            `prism: config.jsxTypes.frameworks names "${name}" — only ${JSX_FRAMEWORKS.join(', ')} have a JSX namespace to augment`
          );
        }
      }
    }
    config.jsxTypes.prefix = config.prefix;

    // The package name in the activation instructions these files carry. Never
    // guessed from the `@{prefix}/{prefix}-ui` convention: the header tells a
    // consumer to include `node_modules/<pkg>/types/react-jsx.d.ts`, and a
    // guessed name is a path that resolves to nothing, includes nothing, and
    // reports nothing — the exact silent no-op the header itself warns about.
    // Inherited from the wrapper sections instead, and demanded explicitly
    // when inheriting would be a guess: they disagree, or there are none.
    if (config.jsxTypes.wcPackage === undefined) {
      const named = new Set(
        FRAMEWORK_SECTIONS
          .filter((key) => config[key])
          .map((key) => config[key].wcPackage || `@${config.prefix}/${config.prefix}-ui`)
      );
      if (named.size !== 1) {
        throw new Error(
          named.size === 0
            ? 'prism: config.jsxTypes.wcPackage is required when no framework wrapper section is configured — the generated files tell consumers which package to include the declarations from, and prism has nothing to infer that name from'
            : `prism: config.jsxTypes.wcPackage is required when the framework sections name different packages (${[...named].join(', ')}) — the generated files can only tell consumers to include the declarations from one of them`
        );
      }
      config.jsxTypes.wcPackage = [...named][0];
    }
  }

  // Wrapper package `exports` maps, written from the generated file tree.
  for (const [key, section] of Object.entries(config)) {
    if (!section || typeof section !== 'object' || section.packageJson === undefined) continue;
    if (typeof section.packageJson !== 'string' || section.packageJson.length === 0) {
      throw new Error(`prism: config.${key}.packageJson must be a path to that package's package.json`);
    }
    // Refused rather than written wrong: ng-packagr produces the published
    // manifest for an Angular library and copies the source one verbatim into
    // dist, so an `exports` map written here ships broken — and the failure
    // lands on a consumer's build, far from the config that caused it.
    if (key === 'angular') {
      throw new Error(
        'prism: config.angular.packageJson is not supported — ng-packagr owns the published package.json for an Angular library (Angular Package Format), and an exports map written into the source manifest is copied into dist and ships broken'
      );
    }
    if (!EXPORTABLE.includes(key)) {
      throw new Error(
        `prism: config.${key}.packageJson has no meaning — an exports map can be written for ${EXPORTABLE.join(', ')}`
      );
    }
    if (section.exportsMode !== undefined && !EXPORT_MODES.includes(section.exportsMode)) {
      throw new Error(
        `prism: config.${key}.exportsMode is "${section.exportsMode}" — must be one of ${EXPORT_MODES.join(', ')}`
      );
    }
  }

  // Propagate prefix, bindings and form-value overrides to each framework
  // config section
  for (const key of [...FRAMEWORK_SECTIONS, 'html', 'css']) {
    if (config[key]) {
      config[key].prefix = config.prefix;
      config[key].bindings = config.bindings;
      config[key].formValue = config.formValue;
    }
  }

  return config;
}

/**
 * Test whether a filename should be ignored.
 * Supports bare filenames, glob-prefixed names, and directory globs.
 */
export function isIgnored(fileName, filePath, patterns) {
  for (const pat of patterns) {
    // Strip leading **/ prefix
    const stripped = pat.replace(/^\*\*\//, '');

    // Directory glob: 'icons/**' → check if path contains /icons/
    if (stripped.endsWith('/**')) {
      const dir = stripped.slice(0, -3);
      if (filePath.includes(`/${dir}/`) || filePath.includes(`\\${dir}\\`)) return true;
      continue;
    }

    // Filename match (supports leading * wildcard, e.g. '*.register.js')
    if (stripped.startsWith('*')) {
      if (fileName.endsWith(stripped.slice(1))) return true;
      continue;
    }
    if (fileName === stripped) return true;
  }
  return false;
}

/**
 * Discover component files from the configured tiers.
 * @param {object} config - normalized config
 * @param {string} root - project root
 * @returns {string[]}
 */
export function discoverComponents(config, root) {
  const componentsDir = join(root, config.components);
  const files = [];

  for (const tier of config.tiers) {
    const tierDir = join(componentsDir, tier);
    try {
      const entries = readdirSync(tierDir);
      for (const entry of entries) {
        if (!entry.endsWith('.js')) continue;
        const fullPath = join(tierDir, entry);
        if (isIgnored(entry, fullPath, config.ignore)) continue;
        files.push(fullPath);
      }
    } catch {
      // Tier directory may not exist yet
    }
  }

  return files;
}
