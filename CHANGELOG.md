# Changelog

## 2.5.0 — unreleased

### Fixed

- **The CSS enum fallback omitted the default too.** 2.4.0 fixed this for documented unions but left the same defect live on the fallback path, because it is the same CSS scan: the default member is the unqualified base style and so has no `:host([x="…"])` rule to be inferred from. `tag`, `checkbox`, `select` and `toggle` all default `size` to `md` and were typed `'sm' | 'lg'`, along with `radio-group.size`, `container.padding`, `diff.mode`, `footer.align`, `link.underline` and `sidebar.position` — 10 props whose default value did not type-check against their own component.

  Prism already had what it needed: `applyDefaults` reads the default from the constructor. When the CSS scan finds values and the default is a non-empty string literal that isn't among them, it is unioned in. A prop's own default is by construction a legal value, so this cannot be wrong, and it's appended rather than prepended so a prop whose default the CSS already styles is unchanged. Computed and empty-string defaults are ignored, and a default alone never invents a union — one legal value is not an enum.

  The same comparison now runs against documented unions: a union that omits the component's own default is reported as drift.

- **Props whose name a framework reserves are now reported.** `arc-column` declares `key`. That is not a JavaScript keyword, so 2.4.0's fix doesn't apply — but React and Preact intercept `key` in the reconciler, so `<Column key="name" label="Name" />` sets the list key and the component never receives the prop. No syntax error, no type error, no warning: the column just renders nothing. And `key=` is exactly what a developer writes by reflex on a component that renders in a list, which makes the collision close to certain rather than hypothetical.

  Prism cannot fix this in the wrapper — the value is taken before the component function is called — so the only remedy is renaming the prop at source, and prism now says so. Checked per framework and only for frameworks actually being generated: `key`, `ref`, `children`, `className` and `dangerouslySetInnerHTML` for React, the same minus `className` for Preact, and `children` for Svelte and Solid, whose generators inject their own. Vue and Angular reserve nothing. It's a `--strict` failure.

### Added

- **Documented `@prop` types are honoured beyond string-literal unions.** Lit's `static properties` can only say `Array`, which every generator rendered as `unknown[]` — and the props carrying real shape (chart series, calendar events, table rows) are exactly the ones a consumer most needs typed. A documented `@prop {Array<{label: string, data: number[]}>} series` is now emitted verbatim in all six wrappers.

  The JSDoc type is read with brace matching rather than a regex, because `{Array<{label: string}>}` ends at its *matching* brace and `[^}]+` would truncate it to `Array<{label: string` — emitting a type that doesn't parse. Types the existing map already covers exactly (`string`, `number`, `Array`, …) are left alone, so `@prop {string} label` still behaves as it did and doesn't suppress CSS enum inference. Anything prism can't emit safely is refused with a diagnostic rather than pasted in.

  One limit worth knowing: prism has no way to add imports to a generated wrapper, so a documented type must be self-contained. `@prop {ChartSeries[]} series` is emitted as written and then fails to compile — prism now warns at generate time instead of leaving you to find it in `tsc`.

- **`--strict` — turn the report into an exit code.** Prism's reporting was architecturally invisible to its main consumer: arc-ui's `generate.js` pipes prism's stdout and discards it unless a step fails, so nothing prism printed on a successful run ever reached anyone. That covers the whole of 2.2.0's reporting feature — the component-skip summary and the misclassification list — plus unmatched-override and invalid-name warnings, and the doc-drift warning added in 2.4.0. All of it went to `/dev/null`.

  `--strict` exits 1 when prism reported something it couldn't act on: doc drift, a `config.interactivity` entry matching no component, or a tag/event/detail key it had to drop. That is the only channel a caller which discards stdout on success can observe, and it needs no change to the calling script. Without the flag, behaviour is unchanged apart from a closing line pointing at it.

  Skipped `interactive` components and the misclassification list are deliberately not strict failures — both are routine on every run, and a check that can never pass gets deleted. `--strict` is a no-op in watch mode, where exiting on a warning would kill the watcher and an exit code nothing reads isn't a signal.

### Changed

