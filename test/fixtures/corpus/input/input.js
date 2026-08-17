import { LitElement, html, css } from 'lit';

/**
 * A **form-associated** element: the platform's own definition of a form
 * control, and what decides which Angular wrappers get a ControlValueAccessor.
 *
 * In the corpus because the failure it guards is silent in both directions.
 * Without an accessor, `<arc-input formControlName="email">` compiles, reports
 * nothing and binds nothing — the control stays pristine and empty while the
 * element on screen holds the user's text. And the wrong rule for *which*
 * components get one ("everything that emits a change event") sweeps in tabs and
 * theme toggles, which are not form controls at all.
 *
 * It fires both a live event and a commit event, so the accessor has to prefer
 * the second — binding the first marks a form dirty on every keystroke.
 *
 * @tag arc-input
 * @prop {'sm'|'md'|'lg'} size - control size
 */
export class ArcInput extends LitElement {
  static formAssociated = true;

  static properties = {
    value: { type: String },
    size: { type: String, reflect: true },
    disabled: { type: Boolean, reflect: true },
    confirmLabel: { type: String },
  };

  constructor() {
    super();
    this.value = '';
    this.size = 'md';
    this.disabled = false;
    this.confirmLabel = 'OK';
  }

  static styles = css`
    :host { display: block; }
    :host([size='sm']) { font-size: 12px; }
    :host([size='lg']) { font-size: 18px; }
  `;

  _input() {
    this.dispatchEvent(new CustomEvent('arc-input', { detail: { value: this.value } }));
  }

  _change() {
    this.dispatchEvent(new CustomEvent('arc-change', { detail: { value: this.value } }));
  }

  render() {
    return html`<input @input=${this._input} @change=${this._change} /><slot></slot>`;
  }
}

customElements.define('arc-input', ArcInput);
