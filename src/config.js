/**
 * Config normalization and file-matching utilities.
 * Extracted from cli.js for testability.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { VALID_TAG } from './parser.js';

/** The classification levels `config.interactivity` may assign. */
const LEVELS = new Set(['static', 'hybrid', 'interactive']);

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
