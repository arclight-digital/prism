import { LitElement } from 'lit';

/**
 * A class that cannot be built outside a browser. Its source defaults are
 * still a usable answer, and are what it keeps.
 *
 * @tag arc-needs-dom
 */
export class ArcNeedsDom extends LitElement {
  static properties = {
    tone: { type: String },
  };

  constructor() {
    super();
    this.tone = 'neutral';
    this._rect = globalThis.document.body.getBoundingClientRect();
  }
}

customElements.define('arc-needs-dom', ArcNeedsDom);