- **Generated Props no longer accept every misspelling.** The Svelte, Preact and Solid interfaces carried a blanket `[key: string]: unknown`, which is what makes `{...rest}` type-check but also accepts anything at all — `<Slider valu={3} />` passed clean, which defeats most of what those types are for. Replaced with pattern index signatures for `data-*`, `aria-*` and `on*`, plus an explicit list of global HTML attributes (`class`, `id`, `style`, `role`, `part`, `tabindex`, `hidden`, …). The spread keeps working, and an unrecognised name is now an error.

  The `on*` signature is not optional: Svelte consumers reach custom events through `onarc-input` on the spread, so narrowing without it would have broken 2.3.0's binding escape hatch. Global attributes a component declares as its own prop are omitted from the generic list rather than repeated, since a duplicate interface key is a hard TS error.

  Solid is included alongside the two reported — its interface carried the identical line. React is unaffected: it never had an index signature.

- **The six generators share one `tsType`.** It existed as six byte-identical copies, so a change to how props are typed had to be made six times to take effect once. Now `src/generators/types.js`, which is also what makes the documented-type support above a single edit rather than six.

- **Parser warnings are collected rather than printed.** `parseComponent` takes an optional fifth argument, a diagnostics array. When one is passed the parser stays silent and pushes structured `{ code, message, file, tag, … }` entries instead, so the CLI can group them into one labelled end-of-run block — capped at 10 per kind, with the full count always stated — rather than interleaving them through hundreds of per-component lines. Called without a collector the parser prints exactly as before, so a library consumer sees no change.

  This moves 2.4.0's doc-drift warning off `console.warn`, which was the wrong channel for it given how prism is actually run.

## 2.4.0 — 2026-07-29

### Fixed — reserved words in binding position

A prop named after a reserved word is a perfectly good attribute but not a legal identifier, and prism had no handling for the difference anywhere. Both of 2.3.0's known issues were instances of it: `arc-label` declares `for`, so `Label.svelte` emitted `let { for = '', … } = $props()` and `Label.tsx` emitted `({ for, … }) =>`; `arc-text` declares `as`, so `Text.ts`'s Angular template read `[attr.as]="as"`. None of the three compiled. The attribute name is public API and is unchanged in every case; only the binding moves.

- **Svelte and Preact** rename the local on the way in — `for: forProp` — and spell the attribute out (`for={forProp}`) instead of using the `{for}` / `for={for}` shorthand. The interface key, the attribute, and the element's own property all keep the real name, as does the event `detail` key a two-way binding reads from. The rename is checked against the component's own prop set, so a component declaring both `for` and `forProp` gets `forProp_` rather than a collision.
- **Vue** takes the props object instead: `defineProps` was previously called for its side effect, and is now assigned to `const props`, with the template reading `:for="props.for"`.
- **Angular** qualifies every template expression with `this.` — `[attr.as]="this.as"`, `(arc-input)="this.arcInput.emit($event)"`. Angular's template grammar has its own keyword list (`as`, `in`, `let`, `var`, `this`, …) that doesn't match JavaScript's, which is why `for` parsed there and `as` didn't. The class field was never the problem: reserved words are legal property names, so `@Input() as` was always fine.
- React, Solid and Preact's interface keys were never affected — all three reach props through property access or an object key, both of which accept any name.

For Vue and Angular the fix is property access rather than a rename, which is legal for every name and so retires the whole class of problem instead of special-casing the words that collide today. Angular's wrapper diff is the broad one: every prop and event binding in every generated template gains the `this.` prefix.

### Changed — enum unions come from the docs first

`prop.values` was populated solely by scanning CSS for `:host([prop="value"])` rules, which is structurally unable to see two things. The **default member** normally has no attribute selector to be inferred from — it's the unqualified base style — so a three-member union came back with two, and every wrapper's type was missing the one value most consumers pass. And a variant handled **in JS** leaves no selector at all, so the union came back empty and the prop collapsed to a bare `string`.

A documented `@prop {'small' | 'medium' | 'large'} size` union on the class JSDoc is now read first, and the CSS scan is the fallback for props that don't have one. Only string-literal unions are read — `{string}`, `{number}` and other types are left to the existing type map. All six generators already consume `prop.values`, so this corrects React, Vue, Svelte, Angular, Solid and Preact at once. Expect a large but mechanical wrapper diff: in arc-ui, 35 props regain their missing default member and 33 regain a union that had collapsed to `string`.

