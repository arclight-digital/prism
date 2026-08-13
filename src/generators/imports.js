/**
 * The module specifier a wrapper imports to register its element.
 *
 * Every generator needs it and all six computed it inline, from the same two
 * config fields, in slightly different ways. That mattered once it stopped
 * being only a generator concern: `verify.js` has to name the same specifier to
 * check the import is still there, and a check that derives the string
 * independently is a check that can agree with itself while disagreeing with
 * what was written.
 *
 * @param {import('../parser.js').ComponentMeta} meta
 * @param {object} config - a framework config section (carries `prefix`, and
 *   optionally `wcPackage`)
 * @returns {string} e.g. '@arclux/arc-ui/top-bar'
 */
export function registerImport(meta, config) {
  const wcPackage = config.wcPackage || `@${config.prefix}/${config.prefix}-ui`;
  // Per-component register subpath — registers only this element (the define is
  // guarded) and exports the element class.
  return `${wcPackage}/${meta.tag.slice(config.prefix.length + 1)}`;
}
