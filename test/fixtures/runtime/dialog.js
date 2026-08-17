import { LitElement, html } from 'lit';

/**
 * The base class, with everything on it. Its subclass lives in modal.js and
 * declares none of it — see that file for what that costs.
 *
 * The events matter as much as the properties here. `elementProperties` is
 * flattened by Lit, so a subclass gets the props back for free once prism reads
 * the class; events, slots and the template are statements in *this* file and
 * flatten nowhere. A fix that restored only the props would leave every wrapper
 * missing its handlers while passing any comparison of prop lists.
 *
 * @tag arc-dialog
 * @slot footer - actions, below the content
 */
export class ArcDialog extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    heading: { type: String },
    dismissible: { type: Boolean, reflect: true },
  };

  _close() {
    this.dispatchEvent(new CustomEvent('arc-close', { detail: { open: false } }));
  }

  _open() {
    this.dispatchEvent(new CustomEvent('arc-open', { detail: { open: true } }));
  }

  render() {
    return html`
      <slot></slot>
      <slot name="footer"></slot>
    `;
  }
}

customElements.define('arc-dialog', ArcDialog);
