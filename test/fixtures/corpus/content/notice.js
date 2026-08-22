import { LitElement, html, css } from 'lit';

/**
 * A component driven by **methods** rather than by its props: `show()` returns
 * an id and the rest take it back.
 *
 * In the corpus because every one of those was unreachable from three of the
 * six wrappers, and no build said so. Svelte's `bind:this` yields the Svelte
 * component, a Vue template ref yields the SFC instance, and an Angular
 * template reference yields the wrapper class whose ElementRef is private to
 * it — only React was fine, because `@lit/react` forwards refs. So the gap was
 * found by an application, months after the wrappers shipped.
 *
 * The private helpers, the static and the lifecycle callbacks are all here to
 * be *skipped*: what a consumer calls is the part that obliges a wrapper.
 *
 * @tag arc-notice
 * @slot none
 * @fires {CustomEvent<{ id: number }>} arc-close - a notice was dismissed
 */
export class ArcNotice extends LitElement {
  static properties = {
    position: { type: String, reflect: true },
    duration: { type: Number },
  };

  constructor() {
    super();
    this.position = 'top-right';
    this.duration = 5000;
    this._notices = [];
    this._nextId = 1;
  }

  static styles = css`:host { display: block; position: fixed; }`;

  /** Not an API a consumer reaches through an element reference. */
  static register() {
    customElements.define('arc-notice', ArcNotice);
  }

  connectedCallback() {
    super.connectedCallback();
    this._notices = [];
  }

  /**
   * Show a notice.
   * @returns {number} its id, for a later dismiss()
   */
  show(options = {}) {
    const id = this._nextId++;
    this._notices = [...this._notices, { id, ...options }];
    this._schedule(id);
    return id;
  }

  /** Dismiss one by the id show() returned. */
  dismiss(id) {
    this._notices = this._notices.filter((n) => n.id !== id);
    this.dispatchEvent(new CustomEvent('arc-close', { detail: { id } }));
  }

  /** Dismiss everything on screen. */
  clear() {
    for (const n of [...this._notices]) this.dismiss(n.id);
  }

  _schedule(id) {
    if (this.duration > 0) setTimeout(() => this.dismiss(id), this.duration);
  }

  render() {
    return html`<div class="stack">${this._notices.length}</div>`;
  }
}

customElements.define('arc-notice', ArcNotice);
