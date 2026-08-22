/**
 * A component whose framework base classes have had their names minified away.
 *
 * In the fixtures because a name test for `LitElement` and `ReactiveElement` is
 * a test that passes in development and fails in production, and nothing in
 * this repo could see the difference. The build a plain `import()` resolves —
 * which is the only kind the CLI ever loads — is minified: `LitElement.name` is
 * `"i"` and `ReactiveElement.name` is `"g"`. So the prototype walk that reads a
 * mixin's methods ran straight through the framework's own prototype and came
 * back with `enableUpdating()` and `C()`, the two members of `ReactiveElement`
 * that neither the `_` convention nor the `*Callback` suffix filters, one of
 * them a mangled private. In the reference catalog that put a handle on 187 of
 * 188 components in five packages, each documented with those two names, on
 * components with no imperative API at all.
 *
 * Vitest resolves lit's `development` export condition, so importing the real
 * `lit` here would reproduce nothing — the classes arrive with their names
 * intact and the old rule passes. Hence the shapes below rather than the
 * package: what matters is the *shape* the walk meets, and shape is the thing
 * minification leaves alone.
 */

/** `ReactiveElement`, as it arrives from the published build. */
class g {
  static elementProperties = new Map([['label', { type: String }]]);

  static get observedAttributes() {
    return ['label'];
  }

  addController() {}
  removeController() {}
  createRenderRoot() {}
  connectedCallback() {}
  disconnectedCallback() {}
  attributeChangedCallback() {}
  requestUpdate() {}
  performUpdate() {}
  scheduleUpdate() {}
  willUpdate() {}
  update() {}
  updated() {}
  firstUpdated() {}
  getUpdateComplete() {}
  shouldUpdate() {}
  // The two that survive every naming rule prism has: one legitimate public
  // method of the framework, one mangled private.
  enableUpdating() {}
  C() {}
}

/** `LitElement`. It adds nothing of its own that matters here. */
class i extends g {}

/** A mixin between the component and the framework — the case runtime exists for. */
const ValidityMixin = (Base) => class extends Base {
  checkValidity() {
    return true;
  }

  reportValidity() {
    return this.checkValidity();
  }
};

/** A component with an imperative API of its own, over a mixin, over minified bases. */
export class ArcMinified extends ValidityMixin(i) {
  show() {}
  _present() {}
}

/** The `arc-divider` case: nothing of its own, and nothing it should be said to have. */
export class ArcQuiet extends i {}

/**
 * A chain with no framework prototype in it at all — nothing owns the reactive
 * update interface. Prism cannot tell where this component ends and its base
 * begins, so the walk has to answer nothing rather than hand back `helper()`.
 */
class UnknownBase {
  helper() {}
}

export class ArcOrphan extends UnknownBase {
  static elementProperties = new Map([['label', { type: String }]]);

  ownMethod() {}
}
