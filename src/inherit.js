/**
 * What a component inherits from the component it extends.
 *
 * `config.runtime` closed half of this by itself: `Ctor.elementProperties` is
 * already flattened, so a subclass's *properties* come back complete without
 * anyone doing anything. The other half does not flatten, because it isn't data
 * on the class. The events a component dispatches, the slots it renders, its
 * template and its styles are all statements in source — and for
 *
 *   export class ArcModal extends ArcDialog {}
 *
 * that source is a file with nothing in it. Reading it yields a component with
 * no events, no slots and no template, which is exactly what it says and not at
 * all what the element does.
 *
 * Props alone coming back is the dangerous state, not a partial one: a wrapper
 * that has recovered its props and not its event handlers passes every
 * comparison of prop lists, which is the first thing anyone checks. In the
 * reference consumer the same refactor that emptied `arc-modal`'s props also
 * took `onArcClose` and `onArcOpen` with them.
 *
 * ── The rule ──
 *
 * Events are always merged: a subclass can dispatch its own, and it also
 * dispatches its parent's. Everything else is inherited only when the subclass
 * renders nothing of its own, which is the one signal that separates "extends
 * and overrides" from "extends and adds nothing". A subclass with its own
 * `render()` is describing its own surface and is believed about it.
 *
 * ── Provenance ──
 *
 * Worth stating plainly, because the version of this story that reached the
 * changelog first was wrong. The `arc-modal` regression was not longstanding:
 * the component had ordinary `static properties` and shipped correct wrappers
 * for every released version, and the props vanished in the single refactor
 * commit that reduced it to a subclass. That is the sharper fact. **A source
 * reader silently empties a component the moment an ordinary, correct refactor
 * turns it into a subclass** — no wrapper edited, no generator edited, and the
 * only signal a handful of findings that read as stale documentation.
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

  // Events first, and unconditionally. A subclass that renders its own template
  // still dispatches whatever its base dispatches, so this is a union rather
  // than a fallback — and the duplicate-free order keeps the subclass's own
  // events first, which is the order its wrapper already declared them in.
  const ownEvents = new Set(meta.events);
  const addedEvents = ancestor.events.filter((e) => !ownEvents.has(e));
  if (addedEvents.length > 0) {
    meta.events = [...meta.events, ...addedEvents];
    inherited.push(`events (${addedEvents.join(', ')})`);
  }

  // Payloads merge whether or not any *name* was new, and that is not a detail.
  // A subclass can know the names from its own `@fires` tags and still know
  // nothing about what they carry, because a tag states no payload — so the
  // names would look complete while every two-way binding derived from them
  // silently disappeared. Only the ancestor's dispatch sites have the keys.
  const ownDetails = Object.keys(meta.eventDetails ?? {}).length;
  meta.eventDetails = { ...ancestor.eventDetails, ...meta.eventDetails };
  if (Object.keys(meta.eventDetails).length > ownDetails && addedEvents.length === 0) {
    inherited.push('event payloads');
  }

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
