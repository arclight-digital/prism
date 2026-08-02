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

Enum values come from a documented `@prop {'primary' | 'secondary'} variant` union when there is one, and are otherwise auto-detected from `:host([variant="value"])` patterns in the CSS plus the prop's own default. A documented `@prop` type that isn't a union is used verbatim, so a `series` prop can be `Array<{label: string, data: number[]}>` rather than `unknown[]`. Props, defaults, types, events, and interactivity level are all extracted automatically.

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

# Write findings as JSON for a wrapper script to consume
npx prism --report-json .prism-report.json
```

All flags also have short forms: `-w` for `--watch`, `-c` for `--config`.

### `--strict`

Prism reports what it couldn't act on, but a caller that pipes stdout and only surfaces it when a step fails can't observe any of it. `--strict` turns those reports into an exit code, which is the one signal such a caller does read:

```
1 prop names a framework reserves — silently dropped at runtime:
  arc-column prop "key" is reserved by react, preact — it is intercepted
  before the component sees it, so the prop silently does nothing there.
  It still works in vue, svelte, angular, solid, so prefer adding an alias
  prop the component falls back to over renaming. Prism cannot work around
  this in the wrapper.

prism: --strict — 1 issue(s) reported above.
```

It fails on: a declared prop prism could not read, a generated wrapper missing an outlet the component declares, a prop name the target framework reserves, doc drift (a documented union the CSS or the component's own default contradicts), a `config.interactivity` or `config.acknowledge` entry matching nothing, and any tag, event or detail key prism had to drop.

Codes it reports but does *not* fail on: `slot-name-collides-with-prop`, `children-without-default-slot`, `unknown-acknowledge-code`, `doc-prop-undeclared`. The first three are information rather than a defect, and an unrecognised acknowledge code in particular must never block a rollback. `doc-prop-undeclared` is a real defect and is report-only for a different reason — see [`config.propsFrom`](#configpropsfrom--declarations-prism-cant-read).

Skipped `interactive` components and the misclassification list are deliberately *not* strict failures. Both are routine on every run, and a check that can never pass gets removed. `--strict` is a no-op in watch mode.

### Wrapper verification

After writing each wrapper, prism reads it back and checks it still carries what the component declares: a component with a default slot must have an outlet for it, and Svelte and Vue must have one per named slot. React, Preact, Solid and Angular need no per-named-slot outlet — children go into the light DOM as-is and the browser does the slotting.

This exists because 2.7.0 shipped wrappers with the default slot deleted. Every check prism had asked whether the *inputs* looked right; the inputs were fine and the output was not. A generated file that stops carrying a component's own slots is a generator bug, so the check belongs in the generator rather than in whatever repo happens to consume it. It reports `wrapper-missing-slot`, and it fails `--strict`.

### `config.acknowledge` — findings you've already decided about

Some findings are correct and stay correct. `arc-column` really does declare `key`, React really does eat it, and the recommended fix is an alias that leaves `key` working for every consumer it works for today — which means the finding remains true forever. Without a way to record that decision, `--strict` could never pass, and by its own rationale a check that can never pass gets deleted.

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

Every field you state must match; fields you omit are wildcards, so `{ code }` alone waives a whole class. Malformed entries throw at config load, on the same terms as `interactivity` and `bindings`.

Two deliberate properties:

- **Waived findings still print**, under a `prism: accepted:` heading with your note. An allowlist that makes output disappear is how a real regression ends up sheltering behind an old decision.
- **An entry matching nothing is itself a strict failure.** Otherwise the list rots — entries outlive the findings they describe and quietly pre-waive whatever next appears under the same key. That one code, `unmatched-acknowledge`, cannot itself be acknowledged.

### `config.propsFrom` — declarations prism can't read

Prism reads two shapes of property declaration: an object literal in `static properties`, and an `@property()` decorator. A declaration that is *built* is a third shape it cannot follow:

```js
static properties = {
  selected:    int({ default: 0, min: 0, max: '_maxIndex', clamp: 'toRange' }),
  orientation: oneOf(['horizontal', 'vertical']),
  showDots:    flag(true, { attribute: 'show-dots', negative: 'no-dots' }),
};
```

Prism could learn to match `helper(...)` and map helper names to types, but that puts your vocabulary's semantics inside prism, where it will drift from the version in your repo. So the hook asks you instead:

```js
// prism.config.js
export default {
  propsFrom(source, filePath) {
    // Return an array of props, or undefined to fall through to prism's
    // own reader — so a hook only has to handle the files it knows about.
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

Only `name` is required; the rest is filled in. `default` is emitted verbatim into generated code, so it is source text — a plain value is converted rather than dropped. Constructor defaults, documented `@prop` unions and documented types still apply on top of whatever the hook returns, so a hook only answers the part it knows about.

The hook is held to its contract rather than trusted: an unknown `type`, an entry with no usable `name`, a non-array return, or a hook that throws is reported as `invalid-props-from` and prism falls back to its own reader. That code is a strict failure and cannot be acknowledged — it describes a bug in the config doing the acknowledging, not a finding about a component.

**Without a hook, an unreadable declaration is still reported.** It was once dropped in silence, which meant a component could lose every prop from all six wrappers and still exit 0 — fewer props is valid TypeScript, so nothing downstream noticed. Two findings now cover it, from opposite directions:

| Code | Means | `--strict` |
|------|-------|-----------|
| `unparsed-prop-declaration` | The reader saw `name:` but the value wasn't an object literal. Names the prop and the declaration. | **fails** (acknowledgeable) |
| `doc-prop-undeclared` | A `@prop` JSDoc tag with no reactive property behind it — the same disagreement seen from the documentation side. | reports only |

The split is deliberate. `unparsed-prop-declaration` is precise by construction — it fires only where prism genuinely could not read a declaration — and the build it turns red belonged to someone already losing props in silence, so red is strictly better.

`doc-prop-undeclared` is equally true but finds a population you did not create and cannot clear on your own. **Prism reads a component's own source, so a prop contributed by a mixin is invisible to it.** A component whose `readonly` comes from a shared `FormControlMixin` documents the prop, doesn't declare it locally, and prism reports it — correctly, because the prop really is absent from the generated wrappers. In the reference consumer that is 18 findings, 16 from one mixin, with `readonly` missing from 14 React wrappers that document it. Failing a build on that is failing it for a backlog only prism can fix.

So it reports for now. The fix is to resolve properties at runtime from `Ctor.elementProperties`, which makes mixin-contributed props visible — at which point the diagnostic quiets down because the underlying bug is gone, not because the rule got weaker, and the missing wrapper props come back at the same time. It becomes a strict failure once that lands, at the next major version.

If you want it failing today, `--report-json` gives you the codes as data to gate on yourself.

### `--report-json` — findings as data

Every heading in the human report carries the literal prefix `prism: warning:` (or `prism: accepted:`), so it can be grepped. But the wording after that prefix is prose and does change between releases — 2.5.0's regrouping silently broke a downstream filter keyed on the word "warning". If something automated consumes prism's findings, use `--report-json <path>` instead:

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

`code` is the stable contract; `message` is for humans and will be reworded. A failure to write the report never fails the generate run.

### camelCase props

A prop whose name changes under lowercasing can't travel as an attribute: `confirmLabel` becomes `confirmlabel` in the DOM, which is not what Lit observes, so the element silently keeps its constructor default. Prism sets these as **properties** instead — an `$effect` against a ref in Svelte, `[confirmLabel]` property binding in Angular, `prop:confirmLabel` in Solid. React, Vue and Preact already resolve the property by its original name.

Kebab-case would be the wrong fix. Lit's Boolean converter is presence-based, so `auto-resize="false"` sets `autoResize` to **true** — worse than the no-op it replaces. Nothing prism generates relies on attribute naming for these props.

One consequence in Svelte: `$effect` doesn't run during SSR, so a camelCase prop is applied on hydration rather than appearing in the server HTML.

### Keeping a component out of the barrels

A bundler resolves the dynamic imports of every module in its graph, and a barrel
puts every component in that graph. So one component's optional dependency becomes
every consumer's required install — even for consumers who never touch it.

`config.barrelExclude` names the components that stay out:

```js
barrelExclude: ['arc-code-block'],   // pulls in shiki
```

They are still generated, still verified, still get their own subpath — they are
simply not re-exported from any barrel, in any framework, so nothing reaches them
unless a consumer asks for them by name. Existing barrel entries are removed on
the next full run: the file is still on disk, so nothing else here would drop it,
and the append path never removes anything.

The names to remove come from the metas rather than from the tag, so this cannot
be wrong about how a name is spelled — the same reason `pruneBarrels` asks the
filesystem instead of guessing. A component prism didn't see this run is left
alone.

### Named slots

A component with `<slot name="start">` gets a snippet prop per slot in the Svelte wrapper, and a forwarded `<slot name="start" />` in the Vue one. React, Preact, Solid and Angular need nothing — none of them treats `slot` as more than an attribute, so it reaches the element on its own.

**The `slot` attribute goes on your own element.** The wrapper adds no carrier element around your content, deliberately: a wrapper node between the shadow slot and your markup would break `::slotted()` rules and any layout the slot applies to its children. Which means the attribute has to come from you:

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

Inside a snippet or a `<template #…>` body, `slot="start"` is ordinary markup and reaches the element intact. The older Svelte form — `<button slot="start">` as a direct child of the component — depends on Svelte preserving the attribute when it converts that child into a snippet prop; the explicit form above doesn't.

**Components that take no children: `@slot none`.** A wrapper accepts `children` unless prism has positive evidence it shouldn't — either it saw named slots and no default one, or you said so. Finding no `<slot>` in the file is not evidence: a default slot rendered by a base class, a mixin, or a helper method looks identical from here, and acting on that in 2.7.0 deleted content from 111 wrappers. So for a component that genuinely has nowhere to put children — a spinner, an icon, a progress bar — say it in the class JSDoc:

```js
/**
 * @tag arc-spinner
 * @slot none
 */
```

Every wrapper then omits `children`, turning content that used to vanish at runtime into a type error at the call site. `none` is reserved for this and is never recorded as a slot name. If the component does render a default `<slot>`, the markup wins and prism reports the contradiction (`slot-none-contradicted`) rather than deleting anything.

Slot names that aren't valid identifiers can't be snippet props, so `slot="icon-left"` is exposed as `iconLeft`. Svelte takes the prop name from the attribute verbatim, so `{#snippet iconLeft()}` reaches it and `slot="icon-left"` on a direct child doesn't. Prism reports each remapped name (`slot-name-remapped`) rather than leaving you to discover it; rename the slot on the component if both forms need to work.

### What the generated Props accept

The Svelte, Preact and Solid interfaces list the component's own props, then an escape hatch for everything a consumer might pass through to the element: the common global HTML attributes by name (`class`, `id`, `style`, `role`, `part`, `tabindex`, `hidden`, …), plus pattern index signatures for `data-*`, `aria-*` and `on*`. The `on*` pattern is what lets a Svelte consumer attach `onarc-input` through the spread.

This is deliberately narrower than a blanket `[key: string]: unknown`, which accepts every typo — `<Slider valu={3} />` type-checked clean under the old signature. If you pass a global attribute prism doesn't list, open an issue; the list is meant to be generous.

### Prop names your framework reserves

Some prop names are legal everywhere but never reach the component. React and Preact take `key` and `ref` in the reconciler, so `<Column key="name" />` sets the list key and the prop is silently dropped — no error, no warning, and `key=` is exactly what you write by reflex on something that renders in a list. Prism can't fix this in the wrapper: the value is taken before the component function is called, so no generated code can recover it. All it can do is report the collision. Checked per framework, and only for frameworks you actually generate.

**Prefer an alias to a rename.** The prop still works in plain HTML and in every framework not named in the warning, so renaming it breaks those consumers to fix the ones that were already broken. Adding a second name the component falls back to breaks nobody:

```js
// arc-column gains `field`; `key` keeps working everywhere it already did
const name = col.field ?? col.key;
```

React and Preact users pass `field`; everyone else can carry on. Deprecate the original later, or never.

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
| `acknowledge` | `Array<{ code, tag?, prop?, note? }>` | `[]` | Findings you've decided about, so `--strict` can pass — see [`config.acknowledge`](#configacknowledge--findings-youve-already-decided-about) |
| `propsFrom` | `(source, filePath) => Props[] \| undefined` | — | Resolve property declarations prism's own reader can't — see [`config.propsFrom`](#configpropsfrom--declarations-prism-cant-read) |

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
2. **Properties** from `static properties = { ... }`, `static get properties() { ... }`, or `@property()` decorators — extracts name, type, and reflect. Internal `{ state: true }` / `@state()` members are excluded from the public surface. The block is walked brace-balanced, so a nested option (`converter: { … }`) can't truncate the config or be mistaken for another property. A declaration that isn't an object literal is reported as `unparsed-prop-declaration` rather than skipped — see [`config.propsFrom`](#configpropsfrom--declarations-prism-cant-read).
3. **Defaults** from `constructor() { this.variant = 'primary'; }` — assignments after nested blocks (`if`/`for`/`try`) are handled.
4. **CSS** from `` css`...` `` template literals
5. **Enum values** from a `@prop {'a' | 'b'} name` JSDoc union, falling back to `:host([prop="value"])` patterns in the CSS *plus the prop's own default*. The documented union wins because CSS can only see what CSS styles: the default member usually has no attribute selector to be inferred from (it's the unqualified base style), and a variant driven from JS leaves no selector at all. On the fallback path the constructor default supplies the missing member — it is by construction a legal value. Where both sources exist, a styled value or a default the union omits is reported as doc drift.
6. **Prop types** from a non-union `@prop {…} name` JSDoc tag, emitted verbatim — `@prop {Array<{label: string, data: number[]}>} series` types the wrapper properly instead of degrading to `unknown[]`, which is all `static properties = { series: { type: Array } }` can say. The type must be self-contained: prism cannot add imports to a generated wrapper, so a documented type naming your own exported type is reported rather than silently emitted.
7. **Template** from `render() { return html`...`; }` — supports variable inlining when templates are built from multiple `html`` ` blocks
8. **Events** from `dispatchEvent(new CustomEvent('name'))` calls — including the top-level keys of each event's `detail` object, which is what [two-way bindings](#two-way-bindings) are derived from
9. **Host display** from `:host { display: ... }` — determines whether HTML output uses `<div>` or `<span>` wrapper
10. **Interactivity level** — see below

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
