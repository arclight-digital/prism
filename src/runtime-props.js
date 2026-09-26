/**
 * Resolve a component's properties from the class itself, by importing it.
 *
 * Everything else in prism reads source text, which needs no toolchain and
 * executes nothing — but a property contributed by a mixin or a base class is
 * not in the file that declares the component, and no amount of source reading
 * finds it. `Ctor.elementProperties` is Lit's own flattened map of every
 * reactive property the class has, mixins and superclasses included, with the
 * declared type, reflect flag, attribute name and `state` marker.
 *
 * Opt-in (`config.runtime`), because importing a module runs it and prism
 * otherwise executes none of a consumer's code. It degrades rather than fails:
 * a module that throws on import costs that one component its runtime answer
 * and nothing else.
 *
 * Defaults, documented `@prop` unions and CSS-inferred enums still come from
 * source and apply on top — the class knows what a property *is*, the file
 * knows what the author said about it.
 */

import { pathToFileURL } from 'node:url';
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isPublicMethod } from './parser.js';

/** Property names prism can emit into a wrapper — same rule as the parser's. */
const VALID_PROP_NAME = /^[A-Za-z_$][\w$]*$/;

/** The `type` values prism knows how to render. */
const KNOWN_TYPES = new Set(['String', 'Boolean', 'Number', 'Array', 'Object']);

/**
 * Make importing a component module survivable.
 *
 * `customElements.define` throws on a duplicate tag, and prism hits duplicates
 * routinely — watch mode re-imports edited files, and two files can name the
 * same tag. The registry here keeps the first definition and ignores the rest;
 * prism reads the class it imported, never the one the registry holds.
 *
 * `HTMLElement` is not installed here — see `installElementFallback`.
 */
function installGlobals() {
  if (!globalThis.customElements) {
    const defined = new Map();
    globalThis.customElements = {
      define(name, ctor) { defined.set(name, ctor); },
      get(name) { return defined.get(name); },
      getName(ctor) {
        for (const [name, c] of defined) if (c === ctor) return name;
        return null;
      },
      whenDefined() { return Promise.resolve(); },
      upgrade() {},
    };
  }

  tolerateDuplicateDefines();
}

/**
 * Let the consumer's own Lit bind to its own DOM shim, then install a bare
 * `HTMLElement` for anything else that extends it at import time.
 *
 * Order is the whole point. Lit's node build declares `class ReactiveElement
 * extends (globalThis.HTMLElement ?? shim)` once, when it loads — so a bare
 * fallback installed first becomes every component's platform base, with no
 * `attachInternals`, `attachShadow` or attributes. Reading `elementProperties`
 * never noticed; constructing a form control, whose mixin attaches internals in
 * its constructor, fails on every one. Lit is resolved from a component's own
 * location, since that is the copy its imports will load.
 *
 * Best effort: a catalog that is not built on Lit, or resolves it somewhere
 * else, just gets the fallback, which is what every run had before.
 */
async function installElementFallback(files) {
  if (!globalThis.HTMLElement && files.length > 0) {
    try {
      await import(pathToFileURL(createRequire(files[0]).resolve('lit')).href);
    } catch { /* no Lit reachable from here; the fallback below is all there is */ }
  }
  globalThis.HTMLElement ??= class HTMLElement {};
}

/**
 * Make `customElements.define` survive a repeated tag. Wrapping rather than
 * replacing, because the registry may not be ours — Lit installs its own, and
 * `config.runtime.setup` may install a fuller one still; whatever it is keeps
 * every behaviour except throwing on a repeat. Idempotent, so it can run again
 * after a setup module has had its turn at the global.
 */
function tolerateDuplicateDefines() {
  const registry = globalThis.customElements;
  if (!registry || registry.__prismTolerant) return;
  const define = registry.define?.bind(registry);
  if (!define) return;
  registry.define = (name, ctor, options) => {
    try {
      define(name, ctor, options);
    } catch {
      // Already registered under that name. Prism reads the class it imported,
      // never the one the registry holds, so nothing downstream depends on
      // which definition won.
    }
  };
  registry.__prismTolerant = true;
}

/** Lit's `PropertyDeclaration.type` is a constructor; prism wants its name. */
function typeName(type) {
  const name = typeof type === 'function' ? type.name : undefined;
  return KNOWN_TYPES.has(name) ? name : 'String';
}

/**
 * The attribute a property is reachable from, as Lit itself resolved it —
 * `false` for none, an explicit string, or the lowercased name.
 */
