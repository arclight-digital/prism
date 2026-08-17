# @arclux/prism

[![CI](https://github.com/Arclight-Digital/prism/actions/workflows/ci.yml/badge.svg)](https://github.com/Arclight-Digital/prism/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@arclux/prism)](https://www.npmjs.com/package/@arclux/prism)
[![license](https://img.shields.io/npm/l/@arclux/prism)](LICENSE)
[![node](https://img.shields.io/node/v/@arclux/prism)](package.json)

Auto-generate framework wrappers and HTML/CSS examples from [Lit](https://lit.dev/) web components.

Write your component once as a Lit custom element. Prism reads the source and generates idiomatic wrappers for **React**, **Vue**, **Svelte**, **Angular**, **Solid**, and **Preact** — plus standalone **HTML/CSS** snippets with optional design-token resolution. No AST libraries, no build step, just regex-based parsing that ships as plain ESM. (One thing source cannot show is a property a mixin contributes, so [`config.runtime`](#configruntime--resolve-properties-from-the-class) will read the class itself when you ask it to.)

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
| **Angular** | Standalone component attached to the element itself, with `@Input()` accessor pairs, and a `ControlValueAccessor` for form-associated elements |
| **Solid** | `.tsx` component using `splitProps()` for reactivity-safe forwarding |
| **Preact** | `.tsx` component with native custom element support |
| **HTML** | Static snippet wrapped in a `<span>` or `<div>` (based on host display), slots replaced with placeholder text |
| **Inline HTML** | Same snippet with all `var()` tokens resolved to literal values and styles inlined |
| **CSS** | Shadow DOM CSS transformed to light DOM (`:host` &rarr; `.arc-button`, scoped inner selectors) |
| **CSS bundle** | All components combined into a single `arc-ui.css` with design tokens |
| **JSX typings** | `react-jsx.d.ts` / `preact-jsx.d.ts` / `solid-jsx.d.ts` for consumers who render `<arc-button>` directly, with no wrapper |
| **Export maps** | Each wrapper package's `exports` field, a subpath per component, written from the tree prism generated |

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

It fails on: a declared prop prism could not read, a generated wrapper that never registers its element, a generated wrapper missing an outlet the component declares or (for a form control) its `ControlValueAccessor`, a form-associated element prism could not wire a form to, a prop name the target framework reserves, doc drift (a documented union the CSS or the component's own default contradicts), an exports-map subpath pointing at a file that isn't there, a configured JSX declaration file something else already owns, a run that would overwrite output from a newer prism, a `config.interactivity` or `config.acknowledge` entry matching nothing, and any tag, event or detail key prism had to drop.

Codes it reports but does *not* fail on: `slot-name-collides-with-prop`, `children-without-default-slot`, `unknown-acknowledge-code`. These are information rather than a defect, and an unrecognised acknowledge code in particular must never block a rollback.

One code is strict only sometimes. `doc-prop-undeclared` fails when it was checked against the component's class and reports when it was read from source, because those are two different claims — see [`config.propsFrom`](#configpropsfrom--declarations-prism-cant-read).

Skipped `interactive` components and the misclassification list are deliberately *not* strict failures. Both are routine on every run, and a check that can never pass gets removed. `--strict` is a no-op in watch mode.

### Wrapper verification

After writing each wrapper, prism reads it back and checks three things.

**It registers its element** (`wrapper-missing-register`). Five frameworks do this with a bare `import '@arclux/arc-ui/card'`; React's value import survives because `createComponent` names the class in `elementClass`. This exists because 2.12.0's Angular wrappers named the element class in type position only — TypeScript elided the import and took `customElements.define` with it, so the built package contained *zero* imports of the element library and all 207 wrappers rendered an unupgraded `HTMLUnknownElement`. Nothing static objects to that: `tsc`, `ng-packagr --strictTemplates`, a production build and a consumer that renders a component all pass, and even prop assertions pass, because setting a property on a non-upgraded element writes an expando that reads back correctly.

**It carries an outlet for the component's content** (`wrapper-missing-slot`). What that requires depends on how the framework handles slots:

- **React, Preact, Solid, Angular** project children into the light DOM verbatim and let the browser assign them from the `slot` attribute. One outlet serves every slot, so it is required whenever the component declares *any* slot — named or default. Gating it on the default slot is what left the wrappers of 10 arc-ui components silently discarding every child.
- **Svelte and Vue** interpose their own slot handling, so they need an explicit outlet per named slot, and their children outlet carries only the default one.

**A form control registers its accessor** (`wrapper-missing-accessor`). Angular only — see [Angular reactive forms](#angular-reactive-forms). Same shape of check and the same reason: a missing `ControlValueAccessor` is invisible from every direction that isn't the file itself, because the binding compiles, reports nothing, and does nothing.

All three checks exist because 2.7.0 shipped wrappers with the default slot deleted. Every check prism had asked whether the *inputs* looked right; the inputs were fine and the output was not. A generated file that stops carrying a component's own slots — or stops registering its own element — is a generator bug, so the check belongs in the generator rather than in whatever repo happens to consume it. All three fail `--strict`.

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

Every field you state must match; fields you omit are wildcards, so `{ code }` alone waives a whole class. Malformed entries throw at config load, on the same terms as `interactivity` and `bindings` — including a field the finding never carries. `props-from-under-reports` names every under-reported prop in a file at once, as `props`, because the fault it describes is the hook's rather than any one prop's; so `{ code, tag, prop }` against it can never match, and saying so at config load beats the alternative, which is an entry that waives nothing plus an `unmatched-acknowledge` finding blaming the original for being gone while it is still live and still failing the build.

Two deliberate properties:

- **Waived findings still print**, under a `prism: accepted:` heading with your note. An allowlist that makes output disappear is how a real regression ends up sheltering behind an old decision.
- **An entry matching nothing is itself a strict failure.** Otherwise the list rots — entries outlive the findings they describe and quietly pre-waive whatever next appears under the same key. That one code, `unmatched-acknowledge`, cannot itself be acknowledged.

### `config.runtime` — resolve properties from the class

Everything else here reads source text. That is the right default: it needs no toolchain, executes nothing, and is why prism can be pointed at a repo it has never seen. It has one blind spot it cannot reason its way out of: **the properties a component has are the properties its class has, and a property contributed by a mixin or a base class is not in the file that declares the component.**

```js
class ArcInput extends FormControlMixin(LitElement) { … }
```

`readonly`, `required` and `name` are real reactive properties of that element, and no amount of reading `input.js` will find them. In the reference consumer that was 16 properties from one mixin, missing from all six framework wrappers of 25 form controls: settable on the element and in plain HTML, unreachable from React or Angular.

Inheritance is the sharper version of the same problem. `export class ArcModal extends ArcDialog {}` — an empty subclass with no `static properties` of its own — has every property `ArcDialog` declares and *none* that source reading can attribute to it. In the same consumer that was six props reaching no wrapper in any framework, for as long as the wrapper packages had existed: `<Modal open>` did nothing, everywhere, and the only symptom was six `doc-prop-undeclared` warnings that read as though the documentation were stale.

Lit already computes the answer. `Ctor.elementProperties` is the flattened map of every reactive property the class has, mixins and superclasses included, with the declared type, the reflect flag, the attribute name and the internal `state` marker. It cannot disagree with the component, because it *is* the component:

```js
runtime: true,
// or, if your components need a DOM at import time:
runtime: { setup: './scripts/dom-shim.js' },
```

**It is opt-in because reading the class means importing the module, and importing a module runs it.** Prism has never executed a line of a consumer's code, and a config file is the right place to say yes to that. Lit 3 carries its own DOM shim, so most projects need no `setup`; the option exists for components that reach for a browser global at module scope, and can point at `@lit-labs/ssr`'s global shim or your own.

It degrades rather than fails. A module that throws on import costs *that component* its runtime answer, is reported as `runtime-unavailable`, and falls back to the source reader — the rest of the catalog is unaffected.

Four things go away when it's on:

| | Why |
|---|---|
| Missing mixin props | The whole point — they are ordinary entries in `elementProperties` |
| `config.propsFrom` | A declaration built by a helper is a plain reactive property by the time the class exists |
| `config.formAssociated` | `formAssociated` is a static on the class, mixin-built or not |
| `unparsed-prop-declaration` | A declaration the reader couldn't parse is no longer a prop that goes missing |

A configured `propsFrom` still wins — it is explicit configuration, and a repo that has one has a reason — but prism now checks it against the class and reports what it left out, which is exact where the `@prop` cross-check was inferential. Defaults, documented `@prop` unions and CSS-inferred enums still come from the source and still apply on top: the class knows what a property *is*, the file knows what the author said about it, and neither substitutes for the other.

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

**A hook that under-reports is indistinguishable from a correct one** (`props-from-under-reports`). Everything above validates entries the hook *returns*, and there is by construction nothing to validate about an entry it never returned. Two real hook bugs shipped through that gap in one repo: an entry matcher that handled block comments but not line comments, and a scanner that split on a comma inside a comment. Both returned well-formed arrays prism accepted, and both silently removed a prop from six wrappers.

So the `@prop` tags are used as a cross-check. A hook that answers for a file and returns strictly fewer props than that file documents gets one finding for the file, naming the missing props — even when its output is otherwise valid. It is the same insight as `doc-prop-undeclared`, applied to hook output. Prefer throwing over returning a partial array; and if the tags are the stale half, acknowledge the code or delete them.

**The value of the split is which of the two you are being told.** Before the codes were separated, a hook silently dropping a real prop surfaced as `doc-prop-undeclared` — "documents `@prop readonly` but declares no reactive property by that name" — which reads as *the documentation is stale*, and is the exact opposite of the truth when the property is real and the hook is the thing that lost it. Findings that read as somebody else's problem get waived, which is what happened: in the reference consumer that message sat in an accepted pile for two releases while `readonly` was in fact missing from **all six framework wrappers of 25 form controls**, contributed by a mixin the hook never followed. `props-from-under-reports` says the hook under-reported; `doc-prop-undeclared` says the tag has nothing behind it. Only one of those sends you to the right file.

**Without a hook, an unreadable declaration is still reported.** It was once dropped in silence, which meant a component could lose every prop from all six wrappers and still exit 0 — fewer props is valid TypeScript, so nothing downstream noticed. Two findings now cover it, from opposite directions:

| Code | Means | `--strict` |
|------|-------|-----------|
| `unparsed-prop-declaration` | The reader saw `name:` but the value wasn't an object literal. Names the prop and the declaration. | **fails** (acknowledgeable) |
| `doc-prop-undeclared` | A `@prop` JSDoc tag with no reactive property behind it — the same disagreement seen from the documentation side. | reports only |

The split is deliberate. `unparsed-prop-declaration` is precise by construction — it fires only where prism genuinely could not read a declaration — and the build it turns red belonged to someone already losing props in silence, so red is strictly better.

`doc-prop-undeclared` is equally true but finds a population you did not create and cannot clear on your own. **Prism reads a component's own source, so a prop contributed by a mixin is invisible to it.** A component whose `readonly` comes from a shared `FormControlMixin` documents the prop, doesn't declare it locally, and prism reports it — correctly, because the prop really is absent from the generated wrappers. In the reference consumer that is 18 findings, 16 from one mixin, with `readonly` missing from 14 React wrappers that document it. Failing a build on that is failing it for a backlog only prism can fix.

**[`config.runtime`](#configruntime--resolve-properties-from-the-class) is the fix, and it changes what this finding means.** Reading the class makes mixin-contributed props visible, so the diagnostic quiets down because the underlying bug is gone rather than because the rule got weaker — and the missing wrapper props come back at the same time.

It also settles how strict the rule can be, which was never really a question about the rule. Read from a file, "no declaration here" is not the same claim as "no such property": a mixin makes the first routinely untrue. Read from the class — `elementProperties`, mixins and base classes included — the two claims are the same one, and a documented `@prop` that isn't there is a stale tag and a one-line fix in the file doing the complaining.

So **strictness follows the evidence**: the finding fails `--strict` when it was checked against the class, and reports when it was read from source. A project that hasn't opted in sees exactly what it saw before, and no build fails for a backlog only prism could clear. Either way it can be waived with `config.acknowledge`.

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

### Angular reactive forms

`formControlName`, `formControl` and `[(ngModel)]` reach a component through one interface — `ControlValueAccessor` — and a wrapper without one doesn't fail. `<arc-input formControlName="email">` compiles, binds nothing, reports nothing, and leaves the control pristine and empty while the element on screen holds the user's text. An Angular team reaching for a component library reaches for reactive forms in the same breath, so prism emits the accessor for the components a form can actually bind to.

**Which components.** The ones the platform itself calls form controls: `static formAssociated = true`, which is what makes the browser attach `ElementInternals` and include the element in a form's submission. No configuration, and no guessing — "everything that emits a change event" is the rule that sweeps in tabs, theme toggles and sortable lists, none of which is a form control.

If your library contributes `formAssociated` from a **mixin**, prism cannot see it from the source: the fact lives in a file it was never handed. [`config.runtime`](#configruntime--resolve-properties-from-the-class) answers it directly — `formAssociated` is a static on the class — and is the better fix. Without it, the same shape of answer as `propsFrom`:

```js
// prism.config.js
formAssociated(source) {
  // true, false, or undefined to fall through to prism's own reader
  return /FormControlMixin\(/.test(source) || undefined;
},
```

**What a form binds.** `checked` if the component declares it, otherwise `value` — read from the component rather than a table of tag names, so a 28th control is covered by writing it. The accessor commits on the component's change event, and reads the DOM property rather than the event's `detail`: the element has already updated itself by the time it dispatches, so no detail shape has to be agreed on. A control firing both `arc-input` and `arc-change` commits on the second — binding the first marks a form dirty on every keystroke.

**Controls whose value is a pair** — a date range is `start`/`end`, a range slider is `low`/`high` — have no single property for an accessor to carry. Name both and it carries an object, which is what a reactive form holds for a compound value anyway:

```js
formValue: {
  'arc-date-range-picker': ['start', 'end'],
  'arc-range-slider': ['low', 'high'],
},
```

Leaving them out would mean `formControlName` working on 25 of 27 controls, which is the kind of gap a consumer discovers rather than reads. (A `FormGroup` with a control per `@Input` is the better shape for validating the two ends separately, works today without any of this, and simply cannot be reached from `[(ngModel)]`.)

`config.formValue` also names the property outright for a control that declares neither `value` nor `checked`. Without an entry, that component is reported as `form-control-unbindable` and its wrapper is generated without an accessor — as is one whose element dispatches no event a form could commit on.

**`@angular/forms` becomes a peer dependency** of your Angular wrapper package. It is first-party and present in any Angular app using forms, but it is a real requirement added to every consumer, and `NG_VALUE_ACCESSOR` is a runtime value rather than a type — so an optional peer would not do. Range it against `@angular/core`.

Three details in the emitted shape are worth knowing, because each cost something to find:

- **The listener is attached in the constructor**, not through the `host` metadata. Prism already maps the change event there to the component's own `@Output`, and a host object cannot carry two handlers for one event. Field initializers run before the constructor body, so the host element reference is populated and `inject()` has already done its work in an injection context.
- **`writeValue` never calls back into the form.** It is the form writing *into* the element; echoing it back marks the control dirty on every programmatic `setValue`. Easy to add "for symmetry" and wrong.
- **The reset value follows the declared type** — `''`, `false`, `0`, `[]`, and a union's own default for a union, because `''` is not a member of `'sm' | 'md' | 'lg'` and the package would not compile. Angular calls `writeValue(null)` on reset routinely, so this is not an edge case.

### `config.jsxTypes` — typing the elements without a wrapper

The wrapper packages are one supported path. The other is a consumer who renders `<arc-input value="…">` directly, and until they have a declaration file every tag is `any` or an error. Prism knows both halves needed to write one — the per-component surface, from the same parse the wrappers come from, and the per-framework attribute conventions, from generating six wrappers against them:

```js
jsxTypes: {
  outDir: 'packages/web-components/types',
  frameworks: ['react', 'preact', 'solid'],   // default: all three
  // wcPackage: '@arclux/arc-ui',             // inherited from the wrapper sections
},
```

`wcPackage` is the package name written into the activation instructions below, and it is **inherited from your framework sections rather than guessed**. Prism's usual `@{prefix}/{prefix}-ui` fallback is wrong here in a way it isn't elsewhere: the header tells a consumer to add `node_modules/<pkg>/types/react-jsx.d.ts` to their tsconfig, and a guessed package name is a path that resolves to nothing, includes nothing, and reports nothing — precisely the silent no-op the rest of that same header warns about. So it comes from the sections that already name the package their imports use, and is required explicitly in the two cases where inheriting would be a guess: when those sections name different packages, and when none is configured.

If you already generate these files yourself, prism will **not** overwrite them — they carry no prism sentinel, so it leaves them alone and raises `jsx-types-not-written`. That is the safety rule doing its job, not a failure; delete yours once you've compared them, and prism owns the path from the next run.

It is a finding rather than a log line, and that is the one place this differs from the identical skip on a wrapper. Hand-writing a wrapper is a standing arrangement — a component whose slots are built at runtime has to be authored by hand, and prism stepping around it every run is the point. Configuring `jsxTypes` makes no such claim: it says prism should produce these files, so a foreign file at one of those paths is near-certainly a migration that hasn't finished. Left as one log line among several hundred, what it hides is the quiet kind of failure — a green pipeline shipping the pre-migration copy indefinitely, because nothing ever writes over it. If you did mean to keep your own file, `config.acknowledge` records that, and the finding keeps printing under `prism: accepted:`.

That writes `react-jsx.d.ts`, `preact-jsx.d.ts` and `solid-jsx.d.ts`, each augmenting the module its framework actually resolves `JSX.IntrinsicElements` through. A documented union stays a union, so a wrong enum value is a compile error — which is most of what the file is worth.

The base attribute set is per framework, and that is where the content is. Solid carries `on:`, `prop:`, `attr:`, `use:` and `classList`; `on:` is how a custom event like `arc-change` is reached from JSX with no ref, and none of the four exists in React or Preact. Preact's `on${string}` stays deliberately loose, because Preact lowercases the part after `on` and a dashed custom event name is not reachable from a plain prop at all — typing it narrowly would promise what the framework cannot do. React takes `className` and `tabIndex`; Solid takes neither.

Each element gets both spellings of any property whose names differ. Lit *lowercases* a property name to get its attribute — `confirmLabel` is `confirmlabel`, not `confirm-label` — and a consumer writing the camelCase form is setting the DOM property, which all three frameworks do for custom elements. Typing only one makes the other an error against an element that handles it fine. An `attribute: 'hint-text'` is honoured, and an `attribute: false` property is still typed.

**Applying the file is the part that goes wrong.** Three instructions look right and silently do nothing, so the generated header states them:

```jsonc
{ "compilerOptions": { "types": ["@arclux/arc-ui/react-jsx"] } }   // does nothing
/// <reference types="@arclux/arc-ui/react-jsx" />                  // does nothing
```

TypeScript resolves a `types` entry as a *package* — `node_modules/@types/<name>`, or `<name>/package.json#types` — and never follows an export-map subpath. Nothing resolves, nothing is included, every tag stays untyped, and no diagnostic is emitted, because a `types` entry resolving to nothing is not an error. A `files` entry pointing outside the consuming project is the third. Two forms that do work:

```jsonc
{ "include": ["src", "node_modules/@arclux/arc-ui/types/react-jsx.d.ts"] }
/// <reference path="./node_modules/@arclux/arc-ui/types/react-jsx.d.ts" />
```

### Wrapper package export maps

Prism decided the wrapper file tree — which components exist, which tier each lands in, what extension each framework's files carry — so it can write the `exports` map instead of a second program re-inferring it. Point a framework section at its package manifest:

```js
react: {
  outDir: 'packages/react/src',
  packageJson: 'packages/react/package.json',
  // exportsMode: 'dist',   // defaults per framework; 'src' for a package with no build
},
```

Every component gets its own subpath (`@arclux/arc-ui-react/Button`), so a consumer that can't tree-shake a 200-export barrel imports one component without paying for the rest. There is deliberately no `"./*"` wildcard: it publishes every internal file as unversioned API and is exempt from the existence check below. Prism sets `exports`, and `main`/`module`/`types` for the built modes; everything else in the manifest is left alone.

The default mode per framework matches what each toolchain consumes: `dist` for React and Preact, and for the other three a dist target plus the condition their own tooling resolves — `solid` pointing at the source `.tsx` so Solid's compiler owns the JSX rather than a prebuilt copy of it, `svelte` at the shipped component, and vue-tsc's `.vue.d.ts` naming. `exportsMode: 'src'` ships source for a package with no build step.

Targets pointing at *source* are checked for existence and reported as `exports-target-missing`; dist targets are not, because they name files the package build has yet to produce and that build fails loudly about anything missing. Two components in different tiers whose names want the same subpath are reported as `exports-subpath-collision` rather than one of them silently losing its entry.

**Angular is refused rather than written wrong.** `ng-packagr` produces the published manifest for an Angular library (Angular Package Format: FESM bundles, partial-Ivy declarations, one entry point) and copies anything in the source manifest verbatim into `dist`, so an `exports` map written here ships broken — and the failure lands on a consumer's build, several steps from the config that caused it. `config.angular.packageJson` throws at config load.

### Version stamping, and downgrades that revert

Every generated file opens with the version that wrote it:

```
// Auto-generated by @arclux/prism 3.0.0 — do not edit manually
```

This exists because running an older prism does not error — it *reverts*. Prism rewrites every wrapper it owns from whatever version is installed, so regenerating a 235-file catalog on an older release silently undid 205 Angular, 10 React, 10 Preact and 10 Solid files. The only signal was a large diff in generated files nobody reads, which CI reported as "generated files are out of date" — wording that reads as *stale committed output* and invites the exact wrong fix: commit the revert.

With the version in the first line, a downgrade announces itself in the diff. Prism also says so directly, from two places:

- **Before writing anything.** A full run and a watcher's first pass scan the output tree and read the stamp off every generated file. Finding one newer than the running version reports `generator-downgrade` — and under `--strict`, outside watch mode, prism *refuses to generate at all*. Nothing is written, the exit code is 1, and the message names both versions. This is the only version of the check that prevents rather than records.
- **While writing.** Single-file mode and a watcher's incremental rebuilds don't get the whole-tree scan — the first would report on files it will never touch, the second already scanned at startup — so the per-file check still reports a stamp it overwrites. A file already named by the scan isn't reported twice.

The second one is a witness rather than a guard: by the time a generator has read a file's stamp it has already decided to overwrite it, and the finding clears itself on the next run, because the files now carry the older stamp. That is what the pre-flight is for.

If you already have a pre-install check that pins a minimum prism version, the two compose rather than overlap — yours can fail before the generate step even starts, and can now key on the highest stamp in committed output rather than on a lockfile.

Barrels are deliberately *not* stamped. A wrapper is rewritten whole on every run, so its version describes all of its content; a barrel is appended to and pruned in place, and its contents accrue across every version that has ever touched the project.

The sentinel prism looks for treats the version as optional, so output written before 3.0.0 — and output written under prism's old org name — is still recognised as its own and still regenerated. A sentinel that insisted on a version would have classified the entire installed base as hand-edited and quietly stopped regenerating any of it.

### Named slots

A component with `<slot name="start">` gets a snippet prop per slot in the Svelte wrapper, and a forwarded `<slot name="start" />` in the Vue one. React, Preact, Solid and Angular need no *per-slot* outlet — none of them treats `slot` as more than an attribute, so it reaches the element on its own — but they do need their one children outlet, because that is what puts your markup in the light DOM for the element to slot. So a component whose slots are all named still takes `children` in those four wrappers, and Angular still gets a single bare `<ng-content />`.

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

**Components that take no children: `@slot none`.** A wrapper accepts `children` unless prism has positive evidence it shouldn't — either it saw named slots and no default one, or you said so. (In React, Preact, Solid and Angular, "named slots and no default" is not enough on its own: their children outlet is the only route that content has, so it stays. The tag is honoured for a component with no slots at all, which is what it is for.) Finding no `<slot>` in the file is not evidence: a default slot rendered by a base class, a mixin, or a helper method looks identical from here, and acting on that in 2.7.0 deleted content from 111 wrappers. So for a component that genuinely has nowhere to put children — a spinner, an icon, a progress bar — say it in the class JSDoc:

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

  // ── Typings for consumers who skip the wrappers ───
  jsxTypes: {
    outDir: 'packages/web-components/types',
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
| `runtime` | `boolean \| { setup?: string }` | `false` | Resolve properties from the component class by importing it, which is the only way mixin-contributed props are visible — see [`config.runtime`](#configruntime--resolve-properties-from-the-class) |
| `propsFrom` | `(source, filePath) => Props[] \| undefined` | — | Resolve property declarations prism's own reader can't. Unnecessary with `runtime` — see [`config.propsFrom`](#configpropsfrom--declarations-prism-cant-read) |
| `formAssociated` | `(source, filePath) => boolean \| undefined` | — | Answer whether an element is form-associated, where the fact comes from a mixin. Unnecessary with `runtime` — see [Angular reactive forms](#angular-reactive-forms) |
| `formValue` | `Record<string, string \| string[]>` | `{}` | The property a form binds on a given component, or the pair of them for a compound value |
| `barrelExclude` | `string[]` | `[]` | Components that stay out of every barrel — see [Keeping a component out of the barrels](#keeping-a-component-out-of-the-barrels) |
| `jsxTypes` | `{ outDir, frameworks? }` | — | Write the opt-in JSX declaration files — see [`config.jsxTypes`](#configjsxtypes--typing-the-elements-without-a-wrapper) |

### Framework options

Each framework section (`react`, `vue`, `svelte`, `angular`, `solid`, `preact`) accepts:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `outDir` | `string` | *required* | Output directory for generated wrappers |
| `wcPackage` | `string` | `'@{prefix}/{prefix}-ui'` | Package name used in `import` statements for the web component |
| `barrels` | `boolean` | `false` | Append exports to tier-level and root-level barrel (index) files |
| `packageJson` | `string` | — | Path to that package's manifest; writing it enables the [exports map](#wrapper-package-export-maps). Not supported for `angular` |
| `exportsMode` | `'dist'\|'dist-solid'\|'dist-svelte'\|'dist-vue'\|'src'` | per framework | What the package's build emits, and therefore what its subpaths point at |

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

Barrels are reconciled after that sweep, and unconditionally: an orphaned file is
untidy, but a barrel exporting a file that is gone breaks the build of whoever
imports it (`TS2307`). What to drop is decided by asking the filesystem whether
each specifier still resolves — never by naming convention — so a barrel prism
doesn't generate keeps working. One run is enough to delete a component and leave
every barrel consistent.

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
- **Append-only barrels** — per-component barrel updates only append. Existing exports are never reordered or rewritten, and the only pass that removes one is the reconciliation above, which drops an export whose specifier no longer resolves, a name its target barrel stopped exporting, or a name `barrelExclude` keeps out. A statement a formatter has wrapped across several lines is read and rewritten in the shape it was found.

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
