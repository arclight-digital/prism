/**
 * Derives two-way bindings shared by the Svelte, Vue and Angular generators.
 *
 * A wrapper that only passes props down is write-only: the framework's copy of
 * `value` never updates, so the next unrelated re-render re-sets the stale
 * value onto the element and silently reverts what the user just did. The
 * write-back path is already in the source — it just has to be found.
 */

/**
 * Derive two-way bindings for a component.
 *
 * A prop is bindable when some event's `detail` carries a key of the same name
 * — that key *is* the element's write-back path. No hardcoded table: the
 * convention (`detail.value` ↔ `value`, `detail.checked` ↔ `checked`) is what
 * the components already follow.
 *
 * Where two events carry the same key — a slider firing both `arc-input` and
 * `arc-change` — both are listened to, so a binding tracks the live drag as
 * well as the commit.
 *
 * @param {import('../parser.js').ComponentMeta} meta
 * @param {object} [config] - framework config section, for `bindings` overrides
 * @returns {Map<string, string[]>} event name → prop names it writes back
 */
export function deriveBindings(meta, config = {}) {
  const byEvent = new Map();
  const rule = config.bindings?.[meta.tag];
  const excluded = new Set(rule?.exclude ?? []);
  const propNames = new Set(meta.props.map((p) => p.name));

  for (const [event, keys] of Object.entries(meta.eventDetails ?? {})) {
    // Sort for stable output: detail keys arrive in dispatch order, which
    // shifts whenever the component is edited.
    const bound = keys.filter((k) => propNames.has(k) && !excluded.has(k)).sort();
    if (bound.length > 0) byEvent.set(event, bound);
  }
  return byEvent;
}

/**
 * The set of prop names any event writes back.
 * @param {Map<string, string[]>} bindings
 * @returns {Set<string>}
 */
export function boundPropNames(bindings) {
  return new Set([...bindings.values()].flat());
}

/**
 * Build a per-event handler name from an event name, e.g. `arc-input` →
 * `onArcInput`. `used` carries names already taken so two events that
 * normalize to the same identifier (`arc-input` and `arcInput`) can't emit
 * duplicate declarations.
 *
 * @param {string} event
 * @param {Set<string>} used
 * @param {string} [prefix='on']
 * @returns {string}
 */
export function handlerName(event, used, prefix = 'on') {
  const pascal = event
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  let name = `${prefix}${pascal}`;
  let n = 2;
  while (used.has(name)) name = `${prefix}${pascal}${n++}`;
  used.add(name);
  return name;
}