function attributeOf(name, declaration) {
  const attribute = declaration?.attribute;
  if (attribute === false) return null;
  if (typeof attribute === 'string') return attribute;
  return name.toLowerCase();
}

/**
 * Where the component's own prototype chain stops and the framework's begins,
 * for the bases whose names survive.
 *
 * `HTMLElement` is a platform global and keeps its name in every build; the
 * shim installed above is named to match. Lit's own classes are the ones that
 * do not — see `isFrameworkBase`.
 */
const ELEMENT_BASES = new Set(['HTMLElement', 'EventTarget']);

/**
 * What a `ReactiveElement` prototype owns, whatever it has been renamed to.
 *
 * A name test for `LitElement` and `ReactiveElement` is a test that passes in
 * development and fails in production. The build a plain `import()` resolves is
 * minified — `LitElement.name` is `"i"` and `ReactiveElement.name` is `"g"` —
 * so a name test never matched, the walk ran straight through the framework's
 * own prototype, and every component in a catalog came back driven by
 * `enableUpdating()` and `C()`: the two members of `ReactiveElement` that a
 * suffix rule and an underscore rule cannot filter, one of them a mangled
 * private. It stopped at `HTMLElement` only because *that* name survives.
 *
 * Shape survives minification, and these three are the interface a
 * `ReactiveElement` is: nothing else in a component's chain owns all of them.
 */
const REACTIVE_ELEMENT = ['requestUpdate', 'performUpdate', 'createRenderRoot'];

/** Whether this prototype is the framework's rather than the component's. */
function isFrameworkBase(proto) {
  if (ELEMENT_BASES.has(proto.constructor?.name)) return true;
  return REACTIVE_ELEMENT.every((name) => Object.hasOwn(proto, name));
}

/**
 * The public methods of a class, its mixins included.
 *
 * `checkValidity()` and `reportValidity()` are declared once, in a form-control
 * mixin, and are real methods of 26 elements whose own files never mention
 * them — the same shape as the `readonly` property that motivated reading the
 * class in the first place. Accessors are skipped: a getter/setter pair is a
 * property, and the generated prop binding already carries it.
 *
 * Answers `null` rather than a partial list when the walk reaches the end of
 * the chain without recognizing a framework base. That means the shape this
 * relies on has changed, and the honest answer is then no answer: the caller
 * falls back to what the component's own source says, which is what prism read
 * before this existed. A list assembled past the boundary is not a smaller
 * answer, it is a wrong one — and it is wrong in the direction that looks like
 * thoroughness, since a handle on every component reads as a check passing
 * harder rather than failing.
 *
 * @param {Function} Ctor
 * @returns {string[]|null}
 */
function readMethods(Ctor) {
  const names = [];
  let proto = Ctor.prototype;
  // `Object.prototype` is the end of the chain, not a base worth recognizing:
  // reaching it means the framework's own prototype was never identified, and
  // everything collected on the way is suspect rather than complete.
  while (proto && proto !== Object.prototype) {
    if (isFrameworkBase(proto)) return names;
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (names.includes(name) || !isPublicMethod(name)) continue;
      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(proto, name);
      } catch { continue; }
      if (typeof descriptor?.value === 'function') names.push(name);
    }
    proto = Object.getPrototypeOf(proto);
  }
  return null;
}

/**
 * Read one class, if it is one prism can read.
 *
 * Touching `observedAttributes` is what forces Lit to finalize the class and
 * build `elementProperties` — a class that has never been constructed or
 * registered may not have done it yet. Wrapped because a class that is not a
 * ReactiveElement can throw from that getter, and "not a component" is an
 * ordinary answer here, not an error.
 *
 * @returns {{ props: import('./parser.js').PropMeta[], formAssociated: boolean,
 *   methods: string[] }|null}
 */
function readClass(Ctor) {
  let declarations;
  try {
    void Ctor.observedAttributes;
    declarations = Ctor.elementProperties;
  } catch {
    return null;
  }
  if (!(declarations instanceof Map)) return null;

  const props = [];
  for (const [name, declaration] of declarations) {
    // Symbol-keyed properties have no attribute and no name a wrapper could
    // carry; `state: true` is internal and was never public API.
    if (typeof name !== 'string' || !VALID_PROP_NAME.test(name)) continue;
    if (declaration?.state === true) continue;
    props.push({
      name,
      type: typeName(declaration?.type),
      // Filled by the parser: from the instance below where it has an answer,
      // from the constructor's source where it does not.
      default: '',
      reflect: declaration?.reflect === true,
      values: [],
      docType: '',
      attribute: attributeOf(name, declaration),
    });
  }

  return {
    props,
    formAssociated: Ctor.formAssociated === true,
    methods: readMethods(Ctor),
    defaults: readInitialValues(Ctor, props.map((p) => p.name)),
  };
}