Where both sources exist they're compared: a value the CSS styles but the documented union omits is genuine doc drift, and prism is the only thing positioned to see both, so it now warns. The documented union still wins — the warning is advisory.

## 2.3.0 — 2026-07-29

### Added

- **Two-way bindings in the Svelte, Vue and Angular wrappers.** All three were write-only: props were passed down and nothing wrote the element's own changes back, so an unrelated re-render re-set the stale value onto the element and silently reverted what the user had just typed. Each framework's two-way form is now generated — `bind:value` in Svelte, `v-model:value` in Vue, `[(value)]` in Angular. Solid and Preact are unchanged because neither language has a two-way binding form; React was never affected, since `@lit/react`'s `createComponent` wires properties and events itself.

  Bindings are derived by convention rather than a hardcoded table: an event whose `detail` carries a key matching a declared prop name is that prop's write-back path. Where two events carry the same key — a slider firing both `arc-input` and `arc-change` — both are listened to, so a binding tracks the live drag as well as the commit. In arc-ui, 41 of 186 components gain bindings.

  - **Svelte** was the worst of the three: it forwarded *no* events at all, so consumers had no manual escape hatch either, and `bind:` on a non-`$bindable` prop is a hard error. Bound props are now `$bindable()` with a handler per event. Handlers are emitted *after* `{...rest}` so they win the spread, then forward explicitly to any handler the consumer passed, so `onarc-input` still fires.
  - **Vue** relayed events but never declared the `update:x` emit that `v-model:x` listens for, so `v-model` bound cleanly and silently did nothing.
  - **Angular** relayed events but never declared the `xChange` output that `[(x)]` desugars to, so the banana-in-a-box form failed to compile. The handler updates the local `@Input()` as well as emitting, so a one-way `[value]` consumer isn't left with the stale bound value on the next change detection.

  All three remain backwards compatible: a parent passing a plain value keeps working, and the existing event relays still fire.

- **`config.bindings` — per-tag binding opt-outs.** The naming convention has exceptions, and they fail quietly, so they live in config alongside `interactivity` rather than in a JSDoc tag codegen can rewrite. `{ 'arc-select': { exclude: ['label'] } }` keeps a prop out of the derived set for every framework at once. Two kinds are worth excluding: **collisions**, where the detail key means something other than the prop it shares a name with — `arc-select` dispatches `detail: { value, label }` where `label` is the *selected option's* text, so binding it would overwrite the field's own label on every change — and **echoes**, where the element dispatches its own unchanged prop as context (`arc-copy-button` reporting the string it just copied) rather than reporting a change. Malformed entries throw at config load: an unknown field, an invalid tag, or an `exclude` that isn't an array of strings.

- **`ComponentMeta.eventDetails`** — event name → the top-level keys of its `detail` object, unioned across every dispatch of that event, since a component may fire the same event from several code paths with different payloads. `events` is unchanged. Extraction is bounded to each `CustomEvent`'s own options object, so an event dispatched without a payload can't inherit the keys of whichever event happens to follow it in the source, and only top-level keys are read — `detail: { href, item: { label } }` yields `href` and `item`, never the nested `label`. Detail keys must be plain identifiers (no `$`, which is a rune sigil in Svelte); anything else is dropped with a warning, on the same reasoning as the existing event-name guard.

### Known issues

Both predate this release and are unrelated to bindings; each is one component, and both are reserved-word collisions between a prop name and the target language.

- `Label.svelte` does not compile: `for` is a declared prop of `arc-label`, and `let { for = '', … } = $props()` is a syntax error on the reserved word.
- `Text.ts`'s Angular template does not parse: `as` is a declared prop of `arc-text`, and `[attr.as]="as"` is a reserved token in Angular template expressions.

## 2.2.1 — 2026-07-29

### Fixed — HTML examples

