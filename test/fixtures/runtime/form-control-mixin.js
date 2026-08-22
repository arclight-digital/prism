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
 * component. So are `checkValidity()` and `reportValidity()`: methods of every
 * element built from this, and of no file that declares one.
 */
export const FormControlMixin = (Base) => class extends Base {
  static formAssociated = true;

  static properties = {
    name: { type: String, reflect: true },
    required: { type: Boolean, reflect: true },
    readonly: { type: Boolean, reflect: true },
  };

  /** The same shape one level up: methods no reader of the component's own file finds. */
  checkValidity() {
    return !this.required || Boolean(this.value);
  }

  reportValidity() {
    return this.checkValidity();
  }

  /**
   * The form owner calls these three and nobody else can. They are platform
   * lifecycle that is neither Lit's nor `HTMLElement`'s, so a skip list spelled
   * as *those* names would let them through — and a wrapper would end up
   * telling its consumer to call `formResetCallback()` on the handle.
   */
  formDisabledCallback(disabled) {
    this.readonly = disabled;
  }

  formResetCallback() {
    this.value = '';
  }

  formStateRestoreCallback(state) {
    this.value = state;
  }

  _internalState() {
    return { touched: false };
  }
};

/** A plain base, so the fixtures can also cover the un-mixed case. */
export class ArcBase extends LitElement {}
