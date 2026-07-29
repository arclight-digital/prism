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

Enum values come from a documented `@prop {'primary' | 'secondary'} variant` union when there is one, and are otherwise auto-detected from `:host([variant="value"])` patterns in the CSS. Props, defaults, types, events, and interactivity level are all extracted automatically.

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

# Delete generated output that no longer has a source component
npx prism --prune

# Exit 1 if anything was reported — for CI and generate scripts
npx prism --strict
```

All flags also have short forms: `-w` for `--watch`, `-c` for `--config`.

### `--strict`

Prism reports what it couldn't act on — doc drift, a `config.interactivity` entry matching no component, a name it had to drop — but a caller that pipes stdout and only surfaces it when a step fails can't observe any of it. `--strict` turns those reports into an exit code, which is the one signal such a caller does read:

```
1 CSS styles a variant value the documented @prop union omits:
  arc-chip styles variant value(s) "ghost" that its documented union omits

prism: --strict — 1 issue(s) reported above.
```

Skipped `interactive` components and the misclassification list are deliberately *not* strict failures. Both are routine on every run, and a check that can never pass gets removed. `--strict` is a no-op in watch mode.

## Configuration

Create a `prism.config.js` in your project root. Every section except `components` and `tiers` is optional — include only the outputs you need. A complete, copyable starting point ships as [`prism.config.example.js`](prism.config.example.js):

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
| `interactivity` | `Record<string, 'static'\|'hybrid'\|'interactive'>` | `{}` | Per-tag classification overrides. Highest precedence — see [Interactivity detection](#interactivity-detection) |
| `bindings` | `Record<string, { exclude: string[] }>` | `{}` | Per-tag opt-outs from derived two-way bindings — see [Two-way bindings](#two-way-bindings) |

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
5. **Enum values** from a `@prop {'a' | 'b'} name` JSDoc union, falling back to `:host([prop="value"])` patterns in the CSS. The documented union wins because CSS can only see what CSS styles: the default member usually has no attribute selector to be inferred from, and a variant driven from JS leaves no selector at all. Where both exist, a styled value the union omits is reported as doc drift.
6. **Template** from `render() { return html`...`; }` — supports variable inlining when templates are built from multiple `html`` ` blocks
7. **Events** from `dispatchEvent(new CustomEvent('name'))` calls — including the top-level keys of each event's `detail` object, which is what [two-way bindings](#two-way-bindings) are derived from
8. **Host display** from `:host { display: ... }` — determines whether HTML output uses `<div>` or `<span>` wrapper
9. **Interactivity level** — see below

## Two-way bindings

A wrapper that only passes props *down* is write-only: the framework's copy of `value` never updates, so the next unrelated re-render re-sets the stale value onto the element and silently reverts what the user just typed. Prism derives the write-back path automatically.

The rule is a convention, not a table: **an event whose `detail` carries a key matching a declared prop name is that prop's write-back path.** Where two events carry the same key — a slider firing both `arc-input` and `arc-change` — both are listened to, so a binding tracks the live drag as well as the commit.

The same derivation feeds each framework's own two-way idiom:

| Generator | Consumer writes | Prism emits |
|---|---|---|
| Svelte | `bind:value` | `$bindable()` + a handler per event |
| Vue | `v-model:value` | `update:value` in `defineEmits` |
| Angular | `[(value)]` | `@Output() valueChange` |
| Solid, Preact | — | nothing; neither framework has a two-way binding form |
| React | — | nothing; `@lit/react`'s `createComponent` wires properties and events itself |

### Svelte output

Bound props are declared `$bindable()`, and a handler per event mirrors the detail back:

```svelte
<script lang="ts">
  let { value = $bindable(0), min = 0, children, ...rest }: Props = $props();

  function __onArcInput(e: Event) {
    const detail = (e as CustomEvent).detail as Record<string, unknown> | null;
    if (detail) {
      if ('value' in detail) value = detail.value as number;
    }
    (rest['onarc-input'] as ((e: Event) => void) | undefined)?.(e);
  }
</script>

<arc-slider {value} {min} {...rest}
  onarc-input={__onArcInput}
>
```

Handlers are declared *after* `{...rest}` so they win the spread, then forward explicitly to any handler the consumer passed — so `onarc-input` still fires. `$bindable` is backwards compatible: a parent passing a plain `value` keeps working, the write just stays local.

### Vue output

`v-model:value` desugars to `:value` plus a listener for `update:value`, so the emit has to be declared for the binding to do anything:

```vue
<script setup lang="ts">
const emit = defineEmits<{
  'arc-input': [event: CustomEvent];
  'update:value': [value: number];
}>();

function onArcInput(payload: CustomEvent) {
  emit('arc-input', payload);
  const detail = payload.detail as Record<string, unknown> | null;
  if (detail) {
    if ('value' in detail) emit('update:value', detail.value as number);
  }
}
</script>

<template>
  <arc-slider :value="value" @arc-input="onArcInput"><slot /></arc-slider>
