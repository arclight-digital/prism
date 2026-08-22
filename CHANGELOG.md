# Changelog

## 3.1.1 — 2026-08-22

### Fixed

**`config.runtime` reported almost every component as driven by Lit's own
internals.** 3.1.0 walks the prototype chain to find the methods a mixin
contributes, and stopped at a prototype whose constructor is *named*
`LitElement` or `ReactiveElement`. The build a plain `import()` resolves — the
only kind the CLI ever loads — is minified: those names are `"i"` and `"g"`. So
the walk ran straight through Lit's own prototype and stopped at `HTMLElement`,
whose name survives because it is a platform global, collecting the two members
of `ReactiveElement` that neither the `_` convention nor the `*Callback` suffix
filters: `enableUpdating`, and `C`, a mangled private.

The result in the reference catalog was a handle on **187 of 188 components in
five packages**, each documented `/** The element, for the methods it is driven
by: enableUpdating() and C(). */` — on components with no imperative API at all.
Everything else 3.1.0 emitted was correct, including the 26 form controls that
really do inherit `checkValidity()` and `reportValidity()`; the boundary was the
only thing wrong.

The boundary is now structural: the prototype that owns `requestUpdate`,
`performUpdate` and `createRenderRoot` is the framework's, whatever it has been
renamed to. Shape is the thing minification leaves alone.

Two things about how this got out are worth recording, because neither is about
Lit. **The test suite could not have caught it**: vitest resolves lit's
`development` export condition, so the real package arrives in tests with its
class names intact, and the CLI's own `import()` does not. A fixture now carries
the minified *shape* rather than the package, since that is what the walk meets.
And **`wrapper-missing-handle` cannot catch it either** — that check fails when
a handle is missing, and this failure emits one everywhere, which reads as a
check passing more thoroughly rather than a check failing. A verification that
can only fail in one direction does not cover the other.

**A walk that cannot find the boundary now answers nothing.** Reaching the end
of the chain without recognizing the framework's prototype means the shape this
relies on has changed, and everything collected on the way is suspect rather
than complete. The component's own file is read instead — what prism did before
3.1.0 — and the degradation is reported as `runtime-methods-unreadable` rather
than absorbed, since mixin-contributed methods go missing again when it
happens. It fails `--strict`, beside `runtime-unavailable`.

## 3.1.0 — 2026-08-22

Two findings from the same report as 3.0.0's scope, raised again by an
application building on the wrappers rather than by any of the six package
builds — which is the thing they have in common. Both failures are silent, both
are on the consumer's side of a wrapper that compiles and renders, and neither
needed a breaking change to fix.

A third thing arrived with them: `npm run test:types` compiles the corpus's
generated wrappers with each framework's own checker. It found two defects in
its first two runs, and both are below.

### Added

**Two-way binding is derived from what a component does, not from what its prop
is called.** A payload key matching a declared prop name was the only write-back
path prism could see. So `arc-app-shell`, which closes its drawer on Escape, on
a backdrop click and on navigation and announces each as `arc-sidebar-toggle`
carrying the new state as `detail.value`, emitted `sidebarOpen` as a one-way
property: a consumer's copy drifted the first time a user dismissed the drawer
any way other than the hamburger, silently, in the direction that leaves a close
button which reopens nothing.

The second derivation is the behavioural one: **a prop the component assigns
outside its constructor and then announces in an event is state it shares rather
than receives**, whatever the payload calls it. Both halves are statically
visible, and where they sit is what tells them apart — a constructor assignment
is a default, the same assignment in a keydown handler is the component moving
state its consumer also holds. Two spellings are read: `detail: { open:
this.sidebarOpen }`, and `detail: { value }` dispatched from a method that
assigns that local to exactly one prop. Ambiguity answers nothing: a local
assigned to two props before it is announced makes neither of them the prop the
event is about, and the search never leaves the method the dispatch is in.

Name-keying could not see any of it, and would have kept needing new names — the
same shape reaches `arc-tabs`' `selected`, `arc-pagination`'s `current`,
`arc-stepper-nav`'s `active` and every `open`-like prop a dismiss path can move.
Across the reference catalog of ~200 components, eight props on eight components
gain a binding they never had, and one loses one — see below.

**A component with public methods gets a handle on the element in every
wrapper.** `arc-toast` is driven by methods — `show(options)` returns an id,
`dismiss(id)` takes it back, plus `updateToast()`, `complete()` and `clear()` —
and three of the six wrappers had no route to the element at all: Svelte's
`bind:this` yields the Svelte component, a Vue template ref yields the SFC
instance, an Angular template reference yields the wrapper class whose
`ElementRef` is private to it. React was fine, because `@lit/react` forwards
refs, which is why this was found in an application months after the wrappers
shipped rather than in a build.

The condition is mechanical, so it is applied rather than configured: prism now
reads the class body for the methods a consumer calls — instance methods that
aren't private by `#` or by the `_` convention, aren't static, and aren't called
by Lit or the browser — and any component with one gets `element()` in Svelte,
`defineExpose` in Vue, a public getter in Angular, a forwarded `ref` in Solid,
and `forwardRef` in Preact. Typed as the element class, and nothing about the
method surface is restated: the handle *is* the element, so prism has no
signature to get wrong and nothing goes stale when a method is added.

A subclass inherits its parent's methods along with its events, so an empty
subclass of a component driven by `show()` gets the same handle. And with
`config.runtime` on, the methods are read from the prototype chain rather than
the file, which is the only way a mixin's are visible at all — `checkValidity()`
and `reportValidity()`, declared once in a form-control mixin, are methods of
every control built from it and of none of their files. The walk stops before
`LitElement`, or every component would look driven by `requestUpdate()`.

**`wrapper-missing-handle`**, beside the three checks that already read each
wrapper back: a component with methods whose wrapper hands back no element.
Fails `--strict`, like the others.

### Changed

**Where the two derivations disagree, the dispatch site wins.** They only
disagree when the source is explicit, and the case is a real defect rather than
a preference: a checkbox sending `detail: { value: this.checked }` while
declaring `value` as the string a form submits is carrying the checked flag, and
mirroring it onto `value` wrote a boolean into a string — cast into place by the
generated wrapper and reported by nothing. Such a prop loses its binding, so a
consumer holding `v-model:value` on a control shaped this way will see the
`update:value` emit disappear. What it was carrying was never that prop's value.

**Preact wrappers for method-driven components are `forwardRef` components**
rather than plain `FunctionComponent`s, which is what lets a ref reach the
element at all. Rendering is unchanged.

**Most of the diff in a large catalog is form controls, not imperative APIs.**
With `config.runtime` on, a mixin's methods are the component's methods, so
`checkValidity()` and `reportValidity()` from a form-control mixin give every
control a handle in five packages. That is correct — they are real public
methods of those elements — but in the reference consumer it is 26 components'
worth of handles arriving for a reason that has nothing to do with `arc-toast`,
and it reads as a surprise in review unless you know.

### Fixed

