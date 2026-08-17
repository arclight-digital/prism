import { LitElement, html, css } from 'lit';

/**
 * A form control that declares **both `checked` and `value`**, where the one a
 * form binds is the second-listed of the two.
 *
 * In the corpus because the rule has to be read from what the component
 * declares rather than from a table of tag names — a table is a thing that goes
 * stale silently when a 28th control is added, and the accessor disagreeing with
 * the `@Input` beside it is not something any type check would catch.
 *
 * @tag arc-checkbox
 */
export class ArcCheckbox extends LitElement {
  static formAssociated = true;

  static properties = {
    checked: { type: Boolean, reflect: true },
    value: { type: String },
    disabled: { type: Boolean, reflect: true },
  };

  constructor() {
    super();
    this.checked = false;
    this.value = 'on';
    this.disabled = false;
  }

  static styles = css`:host { display: inline-flex; }`;

  _toggle() {
    this.checked = !this.checked;
    this.dispatchEvent(new CustomEvent('arc-change', { detail: { checked: this.checked } }));
  }

  render() {
    return html`<button @click=${this._toggle}></button><slot></slot>`;
  }
}

customElements.define('arc-checkbox', ArcCheckbox);
