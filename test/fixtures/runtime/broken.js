/**
 * A module that throws on import.
 *
 * Every consumer catalog eventually has one — a component reaching for a browser
 * global at module scope, an import of an asset Node can't load. The point of
 * the fixture is that it costs *itself* its runtime answer and nothing else:
 * prism reports it, falls back to reading its source, and the other components
 * in the run are unaffected.
 *
 * @tag arc-broken
 */
throw new Error('this module cannot be imported outside a browser');
