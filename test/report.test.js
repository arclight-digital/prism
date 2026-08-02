import { describe, it, expect } from 'vitest';
import {
  outputSummary, misclassified, formatBytes, strictFailures, groupDiagnostics,
  partitionAcknowledged, ACKNOWLEDGEABLE_CODES,
} from '../src/report.js';

/** Minimal meta factory. */
const meta = (tag, interactivity, cssLen, classification) => ({
  tag,
  interactivity,
  css: 'x'.repeat(cssLen),
  classification,
});

const auto = (over = {}) => ({
  level: 'interactive',
  origin: 'auto',
  signals: {
    handlers: ['click'], handlerCount: 1, events: 0,
    imperativeDOM: false, hostDisplayNone: false, ...over,
  },
});

describe('outputSummary', () => {
  it('counts emitting vs skipped and sums skipped CSS', () => {
    const s = outputSummary([
      meta('arc-a', 'static', 100, auto()),
      meta('arc-b', 'hybrid', 200, auto()),
      meta('arc-c', 'interactive', 1000, auto()),
      meta('arc-d', 'interactive', 500, auto()),
    ]);
    expect(s).toEqual({ total: 4, skipped: 2, emitting: 2, skippedCSSBytes: 1500 });
  });

  it('handles an all-static set', () => {
    const s = outputSummary([meta('arc-a', 'static', 10, auto())]);
    expect(s.skipped).toBe(0);
    expect(s.skippedCSSBytes).toBe(0);
  });
});

describe('misclassified', () => {
  it('flags a presentational component tripped by one handler', () => {
    const out = misclassified([meta('arc-button', 'interactive', 4000, auto())]);
    expect(out.map((m) => m.tag)).toEqual(['arc-button']);
  });

  it('ignores components that emit output', () => {
    expect(misclassified([meta('arc-a', 'hybrid', 4000, auto())])).toEqual([]);
  });

  it('never second-guesses a config or JSDoc decision', () => {
    const fromConfig = meta('arc-a', 'interactive', 4000, { ...auto(), origin: 'config' });
    const fromJsdoc = meta('arc-b', 'interactive', 4000, { ...auto(), origin: 'jsdoc' });
    expect(misclassified([fromConfig, fromJsdoc])).toEqual([]);
  });

  it('excludes display:none data carriers', () => {
    const carrier = meta('arc-radio', 'interactive', 4000, auto({ hostDisplayNone: true }));
    expect(misclassified([carrier])).toEqual([]);
  });

  it('excludes components using imperative shadow DOM', () => {
    const imperative = meta('arc-nav', 'interactive', 9000, auto({ imperativeDOM: true }));
    expect(misclassified([imperative])).toEqual([]);
  });

  it('excludes components with many handlers', () => {
    const menu = meta('arc-menu', 'interactive', 9000, auto({ handlerCount: 7 }));
    expect(misclassified([menu])).toEqual([]);
  });

  it('excludes components with little CSS', () => {
    expect(misclassified([meta('arc-tiny', 'interactive', 100, auto())])).toEqual([]);
  });

  it('sorts by CSS size descending', () => {
    const out = misclassified([
      meta('arc-small', 'interactive', 900, auto()),
      meta('arc-big', 'interactive', 5000, auto()),
    ]);
    expect(out.map((m) => m.tag)).toEqual(['arc-big', 'arc-small']);
  });

  it('thresholds are tunable', () => {
    const menu = meta('arc-menu', 'interactive', 9000, auto({ handlerCount: 7 }));
    expect(misclassified([menu], { maxHandlers: 10 }).map((m) => m.tag)).toEqual(['arc-menu']);
  });

  it('tolerates a meta with no classification field', () => {
    expect(misclassified([{ tag: 'arc-x', interactivity: 'interactive', css: 'x'.repeat(4000) }]))
      .toEqual([]);
  });
});

describe('formatBytes', () => {
  it('uses bytes below 1 KB and KB above', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
  });
});

describe('strictFailures', () => {
  const d = (code, message = code) => ({ code, message });

  it('returns the diagnostics that should fail a --strict run', () => {
    const out = strictFailures([
      d('doc-drift'),
      d('unmatched-override'),
      d('invalid-tag'),
      d('invalid-event'),
      d('invalid-detail-key'),
    ]);
    expect(out).toHaveLength(5);
  });

  it('ignores codes outside the strict set', () => {
    expect(strictFailures([d('some-future-note'), d('another')])).toEqual([]);
  });

  it('is empty for a clean run', () => {
    expect(strictFailures([])).toEqual([]);
  });

  it('orders by severity rather than discovery order', () => {
    const out = strictFailures([d('invalid-event'), d('doc-drift'), d('unmatched-override')]);
    expect(out.map((x) => x.code)).toEqual(['doc-drift', 'unmatched-override', 'invalid-event']);
  });

  it('fails on a declaration prism could not read', () => {
    // Precise by construction: it fires only where prism genuinely couldn't
    // read a declaration, so a red build was already losing props in silence.
    expect(strictFailures([d('unparsed-prop-declaration')])).toHaveLength(1);
  });

  it('does not fail on a documented @prop with nothing behind it', () => {
    // True, but it finds mixin-contributed props prism can't see — a backlog
    // the consumer didn't create and can't clear. Report-only until runtime
    // resolution lands; promoted in 3.0. See STRICT_CODES.
    expect(strictFailures([d('doc-prop-undeclared')])).toEqual([]);
  });
});

