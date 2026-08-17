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
 * The constructor and the `@prop` tag below are here for the same reason as the
 * events. `elementProperties` carries what a property *is* and nothing about
 * what surrounds it, so the default and the union are as invisible to a subclass
 * as a dispatch site is — one layer further down, and only Svelte spells a
 * default out loud.
 *
 * @tag arc-dialog
 * @slot footer - actions, below the content
 * @prop {'sm'|'md'|'lg'} size - how wide it sits
 */
export class ArcDialog extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    heading: { type: String },
    dismissible: { type: Boolean, reflect: true },
    size: { type: String, reflect: true },
  };

  constructor() {
    super();
    this.open = false;
    this.heading = '';
    this.size = 'md';
  }

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
