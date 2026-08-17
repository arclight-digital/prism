import { LitElement, html, css } from 'lit';

/**
 * The ordinary case, and the corpus needs one.
 *
 * A component with a default slot, a documented union, a reflected attribute and
 * no events. It is what everything else is compared against: a change that
 * breaks this breaks the common path, and several of the assertions in
 * corpus.test.js are only meaningful because one member of the catalog is
 * unremarkable.
 *
 * @tag arc-badge
 * @prop {'neutral'|'success'|'danger'} tone - colour role
 */
export class ArcBadge extends LitElement {
  static properties = {
    tone: { type: String, reflect: true },
    pill: { type: Boolean, reflect: true },
  };

  constructor() {
    super();
    this.tone = 'neutral';
    this.pill = false;
  }

  static styles = css`
    :host { display: inline-flex; }
    :host([tone='success']) { color: green; }
    :host([tone='danger']) { color: red; }
  `;

  render() {
    return html`<slot></slot>`;
  }
}

customElements.define('arc-badge', ArcBadge);
