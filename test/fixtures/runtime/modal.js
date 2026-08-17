import { ArcDialog } from './dialog.js';

/**
 * A subclass that declares nothing of its own — the sharpest form of the blind
 * spot, and a whole file's worth of it.
 *
 * There is no `static properties` block here to read, so source reading
 * attributes *zero* props to this component and every wrapper it generates
 * accepts nothing. In the reference consumer that was six props (`open`,
 * `heading`, `size`, `fullscreen`, `dismissible`, `closable`) reaching no
 * wrapper in any of the six frameworks, for as long as those packages had
 * existed: `<Modal open>` did nothing, everywhere.
 *
 * The only symptom was `doc-prop-undeclared` warnings, which read as though the
 * documentation were stale — the opposite of the truth, and the reason nobody
 * acted on them for two releases.
 *
 * @tag arc-modal
 * @prop {boolean} open - inherited from arc-dialog
 * @prop {string} heading - inherited from arc-dialog
 */
export class ArcModal extends ArcDialog {}

customElements.define('arc-modal', ArcModal);
