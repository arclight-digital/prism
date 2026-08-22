/**
 * What a component inherits from the component it extends.
 *
 * `config.runtime` recovers a subclass's property declarations on its own —
 * Lit flattens `elementProperties` up the prototype chain. Nothing else
 * flattens, because nothing else is data on the class: events, slots, template
 * and styles are statements in the base class's source file, and so are a
 * default (a constructor assignment) and a union (a `@prop` tag). Reading
 * `export class ArcModal extends ArcDialog {}` yields a component with none of
 * them.
 *
 * Props alone coming back is the dangerous state, not a partial one: a wrapper
 * that recovered its props but not its event handlers passes every comparison
 * of prop lists, which is the first thing anyone checks.
 *
 * The rule: events, methods and per-property facts merge unconditionally,
 * because none of them is rendering — a subclass dispatches its parent's events
 * and inherits its parent's methods, and `super()` runs the parent's
 * constructor whatever the subclass draws.
 * Template, styles, slots and classification transfer only when the subclass
 * renders nothing of its own; a subclass with its own `render()` is describing
 * its own surface and is believed about it. Either way the subclass wins where
 * it spoke: inheriting fills holes, never overrules answers.
 */

/**
 * Fold an ancestor's parsed meta into a subclass's.
 *
 * @param {import('./parser.js').ComponentMeta} meta - the subclass
 * @param {import('./parser.js').ComponentMeta} ancestor - what it extends
 * @returns {{ meta: import('./parser.js').ComponentMeta, inherited: string[] }}
 *   the merged meta, and the names of what it took — for the caller to report
 */
export function inheritFrom(meta, ancestor) {
  const inherited = [];

  // A union, not a fallback: a subclass with its own template still dispatches
  // its base's events. The subclass's own events stay first — the order its
  // wrapper already declares them in.
  const ownEvents = new Set(meta.events);
  const addedEvents = ancestor.events.filter((e) => !ownEvents.has(e));
  if (addedEvents.length > 0) {
    meta.events = [...meta.events, ...addedEvents];
    inherited.push(`events (${addedEvents.join(', ')})`);
  }

  // Payloads merge even when no event *name* was new: a subclass can know the
  // names from its own `@fires` tags while only the ancestor's dispatch sites
  // have the detail keys — and the keys are what two-way bindings derive from.
  const ownDetails = Object.keys(meta.eventDetails ?? {}).length;
  meta.eventDetails = { ...ancestor.eventDetails, ...meta.eventDetails };
  meta.eventWrites = { ...ancestor.eventWrites, ...meta.eventWrites };
  if (Object.keys(meta.eventDetails).length > ownDetails && addedEvents.length === 0) {
    inherited.push('event payloads');
  }

  // Methods, on the same terms and for the same reason: they are on the
  // prototype chain whatever the subclass renders, and an empty subclass of a
  // component driven by `show()` is driven by `show()` too — with no handle in
  // its wrappers to call it through, if this didn't merge.
  const ownMethods = new Set(meta.methods ?? []);
  const addedMethods = (ancestor.methods ?? []).filter((m) => !ownMethods.has(m));
  if (addedMethods.length > 0) {
    meta.methods = [...(meta.methods ?? []), ...addedMethods];
    inherited.push(`methods (${addedMethods.join(', ')})`);
  }

  // Per-property facts, also unconditionally. `elementProperties` carries what
  // a property *is*; the default, the union and the verbatim TS type live in
  // the base class's constructor and JSDoc, which an empty subclass has none
  // of. Unconditional because a constructor is not rendering: `super()` runs
  // whatever the base assigns no matter what the subclass renders — and where
  // the subclass assigns its own, the source reader already found it and the
  // checks below leave it alone.
  const ancestorProps = new Map((ancestor.props ?? []).map((p) => [p.name, p]));
  const gainedDefault = [];
  const gainedType = [];
  for (const prop of meta.props ?? []) {
    const base = ancestorProps.get(prop.name);
    if (!base) continue;
    if (!prop.default && base.default) {
      prop.default = base.default;
      gainedDefault.push(prop.name);
    }
    // A lost union degrades `size: 'sm'|'md'|'lg'` to `string` in six sets of
    // types. Union and docType travel together — both come from the same tag.
    if ((prop.values?.length ?? 0) === 0 && (base.values?.length ?? 0) > 0) {
      prop.values = [...base.values];
      gainedType.push(prop.name);
    }
    if (!prop.docType && base.docType) {
      prop.docType = base.docType;
      if (!gainedType.includes(prop.name)) gainedType.push(prop.name);
    }
  }
  if (gainedDefault.length > 0) inherited.push(`defaults (${gainedDefault.join(', ')})`);
  if (gainedType.length > 0) inherited.push(`documented types (${gainedType.join(', ')})`);

  // Everything below describes what the component *renders*, and a subclass
  // that renders something of its own has already answered for all of it.
  if (meta.template) return { meta, inherited };

  if (ancestor.template) {
    meta.template = ancestor.template;
    inherited.push('template');
  }
  if (!meta.css && ancestor.css) {
    // Lit collects styles up the prototype chain too, so an empty subclass is
    // genuinely styled by its parent's stylesheet.
    meta.css = ancestor.css;
    meta.hostDisplay = meta.hostDisplay || ancestor.hostDisplay;
    inherited.push('styles');
  }
  if ((meta.slots?.length ?? 0) === 0 && (ancestor.slots?.length ?? 0) > 0) {
    meta.slots = [...ancestor.slots];
    meta.slotsInMarkup = [...(ancestor.slotsInMarkup ?? [])];
    inherited.push(`slots (${ancestor.slots.join(', ')})`);
  }
  if (!meta.hasDefaultSlot && ancestor.hasDefaultSlot) {
    meta.hasDefaultSlot = true;
    inherited.push('default slot');
  }
  // `@slot none` on the parent is a statement about the parent's rendering,
  // which the subclass has adopted along with the template.
  if (!meta.noDefaultSlot && ancestor.noDefaultSlot && !meta.hasDefaultSlot) {
    meta.noDefaultSlot = true;
  }

  // Classification is derived from rendering signals — handlers, imperative DOM,
  // a host display — and a subclass that renders nothing has none of them, so it
  // lands on `static` and its CSS silently stops reaching any output. Only
  // adopted where the level was auto-detected rather than decided: a config
  // override names this tag specifically and outranks its parent.
  if (meta.classification?.origin === 'auto' && ancestor.interactivity !== meta.interactivity) {
    meta.interactivity = ancestor.interactivity;
    meta.classification = { ...ancestor.classification, inherited: true };
    inherited.push(`interactivity (${ancestor.interactivity})`);
  }

  return { meta, inherited };
}
