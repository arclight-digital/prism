/**
 * The prop → TypeScript type mapping, shared by all six wrapper generators.
 *
 * This lived as six byte-identical copies, which meant a change to how props
 * are typed had to be made six times to take effect once.
 */

/**
 * Map a WC property type to a TypeScript type string.
 *
 * Precedence, most authoritative first:
 *   1. a documented `@prop {…}` type — the author said what the shape is
 *   2. a detected enum union — from the docs, or inferred from CSS
 *   3. the `static properties` type, which can only say "an Array of something"
 *
 * @param {import('../parser.js').PropMeta} prop
 * @returns {string}
 */
export function tsType(prop) {
  if (prop.docType) return prop.docType;
  if (prop.values && prop.values.length > 0) {
    return prop.values.map((v) => `'${v}'`).join(' | ');
  }
  switch (prop.type) {
    case 'Boolean': return 'boolean';
    case 'Number':  return 'number';
    case 'Array':   return 'unknown[]';
    case 'Object':  return 'Record<string, unknown>';
    default:        return 'string';
  }
}