/**
 * Far enough to move every calendar field at once — year, month, day, hour,
 * minute, second — so a default computed from any of them differs.
 */
const CLOCK_SHIFT_MS = ((400 * 24 + 7) * 60 + 13) * 60_000 + 17_000;

/**
 * What each reactive property starts as on a fresh instance.
 *
 * A default declared anywhere but a constructor assignment — a class field, a
 * mixin constructor seeding its declared vocabulary, a base class — is on the
 * instance and in no file the source reader is handed. Constructing one is the
 * only reading that sees all of them. Lit defers the first update until the
 * element connects, so construction runs the constructors and nothing else.
 *
 * A wrapper that destructures a default passes it to the element explicitly,
 * so a default that is only true *now* — the current month, a random id — would
 * be frozen into the wrapper at generation time. The class is constructed twice,
 * the second time with the clock moved; a value that differs is left out and
 * named, and the element keeps computing its own.
 *
 * @returns {{ values: Map<string, string>, unstable: string[] }|null} source
 *   spellings, the form every other default in prism takes; null when the
 *   class could not be constructed
 */
function readInitialValues(Ctor, names) {
  const first = construct(Ctor);
  if (!first) return null;
  const second = withShiftedClock(() => construct(Ctor));
  if (!second) return null;

  const values = new Map();
  const unstable = [];
  for (const name of names) {
    let a, b;
    try {
      a = spellValue(first[name]);
      b = spellValue(second[name]);
    } catch {
      continue;
    }
    if (a !== b) unstable.push(name);
    else if (a !== undefined) values.set(name, a);
  }
  return { values, unstable };
}

/**
 * `new Ctor()`, without letting a constructor's timer hold the process open —
 * prism ends by running out of work, and a pending interval never lets it.
 */
function construct(Ctor) {
  const { setTimeout: realTimeout, setInterval: realInterval } = globalThis;
  const timers = [];
  globalThis.setTimeout = (...args) => { const t = realTimeout(...args); timers.push(t); return t; };
  globalThis.setInterval = (...args) => { const t = realInterval(...args); timers.push(t); return t; };
  try {
    return new Ctor();
  } catch {
    return null;
  } finally {
    globalThis.setTimeout = realTimeout;
    globalThis.setInterval = realInterval;
    for (const t of timers) globalThis.clearTimeout(t);
  }
}

