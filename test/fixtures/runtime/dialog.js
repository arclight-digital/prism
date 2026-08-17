import { LitElement, html } from 'lit';

/**
 * The base class, with all the properties. Its subclass lives in modal.js and
 * declares none of its own — see that file for what that costs.
 *
 * @tag arc-dialog
 */
export class ArcDialog extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    heading: { type: String },
    dismissible: { type: Boolean, reflect: true },
  };

  render() {
    return html`<slot></slot>`;
  }
}

customElements.define('arc-dialog', ArcDialog);