- **Elements built into a local before interpolation are no longer dropped.** A component that assembles part of its markup into a variable and interpolates it (`const field = this.multiline ? html`<textarea>` : html`<input>`; … ${field}`) lost that element entirely: the extractor only recognised `= html\`` directly after `=`, so the reference never resolved and the interpolation-dropping pass deleted it. `arc-input` generated a styled box containing no input at all. Initializers are now read in full, and a conditional one picks its branch from the condition's default — including conditions held in a local (`const hasText = !!this.text`). An undecidable condition is deliberately left unresolved rather than guessed, so an element that doesn't render by default is never invented.
- **`style` attributes no longer emit malformed declarations.** An unresolved interpolation left broken CSS behind — `style="--fill-percent: %"`, `style="transform:scaleX()"`, `style="position:absolute;top:px;height:Item Heightpx;"`. `style` now takes real values only (never a human-readable placeholder, which is equally invalid: `width: Width`), and the whole attribute is dropped when nothing real resolves. Values that *can* resolve now do: `style="background-color:Color"` became `style="background-color:#4d7ef7"`. Token-list and free-text attributes (`class`, `aria-label`) are unaffected.
- **A prop's own default outranks the generic attribute fallback.** `type=${this.type}` on a text field became `type="button"`, silently turning the example's input into a button. The referenced prop's default is now preferred, with the generic table used only when there isn't one — and an empty default falls through rather than emitting `href=""` (worse than `#`) or `name=""` (dropped outright).
- **Multi-line blocks are re-indented to the interpolation's column.** Dedenting aligned the opening tag but left continuation lines at the variable declaration's original depth. `dedentTemplate` also no longer counts a first line that opens inline with its backtick, which pinned the common indent at 0 and dedented nothing.

## 2.2.0 — 2026-07-28

### Added

- **Every run reports what it didn't produce.** Skipping an `interactive` component is a one-line note buried among hundreds, and the aggregate was never stated anywhere. Runs now end with `85 of 186 components produce HTML/CSS; 101 are interactive (237 KB of component CSS reaches no output)`. That silence is how `arc-button` shipped with zero styles for two releases — it gained a `@click` form-submit bridge, auto-detection flipped it to `interactive`, and a stale `button.css` from before the reclassification masked the gap until it was pruned.
- **Likely-misclassified components are flagged.** Auto-detection is binary, so one incidental handler drops a component's entire stylesheet from the package — correct for a modal, wrong for a button whose only handler bridges form submission. Skipped components that look presentational are now listed with the signal that tripped them and a pointer to `config.interactivity`. Deliberately narrow, since a false positive tells someone to ship a component that doesn't work without JS: only auto-detected classifications are questioned (config and `@arc-prism` levels are decisions, never re-litigated), and imperative shadow DOM, `:host { display: none }`, more than two handlers, or under 800 bytes of CSS all disqualify. Verified against arc-ui: with the overrides removed, `arc-button` is flagged — this would have caught the bug.
- **`ComponentMeta.classification`** exposes how a level was reached: `{ level, origin: 'config' | 'jsdoc' | 'auto', signals }`, where `signals` carries handler names and count, dispatched-event count, imperative-DOM use, and `display: none` host. `interactivity` is unchanged and still mirrors `classification.level`.

## 2.1.0 — 2026-07-28

### Added

- **`config.interactivity` — durable classification overrides.** A new config map pins a component's interactivity level by tag: `{ 'arc-tab': 'interactive', 'arc-tooltip': 'hybrid' }`. It takes precedence over the `@arc-prism` JSDoc tag, which still works. The tag lives in a doc comment, so any pass that rewrites doc comments can silently drop it and take the classification with it — that has happened twice, most recently losing four child-component tags in the arc-ui DX release. Config is data codegen never touches. It also fails loudly where the tag fails silently: an unknown level or malformed tag key throws at config load, and a key matching no component warns on every run, so a renamed or deleted component can't quietly lose its override.
- **Stale-output detection and `--prune`.** Prism now reports generated files it can no longer produce, and deletes them with `--prune`. Two cases: a component reclassified to `interactive` stops producing HTML/CSS, and a deleted component stops producing everything — including wrappers in all six framework targets, which nothing ever revisited. Reporting is the default because these files are by definition unreproducible; deletion is opt-in. Only files carrying prism's generated header are removed, so hand-written files at a generated path are never touched, and barrels and the CSS bundle are never candidates. (Cleared 141 stale files in arc-ui, ~50 KB shipping in the package.)

### Fixed

