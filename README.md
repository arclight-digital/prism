# @arclux/prism

[![CI](https://github.com/Arclight-Digital/prism/actions/workflows/ci.yml/badge.svg)](https://github.com/Arclight-Digital/prism/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@arclux/prism)](https://www.npmjs.com/package/@arclux/prism)
[![license](https://img.shields.io/npm/l/@arclux/prism)](LICENSE)
[![node](https://img.shields.io/node/v/@arclux/prism)](package.json)

Generate framework wrappers and HTML/CSS examples from [Lit](https://lit.dev/) web components.

Write a component once as a Lit custom element. Prism reads the source and generates idiomatic wrappers for **React**, **Vue**, **Svelte**, **Angular**, **Solid**, and **Preact** — plus standalone **HTML/CSS** snippets, **JSX typings**, and wrapper-package **export maps**. Parsing is regex-based: no AST libraries, no build step, plain ESM. The only runtime dependency is [chokidar](https://github.com/paulmillr/chokidar), for watch mode.

## Why

A web-component library still has to meet framework consumers on their terms: typed props, handler props for custom events, `v-model` and `[(x)]` bindings, `formControlName` support, JSX types. Hand-writing that surface for six frameworks turns every new prop into seven edits, and a missed one fails silently — fewer props still type-checks. Prism generates the whole surface from the component source, reads back what it wrote, and reports everything it couldn't act on.

## What it generates

Given a Lit component:

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
| **React** | TypeScript wrapper via `@lit/react` `createComponent`, with a typed `ButtonProps` interface and a `'primary' \| 'secondary'` union for `variant` |
| **Vue 3** | `.vue` SFC with `defineProps` generics and `withDefaults` |
| **Svelte 5** | `.svelte` component using `$props()` runes |
| **Angular** | Standalone component attached to the element itself, with `@Input()` accessor pairs and a `ControlValueAccessor` for form-associated elements |
| **Solid** | `.tsx` component using `splitProps()` for reactivity-safe forwarding |
| **Preact** | `.tsx` component with native custom-element support |
| **HTML** | Static snippet wrapped in a `<span>` or `<div>` (based on host display), slots replaced with placeholder text |
| **Inline HTML** | Same snippet with all `var()` tokens resolved and styles inlined |
| **CSS** | Shadow DOM CSS transformed to light DOM (`:host` &rarr; `.arc-button`, scoped inner selectors) |
| **CSS bundle** | All components combined into one `arc-ui.css` with design tokens |
| **JSX typings** | `react-jsx.d.ts` / `preact-jsx.d.ts` / `solid-jsx.d.ts` for consumers who render `<arc-button>` directly |
| **Export maps** | Each wrapper package's `exports` field, a subpath per component |

Props, defaults, types, events, and interactivity level are extracted automatically:

- **Enum unions** come from a `@prop {'primary' | 'secondary'} variant` JSDoc tag, or failing that are inferred from `:host([variant="value"])` CSS patterns plus the prop's own default.
- **Complex types** in a non-union `@prop` tag are emitted verbatim, so a `series` prop can be `Array<{label: string, data: number[]}>` rather than `unknown[]`.
- **Custom events** (`dispatchEvent(new CustomEvent('arc-change'))`) become typed handler props in every wrapper — `onArcChange` in React/Solid/Preact, a wired `defineEmits` listener in Vue, an `@Output()` in Angular. Preact binds through a ref effect, since its `on*` convention can't reach hyphenated event names.

## Installation

```bash
npm i -D @arclux/prism
```

Requires **Node.js 24+**. No peer dependencies.

## Usage

```bash
npx prism                          # Generate everything in prism.config.js
npx prism --watch                  # Regenerate when source files change
npx prism path/to/button.js        # Process a single component file
npx prism --config ./custom.config.js
npx prism --prune                  # Delete generated output whose component is gone
npx prism --strict                 # Exit 1 if anything was reported
npx prism --report-json out.json   # Write findings as JSON
```

Short forms: `-w` for `--watch`, `-c` for `--config`.

## Configuration

Create `prism.config.js` in your project root. Every section except `components` and `tiers` is optional — include only the outputs you need. A complete, copyable starting point ships as [`prism.config.example.js`](prism.config.example.js):

```js
export default {
  prefix: 'arc',
  components: 'packages/web-components/src',
  tiers: ['content', 'reactive', 'application'],
  ignore: ['**/index.js', '**/shared-styles.js', '**/icons/**'],

  react:  { outDir: 'packages/react/src',  wcPackage: '@arclux/arc-ui', barrels: true },
  vue:    { outDir: 'packages/vue/src',    wcPackage: '@arclux/arc-ui', barrels: true },
  svelte: { outDir: 'packages/svelte/src', wcPackage: '@arclux/arc-ui', barrels: true },
  angular:{ outDir: 'packages/angular/src',wcPackage: '@arclux/arc-ui', barrels: true },
  solid:  { outDir: 'packages/solid/src',  wcPackage: '@arclux/arc-ui', barrels: true },
  preact: { outDir: 'packages/preact/src', wcPackage: '@arclux/arc-ui', barrels: true },

  jsxTypes: { outDir: 'packages/web-components/types' },

  html: { outDir: 'packages/html/examples', baseCSS: 'shared/tokens.css', inlineVariant: true },
  css:  { outDir: 'packages/html/css',      baseCSS: 'shared/tokens.css' },
};
```

### Source options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `prefix` | `string` | `'arc'` | Component tag prefix. Controls tag stripping (`arc-button` &rarr; `Button`), the CSS bundle filename, and custom event detection |
| `components` | `string` | *required* | Root directory containing Lit component sources |
| `tiers` | `string[]` | *required* | Subdirectories of `components` to scan |
| `ignore` | `string[]` | `[]` | Patterns to skip — bare filenames, `**/`-prefixed names, or directory globs |
| `interactivity` | `Record<string, level>` | `{}` | Per-tag classification overrides — see [Interactivity](#interactivity-detection) |
| `bindings` | `Record<string, { exclude }>` | `{}` | Per-tag opt-outs from derived two-way bindings — see [Two-way bindings](#two-way-bindings) |
| `acknowledge` | `Array<{ code, tag?, prop?, note? }>` | `[]` | Findings you've decided about, so `--strict` can pass — see [Acknowledging findings](#configacknowledge) |
| `runtime` | `boolean \| { setup? }` | `false` | Resolve properties from the class by importing it — see [`config.runtime`](#configruntime) |
| `propsFrom` | `(source, filePath) => Props[] \| undefined` | — | Resolve declarations prism's reader can't. Unnecessary with `runtime` — see [`config.propsFrom`](#configpropsfrom) |
| `formAssociated` | `(source, filePath) => boolean \| undefined` | — | Answer whether an element is form-associated when a mixin declares it. Unnecessary with `runtime` |
| `formValue` | `Record<string, string \| string[]>` | `{}` | The property a form binds on a component, or a pair for a compound value |
| `barrelExclude` | `string[]` | `[]` | Components kept out of every barrel — see [Barrels](#keeping-a-component-out-of-the-barrels) |
| `jsxTypes` | `{ outDir, frameworks? }` | — | Write the opt-in JSX declaration files — see [JSX typings](#configjsxtypes) |

### Framework options

Each framework section (`react`, `vue`, `svelte`, `angular`, `solid`, `preact`) accepts:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `outDir` | `string` | *required* | Output directory for generated wrappers |
| `wcPackage` | `string` | `'@{prefix}/{prefix}-ui'` | Package name used in wrapper `import` statements |
| `barrels` | `boolean` | `false` | Append exports to tier- and root-level index files |
| `packageJson` | `string` | — | Path to the package's manifest; enables the [exports map](#wrapper-package-export-maps). Not supported for `angular` |
| `exportsMode` | `'dist'\|'dist-solid'\|'dist-svelte'\|'dist-vue'\|'src'` | per framework | What the package build emits, and so what subpaths point at |

### HTML / CSS options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `html.outDir` | `string` | *required* | Output directory for HTML snippets |
| `html.baseCSS` | `string` | — | Design-tokens CSS, used by the inline variant to resolve `var()` |
| `html.inlineVariant` | `boolean` | `false` | Also generate `.inline.html` files with tokens resolved and styles inlined |
| `css.outDir` | `string` | *required* | Output directory for per-component CSS and the `{prefix}-ui.css` bundle |
| `css.baseCSS` | `string` | — | Design-tokens CSS, included as a `:root` block in the bundle |

## How parsing works

1. **Tag + class name** from `customElements.define(...)` or a `@tag` JSDoc annotation. Invalid tag names are skipped.
2. **Properties** from `static properties = {...}`, `static get properties()`, or `@property()` decorators. `{ state: true }` / `@state()` members are excluded. A declaration that isn't an object literal is reported as `unparsed-prop-declaration` — see [`config.propsFrom`](#configpropsfrom).
3. **Defaults** from `constructor() { this.variant = 'primary'; }`.
4. **CSS** from `` css`...` `` template literals.
5. **Enum values** from a documented `@prop` union, falling back to `:host([prop="value"])` CSS patterns plus the prop's default. Where both exist, disagreements are reported as `doc-drift`.
6. **Prop types** from non-union `@prop` tags, emitted verbatim. The type must be self-contained — generated wrappers take no imports, so a type naming your own exported symbol is reported instead.
7. **Template** from `render()`, with variable templates inlined and simple ternaries resolved against prop defaults.
8. **Events** from `dispatchEvent(new CustomEvent(...))` calls, including each event's top-level `detail` keys.
9. **Host display** from `:host { display: ... }` — decides the HTML snippet's wrapper element.
10. **Interactivity level** — see below.

## Two-way bindings

A wrapper that only passes props down is write-only: the framework's copy of `value` never updates, and the next unrelated re-render re-sets the stale value onto the element. Prism derives the write-back path from a convention: **an event whose `detail` carries a key matching a declared prop name is that prop's write-back path.** If two events carry the same key (a slider firing `arc-input` and `arc-change`), both are listened to.

| Generator | Consumer writes | Prism emits |
|---|---|---|
| Svelte | `bind:value` | `$bindable()` + a handler per event |
| Vue | `v-model:value` | `update:value` in `defineEmits` |
| Angular | `[(value)]` | `@Output() valueChange` |
| Solid, Preact | — | nothing; no two-way binding form |
| React | — | nothing; `@lit/react` wires properties and events itself |

The original event relay still fires in every case, so plain `@arc-input` handlers keep working alongside the binding. Only top-level `detail` keys count; a nested payload never produces a binding.

### `config.bindings` — opt-outs

Two kinds of exception exist, and both fail quietly, so they live in config:

```js
bindings: {
  // Name collision: detail.label is the selected option's text, not the field's
  // own label — the binding would write the wrong data.
  'arc-select': { exclude: ['label'] },
  // Echo: detail.value is the copied string; the button never changes it.
  'arc-copy-button': { exclude: ['value'] },
},
```

Malformed entries throw at config load.

## Interactivity detection

Each component is classified to decide whether it can be represented as static HTML/CSS:

| Level | Meaning | HTML/CSS output? |
|-------|---------|:---:|
| **static** | Pure display, no JS needed | Yes |
| **hybrid** | Renders without JS; JS adds features | Yes |
| **interactive** | Requires JS to function | No |

All components get framework wrappers regardless; the level only affects HTML/CSS output.

Auto-detection is binary (static or interactive): template event handlers (`@click=` etc.), `dispatchEvent`, imperative shadow-DOM access, or `:host { display: none }` all mean `interactive`; otherwise `static`. `hybrid` always requires an override.

Overrides resolve in order: `config.interactivity` (preferred — config is never machine-rewritten, and a bad entry throws at load while an unmatched one warns every run), then an `@arc-prism static|hybrid|interactive` JSDoc tag (kept for back-compat; a malformed tag silently falls through), then auto-detection.

```js
interactivity: {
  'arc-tab':        'interactive',  // child of arc-tabs
  'arc-code-block': 'hybrid',       // display works; copy needs JS
},
```

Every run states the aggregate of what it skipped, and flags auto-classified components that look presentational (few handlers, substantial stylesheet) as candidates for `hybrid`:

```
85 of 186 components produce HTML/CSS; 101 are interactive (237 KB of component CSS reaches no output).

3 of those look presentational — few handlers on a substantial stylesheet:
  arc-button — 4 KB CSS, classified interactive by @click
```

The flag questions only auto-detected levels — a config or JSDoc level is a decision, not a guess.

## Generated wrapper details

### Named slots

Svelte gets a snippet prop per named slot; Vue gets a forwarded `<slot name>` per slot. React, Preact, Solid, and Angular need no per-slot outlet — they project children into the light DOM and the browser assigns them from the `slot` attribute — but they do need their single children outlet, which is also the route for named-slot content. So a component whose slots are all named still takes `children` in those four, and Angular still gets one bare `<ng-content />`.

The wrapper adds no carrier element around your content (one would break `::slotted()` rules and slot layout), so the `slot` attribute goes on your own element:

```svelte
<Toolbar>
  {#snippet start()}
    <button slot="start">Play</button>
  {/snippet}
  <span>default content</span>
</Toolbar>
```

```vue
<Toolbar>
  <template #start><button slot="start">Play</button></template>
  <span>default content</span>
</Toolbar>
```

**Components that take no children:** wrappers accept `children` unless prism has positive evidence they shouldn't — the component declares only named slots (in the four light-DOM frameworks, only when it has no slots at all), or the class JSDoc says so:

```js
/**
 * @tag arc-spinner
 * @slot none
 */
```

Finding no `<slot>` in the file is not treated as evidence: a default slot rendered by a base class, mixin, or helper looks identical from the source. With `@slot none`, every wrapper omits `children`, turning content that would vanish at runtime into a type error. If the component does render a default `<slot>`, the markup wins and the contradiction is reported (`slot-none-contradicted`).

Slot names that aren't valid identifiers become camelCase snippet props (`slot="icon-left"` &rarr; `iconLeft`) and are reported (`slot-name-not-identifier`): `{#snippet iconLeft()}` reaches the slot, `slot="icon-left"` on a direct child of the Svelte wrapper does not.

### What the generated Props accept

The Svelte, Preact, and Solid interfaces list the component's own props, then the common global HTML attributes by name (`class`, `id`, `style`, `role`, `part`, `tabindex`, …) plus pattern index signatures for `data-*`, `aria-*`, and `on*`. That is deliberately narrower than `[key: string]: unknown`, which accepts every typo — `<Slider valu={3} />` used to type-check clean. If a global attribute you need is missing, open an issue.

### camelCase props

A prop whose name changes under lowercasing can't travel as an attribute: `confirmLabel` becomes `confirmlabel` in the DOM, which Lit doesn't observe, so the element keeps its constructor default. Prism sets these as **properties** instead — an `$effect` against a ref in Svelte, `[confirmLabel]` binding in Angular, `prop:confirmLabel` in Solid; React, Vue, and Preact already resolve the property by name. Kebab-case would be worse, not better: Lit's Boolean converter is presence-based, so `auto-resize="false"` would set `autoResize` to **true**.

One consequence in Svelte: `$effect` doesn't run during SSR, so a camelCase prop is applied on hydration rather than appearing in the server HTML.

### Prop names your framework reserves

React and Preact take `key` and `ref` in the reconciler, so `<Column key="name" />` sets the list key and the prop silently never reaches the component. Prism can't work around this in the wrapper — the value is taken before the component function runs — so it reports the collision (`framework-reserved`), checked only for frameworks you generate.

**Prefer an alias to a rename.** The prop still works in plain HTML and every unaffected framework, so renaming breaks working consumers to fix broken ones. A second name the component falls back to breaks nobody:

```js
const name = col.field ?? col.key;   // React/Preact users pass `field`
```

### Angular reactive forms

`formControlName`, `formControl`, and `[(ngModel)]` all reach a component through `ControlValueAccessor` — and a wrapper without one doesn't fail, it binds nothing and reports nothing while the element on screen holds the user's text. Prism emits the accessor for the components a form can actually bind to.

- **Which components:** those with `static formAssociated = true` — the platform's own definition of a form control. No tag tables, no guessing from change events (which would sweep in tabs and toggles). If a mixin contributes the static, [`config.runtime`](#configruntime) sees it directly; without runtime, a `config.formAssociated(source)` hook can answer (return `true`, `false`, or `undefined` to fall through).
- **What a form binds:** `checked` if declared, otherwise `value` — read from the component, so a new control is covered by writing it. The accessor commits on the component's change event (`arc-change` over `arc-input` — committing on input marks the form dirty every keystroke) and reads the DOM property rather than the event `detail`, so no payload shape has to be agreed on.
- **Compound values:** a control whose value is a pair has no single property to carry, so name both and the accessor carries an object — what a reactive form holds for a compound value anyway:

  ```js
  formValue: {
    'arc-date-range-picker': ['start', 'end'],
    'arc-range-slider': ['low', 'high'],
  },
  ```

  `config.formValue` also names the property outright for a control declaring neither `value` nor `checked`. Without an entry, the component is reported as `form-control-unbindable` and its wrapper is generated without an accessor.
- **`@angular/forms` becomes a peer dependency** of the Angular wrapper package — `NG_VALUE_ACCESSOR` is a runtime value, so an optional peer would not do. Range it against `@angular/core`.

Three details of the emitted accessor are deliberate: the change listener is attached in the constructor (the `host` metadata already carries the event's own `@Output`, and can't hold two handlers for one event); `writeValue` never echoes back into the form (that would mark the control dirty on every programmatic `setValue`); and the reset value follows the declared type — `''`, `false`, `0`, `[]`, or a union's own default, since `''` is not a member of `'sm' | 'md' | 'lg'`.

### `config.jsxTypes`

For consumers who render `<arc-input value="…">` directly, prism writes `react-jsx.d.ts`, `preact-jsx.d.ts`, and `solid-jsx.d.ts`, each augmenting the module its framework actually resolves `JSX.IntrinsicElements` through:

```js
jsxTypes: {
  outDir: 'packages/web-components/types',
  frameworks: ['react', 'preact', 'solid'],   // default: all three
  // wcPackage: '@arclux/arc-ui',             // inherited from the wrapper sections
},
```

A documented union stays a union, so a wrong enum value is a compile error — most of what the file is worth. The base attribute set is per framework: Solid carries `on:` (how a custom event is reached from JSX with no ref), `prop:`, `attr:`, `use:`, and `classList`; Preact's `on${string}` stays loose because Preact lowercases handler names and can't reach dashed events from a prop; React takes `className` and `tabIndex`. Each element is typed under both its property and attribute spellings, since Lit *lowercases* names (`confirmLabel` &rarr; `confirmlabel`) and both forms work.

`wcPackage` is the package name written into the activation instructions, inherited from the framework sections; it must be set explicitly when those sections name different packages or none is configured. If you already generate these files yourself, prism won't overwrite them — it reports `jsx-types-not-written` instead. Delete your copy once compared, and prism owns the path from the next run (or acknowledge the code to keep yours).

**Applying the file is the part that goes wrong.** These look right and silently do nothing — TypeScript resolves a `types` entry as a *package* and never follows an export-map subpath, with no diagnostic:

```jsonc
{ "compilerOptions": { "types": ["@arclux/arc-ui/react-jsx"] } }   // does nothing
/// <reference types="@arclux/arc-ui/react-jsx" />                  // does nothing
```

Two forms that work (the generated header states them too):

```jsonc
{ "include": ["src", "node_modules/@arclux/arc-ui/types/react-jsx.d.ts"] }
/// <reference path="./node_modules/@arclux/arc-ui/types/react-jsx.d.ts" />
```

### Wrapper package export maps

Prism decided the wrapper file tree, so it can write the `exports` map rather than have a second program re-infer it:

```js
react: {
  outDir: 'packages/react/src',
  packageJson: 'packages/react/package.json',
  // exportsMode: 'dist',   // defaults per framework; 'src' for a package with no build
},
```

Every component gets its own subpath (`@arclux/arc-ui-react/Button`), so a consumer that can't tree-shake a 200-export barrel imports one component without the rest. There is deliberately no `"./*"` wildcard — it publishes every internal file as unversioned API. Prism sets `exports`, plus `main`/`module`/`types` for built modes, and leaves the rest of the manifest alone.

Default modes match what each toolchain consumes: `dist` for React and Preact; Solid adds a `solid` condition pointing at source `.tsx` so Solid's compiler owns the JSX; Svelte ships the component under the `svelte` condition; Vue uses vue-tsc's `.vue.d.ts` naming. Source targets are checked for existence (`exports-target-missing`); dist targets aren't, since the package build fails loudly about those. Two components wanting the same subpath are reported (`exports-subpath-collision`).

**Angular is refused rather than written wrong:** `ng-packagr` owns the published manifest for an Angular library and copies a source `exports` map verbatim into dist, where it ships broken. `config.angular.packageJson` throws at config load.

### Keeping a component out of the barrels

A bundler resolves the dynamic imports of everything in its module graph, and a barrel puts every component there — so one component's optional dependency becomes every consumer's required install. `config.barrelExclude` names components that stay out:

```js
barrelExclude: ['arc-code-block'],   // pulls in shiki
```

Excluded components are still generated, still verified, and still get their own subpath — they're just not re-exported from any barrel. Existing barrel entries are removed on the next full run.

## Reading properties from the class

### `config.runtime`

Source reading has one blind spot it can't reason around: **a property contributed by a mixin or base class isn't in the file that declares the component.**

```js
class ArcInput extends FormControlMixin(LitElement) { … }
```

`readonly`, `required`, and `name` are real reactive properties of that element, and no amount of reading `input.js` finds them. The sharper version is inheritance: `export class ArcModal extends ArcDialog {}` has every property `ArcDialog` declares and none that source reading can attribute to it — an ordinary refactor into a subclass silently empties the component's wrappers.

Lit already computes the answer: `Ctor.elementProperties` is the flattened map of every reactive property, mixins and superclasses included. `config.runtime` reads it:

```js
runtime: true,
// or, if your components need a DOM at import time:
runtime: { setup: './scripts/dom-shim.js' },
```

**It's opt-in because reading the class means importing the module, and importing runs it** — a config file is the right place to say yes to that. Lit 3 carries its own DOM shim, so most projects need no `setup`; the option exists for components that touch a browser global at module scope. It degrades rather than fails: a module that throws on import costs that one component its runtime answer (reported as `runtime-unavailable`) and falls back to the source reader.

With `runtime` on, four things become unnecessary: mixin props are ordinary `elementProperties` entries, `config.propsFrom` and `config.formAssociated` are answered by the class itself, and `unparsed-prop-declaration` can't occur. A configured `propsFrom` still wins — it's explicit configuration — but is now checked against the class, and omissions are reported. Defaults, documented unions, and CSS-inferred enums still come from source and apply on top: the class knows what a property *is*; the file knows what the author said about it.

### What a subclass inherits

`elementProperties` brings a subclass's property declarations back on its own. Nothing else flattens, because nothing else is data on the class — events, slots, template, and styles are statements in the base class's file, and so are defaults (constructor assignments) and documented unions (JSDoc). So prism links a component to the one it extends, by class identity through the prototype chain, and takes the rest from that component's own parse:

- **Events and payloads** merge always — a subclass dispatches its own and its parent's, and the payload drives two-way bindings.
- **Defaults and documented types** merge always — `super()` runs whatever the base assigns, regardless of what the subclass renders.
- **Template, styles, slots, and interactivity** transfer only when the subclass renders nothing of its own. A subclass with its own `render()` is describing its own surface and is believed.

Inheriting only ever fills a hole: wherever the subclass spoke — its own default, union, or `render()` — it wins. A run reports what it took: `inherits from arc-dialog: events (arc-close, arc-open), defaults (open, heading), template, slots (footer)`.

This needs the base class to be among the components prism scanned. Where it isn't — a base in another package, or dispatch from a helper module — a `@fires` tag is believed instead. Dispatch sites stay authoritative (they carry the `detail` shape; a tag carries none), but a handler prop for an event that never fires is a harmless unused member, while a missing one is a consumer's handler that silently never runs.

### `config.propsFrom`

Prism reads two shapes of property declaration: an object literal in `static properties`, and an `@property()` decorator. A declaration *built* by helpers is a third shape it can't follow:

```js
static properties = {
  selected:    int({ default: 0, min: 0, max: '_maxIndex', clamp: 'toRange' }),
  orientation: oneOf(['horizontal', 'vertical']),
};
```

Teaching prism to map helper names to types would put your vocabulary's semantics inside prism, where they'd drift from your repo. The hook lets the repo answer for itself:

```js
// prism.config.js
export default {
  propsFrom(source, filePath) {
    // Return an array of props, or undefined to fall through to prism's own
    // reader — a hook only handles the files it knows about.
    return myDeclarationReader(source)?.map((d) => ({
      name: d.name,
      type: d.type,          // String | Boolean | Number | Array | Object
      default: d.defaultSrc, // source text, not a value: "'md'", not "md"
      reflect: d.reflect,
      state: d.internal,     // true keeps it off the public surface
    }));
  },
};
```

Only `name` is required. `default` is emitted verbatim into generated code, so it's source text (a plain value is converted rather than dropped). Constructor defaults, documented unions, and documented types still apply on top.

The hook is held to its contract: an unknown `type`, an entry with no usable `name`, a non-array return, or a throw is reported as `invalid-props-from` and prism falls back to its own reader. That code fails `--strict` and can't be acknowledged — it describes a bug in the config, not a finding about a component.

**A hook that under-reports looks identical to a correct one** — there's nothing to validate about an entry it never returned, and a silently dropped prop still type-checks downstream. So the `@prop` tags serve as a cross-check: a hook that answers for a file with strictly fewer props than the file documents gets one `props-from-under-reports` finding naming them. Prefer throwing over returning a partial array; if the tags are the stale half, acknowledge the code or delete them. (With `runtime` on, the same check runs against the class itself, which is exact where the JSDoc check is inferential.)

**Without a hook, an unreadable declaration is still reported**, from two directions:

| Code | Means | `--strict` |
|------|-------|-----------|
| `unparsed-prop-declaration` | The reader saw `name:` but the value wasn't an object literal — the prop reaches no wrapper | **fails** (acknowledgeable) |
| `doc-prop-undeclared` | A `@prop` tag with no reactive property behind it | fails only when checked against the class |

`doc-prop-undeclared` is conditional because the two evidence sources make different claims. Read from source, "no declaration in this file" is routinely untrue for mixin-contributed props — failing a build on that fails it for a backlog only `runtime` can clear. Read from the class, "no such property" means a stale tag and a one-line fix. Strictness follows the evidence; either way the finding can be acknowledged, and `--report-json` lets you gate on it yourself today.

## Diagnostics

Everything prism can't act on is collected and printed once, grouped by a stable machine-readable `code`, at the end of the run.

### `--strict`

A caller that pipes stdout and only surfaces it when a step fails can't observe warnings; `--strict` turns them into an exit code. It fails on: a declared prop prism couldn't read, a generated wrapper that never registers its element or is missing a declared outlet or (for a form control) its accessor, a form-associated element prism couldn't wire, a prop name the framework reserves, doc drift, an exports-map subpath pointing at a missing file, a configured JSX file something else owns, a run that would overwrite output from a newer prism, config entries matching nothing, and any tag, event, or detail key prism had to drop.

Report-only codes: `slot-name-collides-with-prop`, `children-without-default-slot`, `slot-none-contradicted`, the doc-type findings (`unusable-doc-type`, `unportable-doc-type`), `unknown-acknowledge-code` (an unrecognised acknowledge code must never block a rollback), and `doc-prop-undeclared` when read from source. Skipped `interactive` components and the misclassification list are deliberately never failures — both are routine on every run, and a check that can never pass gets removed. `--strict` is a no-op in watch mode.

### `config.acknowledge`

Some findings are correct and stay correct — `arc-column` really declares `key`, React really eats it, and the recommended fix (an alias) leaves the finding true forever. `acknowledge` records the decision so `--strict` can pass:

```js
acknowledge: [
  {
    code: 'framework-reserved',       // required
    tag: 'arc-column',                // optional — omit to match every tag
    prop: 'key',                      // optional — omit to match every prop
    note: 'aliased as `field`; key still works in HTML/Vue/Svelte/Angular/Solid',
  },
],
```

Every stated field must match; omitted fields are wildcards, so `{ code }` alone waives a whole class. Malformed entries throw at config load — including a narrowing field the finding never carries (e.g. `prop` against `props-from-under-reports`, which names its props in bulk).

Two deliberate properties: **waived findings still print**, under a `prism: accepted:` heading with your note — an allowlist that makes output disappear is how a regression hides behind an old decision. And **an entry matching nothing is itself a strict failure** (`unmatched-acknowledge`, which can't be acknowledged) — otherwise the list rots and quietly pre-waives whatever next appears under the same key. Entries naming a code this version doesn't emit are ignored and reported, not fatal, so a config written for a newer release can't block a rollback.

### `--report-json`

Human headings carry the literal prefix `prism: warning:` (or `prism: accepted:`), but the wording after it changes between releases. Anything automated should consume the JSON instead:

```json
{
  "version": 1,
  "strict": true,
  "findings": [
    { "code": "doc-drift", "tag": "arc-chip", "prop": "variant", "message": "…", "accepted": false }
  ],
  "accepted": [
    { "code": "framework-reserved", "tag": "arc-column", "prop": "key", "note": "…", "accepted": true }
  ]
}
```

`code` is the stable contract; `message` is for humans. A failure to write the report never fails the run.

### Version stamping, and downgrades that revert

Every generated file opens with the version that wrote it:

```
// Auto-generated by @arclux/prism 3.0.0 — do not edit manually
```

Running an older prism doesn't error — it *reverts*: prism rewrites every file it owns from whatever version is installed, and the only trace is a large diff in generated files nobody reads. With the stamp, a downgrade announces itself in the diff, and prism says so directly (`generator-downgrade`):

- **Before writing anything**, a full run or a watcher's first pass scans the output tree. Finding files newer than the running version reports the downgrade — and under `--strict`, outside watch mode, prism refuses to generate at all: nothing is written, exit 1, both versions named.
- **While writing**, single-file mode and watch rebuilds still report a newer stamp they overwrite — a witness rather than a guard, since the finding clears itself on the next run once the files carry the older stamp.

Barrels are deliberately unstamped: they're appended to and pruned in place, so their contents accrue across versions and no single stamp would describe them. The sentinel treats the version as optional and matches any org name, so output written before 3.0.0 — or under prism's old scope — is still recognised and regenerated.

### Stale output

A component that becomes `interactive` stops producing HTML/CSS, and a deleted component stops producing everything. Prism reports both every run and removes them with `--prune`:

```
Orphaned output (no matching component):
  stale: packages/html/css/ghost.css (run with --prune to remove)
```

Only files carrying prism's generated header are ever removed. Barrels are reconciled after the sweep and unconditionally — a barrel exporting a file that's gone breaks the build of whoever imports it (`TS2307`), which is not something to leave behind a flag. What to drop is decided by asking the filesystem whether each specifier still resolves, never by naming convention, so barrels prism doesn't generate keep working.

### Wrapper verification

After writing each wrapper, prism reads it back and checks three things, because each failure is invisible from every other direction — the file compiles, builds, and does nothing:

- **It registers its element** (`wrapper-missing-register`). A type-only import of the element class gets elided by TypeScript, taking `customElements.define` with it; the wrapper then renders an unupgraded element whose prop assignments read back fine as expandos.
- **It carries an outlet for the component's content** (`wrapper-missing-slot`) — the children outlet in React/Preact/Solid/Angular whenever any slot is declared, and a per-named-slot outlet in Svelte/Vue.
- **A form control registers its accessor** (`wrapper-missing-accessor`, Angular only).

All three fail `--strict`. A generated file that stops carrying its component's surface is a generator bug, so the check lives in the generator rather than in whatever repo consumes it.

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

Every selector in a rule is scoped — bare element, id, and attribute selectors included, and each item of a comma list — so inner styles never leak past the component. `@keyframes` step selectors and at-rule preludes are left untouched.

The inline HTML variant additionally resolves all `var(--token)` references from your design-tokens CSS and inlines computed styles onto elements; pseudo-state rules that can't be inlined go into a `<style>` block.

## Safety guarantees

- **Header check** — every generated file starts with an `Auto-generated by @arclux/prism — do not edit manually` sentinel. A file without it is assumed hand-written and is **never overwritten or deleted**.
- **Append-only barrels** — per-component barrel updates only append; existing exports are never reordered or rewritten. The only removals are the reconciliation pass (specifiers that no longer resolve, names a target barrel stopped exporting, `barrelExclude` entries). Statements a formatter has wrapped across lines are read and rewritten in the shape they were found.

## Programmatic API

The parser, CSS transform, and token resolver are package exports:

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
