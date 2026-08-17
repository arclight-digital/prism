/**
 * Resolve a component's properties from the class itself, by importing it.
 *
 * Everything else in prism reads source text. That is the right default — it
 * needs no toolchain, executes nothing, and is why prism can be pointed at a
 * repo it has never seen. It also has one blind spot it cannot reason its way
 * out of: **a property contributed by a mixin or a base class is not in the file
 * that declares the component.**
 *
 *   class ArcInput extends FormControlMixin(LitElement) { … }
 *
 * `readonly`, `required` and `name` are real reactive properties of that
 * element, and no amount of reading `input.js` will find them. In the reference
 * consumer that was 16 properties from one mixin, absent from **all six
 * framework wrappers of 25 form controls** — settable on the element and in
 * plain HTML, unreachable from React or Angular, and invisible for two releases.
 * `config.propsFrom` could paper over it only by re-implementing the mixin's
 * contribution in a second place, which is a second thing to keep in step.
 *
 * Lit already computes the answer. `Ctor.elementProperties` is the flattened map
 * of every reactive property the class has, mixins and superclasses included,
 * with the declared type, the reflect flag, the attribute name and the internal
 * `state` marker — built by Lit itself, at the moment the class is finalized. It
 * cannot disagree with the component, because it *is* the component.
 *
 * ── Why this is opt-in ──
 *
 * Reading it means importing the module, and importing a module runs it. Prism
 * has never executed a line of a consumer's code, and turning that on silently
 * in a minor would be a change of kind, not degree. So it is `config.runtime`,
 * off unless asked for, and it degrades rather than fails: a module that throws
 * on import costs that one component its runtime answer and nothing else.
 *
 * ── What it does not answer ──
 *
 * Defaults, documented `@prop` unions and CSS-inferred enums still come from the
 * source, and still apply on top. The class knows what a property *is*; the file
 * knows what the author said about it. Both are needed, and neither is a
 * substitute for the other.
 */

import { pathToFileURL } from 'node:url';
import { statSync } from 'node:fs';

/** Property names prism can emit into a wrapper — same rule as the parser's. */
const VALID_PROP_NAME = /^[A-Za-z_$][\w$]*$/;

/** The `type` values prism knows how to render. */
const KNOWN_TYPES = new Set(['String', 'Boolean', 'Number', 'Array', 'Object']);

/**
 * Make importing a component module survivable.
 *
 * One thing here is not optional. `customElements.define` throws on a duplicate
 * tag, exactly as it does in a browser, and prism hits duplicates as a matter of
 * course: watch mode re-imports an edited file, and two files in a catalog can
 * name the same tag. A registry that keeps the first definition and ignores the
 * rest turns a fatal into a no-op, and prism never needs the registry's contents
 * — it reads the class it imported, not the one the registry holds.
 *
 * `HTMLElement` is a fallback and nothing more. Lit 3 carries its own DOM shim
 * and keeps using it, so this is only reached by a component that extends
 * `HTMLElement` directly. Installed with `??=` so a real DOM, or a shim the
 * project installed itself through `config.runtime.setup`, always wins.
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
 * Make `customElements.define` survive being called twice with the same tag.
 *
 * Wrapping rather than replacing, because the registry may not be ours: Lit
 * installs its own the moment a component is imported, and a project's
 * `config.runtime.setup` may install a fuller one still. Whatever it is keeps
 * every behaviour except throwing on a repeat, which is the one prism cannot
 * live with — a watch rebuild re-imports an edited file, and two files in a
 * catalog can name the same tag.
 *
 * Idempotent, so it can be called again after a setup module has had its turn
 * at the global.
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
 * Read one class, if it is one prism can read.
 *
 * Touching `observedAttributes` is what forces Lit to finalize the class and
 * build `elementProperties` — a class that has never been constructed or
 * registered may not have done it yet. Wrapped because a class that is not a
 * ReactiveElement can throw from that getter, and "not a component" is an
 * ordinary answer here, not an error.
 *
 * @returns {{ props: import('./parser.js').PropMeta[], formAssociated: boolean }|null}
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

  return { props, formAssociated: Ctor.formAssociated === true };
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
async function loadModule(filePath) {
  // Cache-busted by mtime. Node caches modules for the life of the process, so
  // without this a watch-mode rebuild would keep reading the class as it was
  // when the watcher started — reporting confidently on a file it can no longer
  // see. The query is inert to everything except the module cache.
  let stamp = '';
  try {
    stamp = `?prism=${statSync(filePath).mtimeMs}`;
  } catch { /* a file that vanished mid-run fails at the import below */ }

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
    if (read) classes.set(name, read);
  }
  return { classes };
}

/**
 * Resolve runtime property information for a set of component files.
 *
 * Sequential rather than concurrent on purpose: these are ES module imports
 * with side effects — they register custom elements and can touch shared
 * globals — and a catalog is a few hundred already-resolved local files, so the
 * wall-clock difference is small and the ordering guarantee is worth more.
 *
 * @param {string[]} files
 * @param {object} runtimeConfig - the normalized `config.runtime` section
 * @param {(code: string, message: string, extra?: object) => void} warn
 * @returns {Promise<Map<string, { classes: Map<string, object> }>>} keyed by file
 */
export async function resolveRuntimeProps(files, runtimeConfig, warn) {
  installGlobals();

  // A project whose components need more of a DOM than Lit's own shim provides
  // points at a module that installs one — `@lit-labs/ssr`'s global shim, or
  // its own. Imported once, before anything else, and a failure here is fatal
  // to the runtime pass rather than to each file in turn: every component would
  // fail the same way, and 200 identical findings describe one problem.
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
    const result = await loadModule(filePath);
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
  return resolved;
}