describe('acknowledgeable codes', () => {
  it('covers the strict findings a consumer can decide about', () => {
    expect(ACKNOWLEDGEABLE_CODES).toContain('unparsed-prop-declaration');
  });

  it('excludes codes that describe a bug in the config itself', () => {
    // Acknowledging these would be waiving your own mistake, not a finding.
    expect(ACKNOWLEDGEABLE_CODES).not.toContain('invalid-props-from');
    expect(ACKNOWLEDGEABLE_CODES).not.toContain('unmatched-acknowledge');
  });

  it('excludes report-only codes, which need no waiver', () => {
    expect(ACKNOWLEDGEABLE_CODES).not.toContain('doc-prop-undeclared');
  });
});

describe('groupDiagnostics', () => {
  const d = (code, message = code) => ({ code, message });

  it('groups by code in strict-set order', () => {
    const out = groupDiagnostics([
      d('invalid-event', 'a'),
      d('doc-drift', 'b'),
      d('invalid-event', 'c'),
    ]);
    expect(out.map((g) => g.code)).toEqual(['doc-drift', 'invalid-event']);
    expect(out[1].entries.map((e) => e.message)).toEqual(['a', 'c']);
  });

  it('keeps unknown codes rather than dropping them', () => {
    const out = groupDiagnostics([d('mystery'), d('doc-drift')]);
    expect(out.map((g) => g.code)).toEqual(['doc-drift', 'mystery']);
  });

  it('returns nothing for a clean run', () => {
    expect(groupDiagnostics([])).toEqual([]);
  });
});

describe('partitionAcknowledged', () => {
  const finding = (over = {}) => ({
    code: 'framework-reserved', tag: 'arc-column', prop: 'key', message: 'm', ...over,
  });

  it('waives a finding an entry matches on code, tag and prop', () => {
    const { active, accepted, stale } = partitionAcknowledged(
      [finding()],
      [{ code: 'framework-reserved', tag: 'arc-column', prop: 'key', note: 'aliased as field' }],
    );
    expect(active).toEqual([]);
    expect(stale).toEqual([]);
    expect(accepted[0].note).toBe('aliased as field');
  });

  it('leaves a finding the entry does not describe', () => {
    const { active, accepted } = partitionAcknowledged(
      [finding({ prop: 'ref' })],
      [{ code: 'framework-reserved', tag: 'arc-column', prop: 'key' }],
    );
    expect(active).toHaveLength(1);
    expect(accepted).toEqual([]);
  });

  it('treats omitted fields as wildcards', () => {
    const { accepted } = partitionAcknowledged(
      [finding(), finding({ tag: 'arc-row', prop: 'ref' })],
      [{ code: 'framework-reserved' }],
    );
    expect(accepted).toHaveLength(2);
  });

  it('never waives across codes', () => {
    const { active } = partitionAcknowledged(
      [finding({ code: 'doc-drift' })],
      [{ code: 'framework-reserved', tag: 'arc-column' }],
    );
    expect(active).toHaveLength(1);
  });

  it('reports an entry that matched nothing', () => {
    const { stale } = partitionAcknowledged([], [{ code: 'doc-drift', tag: 'arc-gone', prop: 'size' }]);
    expect(stale).toHaveLength(1);
    expect(stale[0].code).toBe('unmatched-acknowledge');
    expect(stale[0].message).toContain('arc-gone.size');
  });

  it('does not report an entry that matched at least once', () => {
    const { stale } = partitionAcknowledged(
      [finding(), finding()],
      [{ code: 'framework-reserved', tag: 'arc-column', prop: 'key' }],
    );
    expect(stale).toEqual([]);
  });

  it('keeps a stale entry as a strict failure', () => {
    // Otherwise the allowlist rots: entries outlive the findings they describe
    // and quietly pre-waive whatever reappears under the same key.
    const { stale } = partitionAcknowledged([], [{ code: 'doc-drift' }]);
    expect(strictFailures(stale)).toHaveLength(1);
  });

  it('is a no-op with no acknowledgements', () => {
    const { active, accepted, stale } = partitionAcknowledged([finding()]);
    expect(active).toHaveLength(1);
    expect(accepted).toEqual([]);
    expect(stale).toEqual([]);
  });
});
