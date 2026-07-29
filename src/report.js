/**
 * Visibility into what a run *didn't* produce.
 *
 * Generators are quiet about absence: an `interactive` component is skipped
 * with a one-line note buried among hundreds, and nothing ever states the
 * aggregate. That silence hid a real bug for two releases — `arc-button` gained
 * a `@click` form-submit bridge, auto-detection flipped it to `interactive`,
 * and the CSS package shipped with no button styles at all. A stale
 * `button.css` from before the reclassification masked it; once that fossil was
 * pruned the only remaining signal was silence.
 *
 * Two reports close that gap:
 *   - `outputSummary`  — how much is being skipped, stated plainly every run
 *   - `misclassified`  — which skipped components look like they shouldn't be
 */

/** Components whose CSS reaches no HTML/CSS output. */
export function outputSummary(metas) {
  const skipped = metas.filter((m) => m.interactivity === 'interactive');
  return {
    total: metas.length,
    skipped: skipped.length,
    emitting: metas.length - skipped.length,
    // Bytes of authored component CSS that reach no output. The headline
    // number — "106 components skipped" reads as routine, "210 KB of CSS
    // reaches nothing" does not.
    skippedCSSBytes: skipped.reduce((n, m) => n + (m.css?.length ?? 0), 0),
  };
}

/**
 * Skipped components that look presentational.
 *
 * Auto-detection is binary: any single event binding forces `interactive`, and
 * the component's whole stylesheet drops out of the package. That's right for a
 * modal and wrong for a button whose one handler bridges form submission. This
 * flags the second kind so it can be pinned as `hybrid`.
 *
 * Deliberately narrow — a false positive here tells someone to ship a component
 * that doesn't work without JS, which is worse than staying quiet:
 *
 *   - only `auto` classifications. A config or JSDoc level is a decision
 *     someone made; re-litigating it every run would train people to ignore
 *     the output.
 *   - no `display: none` host — that's a data carrier for an interactive
 *     parent, never standalone.
 *   - no imperative shadow-DOM access — real interactive machinery.
 *   - few handlers. One incidental affordance is the pattern; seven click
 *     handlers is a dropdown menu.
 *   - substantial CSS. Below the threshold there's nothing worth recovering.
 *
 * @param {import('./parser.js').ComponentMeta[]} metas
 * @param {{ maxHandlers?: number, minCSSBytes?: number }} [opts]
 */
export function misclassified(metas, { maxHandlers = 2, minCSSBytes = 800 } = {}) {
  return metas
    .filter((m) => {
      if (m.interactivity !== 'interactive') return false;
      const c = m.classification;
      if (!c || c.origin !== 'auto') return false;
      const s = c.signals;
      if (s.hostDisplayNone || s.imperativeDOM) return false;
      if (s.handlerCount > maxHandlers) return false;
      return (m.css?.length ?? 0) >= minCSSBytes;
    })
    .sort((a, b) => b.css.length - a.css.length);
}

/** Human-readable byte size, e.g. `210 KB`. */
export function formatBytes(n) {
  return n < 1024 ? `${n} B` : `${Math.round(n / 1024)} KB`;
}
