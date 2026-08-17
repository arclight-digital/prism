import { ArcDialog } from './dialog.js';

/**
 * A subclass that declares nothing of its own — the sharpest form of the blind
 * spot, and a whole file's worth of it.
 *
 * There is no `static properties` block here to read, so source reading
 * attributes *zero* props to this component and every wrapper it generates
 * accepts nothing.
 *
 * The provenance is the point, and it is sharper than "prism mis-reads class
 * hierarchies". In the reference consumer this component was ordinary — its own
 * properties, correct wrappers in every released version — until one refactor
 * merged two dialog tags and reduced it to a subclass. From that commit, six
 * props and both events reached no wrapper in any of the six frameworks:
 * `<Modal open>` did nothing, everywhere. No wrapper was edited, no generator
 * was edited, and the only symptom was `doc-prop-undeclared` warnings that read
 * as though the documentation were stale — the opposite of the truth, and the
 * reason nobody acted on them.
 *
 * The `@fires` tags matter as much as the shape. `elementProperties` is
 * flattened by Lit, so runtime resolution brings the *properties* back on its
 * own — but events, slots and the template are statements in the base class's
 * file and flatten nowhere. Props alone coming back is the dangerous state: a
 * wrapper missing only its handlers passes every comparison of prop lists.
 *
 * Two things have to hold for this file to generate a correct wrapper, and they
 * are deliberately different mechanisms: prism links this class to arc-dialog
 * through the prototype chain and takes its events and slots from there, and it
 * also believes these tags, so the events survive even if the base class is
 * somewhere prism was never pointed at.
 *
 * @tag arc-modal
 * @prop {boolean} open - inherited from arc-dialog
 * @prop {string} heading - inherited from arc-dialog
 * @fires arc-close
 * @fires arc-open
 */
export class ArcModal extends ArcDialog {}

customElements.define('arc-modal', ArcModal);
