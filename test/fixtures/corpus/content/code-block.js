import { LitElement, html, css } from 'lit';

/**
 * The component that stays **out of every barrel**.
 *
 * In the corpus because `barrelExclude` exists for a real cost: a bundler
 * resolves the dynamic imports of anything in a barrel's module graph, and a
 * barrel drags every component into that graph — so one component's optional
 * 13 MB syntax-highlighting dependency becomes everyone's required install. The
 * component is still generated and still reachable by its own subpath; it is
 * only the barrel it stays out of.
 *
 * The failure this guards was silent for the entire life of the feature:
 * exclusion was enforced at the append *and* at the prune, and only the prune
 * can take a name back out — so as long as every excluded component had been
 * excluded before it was first generated, nothing ever exercised the removal.
 *
 * @tag arc-code-block
 */
export class ArcCodeBlock extends LitElement {
  static properties = {
    code: { type: String },
    language: { type: String, reflect: true },
  };

  constructor() {
    super();
    this.code = '';
    this.language = 'text';
  }

  static styles = css`:host { display: block; }`;

  async _highlight() {
    const { codeToHtml } = await import('shiki');
    return codeToHtml(this.code, { lang: this.language });
  }

  render() {
    return html`<pre><slot></slot></pre>`;
  }
}

customElements.define('arc-code-block', ArcCodeBlock);
