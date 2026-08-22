/**
 * Generates Vue 3 SFC (.vue) files from ComponentMeta.
 * Uses defineProps with TS generics and defineEmits for type safety.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { HEADER_HTML as HEADER, claimOutput } from './header.js';
import { tsType, acceptsChildren, typedDefault } from './types.js';
import { deriveBindings, boundPropNames, handlerName } from './bindings.js';
import { needsHandle, methodPhrase, handleName } from './handles.js';
import { registerImport } from './imports.js';

/** Format a default value for Vue's withDefaults(). */
function vueDefault(prop) {
  return typedDefault(prop, { arrayFactory: true });
}

/**
 * Generate a Vue 3 SFC .vue file for a component.
 * @param {import('./parser.js').ComponentMeta} meta
 * @param {object} config - vue config section
 * @param {string} root - project root
 * @returns {{ path: string, written: boolean }}
 */
export function generateVue(meta, config, root) {
  const outDir = join(root, config.outDir, meta.tier);
  const outPath = join(outDir, `${meta.pascalName}.vue`);

  // Safety: never overwrite files without our header.
  const claim = claimOutput(outPath);
  if (!claim.ours) return { path: outPath, written: false };

  mkdirSync(outDir, { recursive: true });

  const lines = [HEADER];

  // <script setup lang="ts">
  lines.push('<script setup lang="ts">');
  const register = registerImport(meta, config);
  lines.push(`import '${register}';`);
  // The element itself has to be reachable from a component driven by methods:
  // a template ref on this SFC yields the SFC instance, and `defineExpose` is
  // the only thing that puts anything on it.
  const handle = needsHandle(meta, 'vue');
  if (handle) {
    lines.push(`import { ref } from 'vue';`);
    lines.push(`import type { ${meta.className} } from '${register}';`);
  }
  lines.push('');
  lines.push(`defineOptions({ name: '${meta.pascalName}' });`);
  lines.push('');

  // Props
  const hasProps = meta.props.length > 0;
  // Whether anything is actually emittable, not whether a source default was
  // recorded: a prop whose only default is unrepresentable (`undefined`, a
  // string against a Number type) contributes nothing, and asking the raw
  // source would wrap the props in a `withDefaults(…, {})` with an empty
  // object — legal, and a lie about the component.
  const hasDefaults = meta.props.some((p) => vueDefault(p) !== undefined);

  if (hasProps) {
    const propsBlock = meta.props
      .map((p) => `  ${p.name}?: ${tsType(p)};`)
      .join('\n');

    // The props object is captured rather than left unassigned so the template
    // can read every prop through it. A prop named after a reserved word
    // (`for`, `class`, `default`) is illegal as a bare identifier in a template
    // expression but fine as a property access, so `props.for` retires the
    // whole class of problem instead of special-casing individual names.
    if (hasDefaults) {
      lines.push(`const props = withDefaults(defineProps<{`);
      lines.push(propsBlock);
      lines.push(`}>(), {`);
      for (const prop of meta.props) {
        const def = vueDefault(prop);
        if (def !== undefined) {
          lines.push(`  ${prop.name}: ${def},`);
        }
      }
      lines.push(`});`);
    } else {
      lines.push(`const props = defineProps<{`);
      lines.push(propsBlock);
      lines.push(`}>();`);
    }
  }

  // Two-way bindings — see deriveBindings for what makes a prop one. Without
  // the matching `update:x` emit, `v-model:x` on the wrapper silently does
  // nothing and every re-render re-sets the stale prop onto the element.
  const twoWay = deriveBindings(meta, config);
  const boundProps = boundPropNames(twoWay);
  const propTypes = new Map(meta.props.map((p) => [p.name, tsType(p)]));

  // Events — capture the emit function so template listeners can relay the
  // underlying custom events. Declaring these in defineEmits also removes them
  // from Vue's native listener fallthrough, so they MUST be wired explicitly in
  // the template below or the parent's @arc-click handler would never fire.
  const hasEvents = meta.events.length > 0;
  if (hasEvents) {
    lines.push('');
    lines.push(`const emit = defineEmits<{`);
    for (const event of meta.events) {
      lines.push(`  '${event}': [event: CustomEvent];`);
    }
    // `update:x` is what v-model:x listens for.
    for (const prop of meta.props) {
      if (boundProps.has(prop.name)) {
        lines.push(`  'update:${prop.name}': [value: ${tsType(prop)}];`);
      }
    }
    lines.push(`}>();`);
  }

  // Named handlers for events that write a prop back. Declared here rather
  // than inline in the template so the `in` guard is readable.
  const handlers = new Map();
  if (twoWay.size > 0) {
    // Seed with prop names — and `props` itself — so a handler can never
    // shadow either in the template.
    const used = new Set([...meta.props.map((p) => p.name), 'props']);
    lines.push('');
    for (const [event, props] of twoWay) {
      const fn = handlerName(event, used);
      handlers.set(event, fn);
      lines.push(`function ${fn}(payload: CustomEvent) {`);
      lines.push(`  emit('${event}', payload);`);
      lines.push(`  const detail = payload.detail as Record<string, unknown> | null;`);
      lines.push('  if (detail) {');
      for (const { prop, key } of props) {
        lines.push(`    if ('${key}' in detail) emit('update:${prop}', detail.${key} as ${propTypes.get(prop)});`);
      }
      lines.push('  }');
      lines.push('}');
    }
  }

  if (handle) {
    const name = handleName(meta);
    lines.push('');
    lines.push(`const __el = ref<${meta.className} | null>(null);`);
    lines.push(`/** The element, for the methods it is driven by: ${methodPhrase(meta)}. */`);
    // Exposed refs are unwrapped on the way out, so a consumer's template ref
    // reads `.${name}` and has the element, not another ref.
    lines.push(`defineExpose({ ${name}: __el });`);
  }

  lines.push('</script>');
  lines.push('');

  // <template>
  lines.push('<template>');

  // Build attribute and event bindings on the wrapped element.
  const bindings = meta.props.map((p) => `    :${p.name}="props.${p.name}"`);
  const eventBindings = meta.events.map((e) => (
    handlers.has(e)
      ? `    @${e}="${handlers.get(e)}"`
      : `    @${e}="(payload: CustomEvent) => emit('${e}', payload)"`
  ));
  // A string `ref` inside `<script setup>` binds to the setup variable of the
  // same name — the form that works from Vue 3.0, unlike `useTemplateRef`.
  const allBindings = [...bindings, ...eventBindings, ...(handle ? ['    ref="__el"'] : [])];

  if (allBindings.length > 0) {
    lines.push(`  <${meta.tag}`);
    lines.push(allBindings.join('\n'));
    lines.push(`  >`);
  } else {
    lines.push(`  <${meta.tag}>`);
  }

  // Forward each named slot as well as the default one — without a forwarded
  // outlet, a consumer's `<template #start>` content is dropped. As in Svelte,
  // no carrier element: the `slot` attribute belongs on the consumer's own
  // element, which Vue 3 leaves alone (it removed `slot` as syntax).
  if (acceptsChildren(meta)) lines.push(`    <slot />`);
  for (const slot of meta.slots ?? []) {
    lines.push(`    <slot name="${slot}" />`);
  }
  lines.push(`  </${meta.tag}>`);
  lines.push('</template>');
  lines.push('');

  writeFileSync(outPath, lines.join('\n'));
  return { path: outPath, written: true, priorVersion: claim.priorVersion };
}