</template>
```

The original `arc-input` relay still fires, so `@arc-input` on the wrapper keeps working whether or not you use `v-model`.

### Angular output

`[(value)]` desugars to `[value]` plus `(valueChange)`, so it doesn't compile at all without the matching output:

```ts
@Output() arcInput = new EventEmitter<CustomEvent>();
@Output() valueChange = new EventEmitter<number>();

onArcInput(event: CustomEvent) {
  this.arcInput.emit(event);
  const detail = event.detail as Record<string, unknown> | null;
  if (!detail) return;
  if ('value' in detail) {
    const next = detail.value as number;
    this.value = next;
    this.valueChange.emit(next);
  }
}
```

The local `@Input()` is updated as well as emitted, so a one-way `[value]` consumer sees the element's current state instead of having the stale bound value pushed back on the next change detection.

### `config.bindings` — opt-outs

The convention has exceptions, and they are the kind that fail quietly, so they live in config rather than a JSDoc tag:

```js
// prism.config.js
bindings: {
  // detail.label is the *selected option's* text, not the field's own label —
  // binding it would overwrite the field label on every change
  'arc-select': { exclude: ['label'] },
  // detail.value is the copied string; the button never changes it
  'arc-copy-button': { exclude: ['value'] },
},
```

Two kinds of exception are worth looking for:

- **Name collisions** — the detail key means something different from the prop it shares a name with. This is a real bug: the binding writes the wrong data.
- **Echoes** — the element dispatches its own unchanged prop as context (`detail: { value: this.value }` from a copy button) rather than reporting a change. Harmless, since the write is a no-op, but it puts `$bindable()` on a prop that can never change.

Only top-level `detail` keys count. A nested payload (`detail: { href, item: { label } }`) never produces a binding, so a component reporting some *other* object's `label` needs no opt-out.

Malformed entries throw at config load — an unknown field, a tag that isn't a valid custom-element name, or an `exclude` that isn't an array of strings.

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

- `@click=`, `@input=`, `@change=`, `@focusin=`, etc. in template &rarr; **interactive**
- `dispatchEvent(new CustomEvent(...))` &rarr; **interactive**
- `this.shadowRoot.querySelector` &rarr; **interactive**
- `:host { display: none }` &rarr; **interactive**
- None of the above &rarr; **static**

Auto-detection is binary (static or interactive). The **hybrid** level requires a manual override.

### Manual overrides

Classification is resolved in three layers, highest precedence first:

| Layer | Source | Notes |
|---|---|---|
| 0 | `config.interactivity` | **Preferred.** Durable — config is never machine-rewritten |
| 1 | `@arc-prism` JSDoc tag | Supported for back-compat |
| 2 | Auto-detection | Binary only (static or interactive) |

#### `config.interactivity` (preferred)

```js
// prism.config.js
export default {
  interactivity: {
    'arc-tab':        'interactive',  // child of arc-tabs
    'arc-code-block': 'hybrid',       // display works; copy needs JS
  },
};
```

Prefer this over the JSDoc tag. A tag lives in a doc comment, and any pass that
rewrites doc comments can silently drop it — taking the classification with it.
The config file is data that codegen never touches.

It also fails loudly rather than silently:

- an unknown level or malformed tag key **throws** at config load
- a key matching no component **warns** on every run, so a renamed or deleted
  component can't quietly lose its override

#### `@arc-prism` JSDoc tag

```js
/**
 * Code block with copy-to-clipboard button.
 * @arc-prism hybrid — renders without JS; copy button requires JS
 */
class ArcCodeBlock extends LitElement { ... }
```

Valid values: `static`, `hybrid`, `interactive`. Still fully supported, but note
that a *malformed* tag is inert — it neither throws nor warns, it just falls
through to auto-detection. `config.interactivity` has no such failure mode.

### What a run didn't produce

Skipping is quiet per-component and invisible in aggregate, so every run now
states the total — and flags skipped components that look like they shouldn't be:

```
85 of 186 components produce HTML/CSS; 101 are interactive (237 KB of component CSS reaches no output).

3 of those look presentational — few handlers on a substantial stylesheet:
  arc-button — 4 KB CSS, classified interactive by @click
  Pin any that render without JS: config.interactivity: { '<tag>': 'hybrid' }
```

The flag is deliberately narrow: only **auto-detected** classifications are
questioned (a `config.interactivity` or `@arc-prism` level is a decision, not a
guess), and components using imperative shadow DOM, carrying `:host { display:
none }`, binding more than two handlers, or styling less than 800 bytes are all
excluded. It is a prompt to look, never an assertion that the level is wrong.

### Stale output

A component that becomes `interactive` stops producing HTML/CSS, and a deleted
component stops producing everything. Prism reports both on every run and
removes them with `--prune`:

```
Orphaned output (no matching component):
  stale: packages/html/css/ghost.css (run with --prune to remove)
```

Only files carrying prism's generated header are ever removed — hand-written
files at a generated path are left alone.

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