function withShiftedClock(fn) {
  const RealDate = globalThis.Date;
  class ShiftedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + CLOCK_SHIFT_MS);
      else super(...args);
    }
    static now() { return RealDate.now() + CLOCK_SHIFT_MS; }
  }
  globalThis.Date = ShiftedDate;
  try {
    return fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

/**
 * A value as source would spell it, or undefined for one a wrapper cannot
 * carry. `null` and `undefined` are absences rather than defaults, and anything
 * that is not plain data — a Date, a Map, a function — has no literal a wrapper
 * could emit that means the same thing.
 */
function spellValue(value) {
  switch (typeof value) {
    case 'string':
      // Single-quoted, the spelling the source reader and typedDefault expect.
      return `'${JSON.stringify(value).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'")}'`;
    case 'number':
      // `Infinity` is a literal a wrapper can carry ("no limit"); NaN is not.
      return Number.isNaN(value) ? undefined : String(value);
    case 'boolean':
      return String(value);
    case 'object':
      return value !== null && isPlainData(value) ? JSON.stringify(value) : undefined;
    default:
      return undefined;
  }
}

function isPlainData(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isPlainData);
  if (typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(value).every(isPlainData);
}

/**
 * Import one component module and read every component class it exports.
 *
 * Keyed by export name so the parser can ask for the class it found in the
 * source, rather than this having to guess which of several exports is the
 * component.
 *
 * @param {string} filePath
 * @returns {Promise<{ classes: Map<string, object> }|{ error: string }>}
 */
async function loadModule(filePath, { bust = false } = {}) {
  // Not cache-busted by default, and that is load-bearing. A query string makes
  // Node treat the URL as a new module, but only for the import that carries
  // it: `modal.js?v=1` still resolves its own `import './dialog.js'` to the
  // plain cached module, so the busted module's base class is a *different
  // object*, ancestry stops matching by identity, and a subclass loses its
  // inherited events and slots. Busting is only for the watcher, where a stale
  // class is the worse problem and the ancestry link is carried forward.
  let stamp = '';
  if (bust) {
    try {
      stamp = `?prism=${statSync(filePath).mtimeMs}`;
    } catch { /* a file that vanished mid-run fails at the import below */ }
  }

  let mod;
  try {
    mod = await import(`${pathToFileURL(filePath).href}${stamp}`);
  } catch (err) {
    return { error: err.message.split('\n')[0] };
  }

  const classes = new Map();
  for (const [name, value] of Object.entries(mod)) {
    if (typeof value !== 'function') continue;
    const read = readClass(value);
    // The constructor is kept so ancestry can be resolved across files once
    // every module has been read — see `linkAncestry`.
    if (read) classes.set(name, { ...read, ctor: value });
  }
  return { classes };
}

/**
 * Record, for each component class, the nearest ancestor that is also a
 * component in this catalog.
 *
 * `elementProperties` flattens inherited *properties*; events, slots, template
 * and styles do not flatten, because they live in the base class's source file.
 * The link recorded here is what lets the CLI inherit those from the ancestor's
 * own parse (see inherit.js). Identity is the constructor object itself — the
 * value the subclass's prototype chain points at — so this cannot be wrong
 * about which class is which, whatever the files are named.
 */
function linkAncestry(resolved) {
  const owner = new Map();
  for (const [file, { classes }] of resolved) {
    for (const [exportName, entry] of classes) {
      if (!owner.has(entry.ctor)) owner.set(entry.ctor, { file, exportName });
    }
  }

  for (const [, { classes }] of resolved) {
    for (const entry of classes.values()) {
      let proto = Object.getPrototypeOf(entry.ctor);
      while (typeof proto === 'function') {
        const found = owner.get(proto);
        if (found) { entry.inheritsFrom = found; break; }
        proto = Object.getPrototypeOf(proto);
      }
      // The constructor has done its job; dropping it keeps a live class object
      // out of the meta the rest of the run passes around.
      delete entry.ctor;
    }
  }
}

/**
 * Resolve runtime property information for a set of component files.
 *
 * Sequential on purpose: these imports have side effects (element registration,
 * shared globals), and over a few hundred local files the ordering guarantee is
 * worth more than the wall-clock difference.
 *
 * @param {string[]} files
 * @param {object} runtimeConfig - the normalized `config.runtime` section
 * @param {(code: string, message: string, extra?: object) => void} warn
 * @param {{ bust?: boolean }} [opts] - re-import past Node's module cache. Only
 *   the watcher wants this; see `loadModule` for what it costs.
 * @returns {Promise<Map<string, { classes: Map<string, object> }>>} keyed by file
 */
export async function resolveRuntimeProps(files, runtimeConfig, warn, opts = {}) {
  installGlobals();

  // A project needing more DOM than Lit's shim provides points at a module that
  // installs one (`@lit-labs/ssr`'s global shim, or its own). Imported once,
  // before anything else; a failure here is fatal to the whole runtime pass
  // rather than to each file in turn — every component would fail identically,
  // and hundreds of identical findings describe one problem.
  if (runtimeConfig.setup) {
    try {
      await import(pathToFileURL(runtimeConfig.setup).href);
    } catch (err) {
      warn(
        'runtime-unavailable',
        `config.runtime.setup could not be imported (${runtimeConfig.setup}): ${err.message.split('\n')[0]} — ` +
        'no component was resolved at runtime this run, and prism read every declaration from source instead.'
      );
      return new Map();
    }
    // A DOM shim will have installed its own registry over the top of ours, and
    // a real one throws on a duplicate define. Re-wrap whatever is there now.
    tolerateDuplicateDefines();
  }

  // After setup, so a DOM it installed is the one Lit binds to.
  await installElementFallback(files);

  const resolved = new Map();
  for (const filePath of files) {
    const result = await loadModule(filePath, opts);
    if (result.error) {
      // One file's failure costs that file its runtime answer and nothing more.
      // The source reader is still a usable account of the component, so this
      // reports a degraded result rather than a broken run.
      warn(
        'runtime-unavailable',
        `${filePath} could not be imported: ${result.error} — its properties were read from source instead, ` +
        'so any contributed by a mixin or a base class are missing from its wrappers.',
        { file: filePath }
      );
      continue;
    }
    resolved.set(filePath, result);
  }

  linkAncestry(resolved);
  return resolved;
}
