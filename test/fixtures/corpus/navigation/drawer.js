import { LitElement, html, css } from 'lit';

/**
 * A component that **moves state its consumer also holds**, and announces the
 * move under a detail key that does not name the prop.
 *
 * In the corpus because two-way binding used to be derived from a prop's
 * *name*: a payload key matching a declared prop was the write-back path, and
 * nothing else was. This drawer closes on Escape and on a backdrop click as
 * well as from the button, each announced as `arc-drawer-toggle` carrying the
 * new state as `detail.value` — so a consumer's copy of `open` drifted the
 * first time a user dismissed it any way other than the button. Silently, and
 * in the direction that leaves a close control which reopens nothing.
 *
 * The rule that reads this one is behavioural: a prop the component assigns
 * outside its constructor and then announces in an event is state it shares
 * rather than receives, whatever the payload calls it.
 *
 * @tag arc-drawer
 * @fires {CustomEvent<{ value: boolean }>} arc-drawer-toggle - the drawer opened or closed itself
 */
export class ArcDrawer extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    label: { type: String },
  };

  constructor() {
    super();
    // A constructor assignment is a default. The same assignment in a keydown
    // handler is the component moving state — which is why where it sits is
    // half of what makes the prop two-way.
    this.open = false;
    this.label = '';
  }

  static styles = css`
    :host { display: block; }
    :host([open]) .backdrop { opacity: 1; }
  `;

  _onKeyDown(e) {
    if (e.key === 'Escape') this._setOpen(false);
  }

  _onBackdrop() {
    this._setOpen(false);
  }

  /** Close (or open) the drawer, and say so. */
  _setOpen(value) {
    if (this.open === value) return;
    this.open = value;
    this.dispatchEvent(
      new CustomEvent('arc-drawer-toggle', {
        detail: { value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    return html`
      <div class="backdrop" @click=${this._onBackdrop}></div>
      <aside aria-label=${this.label} @keydown=${this._onKeyDown}>
        <slot></slot>
      </aside>
    `;
  }
}

customElements.define('arc-drawer', ArcDrawer);
