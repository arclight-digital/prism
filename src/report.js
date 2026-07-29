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

/**
 * Diagnostics that should fail a `--strict` run, in the order they're reported.
 *
 * Every one of these is a statement that prism found something it could not act
 * on: a documented union the CSS contradicts, an override pointing at a
 * component that no longer exists, a name it had to drop. On a normal run they
 * print; under `--strict` they also set the exit code, which is the only signal
 * a caller that discards stdout on success can actually observe.
 *
 * Deliberately not included: skipped `interactive` components and the
 * misclassification list. Both are routine on every run — failing on them would
 * mean `--strict` never passes, and a check that never passes gets removed.
 *
 * @param {import('./parser.js').Diagnostic[]} diagnostics
 */
export const STRICT_CODES = [
  'slot-name-remapped',
  'framework-reserved',
  'doc-drift',
  'unmatched-override',
  'unmatched-acknowledge',
  'invalid-tag',
  'invalid-event',
  'invalid-detail-key',
];

/** Codes an `acknowledge` entry may name. Its own staleness isn't waivable. */
export const ACKNOWLEDGEABLE_CODES = STRICT_CODES.filter((c) => c !== 'unmatched-acknowledge');

/**
 * True if an `acknowledge` entry covers a diagnostic.
 *
 * Every field the entry states must match; fields it omits are wildcards. So
 * `{ code, tag, prop }` accepts one finding and `{ code }` accepts a class of
 * them — blunt, but an explicit choice rather than an accident.
 */
function ackMatches(entry, d) {
  if (entry.code !== d.code) return false;
  if (entry.tag !== undefined && entry.tag !== d.tag) return false;
  if (entry.prop !== undefined && entry.prop !== d.prop) return false;
  return true;
}

/**
 * Split diagnostics into the ones still demanding attention and the ones
 * already decided, and report acknowledgements that matched nothing.
 *
 * Accepted findings are still returned rather than dropped: an allowlist that
 * makes findings vanish is how a real regression hides behind an old decision.
 * They print, quietly, under their own heading.
 *
 * A stale acknowledgement is itself a finding, for the same reason an unmatched
 * `config.interactivity` key is — the entry sits in the config looking like it's
 * doing something while the thing it described is gone.
 *
 * @param {import('./parser.js').Diagnostic[]} diagnostics
 * @param {Array<{code: string, tag?: string, prop?: string, note?: string}>} acknowledge
 * @returns {{ active: object[], accepted: object[], stale: object[] }}
 */
export function partitionAcknowledged(diagnostics, acknowledge = []) {
  const used = new Set();
  const active = [];
  const accepted = [];

  for (const d of diagnostics) {
    const idx = acknowledge.findIndex((entry) => ackMatches(entry, d));
    if (idx === -1) {
      active.push(d);
    } else {
      used.add(idx);
      accepted.push({ ...d, note: acknowledge[idx].note });
    }
  }

  const stale = acknowledge
    .map((entry, i) => ({ entry, i }))
    .filter(({ i }) => !used.has(i))
    .map(({ entry }) => ({
      code: 'unmatched-acknowledge',
      message:
        `config.acknowledge entry for ${entry.code}` +
        `${entry.tag ? ` on ${entry.tag}` : ''}${entry.prop ? `.${entry.prop}` : ''}` +
        ' matched no finding — the issue is gone, or the entry no longer describes it',
      tag: entry.tag,
      prop: entry.prop,
    }));

  return { active, accepted, stale };
}

export function strictFailures(diagnostics) {
  const rank = new Map(STRICT_CODES.map((c, i) => [c, i]));
  return diagnostics
    .filter((d) => rank.has(d.code))
    .sort((a, b) => rank.get(a.code) - rank.get(b.code));
}

/**
 * Group diagnostics by code, preserving STRICT_CODES order, so the end-of-run
 * block reads as a few labelled lists rather than one interleaved wall.
 *
 * @param {import('./parser.js').Diagnostic[]} diagnostics
 * @returns {Array<{ code: string, entries: import('./parser.js').Diagnostic[] }>}
 */
export function groupDiagnostics(diagnostics) {
  const byCode = new Map();
  for (const d of diagnostics) {
    if (!byCode.has(d.code)) byCode.set(d.code, []);
    byCode.get(d.code).push(d);
  }
  const ordered = [...STRICT_CODES, ...byCode.keys()];
  const seen = new Set();
  const out = [];
  for (const code of ordered) {
    if (seen.has(code) || !byCode.has(code)) continue;
    seen.add(code);
    out.push({ code, entries: byCode.get(code) });
  }
  return out;
}
