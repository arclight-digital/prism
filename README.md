# @arclux/prism

[![CI](https://github.com/Arclight-Digital/prism/actions/workflows/ci.yml/badge.svg)](https://github.com/Arclight-Digital/prism/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@arclux/prism)](https://www.npmjs.com/package/@arclux/prism)
[![license](https://img.shields.io/npm/l/@arclux/prism)](LICENSE)
[![node](https://img.shields.io/node/v/@arclux/prism)](package.json)

Auto-generate framework wrappers and HTML/CSS examples from [Lit](https://lit.dev/) web components.

Write your component once as a Lit custom element. Prism reads the source and generates idiomatic wrappers for **React**, **Vue**, **Svelte**, **Angular**, **Solid**, and **Preact** — plus standalone **HTML/CSS** snippets with optional design-token resolution. No AST libraries, no build step, just regex-based parsing that ships as plain ESM.

## What it does

Given a Lit component like this:

```js
class ArcButton extends LitElement {
  static properties = {
    variant: { type: String, reflect: true },
    disabled: { type: Boolean, reflect: true },
  };

  constructor() {
    super();
    this.variant = 'primary';
    this.disabled = false;
  }

  static styles = css`
    :host { display: inline-flex; }
    :host([variant="primary"]) { background: var(--arc-color-primary); }
    :host([variant="secondary"]) { background: var(--arc-color-secondary); }
  `;

  render() {
    return html`<button class="btn"><slot></slot></button>`;
  }
}
customElements.define('arc-button', ArcButton);
```

Prism generates:

| Output | What you get |
|--------|-------------|
| **React** | TypeScript wrapper using `@lit/react` `createComponent` with a typed `ButtonProps` interface and `'primary' \| 'secondary'` enum for `variant` |
| **Vue 3** | `.vue` SFC with `defineProps` generics and `withDefaults` |
| **Svelte 5** | `.svelte` component using `$props()` runes |
| **Angular** | Standalone component with `@Input()` decorators and `CUSTOM_ELEMENTS_SCHEMA` |
| **Solid** | `.tsx` component using `splitProps()` for reactivity-safe forwarding |
| **Preact** | `.tsx` component with native custom element support |
| **HTML** | Static snippet wrapped in a `<span>` or `<div>` (based on host display), slots replaced with placeholder text |
| **Inline HTML** | Same snippet with all `var()` tokens resolved to literal values and styles inlined |
| **CSS** | Shadow DOM CSS transformed to light DOM (`:host` &rarr; `.arc-button`, scoped inner selectors) |
| **CSS bundle** | All components combined into a single `arc-ui.css` with design tokens |

Enum values are auto-detected from `:host([variant="value"])` patterns in the CSS. Props, defaults, types, events, and interactivity level are all extracted automatically.

Custom events (`dispatchEvent(new CustomEvent('arc-change'))`) become typed handler props in every wrapper — `onArcChange` in React/Solid/Preact, a wired `defineEmits` listener in Vue, and an `@Output()` in Angular — so a consumer's handler actually fires. (Preact binds via a ref effect, since its `on*` convention can't target hyphenated event names.)

## Installation

```bash
npm i -D @arclux/prism
```

Requires **Node.js 24+**. No peer dependencies — the only runtime dependency is [chokidar](https://github.com/paulmillr/chokidar) for watch mode.

## Usage

```bash
# Generate all components defined in prism.config.js
npx prism

# Watch mode — regenerate when source files change
npx prism --watch

# Process a single component file
npx prism path/to/button.js

# Use a custom config path
npx prism --config ./custom.config.js
```

All flags also have short forms: `-w` for `--watch`, `-c` for `--config`.

## Configuration

Create a `prism.config.js` in your project root. Every section except `components` and `tiers` is optional — include only the outputs you need:

```js
export default {
  // ── Source ────────────────────────────────────────
  prefix: 'arc',
  components: 'packages/web-components/src',
  tiers: ['content', 'reactive', 'application'],
  ignore: ['**/index.js', '**/shared-styles.js', '**/icons/**'],

  // ── Framework wrappers (all optional) ─────────────
  react: {
    outDir: 'packages/react/src',
    wcPackage: '@arclux/arc-ui',
    barrels: true,
  },

  vue: {
    outDir: 'packages/vue/src',
    wcPackage: '@arclux/arc-ui',
    barrels: true,
  },

  svelte: {
    outDir: 'packages/svelte/src',
    wcPackage: '@arclux/arc-ui',
    barrels: true,
  },

  angular: {
    outDir: 'packages/angular/src',
    wcPackage: '@arclux/arc-ui',
    barrels: true,
  },

  solid: {
    outDir: 'packages/solid/src',
    wcPackage: '@arclux/arc-ui',
    barrels: true,
  },

  preact: {
    outDir: 'packages/preact/src',
    wcPackage: '@arclux/arc-ui',
    barrels: true,
  },

  // ── HTML/CSS outputs (optional) ───────────────────
  html: {
    outDir: 'packages/html/examples',
    baseCSS: 'shared/tokens.css',
    inlineVariant: true,
  },

  css: {
    outDir: 'packages/html/css',
    baseCSS: 'shared/tokens.css',
  },
};
```

### Source options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `prefix` | `string` | `'arc'` | Component tag prefix. Controls tag stripping (`arc-button` &rarr; `Button`), CSS bundle filename (`arc-ui.css`), and custom event detection. Change this to match your own design system prefix. |
| `components` | `string` | *required* | Root directory containing Lit component source files |
| `tiers` | `string[]` | *required* | Subdirectories within `components` to scan (e.g. `['content', 'reactive']`) |
| `ignore` | `string[]` | `[]` | Patterns to skip — bare filenames (`index.js`), prefixed (`**/index.js`), or directory globs (`**/icons/**`) |

### Framework options

Each framework section (`react`, `vue`, `svelte`, `angular`, `solid`, `preact`) accepts:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `outDir` | `string` | *required* | Output directory for generated wrappers |
| `wcPackage` | `string` | `'@{prefix}/{prefix}-ui'` | Package name used in `import` statements for the web component |
| `barrels` | `boolean` | `false` | Append exports to tier-level and root-level barrel (index) files |

### HTML options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `html.outDir` | `string` | *required* | Output directory for HTML snippet files |
| `html.baseCSS` | `string` | — | Path to design tokens CSS (used by inline variant to resolve `var()` references) |
| `html.inlineVariant` | `boolean` | `false` | Also generate `.inline.html` files with all tokens resolved and styles inlined |

### CSS options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `css.outDir` | `string` | *required* | Output directory for per-component CSS files and `{prefix}-ui.css` bundle |
| `css.baseCSS` | `string` | — | Path to design tokens CSS (included as `:root` block in the bundle) |

## How parsing works

Prism uses regex-based parsing (no AST library) to extract metadata from Lit source files:

1. **Tag + class name** from `customElements.define('arc-button', ArcButton)`, or a `@tag arc-button` JSDoc annotation. The tag must be a valid custom-element name (lowercase, hyphenated) — components with an invalid tag are skipped.
2. **Properties** from `static properties = { ... }`, `static get properties() { ... }`, or `@property()` decorators — extracts name, type, and reflect. Internal `{ state: true }` / `@state()` members are excluded from the public surface.
3. **Defaults** from `constructor() { this.variant = 'primary'; }` — assignments after nested blocks (`if`/`for`/`try`) are handled.
4. **CSS** from `` css`...` `` template literals
5. **Enum values** from `:host([prop="value"])` patterns in the CSS
6. **Template** from `render() { return html`...`; }` — supports variable inlining when templates are built from multiple `html`` ` blocks
7. **Events** from `dispatchEvent(new CustomEvent('name'))` calls
8. **Host display** from `:host { display: ... }` — determines whether HTML output uses `<div>` or `<span>` wrapper
9. **Interactivity level** — see below

## Interactivity detection

Prism classifies each component to determine whether it can be represented as static HTML/CSS or requires JavaScript:

| Level | Meaning | HTML/CSS output? |
|-------|---------|:---:|
| **static** | Pure display, no JS needed | Yes |
| **hybrid** | Visual works without JS, JS adds features | Yes |
| **interactive** | Requires JS to function | No |

All components get framework wrappers regardless of interactivity level. The classification only affects HTML/CSS output.

### Auto-detection

Prism looks for these signals in the source:

- `@click=`, `@input=`, `@change=`, etc. in template &rarr; **interactive**
- `dispatchEvent(new CustomEvent(...))` &rarr; **interactive**
- `this.shadowRoot.querySelector` &rarr; **interactive**
- `:host { display: none }` &rarr; **interactive**
- None of the above &rarr; **static**

Auto-detection is binary (static or interactive). The **hybrid** level requires a manual override.

### Manual overrides

Add an `@arc-prism` JSDoc tag to the class comment:

```js
/**
 * Code block with copy-to-clipboard button.
 * @arc-prism hybrid — renders without JS; copy button requires JS
 */
class ArcCodeBlock extends LitElement { ... }
```

Valid values: `static`, `hybrid`, `interactive`. The override is checked before auto-detection, so it always wins.

## CSS transformation

The `css` and `html` outputs convert shadow DOM CSS to light DOM equivalents:

| Shadow DOM | Light DOM |
|-----------|-----------|
| `:host` | `.arc-button` |
| `:host([variant="primary"])` | `.arc-button[data-variant="primary"]` |
| `:host([disabled])` | `.arc-button[disabled]` |
| `:host(:hover)` | `.arc-button:hover` |
| `:host(::before)` | `.arc-button::before` |
| `:host(:not([variant="primary"]))` | `.arc-button:not([data-variant="primary"])` |
| `.btn` (inner class) | `.arc-button .btn` |
| `svg` (bare element) | `.arc-button svg` |
| `.icon, .label` (selector list) | `.arc-button .icon, .arc-button .label` |

Every selector in a rule is scoped — including bare element, id, and attribute selectors, and each item in a comma-separated list — so inner styles never leak past the component. `@keyframes` step selectors (`0%`, `from`/`to`) and at-rule preludes (`@media`, `@supports`) are left untouched.

The inline HTML variant further resolves all `var(--token)` references using your design tokens CSS, and inlines the computed styles directly onto elements. A token reused multiple times in the same rule resolves at every occurrence. Pseudo-state rules (`:hover`, `:focus`, etc.) that can't be inlined are placed in a `<style>` block.

## Safety guarantees

- **Header check** — every generated file starts with `// Auto-generated by @arclux/prism — do not edit manually` (or the comment equivalent for HTML/CSS). If a file exists without this header, Prism assumes it was manually written and **never overwrites it**.
- **Append-only barrels** — barrel file updates only append new export lines. Existing exports are never removed, reordered, or modified.

## Programmatic API

The parser, CSS transform, and token resolver are available as package exports:

```js
import { parseComponent } from '@arclux/prism/parser';
import { shadowToLight } from '@arclux/prism/css-transform';
import { loadTokenMap, resolveTokens } from '@arclux/prism/resolve-tokens';

const meta = parseComponent(source, filePath, 'arc');
const lightCSS = shadowToLight(meta.css, meta.tag);
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and PR guidelines.

## License

[MIT](LICENSE) &copy; Arclight Digital, LLC