**A Svelte wrapper imported `Snippet` when nothing declared one, and a Solid
wrapper imported `JSX` the same way.** Both happen on a component with `@slot
none`: no named-slot snippets, no `children`, and a type import with nothing
left to refer to — which fails `tsc` and `svelte-check` under `noUnusedLocals`,
on by default in the starter template both frameworks ship.

In the reference catalog that is **70 of 188 wrappers in each of the two
packages**, the same 70 components both times: exactly the `@slot none` set.
And it is worse in those two packages than it would be anywhere else, because
Svelte and Solid ship `src/` rather than `dist/` — their export maps point at
source — so it is the *consumer's* compiler that reads these files, and
`skipLibCheck` does not cover `.tsx` or `.svelte`. The packages themselves
compile because nothing in that repo turns `noUnusedLocals` on over the wrapper
trees, which is the whole shape of it: the file is checked by a config that
cannot fail on it.

Invisible from inside prism, since the wrapper is otherwise exactly right, and
invisible to every string assertion in this repo. The Solid case defeats a
grep as well — `declare module 'solid-js/jsx-runtime' { namespace JSX { … } }`
puts the identifier in the file while the import stays dead. Found by the type
check the moment it existed.

### Testing

**`npm run test:types` — the corpus, compiled by each framework's own checker.**
`tsc` for React, Preact, Solid and Angular, `vue-tsc` for Vue, `svelte-check`
for Svelte, against a stub of the element package built from the corpus metas so
the wrappers' use of the element's own type is checked too. It is the only test
here that asks what a consumer asks — does the file compile where it lands —
and it is the first thing in this repo that could have caught either defect
above without a 202-component catalog downstream.

Each framework is checked twice: once against the generated tree, and once
against a file with a deliberate type error, which it has to fail. That second
run is not ceremony — the first working version of this harness put the tree
under `node_modules/`, where svelte-check does not look, and it reported a clean
pass on a file that could not compile. A checker that reads nothing and a
checker that is happy print the same thing.

Kept out of `npm test`: it needs six framework toolchains, and prism's
dependency list is one package. CI installs them for that job alone, with
`--no-save`, so nothing about the published package changes.

## 3.0.0 — 2026-08-16

Scoped from `PRISM-3.md`, filed by `arc-ui` against 2.13.1. That document is not
a bug list — every open bug was already fixed — it is an account of **the work
the consumer was doing that prism should be doing**: seven files, about 1,235
lines, that existed only because of prism, four of them verification and one of
them a 275-line post-processor that regex-rewrote prism's emitted Angular files
because the shape it needed had no hook.

This release takes that work. It also takes the one defect the same document
found, which is breaking, and it is the release where generated output starts
saying which version wrote it.

### Breaking

**The Solid `IntrinsicElements` augmentation targeted a module nothing consults.**
Every generated Solid wrapper carried `declare module 'solid-js'`, and it did
nothing. Under the standard Solid setup — `jsx: "preserve"`,
`jsxImportSource: "solid-js"` — TypeScript resolves `JSX.IntrinsicElements`
through the **`solid-js/jsx-runtime`** entry, which re-exports the namespace from
`solid-js/types/jsx`. Augmenting the main entry declares a second, unrelated
`JSX` namespace, and because merging into an unused namespace is not an error
there was no diagnostic: 201 wrappers in the reference consumer carried the block
and none of it applied. Not visible from the Solid package's own build either,
which compiles either way — the wrapper types its props separately, and the
intrinsic lookup only matters to someone writing the tag directly.

It now emits `declare module 'solid-js/jsx-runtime'`. This is breaking because
the block typed nothing before: a Solid consumer passing a wrong enum value to an
`<arc-*>` tag has been compiling clean and will stop.

**Angular wrapper packages gain `@angular/forms` as a peer dependency**, wherever
any component is form-associated. See below.

**New `--strict` failures.** `form-control-unbindable`,
`props-from-under-reports`, `wrapper-missing-accessor`, `exports-target-missing`,
`generator-downgrade` and `invalid-form-associated` all fail a strict run. A
build that passed on 2.13.1 can fail on 3.0.0 without anything having changed in
the components.

**Every generated file's header line changed**, since it now carries a version.
Anything matching prism's header string exactly needs to allow for it.

### Added

**Angular `ControlValueAccessor` for form-associated elements.** `formControlName`,
`formControl` and `[(ngModel)]` worked on zero Angular wrappers, and did not fail
while not working: the binding compiled, reported nothing, and left the control
pristine and empty while the element on screen held the user's text. That is most
of the reason an Angular wrapper package exists — an Angular team reaching for a
component library reaches for reactive forms in the same breath.

Which components get one is the platform's own definition rather than a
heuristic: `static formAssociated = true`. The rule it replaces — "components
that emit a change event" — swept in tabs, theme toggles, waveforms and sortable
lists, none of which is a form control. `config.formAssociated` answers for a
library that contributes the static from a mixin, where prism cannot see it.

A form binds `checked` if the component declares it and `value` otherwise, read
from the component rather than a table of tag names. `config.formValue` names the
property outright, or names the *pair* for the two controls whose value is
compound — a date range is `start`/`end`, a range slider is `low`/`high` — which
the accessor then carries as an object. Leaving those out would have meant
`formControlName` working on 25 of 27 controls, which is the kind of gap a
consumer discovers rather than reads.

Three details in the emitted shape each cost something to find, and are recorded
where they are implemented: the commit listener is attached in the constructor
because the host metadata already maps that event to the component's own
`@Output` and cannot carry two handlers for one event; `writeValue` never calls
back into the form, because echoing marks the control dirty on every programmatic
`setValue`; and the reset value follows the declared type, using a union's own
default because `''` is not a member of `'sm' | 'md' | 'lg'` and the package
would not compile.

A form control prism cannot wire — no bindable property, or no event to commit on
— is reported as `form-control-unbindable`, and its wrapper is still generated,
without an accessor.

**`config.jsxTypes` — the declaration files for consumers who skip the wrappers.**
Prism generates six framework wrappers and did not generate the other thing a
framework consumer needs: types for someone rendering `<arc-input>` directly.
`react-jsx.d.ts`, `preact-jsx.d.ts` and `solid-jsx.d.ts` are now emitted, each
augmenting the module its framework actually resolves `JSX.IntrinsicElements`
through, with a per-framework base attribute set — Solid's `on:`/`prop:`/`attr:`/
`use:`/`classList`, Preact's deliberately loose `on${string}`, React's
`className` and `tabIndex`. A documented union stays a union, so a wrong enum
value is a compile error.

Each element carries both spellings of any property whose attribute name differs,
because Lit *lowercases* rather than kebab-cases and both spellings reach the
element. And the generated header states how to apply the file — and the three
ways that look right and silently do nothing, one of which shipped in the
reference consumer's own React file for a whole release.

**Wrapper package export maps.** Point a framework section at its `packageJson`
and prism writes that package's `exports` from the tree it just generated: a
subpath per component, `main`/`module`/`types` for the built modes, and the
condition each toolchain resolves — `solid` at source `.tsx` so Solid's compiler
owns the JSX, `svelte` at the shipped component, vue-tsc's `.vue.d.ts` naming.
Source targets are checked for existence (`exports-target-missing`); dist targets
are not, since the package build produces them later and fails loudly itself. Two
components whose names want the same subpath are reported
(`exports-subpath-collision`) rather than one of them quietly losing its entry.
`config.angular.packageJson` throws — ng-packagr owns that manifest and copies
the source one into `dist` verbatim, so anything written there ships broken.

