/**
 * The module specifier a wrapper imports to register its element. Shared
 * because `verify.js` has to name the same specifier to check the import is
 * still there — a check that derives it independently can agree with itself
 * while disagreeing with what was written.
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
