import { LitElement } from 'lit';

/**
 * The shape that motivated runtime resolution: properties contributed to a
 * component by a mixin, in a file the component's own source never shows.
 *
 * `readonly` and `required` are real reactive properties of every element built
 * from this, and no amount of reading the component's file will find them. In
 * the reference consumer that was 16 such properties across 25 components,
 * missing from all six framework wrappers.
 *
 * `formAssociated` is here for the same reason — the static that decides which
 * Angular wrappers get a ControlValueAccessor is set by the mixin, not the
 * component.
 */
export const FormControlMixin = (Base) => class extends Base {
  static formAssociated = true;

  static properties = {
    name: { type: String, reflect: true },
    required: { type: Boolean, reflect: true },
    readonly: { type: Boolean, reflect: true },
  };
};

/** A plain base, so the fixtures can also cover the un-mixed case. */
export class ArcBase extends LitElement {}