- **`::slotted()` no longer corrupts class names ending in `slot`.** The `slot::slotted(SEL)` rule wasn't anchored to a selector boundary, so any class whose name ended in `slot` contained the literal substring and lost it: `.btn-slot::slotted(a)` became `.btn-a`, `.card-slot::slotted(a)` became `.card-a`. The rewrite is now boundary-aware and consumes the slot's whole compound selector — `slot`, `slot[name="x"]`, or a class the component put on its slot — since `::slotted()` is only valid attached to a `<slot>`. Attribute-selector `::slotted([slot="prefix"])` and named-slot mapping are unchanged. Nested parens in the argument (`::slotted(:not(:first-child))`) are also now scanned rather than pattern-matched, instead of working by accident.
- **`@focusin` / `@focusout` are detected as interactive.** The event-binding pattern matched `@focus\s*=`, which can't span the `in`/`out` suffix, so a component whose only handler was `@focusin` was classified static and shipped CSS for behaviour it couldn't perform without JS.
- **The CSS transform no longer rewrites selectors inside comments.** Prose that merely mentioned a selector (`/* pair .btn with .btn-slot::slotted(a) … */`) was rewritten as if it were code.

### Changed

- `prism.config.js` in this repo is now `prism.config.example.js`. It described a consumer's directory layout, was never loaded (prism resolves config from the directory it runs in) and was never published — but read as authoritative.

### Fixed

- **Comment-aware selector splitting (regression from 2.0.4).** The comma-list splitter didn't skip `/* … */` comments, so a comment whose prose contained parentheses and commas (e.g. `(never …), which`) made the splitter break *inside the comment*. That shattered the comment, left the following selector unscoped, and leaked the `.tag ` prefix into the comment text. A multi-line comment sitting directly before a comma-separated rule is now handled correctly: the comment is preserved verbatim and every selector in the list is scoped. (Surfaced in arc-ui's tooltip, qr-code, and code-block CSS.)

## 2.0.4 — 2026-07-23

### Fixed — CSS transform

- **Comment-glue dead CSS.** A comment sitting between rules was prefixed with `.tag ` and fused onto the following selector; when that selector was itself `.tag`-anchored (every `:host([attr])` variant), the result was `.tag .tag[data-…]` — requiring a nested component and matching nothing. This had shipped broken variant/positioning CSS for 26 components (button sizes/variants, card, dock, float-bar, divider, stack, avatar, …). Comments are now preserved without being scoped. Comments containing braces are also handled.
- **Single-quoted `:host()` attributes.** `:host([layout='centered'])` produced the invalid selector `.tag([layout='centered'])` (browsers drop it) because the attribute regexes only accepted double quotes. Single and double quotes are now both handled (and normalized to double quotes on output). Enum-value detection in the parser accepts single quotes too.
- **`:host(.class)` selectors.** `:host(.dismissed)` fell through to the bare rule and emitted the invalid `.tag(.dismissed)`; it now becomes the compound `.tag.dismissed`.

> Note: comma-separated selector lists were already fully scoped as of 2.0.0; consumers still seeing only the first selector scoped are looking at a stale bundle and should regenerate.

### Fixed — HTML examples

- **Blank flagship examples.** An element whose only content was an unresolvable interpolation (e.g. `<button>${this._renderContent()}</button>`) was left empty. It now falls back to the component-label placeholder, matching empty-slot handling.
- **Ternary interpolations evaluated against prop defaults.** `${this.dismissible ? html`…` : ''}` no longer renders the stray text "Dismissible" (default `false` → nothing), and `aria-busy=${this.loading ? 'true' : 'false'}` resolves to `aria-busy="false"`.
- **Shadow-internal slot leakage.** A named slot whose fallback is an element (e.g. `<slot name="icon"><arc-icon…></slot>`) is now dropped instead of leaking the `<slot>` and custom element into the output.
- **Attribute placeholders.** Bound attributes get sensible defaults (`type="button"`, `aria-busy="false"`, `href="#"`, …) instead of the prop name (`type="Type"`); unresolvable bound attributes are dropped entirely rather than emitting `name=""`.
- **Phantom `tokens.css` reference.** The external-CSS example header now names the actual configured `baseCSS` file instead of a hard-coded `tokens.css`.

