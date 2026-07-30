/**
 * Config normalization and file-matching utilities.
 * Extracted from cli.js for testability.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { VALID_TAG } from './parser.js';
import { ACKNOWLEDGEABLE_CODES } from './report.js';

/** The classification levels `config.interactivity` may assign. */
const LEVELS = new Set(['static', 'hybrid', 'interactive']);

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

  // Accepted findings. Some findings are correct and stay correct: `arc-column`
  // really does declare `key`, React really does eat it, and the right fix is an
  // alias that leaves `key` working for the five consumers it works for today.
  // Doing that leaves the finding permanently true, so without a way to record
  // "known, decided, not going to change", `--strict` could never pass on the
  // repos it was built for — and by its own rationale, a check that can never
  // pass gets deleted.
  //
  // Validated on the same terms as `interactivity` and `bindings`: a typo here
  // would silence nothing while looking like it had.
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
    // between releases, so throwing here version-locks the config in both
    // directions: a file valid for 2.7 made 2.6 refuse to start, which meant a
    // rollback silently generated nothing and looked like the rollback hadn't
    // helped. Being unable to bisect the generator is worse than tolerating an
    // entry that does nothing, and `unknownCodes` keeps it visible.
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
  }

  // Entries naming a code this version doesn't know are dropped so they can't
  // silently pre-waive a future finding, and surfaced so the drop is visible.
  config.unknownAcknowledgeCodes = [...new Set(unknownCodes)];
  config.acknowledge = config.acknowledge
    .filter((e) => ACKNOWLEDGEABLE_CODES.includes(e.code));

  config.prefix = config.prefix || 'arc';
  config.ignore = config.ignore || [];
  config.tiers = config.tiers || [];

  // Propagate prefix and bindings to each framework config section
  for (const key of ['react', 'vue', 'svelte', 'angular', 'solid', 'preact', 'html', 'css']) {
    if (config[key]) {
      config[key].prefix = config.prefix;
      config[key].bindings = config.bindings;
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