**The version is stamped into generated output.** An older prism does not error;
it reverts. Regenerating a 235-file catalog on 2.12.0 silently undid 205 Angular,
10 React, 10 Preact and 10 Solid files, and the only signal was a large diff that
CI reported as "generated files are out of date" — wording that reads as stale
committed output and invites the exact wrong fix. The header now names the
version that wrote the file.

Reporting that during the overwrite is a witness rather than a guard — by the
time a generator has read a file's stamp it has already decided to replace it,
and the finding clears itself on the next run because the files then carry the
older stamp. So the same stamp is read **before anything is written**: a full run
and a watcher's first pass scan the output tree, and under `--strict` prism
refuses to generate at all rather than reverting first and reporting after.
Nothing is written, the exit code is 1, and the message names both versions. The
per-file check stays for single-file mode and incremental watch rebuilds, and a
file the scan already named isn't reported twice.

The sentinel treats the version as optional, which is the half that had to be
right: every file written before this release carries none, and a sentinel that
insisted on one would have classified the entire installed base as hand-edited
and quietly stopped regenerating it. Barrels are deliberately not stamped —
they accrue content across versions rather than being rewritten whole.

**A cross-check on what `config.propsFrom` doesn't return.** Prism validates
every entry a hook returns and had, by construction, nothing to validate about an
entry it never returned — so a hook that under-reports was indistinguishable from
a correct one. Two real hook bugs shipped through that gap, each silently
removing a prop from six wrappers. The `@prop` tags are the one independent
account of the same component prism has, so a hook that answers for a file and
returns strictly fewer props than that file documents is now reported as
`props-from-under-reports`, once per file, naming the missing props.

What the new code buys is not detection but **attribution**: the same absence was
already visible as `doc-prop-undeclared`, whose wording — "documents `@prop x`
but declares no reactive property by that name" — reads as *the documentation is
stale*, and is exactly backwards when the property is real and the hook is what
lost it. A finding that reads as somebody else's problem gets waived. It was: on
first contact with a real catalog this code found `readonly`, contributed by a
form-control mixin the consumer's hook never followed and therefore missing from
**all six framework wrappers of 25 form controls**, while the old message sat
unread in an accepted pile. `props-from-under-reports` names the hook;
`doc-prop-undeclared` names the tag. Only one of them sends you to the right file.

**A verification pass for the accessor** (`wrapper-missing-accessor`), alongside
the existing registration and slot-outlet checks, for the same reason those
exist: a missing `ControlValueAccessor` is invisible from every direction that
isn't the file itself.

**An acceptance corpus** (`test/fixtures/corpus/`). Five component sources, each
one a shape that has broken, run through every generator in one pass. Prism's
generator tests build `meta` by hand and so can only prove the generators did as
they were told; every serious defect prism has shipped was found downstream
instead. CONTRIBUTING.md records both halves of the arrangement — the corpus, and
the reference consumer as the acceptance suite a release candidate is run against
before publishing, which is what actually catches what a five-component corpus
cannot.

**`prop.attribute`** is now parsed from a declaration's `attribute:` option, and
defaults to Lit's own lowercasing of the property name.

### Found while the reference consumer took the release

Three things the first real catalog surfaced, all fixed here:

**`jsxTypes.wcPackage` is inherited from the wrapper sections, not guessed.** It
fell back to the `@{prefix}/{prefix}-ui` convention, which is a reasonable
default everywhere else prism uses it and the wrong one here: the package name
goes into the activation instruction the generated header carries, so a guess
produces `node_modules/<wrong-pkg>/types/react-jsx.d.ts` — a path that resolves
to nothing, includes nothing and reports nothing. That is *precisely* the silent
no-op the rest of that same header warns about at length, which makes it a file
explaining a trap while setting one. It now comes from the framework sections
that already name the package, and is required explicitly in the two cases where
inheriting would be a guess: when they disagree, and when none is configured.

**An `acknowledge` entry naming a field its finding never carries now throws at
config load.** `props-from-under-reports` carries `props`, plural — the fault it
describes is the hook's rather than any one prop's — so the natural
`{ code, tag, prop: 'value' }` matched nothing, and the only feedback was an
`unmatched-acknowledge` finding saying "the issue is gone, or the entry no longer
describes it": the one conclusion that isn't true, while the original is still
live and still failing the build. Two misleading findings from one field that was
never going to match. The same check covers the codes that describe generated
output and so carry no `tag`. Unrecognised codes are still judged on nothing, so
a config written for a newer release still runs.

**A JSX declaration file prism was configured to write but didn't is now a
finding**, `jsx-types-not-written`, and fails `--strict`. A consumer migrating
off their own generator has those exact paths on disk already; prism declines to
overwrite what it didn't write, which is correct and permanent, so the pipeline
stays green while the pre-migration copy is what ships — indefinitely, because
nothing will ever write over it. That is precisely how it went in the reference
consumer, with the one-line fix already known and written down, because
`(skipped — manual file)` was one log line among several hundred.

Strict here and not for the same skip on a wrapper, because the two mean
different things: hand-writing a wrapper is a standing arrangement (a component
whose slots are built at runtime has to be authored by hand, and prism stepping
around it every run is the feature), while configuring `jsxTypes` says prism
should produce these files. The message now names the fix —
`(skipped — not prism's; delete it to hand the file over)` — and
`config.acknowledge` records a decision to keep your own.

### `config.runtime` — resolve properties from the class

The oldest item in the ledger, and the one the rest kept pointing at. In one
line: **the properties a component has are the properties its class has, and
every attempt to compute that from one file's text is a partial answer that
looks complete.**

Three defects in the reference consumer share that shape, and none of them was
findable from inside it:

- a **mixin** contributing `readonly`, `required` and `name` — missing from all
  six framework wrappers of 25 form controls;
- a **base class**: `export class ArcModal extends ArcDialog {}`. The component
  had ordinary `static properties` and shipped correct wrappers for every
  released version; the props vanished in the single refactor commit that merged
  two dialog tags and reduced this one to a subclass. Six props and both events
  stopped reaching any of the six frameworks — `<Modal open>` did nothing,
  everywhere — while no wrapper was edited, no generator was edited, and the only
  signal was a handful of findings that read as stale documentation. **A source
  reader empties a component the moment an ordinary, correct refactor turns it
  into a subclass;**
- a hardcoded tier list standing in for a file tree, which is the same mistake
  one level up (see the exports map above).

Everything else in prism reads source text, which has one blind spot it cannot
reason its way out of: **a property contributed by a mixin or a base class is not
in the file that declares the component.**

```js
class ArcInput extends FormControlMixin(LitElement) { … }
```

`readonly`, `required` and `name` are real reactive properties of that element,
and no amount of reading `input.js` finds them. In the reference consumer that
was 16 properties from one mixin, missing from **all six framework wrappers of 25
form controls** — settable on the element and in plain HTML, unreachable from
React or Angular, and invisible for two releases because the only finding that
saw a shadow of it read as though the documentation were stale.

