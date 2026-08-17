import { LitElement, html, css } from 'lit';
import { FormControlMixin } from './form-control-mixin.js';

/**
 * A component whose declarations are *built* by helpers, and whose form
 * behaviour comes from a mixin — both of the things prism's source reader
 * cannot follow, in one file.
 *
 * Read from source, this component has two props (`value` and whatever the
 * reader makes of the helper calls) and is not form-associated. Read from the
 * class, it has seven and is.
 *
 * @tag arc-input
 * @prop {'sm'|'md'|'lg'} size - control size
 * @prop {boolean} readonly - contributed by the form-control mixin
 * @prop {string} ghost - documented, and not a property of anything
 */
export class ArcInput extends FormControlMixin(LitElement) {
  static properties = {
    value: { type: String },
    size: oneOf(['sm', 'md', 'lg']),
    confirmLabel: { type: String },
    hint: { type: String, attribute: 'hint-text' },
    _open: { state: true },
  };

  constructor() {
    super();
    this.value = '';
    this.size = 'md';
    this.confirmLabel = 'OK';
    this.hint = '';
  }

  static styles = css`:host { display: block; }`;

  _change() {
    this.dispatchEvent(new CustomEvent('arc-change', { detail: { value: this.value } }));
  }

  render() {
    return html`<input @change=${this._change} /><slot></slot>`;
  }
}

/** The vocabulary prism's reader can't follow — a declaration built by a call. */
function oneOf(values) {
  return { type: String, reflect: true, __values: values };
}

customElements.define('arc-input', ArcInput);
