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
import { needsHandle, methodPhrase, handleName } from './handles.js';
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
  // One snippet prop per named slot — a slot the wrapper doesn't declare and
  // render renders nowhere, silently, with a clean build. Rendered bare, with
  // no carrier element, so `::slotted()` rules and slot layout still see the
  // real content; the consequence is that the `slot` attribute has to be on
  // the consumer's own element, where a `{#snippet}` body leaves it intact.
  const slotSnippets = slotSnippetNames(meta.slots ?? [], meta.props);
  // Only when there is somewhere to put them — see acceptsChildren.
  const takesChildren = acceptsChildren(meta);

  lines.push('<script lang="ts">');
  const register = registerImport(meta, config);
  lines.push(`  import '${register}';`);
  // The element's own type, for the handle below — the methods a consumer calls
  // through it are declared on the class, not on anything prism emits.
  const handle = needsHandle(meta, 'svelte');
  if (handle) lines.push(`  import type { ${meta.className} } from '${register}';`);
  // Both members that name `Snippet` are conditional, so the import is too: an
  // unused type import fails `svelte-check` under `noUnusedLocals`, and a
  // component with `@slot none` declares neither member.
  if (slotSnippets.size > 0 || takesChildren) {
    lines.push(`  import type { Snippet } from 'svelte';`);
  }
  lines.push('');

  // Props interface
  lines.push('  interface Props {');
  for (const prop of meta.props) {
    lines.push(`    ${prop.name}?: ${tsType(prop)};`);
  }
  for (const [slot, ident] of slotSnippets) {
    lines.push(`    /** <slot name="${slot}"> — put slot="${slot}" on the element inside. */`);
    lines.push(`    ${ident}?: Snippet;`);
  }
  if (takesChildren) lines.push('    children?: Snippet;');
  lines.push(...passthroughMembers(meta.props, '    ', slotSnippets.values()));
  lines.push('  }');
  lines.push('');

  // Two-way bindings — see deriveBindings for what makes a prop one.
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

  // Props whose name changes under lowercasing can't be attributes at all (see
  // mixedCaseProps) — set as properties instead, and left out of the template
  // below so no dead attribute is emitted alongside.
  const viaProperty = mixedCaseProps(meta.props);
  if (viaProperty.length > 0 || handle) {
    lines.push('');
    lines.push('  let __el: HTMLElement | undefined = $state();');
  }
  if (viaProperty.length > 0) {
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

  // The element itself. `bind:this` on this component yields the component, so
  // without this there is no route to the element at all — and every method the
  // component is driven by lives on it.
  if (handle) {
    const name = handleName(meta);
    lines.push('');
    lines.push(`  /**`);
    lines.push(`   * The element, for the methods it is driven by: ${methodPhrase(meta)}.`);
    lines.push(`   *`);
    lines.push(`   * A function rather than a property: an instance \`export\` in runes mode`);
    lines.push(`   * captures its binding once, which would be before the element exists.`);
    lines.push(`   * Reach it with \`bind:this\` on this component, then \`${name}()\`.`);
    lines.push(`   */`);
    lines.push(`  export function ${name}(): ${meta.className} | undefined {`);
    // `bind:this` on a tag Svelte has no entry for types as HTMLElement, so the
    // narrowing happens here rather than on the binding, where it would be an
    // error rather than a cast.
    lines.push(`    return __el as ${meta.className} | undefined;`);
    lines.push(`  }`);
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
      for (const { prop, key } of props) {
        lines.push(`      if ('${key}' in detail) ${locals.get(prop)} = detail.${key} as ${propTypes.get(prop)};`);
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
  if (viaProperty.length > 0 || handle) attrList.push('bind:this={__el}');
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
  // Named slots first, then the default children. Order is cosmetic — the
  // shadow slot decides where content lands — but keeps the emitted markup
  // reading like the component's own.
  for (const ident of slotSnippets.values()) {
    lines.push(`  {@render ${ident}?.()}`);
  }
  if (takesChildren) lines.push(`  {@render children?.()}`);
  lines.push(`</${meta.tag}>`);
  lines.push('');

  writeFileSync(outPath, lines.join('\n'));
  return { path: outPath, written: true, priorVersion: claim.priorVersion };
}
