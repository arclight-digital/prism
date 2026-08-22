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
 * Two things make a payload a prop's write-back path, and the second is the
 * one a table of names cannot reach:
 *
 *   - the key names the prop (`detail.value` ↔ `value`), the convention the
 *     components already follow; or
 *   - the dispatch site shows the key carrying that prop's new value, which is
 *     what `eventWrites` records — `arc-sidebar-toggle` announcing `sidebarOpen`
 *     as `detail.value` is the component moving state its consumer holds a copy
 *     of, and the consumer's copy drifts the first time a backdrop click closes
 *     the drawer.
 *
 * Behaviour outranks the name where they disagree, because they only disagree
 * when the source is explicit: `detail: { value: this.checked }` on a checkbox
 * whose `value` is the string a form submits carries the checked flag, and
 * mirroring it onto `value` writes a boolean into a string.
 *
 * Where two events carry the same key — a slider firing both `arc-input` and
 * `arc-change` — both are listened to, so a binding tracks the live drag as
 * well as the commit.
 *
 * @param {import('../parser.js').ComponentMeta} meta
 * @param {object} [config] - framework config section, for `bindings` overrides
 * @returns {Map<string, Array<{ prop: string, key: string }>>} event name → the
 *   props it writes back, each with the detail key carrying the value
 */
export function deriveBindings(meta, config = {}) {
  const byEvent = new Map();
  const rule = config.bindings?.[meta.tag];
  const excluded = new Set(rule?.exclude ?? []);
  const propNames = new Set(meta.props.map((p) => p.name));

  for (const [event, keys] of Object.entries(meta.eventDetails ?? {})) {
    const writes = meta.eventWrites?.[event] ?? {};
    const byProp = new Map();
    for (const key of keys) {
      const prop = writes[key] ?? key;
      if (!propNames.has(prop) || excluded.has(prop)) continue;
      // Where two keys of one payload carry the same prop, the one that names
      // it outright is the plainer write-back path; otherwise the first wins.
      if (byProp.has(prop) && key !== prop) continue;
      byProp.set(prop, { prop, key });
    }
    // Sorted for stable output: detail keys arrive in dispatch order, which
    // shifts whenever the component is edited.
    if (byProp.size > 0) {
      byEvent.set(event, [...byProp.values()].sort((a, b) => (a.prop < b.prop ? -1 : a.prop > b.prop ? 1 : 0)));
    }
  }
  return byEvent;
}

/**
 * The set of prop names any event writes back.
 * @param {Map<string, Array<{ prop: string, key: string }>>} bindings
 * @returns {Set<string>}
 */
export function boundPropNames(bindings) {
  return new Set([...bindings.values()].flat().map((b) => b.prop));
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
