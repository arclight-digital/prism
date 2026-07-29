import { describe, it, expect } from 'vitest';
import { outputSummary, misclassified, formatBytes } from '../src/report.js';

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
