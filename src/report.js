/**
 * Visibility into what a run *didn't* produce.
 *
 * Generators are quiet about absence: an `interactive` component is skipped
 * with one line among hundreds, and nothing states the aggregate — which is
 * how a misclassified button once shipped a CSS package with no button styles
 * and the only signal was silence.
 *
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
    // Bytes of authored CSS reaching no output — "106 components skipped"
    // reads as routine, "210 KB of CSS reaches nothing" does not.
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
 * Diagnostics that fail a `--strict` run, in the order they're reported.
 *
 * On a normal run these print; under `--strict` they also set the exit code —
 * the only signal a caller that discards stdout on success can observe.
 *
 * Deliberately not included: skipped `interactive` components and the
 * misclassification list. Both are routine on every run, and a check that
 * never passes gets removed. `doc-prop-undeclared` is absent but can fail a
 * run anyway: read from source, "no declaration in this file" is routinely
 * untrue for mixin-contributed props; checked against the class it means "no
 * such property", which is a stale tag. It fails only in the second case — see
 * `strictFailures`.
 *
 * @param {import('./parser.js').Diagnostic[]} diagnostics
 */
export const STRICT_CODES = [
  // Most consequential first: a prop prism cannot read is absent from every
  // wrapper, and fewer props still typechecks, so nothing downstream notices.
  'unparsed-prop-declaration',
  'invalid-props-from',
  'props-from-under-reports',
  'invalid-form-associated',
  // A module `config.runtime` was meant to read but couldn't — that component's
  // mixin-contributed props are silently missing again, and nothing else says so.
  'runtime-unavailable',
  // Same kind of loss as the prop findings: a binding a consumer writes, that
  // compiles, and that does nothing at runtime.
  'form-control-unbindable',
  // The files have already been reverted by the time this prints, and it clears
  // itself on the next run once they carry the older stamp — a warning missed
  // is a warning gone.
  'generator-downgrade',
  // Above the slot check because its failure is total: a wrapper that registers
  // nothing renders an inert element.
  'wrapper-missing-register',
  'wrapper-missing-accessor',
  'wrapper-missing-slot',
  'exports-target-missing',
  'exports-subpath-collision',
  // Strict, unlike the identical skip on a wrapper: a hand-written wrapper is a
  // standing arrangement, a foreign file at a configured jsxTypes path is
  // near-certainly an unfinished migration — see cli.js where it is raised.
  'jsx-types-not-written',
  'slot-name-not-identifier',
  'framework-reserved',
  'doc-drift',
  'unmatched-override',
  'unmatched-acknowledge',
  'invalid-tag',
  'invalid-event',
  'invalid-detail-key',
];

/**
 * Codes an `acknowledge` entry may name. Its own staleness isn't waivable, and
 * neither are the two hook findings — those report a config hook returning
 * something prism can't use, which is a bug in the config doing the
 * acknowledging rather than a finding about a component.
 */
const UNWAIVABLE = new Set([
  'unmatched-acknowledge', 'invalid-props-from', 'invalid-form-associated',
]);

/**
 * Codes that are not always strict but can be, so still have to be waivable.
 *
 * `doc-prop-undeclared` fails only when it was checked against the class rather
 * than the file — see `strictFailures`. A code that can fail a build and cannot
 * be acknowledged is a code with no way out of a decision someone has already
 * made, which is the position `--strict` exists to avoid.
 */
const CONDITIONALLY_STRICT = ['doc-prop-undeclared'];

export const ACKNOWLEDGEABLE_CODES = [...STRICT_CODES, ...CONDITIONALLY_STRICT]
  .filter((c) => !UNWAIVABLE.has(c));

/**
 * Which narrowing fields each acknowledgeable code actually carries.
 *
 * A stated field the finding never sets can never match, so the entry waives
 * nothing and is then reported as `unmatched-acknowledge` — blaming the finding
 * for being gone while it is still failing the build. Checking here, at config
 * load, says so at the moment the entry is written instead.
 * (`props-from-under-reports` is the case that surfaced this: it carries
 * `props`, plural, so the natural `{ code, tag, prop }` silently did nothing.)
 *
 * Anything not listed narrows by `tag` alone. **Keep this in step with the
 * fields the diagnostics are constructed with** — a code that starts carrying a
 * `prop` and isn't added here rejects a legitimate entry loudly at config load,
 * which is the failure direction to prefer.
 */
const CARRIES_PROP = new Set([
  'unparsed-prop-declaration',
  'slot-name-not-identifier',
  'framework-reserved',
  'doc-drift',
  'doc-prop-undeclared',
]);

/** Codes that describe output or config rather than a component. */
const CARRIES_NO_TAG = new Set([
  'generator-downgrade',
  'exports-target-missing',
  'exports-subpath-collision',
  'jsx-types-not-written',
  'runtime-unavailable',
]);

/**
 * Why an `acknowledge` entry could never match, or null if it could.
 *
 * Called at config load, so the answer arrives before the run rather than as a
 * pair of contradictory findings after it.
 *
 * @param {{ code: string, tag?: string, prop?: string }} entry
 * @returns {string|null}
 */
export function unmatchableAckField(entry) {
  // An unrecognised code is dropped and reported elsewhere; judging its fields
  // would version-lock the config in the direction normalizeConfig avoids.
  if (!ACKNOWLEDGEABLE_CODES.includes(entry.code)) return null;
  if (entry.prop !== undefined && !CARRIES_PROP.has(entry.code)) {
    return `${entry.code} findings carry no "prop", so this entry would match nothing`
      + (entry.code === 'props-from-under-reports'
        ? ' — it names every under-reported prop in a file at once, as "props", because the fault is the hook\'s rather than any one prop\'s. Narrow by tag instead.'
        : '. Narrow by tag instead.');
  }
  if (entry.tag !== undefined && CARRIES_NO_TAG.has(entry.code)) {
    return `${entry.code} findings describe generated output rather than a component, so they carry no "tag" and this entry would match nothing. Drop the tag to waive the code.`;
  }
  return null;
}

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
 * Split diagnostics into active and acknowledged, and report acknowledgements
 * that matched nothing.
 *
 * Accepted findings are returned rather than dropped — an allowlist that makes
 * findings vanish is how a regression hides behind an old decision — and a
 * stale acknowledgement is itself a finding, since the entry sits in the config
 * looking like it does something while the thing it described is gone.
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

/**
 * Diagnostics that fail this run: the strict codes, plus any finding carrying
 * `strict: true` — which `doc-prop-undeclared` sets when it was checked against
 * the class rather than read from source (see STRICT_CODES).
 *
 * @param {import('./parser.js').Diagnostic[]} diagnostics
 */
export function strictFailures(diagnostics) {
  const rank = new Map(STRICT_CODES.map((c, i) => [c, i]));
  return diagnostics
    .filter((d) => rank.has(d.code) || d.strict === true)
    // Findings that are strict only by evidence sort after the always-strict
    // codes, which is where an unranked code lands anyway.
    .sort((a, b) => (rank.get(a.code) ?? STRICT_CODES.length) - (rank.get(b.code) ?? STRICT_CODES.length));
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
