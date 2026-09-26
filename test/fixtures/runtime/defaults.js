import { LitElement } from 'lit';
import { DeclaredPropsMixin, flag, oneOf, list, computed } from './declared-props-mixin.js';

/**
 * Defaults that are on the instance and in no constructor prism can read.
 *
 * The reference consumer declares props through a vocabulary whose defaults
 * live in the declaration, and a mixin constructor seeds them — so the
 * component's own constructor is gone, and every wrapper lost `= 'md'`,
 * `= true` and `= []`. The mixin here is that shape, cut down.
 *
 * @tag arc-grid
 */
export class ArcGrid extends DeclaredPropsMixin(LitElement) {
  static properties = {
    density: oneOf(['comfortable', 'compact']),
    striped: flag(true),
    columns: list(),
    month: computed(() => new Date().getMonth()),
    seed: computed(() => Math.random()),
    label: { type: String },
    caption: { type: String },
    lookup: { type: Object },
    options: { type: Object },
    max: { type: Number },
  };

  constructor() {
    super();
    this.label = "Rows";
    this.caption = SOME_CAPTION;
    this.lookup = new Map();
    this.options = { page: 1, sizes: [10, 25] };
    this.max = Infinity;
    // Held open past the run if prism let it be.
    this._poll = globalThis.setInterval(() => {}, 1000);
  }
}

const SOME_CAPTION = 'Results';

customElements.define('arc-grid', ArcGrid);
