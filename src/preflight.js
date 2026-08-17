/**
 * Checks made *before* anything is written.
 *
 * `verify.js` is the other half of this: it reads output back after a run and
 * asks whether the file came out the way the component says it should. That is
 * the right shape for a generator bug, where the damage is a file that is wrong
 * and can be regenerated correctly. It is the wrong shape for exactly one
 * failure, and it is the most destructive one prism has:
 *
 * **An older prism does not error — it reverts.** Prism rewrites every wrapper
 * it owns from whatever version is installed, so running 2.12.0 against output
 * written by 2.13.1 silently undid 205 Angular, 10 React, 10 Preact and 10 Solid
 * files. Nothing failed. The only signal was a large diff in generated files
 * nobody reads, which CI reported as "generated files are out of date" — wording
 * that reads as *stale committed output* and invites the exact wrong fix: commit
 * the revert.
 *
 * Stamping the version into each file (see header.js) makes that visible in a
 * diff, and the per-file check in the CLI reports it — but only while doing it.
 * By the time a generator has read a file's stamp it has already decided to
 * overwrite it, so the report is a witness rather than a guard, and it clears
 * itself on the next run because the files then carry the older stamp.
 *
 * So the same stamp is read here first, across the whole output tree, before a
 * single file is written. Under `--strict` that turns a revert already committed
 * into a run that refuses to start.
 */

import { openSync, readSync, closeSync, readdirSync, existsSync, statSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { join } from 'node:path';
import { VERSION, isPrismGenerated, generatedVersion, compareVersions } from './generators/header.js';

/**
 * How much of each file to read. The sentinel always lives in the opening
 * comment, and this is the same window `isPrismGenerated` inspects — reading
 * whole files to look at their first line would make a pre-flight over a
 * 1,500-file tree cost more than the generate it precedes.
 */
const HEAD_BYTES = 300;

/** The first `HEAD_BYTES` of a file, or '' if it can't be read. */
function head(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const read = readSync(fd, buf, 0, HEAD_BYTES, 0);
    return buf.toString('utf-8', 0, read);
  } catch {
    return '';
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Every directory prism writes generated files into.
 *
 * Deliberately not recursive below the tiers, matching what the generators
 * actually do: a framework writes `outDir/<tier>/Name.ext`, and CSS, HTML and
 * the JSX declarations are flat. Walking arbitrarily deep would start reading a
 * consumer's own source.
 */
function outputDirs(config, root) {
  const dirs = new Set();
  for (const key of ['react', 'vue', 'svelte', 'angular', 'solid', 'preact']) {
    if (!config[key]) continue;
    dirs.add(join(root, config[key].outDir));
    for (const tier of config.tiers) dirs.add(join(root, config[key].outDir, tier));
  }
  for (const key of ['css', 'html']) {
    if (config[key]) dirs.add(join(root, config[key].outDir));
  }
  if (config.jsxTypes) dirs.add(join(root, config.jsxTypes.outDir));
  return [...dirs];
}

/**
 * Find generated output written by a *newer* prism than the one about to run.
 *
 * MUST be called before any generator writes, and only in the modes that rewrite
 * the whole tree — a full run, or a watcher's initial pass. Single-file mode
 * doesn't get one: it rewrites one file, so the per-file check covers it, and a
 * whole-tree scan there would report on files the run will never touch.
 *
 * @param {object} config - normalized config
 * @param {string} root - project root
 * @returns {{ newer: Array<{ path: string, version: string }>, scanned: number,
 *   highest: string|null }}
 */
export function scanForNewerOutput(config, root) {
  const newer = [];
  let scanned = 0;
  let highest = null;

  for (const dir of outputDirs(config, root)) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      try {
        if (!statSync(path).isFile()) continue;
      } catch {
        continue;
      }
      const text = head(path);
      if (!isPrismGenerated(text)) continue;
      scanned++;
      const version = generatedVersion(text);
      if (!version || compareVersions(version, VERSION) <= 0) continue;
      newer.push({ path, version });
      if (!highest || compareVersions(version, highest) > 0) highest = version;
    }
  }

  return { newer, scanned, highest };
}

/**
 * The finding for one file the run is about to revert.
 *
 * Written in the conditional — "would revert", not "has reverted" — because
 * nothing has happened yet. That is the whole difference between this and the
 * per-file check, and the reason it is worth saying twice.
 *
 * @param {{ path: string, version: string }} entry
 * @param {string} file - the path, relative to the project root
 * @returns {import('./parser.js').Diagnostic}
 */
export function downgradeFinding(entry, file) {
  return {
    code: 'generator-downgrade',
    message:
      `${file} was generated by prism ${entry.version}, and this run is ${VERSION}. ` +
      'Regenerating would rewrite it from the older generator — a downgrade does not fail, ' +
      `it reverts. Install ${entry.version} or later, or reset this file to its committed state ` +
      'if the output is what moved rather than the generator.',
    file: entry.path,
    priorVersion: entry.version,
    version: VERSION,
  };
}

/**
 * The block printed when a downgrade is found, before anything is written.
 *
 * One aggregate line rather than 235: the per-file findings carry the list (and
 * reach `--report-json`), and what someone needs at this moment is the count,
 * the two versions, and whether their working tree has been touched yet.
 *
 * @param {ReturnType<typeof scanForNewerOutput>} scan
 * @param {boolean} aborting - whether the run is stopping here
 * @returns {string}
 */
export function describeDowngrade(scan, aborting) {
  const n = scan.newer.length;
  return (
    `\nprism: ${n} generated file${n === 1 ? '' : 's'} on disk ${n === 1 ? 'was' : 'were'} ` +
    `written by @arclux/prism ${scan.highest}, and this run is ${VERSION}.\n` +
    `  An older generator does not error — it rewrites, so regenerating reverts ` +
    `${n === 1 ? 'it' : 'all of them'} to what\n  this version emits, and the only trace is a large diff in files nobody reads.\n` +
    (aborting
      ? '  Nothing has been written. Two ways out, depending on which side moved:\n' +
        `    install @arclux/prism ${scan.highest} or later, if the generator is what went backwards;\n` +
        '    or reset the generated tree to its committed state, if the output is what came forward.\n' +
        '  Dropping --strict regenerates over it anyway.'
      : `  Install ${scan.highest} or later if the generator is what went backwards, or reset the\n` +
        '  generated tree if the output is. Either way, check the diff before committing.')
  );
}