Lit already computes the answer. `Ctor.elementProperties` is the flattened map of
every reactive property a class has, mixins and superclasses included, with the
declared type, the reflect flag, the attribute name and the internal `state`
marker — built by Lit, at the moment the class is finalized. It cannot disagree
with the component, because it *is* the component. `config.runtime: true` reads
it.

**Opt-in, deliberately.** Reading the class means importing the module, and
importing a module runs it. Prism has never executed a line of a consumer's code,
and turning that on silently would be a change of kind rather than degree. It
also degrades rather than fails: a module that throws on import costs that one
component its runtime answer, is reported as `runtime-unavailable`, and falls
back to the source reader. `config.runtime.setup` points at a module that
installs whatever DOM your components need at import time — Lit 3 carries its
own shim and needs none.

What it retires, beyond the missing props:

- **`config.propsFrom`.** A declaration built by a helper — `size: oneOf([…])` —
  is an ordinary reactive property by the time the class exists, so there is
  nothing left for a hook to explain. Where a hook is configured it still wins,
  because it is explicit configuration; but prism now checks it against the class
  and reports what it left out. That check is exact where the `@prop` cross-check
  was inferential, and it names the mixin props a one-file hook cannot see.
- **`config.formAssociated`.** `formAssociated` is a static on the class, so a
  mixin-built form control answers the question the same way the browser does.
- **`unparsed-prop-declaration`.** A declaration the source reader could not read
  is no longer a prop that goes missing; the class has it either way.

**And what it does not fix on its own, which took a second pass to see.**
`elementProperties` is flattened; nothing else is. The events a component
dispatches, the slots it renders, its template and its styles are statements in
the base class's *file*, so a subclass got its props back and stayed missing
everything else — a wrapper that passes any comparison of prop lists while every
`onArcClose` a consumer wrote silently never runs. Prism now links a component to
the one it extends by class identity through the prototype chain, and takes the
rest from that component's own parse: events and their payloads always, since a
subclass dispatches its parent's as well as its own; template, styles, slots and
interactivity only where the subclass renders nothing of its own. Each run says
what it took.

The same gap runs one layer below the property list, and closes the same way.
`elementProperties` carries what a property *is* — its type, whether it reflects,
which attribute it binds — and nothing about what surrounds it: a default is an
assignment in the base class's constructor, and a union is words in a `@prop`
tag. So a subclass's properties arrived complete and uniformly bare. Defaults and
documented types are now inherited too, unconditionally, because a constructor is
not rendering — `super()` runs whatever the base assigns however the subclass
draws. Svelte is where a lost default shows, being the only emitter that puts one
in the destructuring; a lost union is quieter and costs more, `size: string` in
place of `size: 'sm' | 'md' | 'lg'` across six sets of types.

Inheriting is only ever filling a hole. Wherever the subclass spoke — its own
default, its own union, its own `render()` — it is believed, and prism looks no
further up.

A parse is independent of every other parse of the same file, which had to be
made true rather than merely stated. The runtime map is resolved once per run and
read by every parse; it used to hand out its own prop objects, so each parse left
its conclusions where the next one would read them. That was harmless for exactly
as long as every conclusion was re-derived from the same source, and inherited
facts are the first thing that stopped being true of — a watch rebuild would have
read an inherited default back as the subclass's own and stopped looking for
where it came from. Neither a single generate nor an idempotency check can see
this, since neither parses a file twice.

Where the base class isn't among the scanned components — another package, or a
helper module doing the dispatching — a `@fires` tag is now believed rather than
discarded. Dispatch sites stay authoritative because they carry the `detail`
shape that two-way bindings are derived from, and a tag carries nothing; but an
absence of dispatch sites is not evidence of absence, and the two ways of being
wrong are not equal.

**And it finally promotes `doc-prop-undeclared`.** The finding was report-only
for two releases because the population it found was one the consumer did not
create and could not clear. That was never a problem with the rule — it was the
evidence behind it. Read from a file, "no declaration here" is not the same claim
as "no such property", because a mixin makes the first routinely untrue. Read
from the class, the two claims are the same one, and a documented `@prop` that
isn't there is a stale tag and a one-line fix in the file doing the complaining.

So strictness follows the evidence: the finding fails `--strict` when it was
checked against `elementProperties`, and reports when it was read from source.
Nothing changes for a project that doesn't opt in, and no build fails for a
backlog only prism could clear. It is acknowledgeable either way.

## 2.13.1 — 2026-08-15

Reported from `arc-ui`, from a single catalog change that added 15 tags to
`barrelExclude` and deleted 5 components. Both defects are in barrel
maintenance, neither ships a broken package, and arc-ui's own checks caught
both — but one of them is silent inside prism and the other reports as somebody
else's error.

### Fixed

**`barrelExclude` could not remove a name from a barrel a formatter had
wrapped.** Removal matched one line at a time, so an export statement written
across several lines — what any formatter produces once a barrel passes its
print width — matched nothing and was copied through untouched. The config entry
simply had no effect, and nothing reported it: the gate on the append is the
only other place `barrelExclude` is enforced, and it can keep a name out but
never take one back. So the bug was invisible for as long as every excluded
component was excluded *before* it was first generated — true for the entire
life of arc-ui's only excluded component, and false the moment a catalog change
excluded fifteen that were already there. Barrels are now read by export
statement rather than by line. A rewritten statement keeps the layout it was
found in — indent, one name per line, trailing comma — so a prune doesn't land
in a consumer's diff as a reflow that their next format undoes.

The same single-line constraint sat on the other end of the file: the
web-component root barrel merges a new component into the existing re-export for
its tier, and against a wrapped statement that pattern matched nothing and
appended a second statement for the same module instead.

**Deleting a component left every wrapper barrel naming files the same run had
deleted.** `pruneBarrels` ran before `sweepOrphans`, and it decides what to
remove by asking the filesystem whether a specifier still resolves — the right
design, and the reason it never deletes a working export, but it means the
orphans have to be gone already. They weren't: every specifier resolved,
nothing was removed, and four lines later the files went. Deleting five
components broke the build of all six wrapper packages with `TS2307`, and the
run that broke them exited without saying so — a second run repaired them. The
two calls are swapped. Barrel repair stays unconditional rather than gated
behind `--prune`, for the reason it always was: an unbuildable barrel is a bug,
not untidiness.

## 2.13.0 — 2026-08-13

Reported from `arc-ui`, where a new harness mounted all six wrapper packages in
a real browser for the first time and found three defects prism had shipped.
Every one of them survives `tsc`, `ng-packagr --strictTemplates`, a production
Vite build, and a consumer that imports the package and renders a component. The
common thread is that none of them is a *compile* failure — the wrappers were
well-typed descriptions of the wrong runtime.

### Fixed

**The Angular package registered no custom elements at all.** Every wrapper
imported its element class and used it only to type the host reference, so
TypeScript elided the import and the `customElements.define` side effect never
reached the bundle: the built package contained zero imports of the element
library and all 207 wrappers rendered an unupgraded `HTMLUnknownElement` — no
shadow root, no styles, no behaviour, and every `@Input()` writing a meaningless
expando. The generator now emits the side effect and the type separately:

