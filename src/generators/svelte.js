/**
 * Generates Svelte 5 component (.svelte) files from ComponentMeta.
 * Uses $props() runes and Snippet type for children.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { HEADER_HTML as HEADER, claimOutput } from './header.js';
import { tsType, passthroughMembers, acceptsChildren, typedDefault } from './types.js';
import { deriveBindings, boundPropNames, handlerName } from './bindings.js';
import { localNames, slotSnippetNames, mixedCaseProps } from './identifiers.js';
import { registerImport } from './imports.js';

/** Format a default value for Svelte destructuring. */
function svelteDefault(prop) {
  return typedDefault(prop);
}

/**
 * Generate a Svelte 5 .svelte file for a component.
 * @param {import('./parser.js').ComponentMeta} meta
 * @param {object} config - svelte config section
 * @param {string} root - project root
 * @returns {{ path: string, written: boolean }}
 */
export function generateSvelte(meta, config, root) {
  const outDir = join(root, config.outDir, meta.tier);
  const outPath = join(outDir, `${meta.pascalName}.svelte`);

  // Safety: never overwrite files without our header.
  const claim = claimOutput(outPath);
  if (!claim.ours) return { path: outPath, written: false };

  mkdirSync(outDir, { recursive: true });

  const lines = [HEADER];

  // <script lang="ts">
  lines.push('<script lang="ts">');
  lines.push(`  import '${registerImport(meta, config)}';`);
  lines.push(`  import type { Snippet } from 'svelte';`);
  lines.push('');

  // One snippet prop per named slot. Without these the content is lost outright:
  // Svelte routes `slot="start"` on a component's child to a prop of that name,
  // so if the wrapper doesn't declare it and doesn't render it, it renders
  // nowhere — silently, with a clean build and a clean typecheck.
  //
  // Rendered bare, with no carrier element, so `::slotted()` rules and any
  // layout the shadow slot applies to its children still see the real content.
  // The consequence is that the `slot` attribute has to be on the consumer's own
  // element; inside a `{#snippet}` body it is ordinary markup and survives.
  const slotSnippets = slotSnippetNames(meta.slots ?? [], meta.props);

  // Props interface
  lines.push('  interface Props {');
  for (const prop of meta.props) {
    lines.push(`    ${prop.name}?: ${tsType(prop)};`);
  }
  for (const [slot, ident] of slotSnippets) {
    lines.push(`    /** <slot name="${slot}"> — put slot="${slot}" on the element inside. */`);
    lines.push(`    ${ident}?: Snippet;`);
  }
  // Only when there is somewhere to put them — see acceptsChildren.
  const takesChildren = acceptsChildren(meta);
  if (takesChildren) lines.push('    children?: Snippet;');
  lines.push(...passthroughMembers(meta.props, '    ', slotSnippets.values()));
  lines.push('  }');
  lines.push('');

  // Two-way bindings, derived from event detail keys that match prop names.
  const bindings = deriveBindings(meta, config);
  const boundProps = boundPropNames(bindings);
  const propTypes = new Map(meta.props.map((p) => [p.name, tsType(p)]));

  // A prop named after a reserved word can't be a binding name, so it is
  // renamed on the way in (`for: forProp`). The interface key, the attribute
  // and the element's own property all keep the real name.
  const locals = localNames(meta.props);
  const renamed = (name) => locals.get(name) !== name;

  // $props() destructuring with defaults. Bound props are wrapped in
  // $bindable() so the wrapper can write to them; this is backwards
  // compatible — a parent passing a plain value keeps working, the write
  // just stays local.
  const destructured = [];
  for (const prop of meta.props) {
    const def = svelteDefault(prop);
    const init = boundProps.has(prop.name) ? `$bindable(${def ?? ''})` : def;
    const binding = renamed(prop.name)
      ? `${prop.name}: ${locals.get(prop.name)}`
      : prop.name;
    if (init !== undefined) {
      destructured.push(`${binding} = ${init}`);
    } else {
      destructured.push(binding);
    }
  }
  for (const ident of slotSnippets.values()) destructured.push(ident);
  if (takesChildren) destructured.push('children');
  destructured.push('...rest');

  lines.push(`  let { ${destructured.join(', ')} }: Props = $props();`);

  // Props whose name changes under lowercasing can't be attributes at all —
  // Svelte writes `confirmLabel` as `confirmlabel`, which Lit never observes, so
  // the element silently keeps its constructor default. Kebab-case would be
  // worse: Lit's Boolean converter is presence-based, so `auto-resize="false"`
  // reads as true. These are set as properties instead, and left out of the
  // template below so no dead attribute is emitted alongside.
  const viaProperty = mixedCaseProps(meta.props);
  if (viaProperty.length > 0) {
    lines.push('');
    lines.push('  let __el: HTMLElement | undefined = $state();');
    lines.push('  $effect(() => {');
    lines.push('    const el = __el as unknown as Record<string, unknown> | undefined;');
    lines.push('    if (!el) return;');
    for (const prop of viaProperty) {
      const local = locals.get(prop.name);
      // Undefined is not written through: the point is to reach the element's
      // own default when the consumer passes nothing, not to overwrite it.
      lines.push(`    if (${local} !== undefined) el.${prop.name} = ${local};`);
    }
    lines.push('  });');
  }

  // Binding handlers. Without these the wrapper is write-only: Svelte's copy
  // of the prop never updates, so the next unrelated re-render re-sets the
  // stale value onto the element and silently reverts the user's input.
  const handlers = new Map();
  if (bindings.size > 0) {
    const used = new Set();
    lines.push('');
    lines.push('  // Two-way binding — mirror the event detail back onto the prop, then');
    lines.push('  // forward to the consumer\'s own handler, which {...rest} would otherwise');
    lines.push('  // have attached. These are declared after {...rest} below so they win.');
    for (const [event, props] of bindings) {
      const fn = handlerName(event, used, '__on');
      handlers.set(event, fn);
      lines.push(`  function ${fn}(e: Event) {`);
      lines.push(`    const detail = (e as CustomEvent).detail as Record<string, unknown> | null;`);
      lines.push('    if (detail) {');
      for (const name of props) {
        lines.push(`      if ('${name}' in detail) ${locals.get(name)} = detail.${name} as ${propTypes.get(name)};`);
      }
      lines.push('    }');
      lines.push(`    (rest['on${event}'] as ((e: Event) => void) | undefined)?.(e);`);
      lines.push('  }');
    }
  }

  lines.push('</script>');
  lines.push('');

  // Template
  // Shorthand `{name}` unless the local was renamed — `{forProp}` would bind
  // the wrong attribute, so those spell out `for={forProp}`.
  const byProperty = new Set(viaProperty.map((p) => p.name));
  const attrList = meta.props
    .filter((p) => !byProperty.has(p.name))
    .map((p) => (renamed(p.name) ? `${p.name}={${locals.get(p.name)}}` : `{${p.name}}`));
  if (viaProperty.length > 0) attrList.push('bind:this={__el}');
  const attrs = attrList.join(' ');
  const attrStr = attrs ? ` ${attrs} {...rest}` : ' {...rest}';

  if (handlers.size === 0) {
    lines.push(`<${meta.tag}${attrStr}>`);
  } else {
    lines.push(`<${meta.tag}${attrStr}`);
    for (const [event, fn] of handlers) {
      lines.push(`  on${event}={${fn}}`);
    }
    lines.push('>');
  }
  // Named slots first, in template order, then the default children. Order is
  // cosmetic for correctly-attributed content — the shadow slot decides where it
  // lands — but it keeps the emitted markup reading like the component's own.
  for (const ident of slotSnippets.values()) {
    lines.push(`  {@render ${ident}?.()}`);
  }
  if (takesChildren) lines.push(`  {@render children?.()}`);
  lines.push(`</${meta.tag}>`);
  lines.push('');

  writeFileSync(outPath, lines.join('\n'));
  return { path: outPath, written: true, priorVersion: claim.priorVersion };
}
