/**
 * What a form binds to when it binds to one of these elements.
 *
 * Angular's `formControlName`, `formControl` and `ngModel` all reach a
 * component through `ControlValueAccessor`, and a wrapper without one doesn't
 * fail — it binds nothing and reports nothing. The decision lives here rather
 * than in the Angular generator because the CLI needs the same answer to
 * report the components it could not wire, and a check that re-derives it
 * independently can agree with itself while disagreeing with what was emitted.
 */

import { tsType, typedDefault } from './types.js';

/**
 * The property a form binds to, when nothing says otherwise.
 *
 * `checked` first: a checkbox and a toggle both declare `value` *and* `checked`,
 * and the one a form binds is the second. Reading it from what the component
 * declares rather than from a table of tag names means a 28th control is covered
 * by writing it.
 */
const DEFAULT_VALUE_PROPS = ['checked', 'value'];

/**
 * The value a form reset writes into the element, as source text.
 *
 * Angular calls `writeValue(null)` on reset routinely, and the value has to be
 * one the declared type admits or the wrapper package stops compiling — `''`
 * is not a member of `'sm' | 'md' | 'lg'`, so a union uses the element's own
 * default. Returns null when the type admits no nameable empty value (an
 * object shape with no default); the caller then emits a reset that leaves the
 * element alone rather than one that doesn't compile.
 */
function emptyValue(prop) {
  const type = tsType(prop);
  const declaredDefault = typedDefault(prop);

  if (prop.values?.length > 0) return declaredDefault ?? `'${prop.values[0]}'`;
  if (/\[\]$|^(?:Readonly)?Array\s*</.test(type)) return '[]';
  if (type === 'boolean') return 'false';
  if (type === 'number') return '0';
  if (type === 'string') return "''";
  // A documented object shape. `{}` satisfies `Record<string, unknown>` and
  // almost nothing else, so anything more specific falls back to the default.
  if (type.startsWith('Record<')) return '{}';
  return declaredDefault ?? null;
}

/**
 * The event after which the element's value is worth reading back.
 *
 * The accessor reads the live DOM property, not the event's `detail`, so all
 * this event must do is fire *after* the element has updated itself. A control
 * firing both `arc-input` and `arc-change` commits on the second — binding the
 * first would mark a form dirty on every keystroke.
 */
function commitEvent(meta, prefix) {
  const conventional = `${prefix}-change`;
  if (meta.events.includes(conventional)) return conventional;

  const change = meta.events.find((e) => e.endsWith('-change'));
  if (change) return change;

  // Nothing named like a change event. Fall back to any event that carries a
  // bound property in its detail — that key *is* the element's write-back path,
  // the same convention two-way bindings are derived from.
  const names = new Set(meta.props.map((p) => p.name));
  for (const [event, keys] of Object.entries(meta.eventDetails ?? {})) {
    if (keys.some((k) => names.has(k))) return event;
  }
  return null;
}

/**
 * Decide how a form binds to this component.
 *
 * @param {import('../parser.js').ComponentMeta} meta
 * @param {object} [config] - a framework config section, for `prefix` and
 *   `formValue` overrides
 * @returns {null | {
 *   parts: Array<{ name: string, type: string, empty: string|null }>,
 *   composite: boolean,
 *   type: string,
 *   empty: string|null,
 *   event: string,
 *   disabled: boolean,
 * } | { problem: string }} null when the component is not form-associated at
 *   all — the ordinary case, and not a finding.
 */
export function formBinding(meta, config = {}) {
  if (!meta.formAssociated) return null;

  const declared = new Map(meta.props.map((p) => [p.name, p]));
  const configured = config.formValue?.[meta.tag];
  const names = configured === undefined
    ? DEFAULT_VALUE_PROPS.filter((n) => declared.has(n)).slice(0, 1)
    : [configured].flat();

  if (names.length === 0) {
    return {
      problem:
        `${meta.tag} is form-associated but declares neither "value" nor "checked", so prism cannot ` +
        'tell what a form should read and write on it. Name the property with ' +
        `config.formValue: { '${meta.tag}': 'someProp' }, or a pair of them for a control whose value ` +
        'is compound.',
    };
  }

  const missing = names.filter((n) => !declared.has(n));
  if (missing.length > 0) {
    return {
      problem:
        `config.formValue names ${missing.map((n) => `"${n}"`).join(', ')} for ${meta.tag}, which ` +
        'declares no such property — the accessor would write to nothing. Wrappers for this ' +
        'component are generated without one.',
    };
  }

  const event = commitEvent(meta, config.prefix ?? 'arc');
  if (!event) {
    return {
      problem:
        `${meta.tag} is form-associated but dispatches no event a form could commit on, so a bound ` +
        'control would never see the user\'s edits. Dispatch a `' + `${config.prefix ?? 'arc'}-change` +
        '` event when the value settles.',
    };
  }

  const parts = names.map((name) => {
    const prop = declared.get(name);
    return { name, type: tsType(prop), empty: emptyValue(prop) };
  });

  // A ControlValueAccessor carries exactly one value, and some controls bind
  // two properties (start/end, low/high) with no single `value` between them —
  // so the accessor carries an object, which is what a reactive form holds for
  // a compound value anyway. (A FormGroup with a control per @Input is the
  // better shape for validating the two ends separately, and works without any
  // of this — but cannot be reached from `[(ngModel)]`.)
  const composite = parts.length > 1;
  const type = composite
    ? `{ ${parts.map((p) => `${p.name}: ${p.type}`).join('; ')} }`
    : parts[0].type;
  const empty = parts.every((p) => p.empty !== null)
    ? composite
      ? `{ ${parts.map((p) => `${p.name}: ${p.empty}`).join(', ')} }`
      : parts[0].empty
    : null;

  return {
    parts,
    composite,
    type,
    empty,
    event,
    // `setDisabledState` is optional in the interface, and an element with no
    // `disabled` property has no way to express a disabled form control.
    disabled: declared.has('disabled'),
  };
}