```ts
import '@arclux/arc-ui/top-bar';
import type { ArcTopBar } from '@arclux/arc-ui/top-bar';
```

The other five packages were unaffected, but for reasons that were accidents
rather than decisions — React binds the class as a value in `elementClass`, and
the rest emit a bare import with no binding to erase. So the property is now
checked rather than relied on; see `wrapper-missing-register` below.

Worth stating plainly, because it is why this went unnoticed for so long: a
property written to a non-upgraded element is stored as an expando and reads
back correctly. Prop assertions pass against a package that registers nothing.

**Angular and Solid discarded children unless the component had a *default*
slot.** `arc-top-bar` declares four named slots and no default one; its Angular
wrapper was `template: \`\`` and its Solid wrapper had no `children` in its props
and none in its body, so every child a consumer wrote vanished. Ten arc-ui
components were affected in both.

Both frameworks project children into the light DOM verbatim and let the browser
assign them from the `slot` attribute, which means their single children outlet
is the route named-slot content takes too. The rule is now: **any declared
`<slot>`, named or default, means the wrapper forwards children.** Angular gets
one bare `<ng-content />` — not a `select=` per slot, since assignment is the
custom element's job, not Angular's.

React and Preact moved to the same rule. Neither was broken at runtime
(`createComponent` and `h()`'s props both carry children regardless), but their
generated `Props` interface said a component taking `<span slot="logo">` accepts
no children, which is false and was the only thing standing between them and the
same defect. Vue and Svelte are unchanged: they emit an explicit outlet per named
slot, so their children outlet correctly stays gated on the default slot.

`@slot none` still means what it says for a component with no slots at all. On a
component that has named slots, it no longer closes the only route their content
has in the four frameworks above.

### Added

**`wrapper-missing-register` — a wrapper that never registers its element.**
Prism's post-generate verification existed precisely to catch a generated file
that stopped carrying something the component needs, and it watched the slots
while an entire package went inert. It now also reads back the register import
(or, for React, the `elementClass` reference that keeps the value import alive).
It fails `--strict`, and it sorts above `wrapper-missing-slot`, because a wrapper
that registers nothing makes everything else it gets right unobservable.

The slot half of that check was strengthened at the same time. It tested
`meta.hasDefaultSlot`, which is not the rule any generator follows, so it agreed
with both defects above; it now asks each generator's own predicate whether the
file should have carried an outlet.

## 2.12.0 — 2026-08-01

Reported from `arc-ui`, where a move to helper-built property declarations
dropped every prop from all six framework wrappers and the run still exited 0.

### Added

**`config.propsFrom` — resolve declarations prism's reader can't.** Prism reads
object literals and `@property()` decorators. A declaration built by a helper —
`selected: int({ default: 0, min: 0, clamp: 'toRange' })` — carries its meaning
in a vocabulary prism would have to re-implement to read, and re-implementing it
is how the generator's idea of a prop drifts from the component's. The hook lets
a repo answer for itself:

```js
// prism.config.js
propsFrom(source, filePath) {
  // return an array of props, or undefined to fall through to prism's reader
}
```

Returning `undefined` falls through, so a hook only has to handle the files it
knows about. Returned entries are filled in and checked — an unknown `type`, an
entry with no usable `name`, a non-array return, or a hook that throws is
reported as `invalid-props-from` rather than absorbed, and prism falls back to
its own reader. Constructor defaults, documented unions and `@prop` types still
apply on top, so a hook only has to answer the part it knows.

### Fixed

**A declaration prism couldn't read was dropped in silence.** This is the more
important half, and it is independent of the hook. Nothing warned: the wrappers
were generated with zero props, `tsc` compiled them happily (fewer props is
still valid TypeScript), and the run exited 0. The regression was visible only
in `git diff`. Two new findings close it, from opposite directions:

- `unparsed-prop-declaration` — the reader saw `name:` but the value wasn't an
  object literal. It names the prop and the declaration it couldn't read.
  **Fails `--strict`**, and is acknowledgeable.
- `doc-prop-undeclared` — a `@prop` JSDoc tag with no reactive property behind
  it. The same disagreement seen from the documentation side, so it catches the
  case even where nothing looks unreadable. **Reports only.** A prop already
  reported as unreadable isn't reported again here.

Only the second half of that split is a judgement call.
`unparsed-prop-declaration` fires only where prism genuinely could not read a
declaration, so the build it turns red belonged to someone already losing props
in silence.

`doc-prop-undeclared` is equally true and finds far more, because prism reads a
component's own source and a prop contributed by a mixin is invisible to it. A
component whose `readonly` comes from a shared `FormControlMixin` documents the
prop, declares it nowhere locally, and gets reported — correctly, since the prop
really is missing from the generated wrappers. In the reference consumer that is
18 findings, 16 from one mixin, with `readonly` absent from 14 React wrappers
that document it. None of it was introduced by the consumer and none of it can
be cleared without prism changing first, so failing a minor upgrade on it would
mostly teach people to pin.

The fix is the cause rather than the rule: resolve properties at runtime from
`Ctor.elementProperties`, making mixin-contributed props visible. The diagnostic
then quiets because the bug is gone rather than because the rule got weaker, and
the missing wrapper props return at the same time. That work is additive and is
planned for a 2.x minor; the promotion to a strict failure follows in 3.0.0.
Until then `--report-json` gives the codes as data to gate on yourself.

**A nested option could mark a public prop internal.** The config capture was
`(\w+)\s*:\s*\{([^}]*)\}`, which ended at the *first* `}` — so
`{ type: Object, converter: { fromAttribute: () => ({ state: true }) } }` both
truncated the config that was read and left the tail to be rescanned as though
it were more properties. `state`, `type` and `reflect` are now read from the
config's own keys only, and the properties block is walked brace-balanced rather
than pattern-matched. The same hardening applies to `@property()` decorators.

## 2.11.1 — 2026-07-31

### Fixed

**A prop defaulting to `undefined` or `null` reached wrappers as a quoted string.**
`this.format = undefined` and `this.contained = null` are the absence of a
value, but the parser records a default as source text, so both arrived at
`typedDefault` as the truthy strings `'undefined'` and `'null'`. Every branch
before the fallback is keyed on a declared type or a leading quote, so neither
matched one and both fell through to "quote it" — emitting `format: 'undefined'`
and `contained: 'null'`.

Two ways that showed up:

- **Vue failed to build.** `format` is documented `Function`, so a string
  default is `TS2322: Type 'string' is not assignable to type
  'InferDefault<…, Function | undefined>'`. `vue-tsc` runs in the package's
  `prepack`, so `npm pack` on the Vue wrapper failed outright.
- **Svelte compiled and was wrong.** `contained = 'null'` is a non-empty string
  and therefore truthy, so a prop whose whole purpose was to be unset defaulted
  to set. Silent, and only in the generated packages.

Both now emit no default at all, which is what preserves the author's intent —
the element assigns its own `null`/`undefined` when it upgrades, and a wrapper
that stays quiet lets it.

`hasDefaults` in the Vue generator followed: it asked whether a source default
was *recorded* rather than whether any survived typing, so a component whose
only default was unrepresentable got `withDefaults(defineProps<…>(), {})` — an
empty defaults object, legal and untrue. It now asks the serialiser.

## 2.11.0 — 2026-07-31

The release that shipped the four entries below it.

`2.8.1`, `2.9.0`, `2.10.0` and `2.10.1` were written up as separate versions but
never published — `package.json` stayed at `2.8.0` throughout and was bumped once,
to `2.11.0`, at the release. On npm the line therefore reads `2.8.0 → 2.11.0`, and
those four headings are the notes for what is inside this one version rather than
versions anyone can install. They are kept as written; collapsing them would lose
the per-change detail, and renumbering them would invent a history that npm does
not have.

So, upgrading from `2.8.0`, this release contains:

- **`config.barrelExclude`** — keep a component out of every generated barrel, so
  one component's optional dependency stops being every consumer's required
  install. See [2.10.0](#2100--2026-07-30).
- **`@slot none`** — a way to assert that a component takes no children, so its
  wrappers omit `children` instead of silently discarding it. See
  [2.9.0](#290--2026-07-30).
- **A commented at-rule was emitted with the component selector in front of it**,
  which browsers drop whole — a responsive breakpoint that had never once applied.
  See [2.10.1](#2101--2026-07-30).
- **Barrel exports are pruned for components that no longer exist**, plus the
  Angular, Solid and Preact wrapper fixes listed in [2.8.1](#281--2026-07-30).

### Fixed

- **The release itself now carries a heading.** A version that ships without one
  leaves its content filed under numbers that were never released, which is how
  this entry came to be written after the fact.

## 2.10.1 — 2026-07-30

### Fixed

- **A commented at-rule was emitted with the component selector in front of it.** `shadowToLight` decides whether a `{`-prelude is an at-rule or a selector list by testing whether it starts with `@`. Comments are copied into that same prelude buffer, so a comment sitting above the at-rule made it start with `/*` instead — the at-rule fell through to the selector branch and was scoped like a selector:

  ```css
  /* Collapse below the nav breakpoint. */
  .arc-top-bar @media (max-width: 900px) { … }
  ```

  A selector prefixing an at-rule is invalid, so browsers drop the block whole. In one design system that silently disabled the responsive breakpoint of a top bar in the standalone CSS package — the query was present in the file, and had never once applied. The bug is invisible in review precisely because the comment explaining the query is what breaks it.

  Its reach is wider than media queries. Because the misclassified at-rule never pushed its name onto the context stack, a commented `@keyframes` also lost its keyframes context, and its `0%` / `100%` steps were scoped as if they were selectors.

  The prelude is now classified after skipping leading whitespace *and* comments, which is what `scopeSelectorList` already did one level down; both share the pattern now. A selector starting with `@` is additionally passed through unscoped, so a future misclassification degrades to an unscoped rule rather than invalid CSS.

## 2.10.0 — 2026-07-30

### Added

- **`config.barrelExclude` — keep a component out of every generated barrel.** A bundler resolves the dynamic imports of every module in its graph, and a barrel puts every component in that graph. So a single component's optional dependency becomes every consumer's required install, whether or not they use it: arc-code-block reaches shiki, which is 13.6 MB, and it reached it for everyone.

  ```js
  barrelExclude: ['arc-code-block'],
  ```

  Excluded components are still generated and still verified — they are simply not re-exported from any barrel in any framework, so nothing reaches them unless a consumer imports them by name. Existing barrel entries are removed on the next full run, since the file is still on disk and nothing else would drop it. The names to remove come from the metas, not from the tag, so a component prism didn't see this run is left alone rather than removed on a guess.

## 2.9.0 — 2026-07-30

### Added

- **`@slot none` — a way to say a component takes no children.** Prism drops the `children` member only on positive evidence, because reading "no default slot found" as "no default slot exists" is what deleted content from 111 wrappers in 2.7.0. But that left no way to state the truth about a component whose file contains no `<slot>` at all: the wrapper kept a `children` prop that silently discards whatever is passed to it. In one real design system that was 66 of 185 components.

  `@slot none` in the class JSDoc is the author asserting it. Every wrapper then omits `children` — a type error at the call site instead of content vanishing at runtime.

  ```js
  /**
   * @tag arc-spinner
   * @slot none
   */
  ```

  `none` is reserved as the name of the absence and is never recorded as a slot. A rendered default `<slot>` still wins over the tag — a stale annotation must not delete content — and the contradiction is reported as `slot-none-contradicted`. The `children-without-default-slot` warning now names the annotation as the fix.

  One consequence in the Preact generator: a component with no props, no events and no children destructures nothing, and `({ , ...rest })` is a syntax error. Unreachable before this release, since `children` was always there to fill the list.

## 2.8.1 — 2026-07-30

### Fixed

- **A deleted component stopped being exported from the barrels.** Barrel updates were append-only by design — the right shape for watch and single-file mode, where the generator sees one meta and must not judge the rest of the barrel on that basis. The cost was that a removed component's export lines survived forever, pointing at a file the generators had stopped writing:

  ```
  error TS2307: Cannot find module './ToastManager.js'
  ```

  That breaks the build of whoever imports the barrel rather than prism's own, and only when someone typechecks the wrapper package — so it surfaced as a mysterious failure in a consuming repo long after the deletion. The barrels in one project had last been written eleven days before the components they described.

  `pruneBarrels` now runs on every full discovery pass and repairs them. Unlike `sweepOrphans` it is *not* gated behind `--prune`: an orphaned component file is untidy, but an unbuildable barrel is a bug.

  Decided by **resolution**, never by naming convention. The first version of this rebuilt the expected specifier set from the metas and deleted anything absent from it, which quietly stripped 136 working exports from a project whose web-component barrels point at `./accordion.register.js` — a filename this generator would never write, in a barrel it does not generate at all. Asking the filesystem cannot be wrong about that, and it needs no metas: a specifier either resolves or it does not.

  Two line shapes are handled. A component export names a file that must exist and is dropped whole when it does not, allowing for the fact that a barrel says `./Toast.js` for `Toast.ts`, Angular omits the extension, and a directory specifier means that directory's index. A barrel-to-barrel re-export (`from './feedback/index.js'`) resolves either way, so its *identifier list* is filtered against what the target still exports and the line only disappears once nothing survives — that is the shape a web-component root barrel uses, and nothing else can catch a name a tier barrel stopped exporting.

  Tier barrels are repaired before root barrels, so a root barrel sees them already correct. A prune that changes nothing writes nothing, and one that does trims to a single trailing newline like the append path, so it never shows up in a consumer's diff as whitespace.

## 2.8.0 — 2026-07-29

### Added

- **Every generated wrapper is verified against its component before the run ends.** Prism's checks all asked whether the *inputs* looked right — a union the CSS contradicts, a prop name a framework reserves. None asked whether the file on disk still carried what the component can receive, which is exactly how 2.7.0 shipped wrappers with the default slot deleted: the parser was wrong, the generators faithfully did as told, every unit test passed, and nothing compared the result to the component.

  `src/verify.js` reads each wrapper back and checks that a component with a default slot got an outlet for it, and that Svelte and Vue got one per named slot. React, Preact, Solid and Angular need no per-named-slot outlet — children are projected into the light DOM as-is and the browser does the slotting from the `slot` attribute. Deliberately the dumbest possible check: string matching against the file just produced, needing no framework toolchain and no consuming repo. Reported as `wrapper-missing-slot`, a `--strict` failure.

  This is the invariant arc-ui wrote as `check-wrapper-slots.js`. It is a generator-side property, so it belongs in the generator.

### Fixed

- **`slot-name-remapped` conflated two causes and misadvised one.** It reported every remapped slot as "not a valid identifier". True for `icon-left` → `iconLeft`; false for `eyebrow` → `eyebrow_`, where the name is a perfectly good identifier already taken by a prop of the same name — a deliberate pairing (prop for the string case, slot to override with markup) on 8 arc-ui components. The advice to "rename the slot to `eyebrow_`" would have put a trailing underscore in the public HTML API of six frameworks to satisfy one. `slotSnippetNames` already receives the props, so prism always knew which case it was in.

  Now two codes: `slot-name-not-identifier` (renaming is reasonable advice, still a `--strict` failure) and `slot-name-collides-with-prop` (informational, no action, not a strict failure).

- **An unknown `acknowledge` code no longer refuses to run.** Codes get added and split between releases, so throwing version-locked the config in both directions: a file valid for 2.7 made 2.6 refuse to start, which meant a rollback silently generated nothing and looked like the rollback hadn't helped. Being unable to bisect the generator is worse than tolerating an entry that does nothing. Unrecognised codes are dropped and reported as `unknown-acknowledge-code` — not a strict failure, so a rollback can run a config written for a newer release. A missing `code` is still fatal, and `unmatched-acknowledge` still can't be waived.

- **Dynamic slot names no longer invent phantom slots.** `arc-virtual-list` computes `name="item-${index}"` per row. The template scan recorded the literal text and the `@slot item-${index}` tag recorded the `item-` prefix left after the expression, so one dynamic family became two slots that don't exist. JSDoc has no grammar for this, so names containing an expression are now skipped rather than guessed at.

- **A documented slot no longer justifies dropping `children`.** `ComponentMeta` gains `slotsInMarkup` — the slots seen as real `<slot name>` tags, as opposed to known only from a `@slot` tag. Dropping children is gated on that stricter set. A `@slot header` tag proves a named slot exists; it says nothing about whether the default slot is rendered somewhere the parser never reads (a base class, a mixin, an imported helper), and that combination was the residual form of the 2.7.0 bug.

### Changed

- **Wrappers that accept `children` for an element with no default slot are now reported**, as `children-without-default-slot`. Deliberately reported rather than acted on: the only evidence prism has is that it found no `<slot>` in that file, and an inherited default slot looks identical from here. 2.7.0 acted on evidence this weak and deleted content from 90 wrappers, so this states the case and leaves the call to someone who can see the whole component. Not a strict failure.

## 2.7.1 — 2026-07-29

### Fixed

- **2.7.0 deleted the default slot from wrappers of 111 components.** A regression introduced by 2.7.0's own slot handling, and a runtime break rather than a typing one: any component whose only slot was the default rendered nothing at all. Svelte lost `{@render children?.()}`, Solid lost `{local.children}`, Preact lost `{children}`; React lost only the `children` type from 87 interfaces (`@lit/react` forwards children itself) but still broke TypeScript builds. Vue and Angular were unaffected, because `<slot>` and `<ng-content>` are passthrough.

  `extractTemplate` deliberately skips nested `` html`…` `` inside `${}` — it exists to produce HTML examples, not a complete slot inventory. So a default slot in a conditional branch (`${this.loading ? html`<spinner>` : html`<slot></slot>`}`), in a helper method, or behind an `open` guard never appears in `meta.template`. 2.7.0 read that absence as *"this component has no default slot"* and dropped children accordingly. Those are different claims. 2.7.0's `@slot` JSDoc support then made it fire widely, by populating the named-slot list from documentation while the default-slot check still consulted only the lossy template — so a documented component looked named-slots-only.

  Two independent fixes, either of which alone would have prevented the break:

  - **Slots are detected from the component source, not the extracted template.** The source contains every template in the file, including the branches extraction skips.
  - **Children are dropped only on positive evidence** — slots were found, and none was the default. Finding no slots is not evidence a component has none; it is equally consistent with having failed to look in the right place. Only one of those justifies removing anything, so neither does.

### Added

- **`test/slot-projection.test.js` — the invariant that was missing.** Every case starts from component *source* and runs parser and generator together, asserting that whatever a component can receive, every wrapper can pass. Nine real-world template shapes cover the ones extraction handles by luck: conditional branches, helper methods, local template variables, both arms of a ternary, `@slotchange` handlers, multiline templates.

  The tests that existed when 2.7.0 shipped all passed, because they built `meta` by hand with `hasDefaultSlot` set to whatever the assertion expected. They proved the generators did as they were told; nothing proved the parser was telling them the truth about real source. The bug lived in that seam, so the tests now live there too.

## 2.7.0 — 2026-07-29

### Fixed

- **camelCase props never reached the element.** 53 props across 35 components, silently. HTML attribute names are lowercased on the way into the DOM, so `confirmLabel` was written as `confirmlabel` — not an attribute Lit observes, so the property kept its constructor default and nothing warned. Measured on `arc-confirm`: `confirmLabel="Delete"` produced `confirmlabel="Delete"` in the DOM with `el.confirmLabel === 'Confirm'`. All-lowercase props were unaffected, which is why `open` and `heading` worked and made the failure look arbitrary.

  Fixed by setting the property, not by emitting kebab-case. Kebab-case would have been worse for the 19 Boolean props: Lit's Boolean converter is presence-based, so `auto-resize="false"` sets `autoResize` to **true** — turning a silent no-op into a silently inverted value on every boolean a consumer explicitly sets to false.

  - **Svelte** binds a ref and assigns the properties in an `$effect`, and those props are left out of the template so no dead attribute is emitted beside them. `undefined` is never written through, so a prop the consumer omits still resolves to the element's own default rather than being overwritten with nothing. One consequence worth knowing: `$effect` doesn't run during SSR, so these values are applied on hydration rather than being present in the server HTML — where previously they were present but wrong.
  - **Angular** binds them with `[confirmLabel]` instead of `[attr.confirmLabel]`; `setAttribute` lowercases, so the attribute form could never have worked. Reflected props still appear as attributes for CSS, because Lit reflects the property itself.
  - **Solid** uses its `prop:` namespace, which sets a property rather than an attribute.
  - React is unaffected — `@lit/react`'s `createComponent` sets properties from the element class. Vue and Preact both resolve `key in el` against the original casing and appear unaffected; neither was changed.

- **Wrappers accepted children for elements with no default slot.** `arc-confirm` declared `children` and rendered them into an element that discards them, so the content vanished. All six wrappers now omit the children member when the component has no default `<slot>`, making it a type error instead of a silent no-op. The absence is only trusted when a template was actually parsed — an unextractable `render()` yields an empty template that would otherwise look identical to "no slots" and strip children from wrappers that need them.

- **`@slot` JSDoc tags are read alongside the template.** Slot detection scanned the extracted template, which misses components whose `render()` can't be parsed. Documented `@slot start` tags are now unioned in, so a slot has to be invisible to both sources to be missed. A bare `@slot - description` documents the default slot and adds no named one.

- **Named-slot content was silently dropped by the Svelte wrappers.** `arc-toolbar` and `arc-status-bar` lost every `slot="start"` and `slot="end"` child: only the unslotted content survived, so transport controls, position readouts and loop-integrity pips all rendered nowhere. Build clean, typecheck clean, no warning.

  Svelte routes `slot="start"` on a **component's** child to a snippet prop of that name. The generated wrapper rendered only `{@render children?.()}` and declared no such prop, so the content had nowhere to go. Used against the custom element directly it works, because Svelte doesn't intercept `slot` on a plain element — the wrapper layer was what broke it.

  `ComponentMeta` now carries `slots` and `hasDefaultSlot`. Nothing recorded them before: `html.js` strips `<slot name="…">` at generation time and the parser never looked, so no generator could have known named slots existed. The Svelte wrapper declares a `Snippet` prop per named slot and renders each one; the Vue wrapper forwards `<slot name="…" />` alongside the default, closing the narrower version of the same gap (`<template #start>` was dropped there, while a `<div slot="start">` child happened to work because Vue 3 removed `slot` as syntax). React, Preact, Solid and Angular were never affected.

  **No carrier element is added.** Wrapping projected content in a `display:contents` node would guarantee slot targeting but sit between the shadow slot and the content, breaking `::slotted()` rules and any layout the slot applies to its children. The trade is that the `slot` attribute must be on your own element, inside the snippet — see the README. In that position it's ordinary markup and survives regardless of how Svelte handles the attribute on a slotted child.

  Slot names that aren't valid identifiers can't be snippet props, so `slot="icon-left"` is exposed as `iconLeft`, and every remapped name is reported (`slot-name-remapped`, a `--strict` failure) rather than left to be discovered — `{#snippet iconLeft()}` reaches it, `slot="icon-left"` on a direct child does not, because Svelte derives the prop name from the attribute verbatim.

## 2.6.0 — 2026-07-29

### Added

- **`config.acknowledge` — findings you've already decided about.** `--strict` shipped in 2.5.0 unadoptable, and prism's own advice was the reason. For `arc-column.key` it recommends adding an alias rather than renaming, precisely so the five frameworks where `key` works today keep working. Do that and the finding stays true forever — React still eats the prop — with no way to record the decision. Following the recommendation left a permanent finding, so `--strict` could never pass, which left it useful only for repos with nothing to report: the opposite of what it was built for. Its own rationale ("a check that can never pass gets deleted") applied to itself.

  An entry is `{ code, tag?, prop?, note? }`. Every field stated must match and omitted fields are wildcards, so `{ code, tag, prop }` waives one finding and `{ code }` waives a class. Malformed entries throw at config load, on the same terms as `interactivity` and `bindings`.

  Two deliberate properties. Waived findings **still print**, under a `prism: accepted:` heading with the note attached — an allowlist that makes output vanish is how a real regression ends up sheltering behind an old decision. And an entry matching **nothing** is itself a strict failure, because otherwise the list rots: entries outlive the findings they describe and quietly pre-waive whatever next appears under the same key. That code, `unmatched-acknowledge`, is the one thing that can't itself be acknowledged.

- **`--report-json <path>` — findings as data.** 2.5.0 moved findings into labelled groups whose headers contain no fixed keyword, which silently broke a downstream filter that had matched on the word "warning" since 2.4.0. The reserved-prop finding went unseen on the first 2.5.0 run — the exact failure the reporting work existed to prevent, reintroduced by the reporting work.

  Two fixes. Every heading now carries a literal `prism: warning:` (or `prism: accepted:`) prefix, so grep has something stable to match. And for anything automated, `--report-json` writes the findings as structured data — `code` is the contract, `message` is prose and will keep being reworded. A failed report write never fails the generate run.

### Fixed

- **The documented-type length limit is no longer a silent, undocumented cliff.** `MAX_DOC_TYPE` was 200 characters and the rejection said only "can't emit safely", so a 209-character `menubar.items` shape degraded to `Array` with no indication that length was the cause — findable only by reading `parser.js`. The limit is now 500, since a legitimate three-level nested menu shape is ~180 and 200 was tight for exactly the props this feature exists to serve, and the diagnostic states the actual length and the limit. The unsafe-character rejection likewise names the characters it objected to, and both carry a structured `reason`.

- **The unimportable-type diagnostic now says what to do.** It reported that prism couldn't import the symbol without noting that generated wrappers take no imports at all, making "inline the shape" always the answer. It now says so, with an example.

## 2.5.0 — 2026-07-29

### Fixed

- **The CSS enum fallback omitted the default too.** 2.4.0 fixed this for documented unions but left the same defect live on the fallback path, because it is the same CSS scan: the default member is the unqualified base style and so has no `:host([x="…"])` rule to be inferred from. `tag`, `checkbox`, `select` and `toggle` all default `size` to `md` and were typed `'sm' | 'lg'`, along with `radio-group.size`, `container.padding`, `diff.mode`, `footer.align`, `link.underline` and `sidebar.position` — 10 props whose default value did not type-check against their own component.

  Prism already had what it needed: `applyDefaults` reads the default from the constructor. When the CSS scan finds values and the default is a non-empty string literal that isn't among them, it is unioned in. A prop's own default is by construction a legal value, so this cannot be wrong, and it's appended rather than prepended so a prop whose default the CSS already styles is unchanged. Computed and empty-string defaults are ignored, and a default alone never invents a union — one legal value is not an enum.

  The same comparison now runs against documented unions: a union that omits the component's own default is reported as drift.

- **Props whose name a framework reserves are now reported.** `arc-column` declares `key`. That is not a JavaScript keyword, so 2.4.0's fix doesn't apply — but React and Preact intercept `key` in the reconciler, so `<Column key="name" label="Name" />` sets the list key and the component never receives the prop. No syntax error, no type error, no warning: the column just renders nothing. And `key=` is exactly what a developer writes by reflex on a component that renders in a list, which makes the collision close to certain rather than hypothetical.

  Prism cannot fix this in the wrapper — the value is taken before the component function is called, so no generated code can recover it — and it doesn't pretend otherwise. It reports the collision, names the frameworks that *do* still receive the prop, and points at an alias rather than a rename: the prop works today in plain HTML and in every framework absent from the warning, so renaming it would break the working consumers to fix the broken ones, while a second name the component falls back to (`col.field ?? col.key`) breaks nobody. Checked per framework and only for frameworks actually being generated: `key`, `ref`, `children`, `className` and `dangerouslySetInnerHTML` for React, the same minus `className` for Preact, and `children` for Svelte and Solid, whose generators inject their own. Vue and Angular reserve nothing. It's a `--strict` failure.

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
