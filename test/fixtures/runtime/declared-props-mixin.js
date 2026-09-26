/**
 * The declared-props vocabulary, cut down: a default lives in the declaration,
 * and the mixin's constructor seeds it. The component's own constructor never
 * mentions these props, which is the whole problem for a source reader.
 */
export const DEFAULT = Symbol('default');

export const flag = (fallback) => ({ type: Boolean, reflect: true, [DEFAULT]: fallback });
export const oneOf = (values) => ({ type: String, reflect: true, [DEFAULT]: values[0] });
export const list = () => ({ type: Array, [DEFAULT]: () => [] });
export const computed = (fn) => ({ type: Number, [DEFAULT]: fn });

export const DeclaredPropsMixin = (Base) => class extends Base {
  constructor() {
    super();
    for (const [name, declaration] of this.constructor.elementProperties) {
      if (!(DEFAULT in declaration) || this[name] !== undefined) continue;
      const value = declaration[DEFAULT];
      this[name] = typeof value === 'function' ? value(this) : value;
    }
  }
};
