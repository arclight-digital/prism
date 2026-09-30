import { LitElement, html, css } from 'lit';
import { statusVars } from './status-styles.js';

/**
 * A component whose host properties come from a module it imports: in no css
 * literal of its own file, and so invisible to the source reader.
 *
 * @tag arc-status-badge
 */
export class ArcStatusBadge extends LitElement {
  static properties = { variant: { type: String, reflect: true } };

  static styles = [
    statusVars,
    css`
      :host { display: inline-block; }
      .badge { background: rgba(var(--_status-rgb), 0.1); padding: var(--space-xs); }
    `,
  ];

  render() {
    return html`<span class="badge"><slot></slot></span>`;
  }
}
