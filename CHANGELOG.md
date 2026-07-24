# Changelog

## 2.0.5 — 2026-07-23

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
