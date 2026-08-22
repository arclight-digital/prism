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
 * `HTMLElement` is a fallback only — Lit 3 carries its own DOM shim — and is
 * installed with `??=` so a real DOM, or a shim from `config.runtime.setup`,
 * always wins.
 */
function installGlobals() {
  globalThis.HTMLElement ??= class HTMLElement {};

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
 * Where the component's own prototype chain stops and the platform's begins.
 * A mixin between the two is the whole point — its class is neither of these,
 * so its methods are read like the component's own.
 */
const ELEMENT_BASES = new Set([
  'LitElement', 'ReactiveElement', 'HTMLElement', 'EventTarget', 'Object',
]);

/**
 * The public methods of a class, its mixins included.
 *
 * `checkValidity()` and `reportValidity()` are declared once, in a form-control
 * mixin, and are real methods of 27 elements whose own files never mention
 * them — the same shape as the `readonly` property that motivated reading the
 * class in the first place. Accessors are skipped: a getter/setter pair is a
 * property, and the generated prop binding already carries it.
 *
 * @param {Function} Ctor
 * @returns {string[]}
 */
function readMethods(Ctor) {
  const names = [];
  let proto = Ctor.prototype;
  while (proto && proto !== Object.prototype) {
    if (ELEMENT_BASES.has(proto.constructor?.name)) break;
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
  return names;
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
      // Left for the source pass: the class knows the property exists and what
      // it is, the constructor knows what it starts as, and the JSDoc knows what
      // the author meant. Only the first of those is readable from here.
      default: '',
      reflect: declaration?.reflect === true,
      values: [],
      docType: '',
      attribute: attributeOf(name, declaration),
    });
  }

  return { props, formAssociated: Ctor.formAssociated === true, methods: readMethods(Ctor) };
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