## 2.0.3 — 2026-07-23

### Fixed

- **HTML template converter drops unresolvable interpolations instead of emitting garbage.** Method/getter calls (`${this._renderOverflow()}`) and private/computed members (`${this._hasToc ? 'has-toc' : ''}`) were turned into visible text/markup via a mangled identifier (`_render Overflow`, a `_has Toc` class). They're now dropped, leaving clean surrounding markup; plain public property placeholders (`${this.heading}` → "Heading") are unchanged. This makes the `hybrid` interactivity tag viable for components that use render helpers or computed classes.

## 2.0.2 — 2026-07-23

### Fixed

- **Generated-file recognition survives an org/package rename.** The overwrite guard matched the exact current header (`@arclux/prism`), so any file generated before the `@arclight` → `@arclux` rename was treated as hand-edited and skipped forever — going permanently stale (74 such files in the arc-ui consumer). All generators now recognize prism's sentinel independent of the org name (`isPrismGenerated`), so pre-rename output is refreshed on the next run.
- **`::slotted()` styles are no longer dropped from static CSS/HTML output.** The shadow→light transform passed `::slotted()` through verbatim; it's inert in light DOM, so slotted-content styles were silently lost. `slot[name="x"]::slotted(SEL)` now maps to a scoped `[slot="x"]` selector, and bare `::slotted(SEL)` to a scoped descendant.

## 2.0.1 — 2026-07-23

### Changed

- Upgraded dependencies to current majors: `chokidar` 5, `vitest` 4, `@vitest/coverage-v8` 4, `eslint` 10.
- Added `@eslint/js` as an explicit dev dependency — the ESLint 10 upgrade surfaced that the flat config imported it while relying on it being provided transitively by ESLint 9.
- Bumped CI/release GitHub Actions (`actions/checkout`, `actions/setup-node`) to v7, clearing the Node 20 runtime deprecation warning.

### Docs

- Documented 2.0.0 behavior in the README: `@property` decorator and `static get properties()` parsing, `@tag` JSDoc and tag validation, full selector scoping (bare/id/attribute selectors and comma lists, with `@keyframes`/at-rule carve-outs), and typed custom-event handler props across all framework wrappers.

## 2.0.0 — 2026-07-23

> **Breaking:** the supported Node baseline is now **24+** (`engines.node` is `>=24`, up from `>=22`). Consumers on Node 22 should pin to 1.3.x.
>
> **Breaking:** the parser now rejects components whose `customElements.define('...')` tag is not a valid custom-element name (previously any string was accepted). A component that relied on a non-conforming tag will now be skipped — see Security below.

### Security

- **Component input validation.** The parser now rejects components whose custom-element tag name isn't valid (`customElements.define('...')` previously captured any non-quote characters) and drops custom event names that aren't valid identifiers. These unvalidated strings flowed unescaped into generated wrappers, output file paths, and dynamically-built regexes, enabling code injection into consumers' apps, path traversal on write, comment-breakout, and ReDoS from a malicious/compromised component source.

### Fixed

