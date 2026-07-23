/**
 * Config normalization and file-matching utilities.
 * Extracted from cli.js for testability.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

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

  config.prefix = config.prefix || 'arc';
  config.ignore = config.ignore || [];
  config.tiers = config.tiers || [];

  // Propagate prefix to each framework config section
  for (const key of ['react', 'vue', 'svelte', 'angular', 'solid', 'preact', 'html', 'css']) {
    if (config[key]) config[key].prefix = config.prefix;
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
