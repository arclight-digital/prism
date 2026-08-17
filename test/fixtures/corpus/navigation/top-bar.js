import { LitElement, html, css } from 'lit';

/**
 * A component whose slots are **all named** — it renders no unnamed default one.
 *
 * In the corpus because this shape has broken twice. 2.7.0 read "no default slot
 * found" as "no default slot exists" and deleted `children` from 111 wrappers;
 * later, the four frameworks that project children into the light DOM verbatim
 * (React, Preact, Solid, Angular) gated their single outlet on the *default*
 * slot, so `<arc-top-bar>` generated an empty Angular template and a Solid
 * wrapper with no `children` member. Both times every child a consumer wrote was
 * discarded, and both times nothing failed.
 *
 * It also carries a **dashed custom event**, which is its own trap: Preact
 * lowercases the part after `on`, so `arc-nav-toggle` is not reachable from a
 * plain `on*` prop and the wrapper has to attach a listener.
 *
 * @tag arc-top-bar
 * @slot logo - brand mark, leading
 * @slot actions - trailing controls
 */
export class ArcTopBar extends LitElement {
  static properties = {
    sticky: { type: Boolean, reflect: true },
    label: { type: String },
  };

  constructor() {
    super();
    this.sticky = false;
    this.label = '';
  }

  static styles = css`
    :host { display: flex; }
    :host([sticky]) { position: sticky; }
  `;

  _toggle() {
    this.dispatchEvent(new CustomEvent('arc-nav-toggle', { detail: { open: true } }));
  }

  render() {
    return html`
      <slot name="logo"></slot>
      <button @click=${this._toggle}>${this.label}</button>
      <slot name="actions"></slot>
    `;
  }
}

customElements.define('arc-top-bar', ArcTopBar);