- **Token resolution:** a design token referenced more than once in the same CSS now resolves on every occurrence. A mis-scoped cycle-detection set previously left all but the first use as literal `var(--token)`.
- **CSS scoping:** the shadow→light transform now scopes every selector in a comma list, scopes bare element/id/attribute selectors (not only `.class`), and handles multiple rules on one line — closing style leaks — while correctly leaving `@keyframes` steps and at-rule preludes unscoped.
- **Vue events:** wrappers now capture `defineEmits` and wire template listeners, so custom events actually reach the parent. Declaring emits without wiring them previously suppressed native fallthrough, so `@arc-*` handlers never fired.
- **Barrel exports:** duplicate detection is now identifier-boundary aware; a component whose name is a substring of an existing export (e.g. `Button` vs `IconButton`) is no longer silently dropped.
- **Angular:** `Array`/`Object` props bind as DOM properties instead of `[attr.x]`, which stringified them (`"1,2,3"`, `"[object Object]"`) and made Lit's `JSON.parse` converter null them out.
- **React:** the `EventName` type import is emitted only when a component has events, so event-less wrappers compile under `noUnusedLocals`.
- **Solid & Preact:** custom events are now supported — Solid via the `on:` namespace, Preact via a ref + effect (its `on*` lowercasing can't bind hyphenated events) — matching the other generators.
- **Parser:** constructor defaults after a nested block are no longer truncated; `@property` decorators and `static get properties()` are now recognized in addition to the `static properties = {}` field.
- **Watch mode:** file-processing errors are caught so one bad file no longer crashes the watcher; a new `unlink` handler rebuilds the CSS bundle when a component is removed.
- **Config:** a missing/invalid `components` (or non-array `tiers`) now throws an actionable error instead of a raw `ERR_INVALID_ARG_TYPE`; a `prism.config.js` that exists but fails to load surfaces its real error instead of "not found".

### Changed

- Dev-dependency audit cleared (`vitest` critical advisory GHSA-5xrq-8626-4rwp and related). CI now baselines Node 24 + latest.
- Removed the misleading `// Auto-generated` header comment from prism's own hand-written sources (the string remains the sentinel written into generated output).

## 1.3.1

### Fixed

- Barrel auto-creation crashed with ENOENT when the tier directory itself didn't exist yet; the directory is now created first. Test updated to cover the create-when-missing behavior introduced in 1.3.0.

## 1.3.0

### Fixed

- **Wrapper registration**: all framework generators (React, Vue, Svelte, Angular, Solid, Preact) now import the web-component package's per-component register subpath (e.g. `@arclux/arc-ui/button`) instead of the bare package root. The bare import stopped registering elements in wc-package v1.8.0 and was eligible for removal by tree-shakers (`sideEffects: false`), silently leaving custom elements undefined in production builds. The subpath import registers exactly one component's dependency chain — per-component tree-shaking now works through every wrapper.
- **Internal state leak**: the parser now excludes Lit `{ state: true }` properties from the public prop surface. Previously internals like `_hasFooter` appeared in every generated props interface, and Svelte/Solid/Preact/Angular wrappers actively wrote them onto the element, stomping component-internal state.
- **CSS transform**: `:host()` selectors with compound inner selectors (e.g. `:host(:not([href]):not([interactive])))`) previously fell through to the bare `:host` rule and emitted invalid CSS (`.tag(...)`) that browsers drop. They now transform correctly.
- **Barrel generation**: tier and root barrels are now created when missing instead of silently skipped. Previously a newly added tier (data, typography) never got barrels, leaving its components unreachable via package exports.

## 1.2.2

> These changes shipped across the 1.2.x line; 1.2.0 and 1.2.1 were interim patch releases that were never tagged, so they are consolidated here.

### Changed

- **Breaking (config):** the `tokensCSS` config option was renamed to `baseCSS`. Update your `prism.config.js` accordingly.

### Added

- `@tag` JSDoc annotation is now honored for tag-name extraction (falls back to `customElements.define`).

### Fixed

- `isIgnored` wildcard matching for `*.register.js` patterns; register files are ignored during discovery.

## 1.1.0

### Added

- Configurable component prefix via `config.prefix` (defaults to `arc`).
- `wcPackage` now falls back to a prefix-based default (`@<prefix>/<prefix>-ui`) when not set.

## 1.0.1

### Changed

- Repository URLs updated to the Arclight-Digital org; org name lowercased to match npm/GitHub provenance.
- Release workflow switched to npm OIDC trusted publishing with provenance (no static token).

## 1.0.0

Initial release.

### Features

- Parse Lit web component source files (regex-based, no AST dependency)
- Generate **React** wrappers (TypeScript, `@lit/react` `createComponent`)
- Generate **Vue 3** SFCs (`defineProps`, `defineEmits`)
- Generate **Svelte 5** components (`$props()` runes)
- Generate **Angular** standalone components (`@Input`, `@Output`)
- Generate **Solid** components (`splitProps`)
- Generate **Preact** components (native CE support)
- Generate **HTML/CSS** examples (external CSS and inline variants)
- Generate **standalone CSS** files (shadow DOM to light DOM transform)
- Automatic interactivity detection (static / hybrid / interactive)
- `@arc-prism` JSDoc overrides for interactivity level
- Append-only barrel file updates (tier + root)
- Watch mode via chokidar
- Header-based safety — never overwrites manually edited files
