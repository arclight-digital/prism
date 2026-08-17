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
 * Absent from this list, but able to fail a run anyway: `doc-prop-undeclared`.
 * It was excluded for two releases because the population it found was one the
 * consumer did not create and could not clear — prism read a component's own
 * source, so a prop contributed by a mixin was invisible to it, and the
 * reference consumer had 18 findings, 16 from a single form-control mixin.
 * Failing a build on a backlog only prism could clear is how a major upgrade
 * teaches people to pin.
 *
 * The fix was the cause rather than the rule. With `config.runtime` on, prism
 * reads `Ctor.elementProperties` — the flattened property map Lit builds from
 * the class, mixins included — and the finding changes meaning: not "no
 * declaration in this file", which a mixin makes routinely untrue, but "no such
 * property", which is a stale tag and a one-line fix. So it fails when it was
 * checked against the class and reports when it was read from source. See
 * `strictFailures`.
 *
 * @param {import('./parser.js').Diagnostic[]} diagnostics
 */
export const STRICT_CODES = [
  // First because it is the most consequential thing prism can find: a prop it
  // cannot read is a prop absent from every wrapper, and fewer props still
  // typechecks, so nothing downstream notices. Precise by construction — it
  // fires only where prism genuinely could not read a declaration — so the
  // build it turns red belonged to someone already losing props in silence.
  'unparsed-prop-declaration',
  'invalid-props-from',
  'props-from-under-reports',
  'invalid-form-associated',
  // A module `config.runtime` was meant to read but couldn't. Strict because
  // the answer it degrades to is the one runtime resolution was turned on to
  // replace: that component's mixin-contributed props are silently missing from
  // every wrapper again, and nothing else would say so.
  'runtime-unavailable',
  // A form control whose Angular wrapper got no ControlValueAccessor. Grouped
  // with the prop findings because it is the same kind of loss — a binding a
  // consumer writes, that compiles, and that does nothing at runtime.
  'form-control-unbindable',
  // A run that rewrote output a newer prism had written. Near the top because
  // the damage is already done by the time it prints and it is the only finding
  // here that says so: the files have been reverted, and the single run that
  // reports it is the last moment anyone sees the two versions side by side.
  // It clears itself on the next run — the files now carry the older stamp — so
  // a warning missed is a warning gone.
  'generator-downgrade',
  // Above the slot check because its failure is total rather than partial: a
  // wrapper that registers nothing renders an inert element, so every other
  // thing it gets right is unobservable.
  'wrapper-missing-register',
  'wrapper-missing-accessor',
  'wrapper-missing-slot',
  'exports-target-missing',
  'exports-subpath-collision',
  // A configured JSX declaration file prism declined to write because something
  // else already owns that path. Strict, unlike the identical situation for a
  // wrapper, because the two mean different things — see the code's label and
  // the note in cli.js where it is raised.
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
 * `acknowledge` narrows by stating fields that must match, and a field the
 * finding never sets can never match — so `{ code, tag, prop }` against a code
 * that carries no `prop` waives nothing. That would be tolerable if it were
 * visible, and it is the opposite: the entry matches nothing, so it is reported
 * as `unmatched-acknowledge` — "the issue is gone, or the entry no longer
 * describes it" — which names the one conclusion that isn't true while the
 * finding is still live and still failing the build. Two findings, both
 * misleading, from one field that was never going to match.
 *
 * `props-from-under-reports` is the case that surfaced it: it carries `props`,
 * plural, because the fault it describes is the hook's rather than any one
 * prop's, so the natural `{ code, tag, prop: 'value' }` silently did nothing.
 *
 * Anything not listed narrows by `tag` alone. **Keep this in step with the
 * fields the diagnostics are constructed with** — a code that starts carrying a
 * `prop` and isn't added here rejects a legitimate entry, loudly, at config
 * load, which is the failure direction to prefer.
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

/**
 * Diagnostics that fail this run.
 *
 * Mostly a question about the code, and for one finding a question about the
 * evidence behind it. `doc-prop-undeclared` is the same claim either way — a
 * documented `@prop` with nothing behind it — but read from source it means
 * "no declaration in this file", which a mixin makes routinely untrue, and read
 * from the class it means "no such property", which is simply a stale tag. The
 * first cannot fail a build without failing it for a backlog the consumer did
 * not create; the second is a one-line fix in the file being complained about.
 * So the finding carries `strict` when it was checked against the class.
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
