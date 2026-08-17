/**
 * Generates Preact component (.tsx) files from ComponentMeta.
 * Native CE support — no wrapper library needed.
 *
 * The element is rendered with h('arc-x', …) rather than a JSX literal:
 * preact's JSX.IntrinsicElements has no entry for custom elements, so the
 * literal form fails to compile the moment the package is actually built,
 * while h() accepts any string tag. Runtime output is identical — JSX
 * desugars to the same call.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { HEADER, claimOutput } from './header.js';
import { tsType, passthroughMembers, projectsChildren } from './types.js';
import { localNames } from './identifiers.js';
import { registerImport } from './imports.js';

/**
 * Convert a custom event name to a handler prop name.
 * 'arc-change' → 'onArcChange'
 */
function eventToHandlerName(eventName) {
  return 'on' + eventName
    .split('-')
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join('');
}

/**
 * Generate a Preact component .tsx file.
 * @param {import('./parser.js').ComponentMeta} meta
 * @param {object} config - preact config section
 * @param {string} root - project root
 * @returns {{ path: string, written: boolean }}
 */
export function generatePreact(meta, config, root) {
  const outDir = join(root, config.outDir, meta.tier);
  const outPath = join(outDir, `${meta.pascalName}.tsx`);

  // Safety: never overwrite files without our header.
  const claim = claimOutput(outPath);
  if (!claim.ours) return { path: outPath, written: false };

  mkdirSync(outDir, { recursive: true });

  const lines = [HEADER, ''];

  const hasEvents = meta.events.length > 0;

  lines.push(`import { h, type FunctionComponent } from 'preact';`);
  // Preact lowercases `on*` handler names, so hyphenated custom events like
  // `arc-click` can't be bound as JSX props — attach them via addEventListener
  // in a layout effect against a ref instead.
  if (hasEvents) {
    lines.push(`import { useLayoutEffect, useRef } from 'preact/hooks';`);
  }
  lines.push(`import '${registerImport(meta, config)}';`);
  lines.push('');

  // Props interface
  lines.push(`export interface ${meta.pascalName}Props {`);
  for (const prop of meta.props) {
    lines.push(`  ${prop.name}?: ${tsType(prop)};`);
  }
  for (const event of meta.events) {
    lines.push(`  ${eventToHandlerName(event)}?: (e: CustomEvent) => void;`);
  }
  // Any declared slot, named or default — children reach the element either
  // way (an undestructured `children` rides `...rest` into `h()`'s props), so
  // the point is to stop the interface denying a member the component accepts.
  const takesChildren = projectsChildren(meta);
  if (takesChildren) lines.push('  children?: preact.ComponentChildren;');
  lines.push(...passthroughMembers(meta.props, '  '));
  lines.push('}');
  lines.push('');

  // Component. A prop named after a reserved word can't be a binding name, so
  // it is renamed on the way in (`for: forProp`) — the JSX attribute below
  // still carries the real name.
  const locals = localNames(meta.props);
  const destructured = meta.props.map((p) => (
    locals.get(p.name) === p.name ? p.name : `${p.name}: ${locals.get(p.name)}`
  ));
  for (const event of meta.events) destructured.push(eventToHandlerName(event));
  if (takesChildren) destructured.push('children');
  // `({ , ...rest })` is a syntax error. A component with no props, no events
  // and no children destructures nothing, which only became reachable once
  // `@slot none` let children be dropped from a propless component.
  const destructStr = destructured.length ? `${destructured.join(', ')}, ` : '';

  // Object-literal keys keep the real prop name even when the local binding
  // was renamed for a reserved word (`for: forProp` is a legal literal entry).
  const propEntries = meta.props.map((p) => (
    locals.get(p.name) === p.name ? p.name : `${p.name}: ${locals.get(p.name)}`
  ));

  if (hasEvents) {
    const propsObj = ['ref', ...propEntries, '...rest'].join(', ');
    lines.push(`export const ${meta.pascalName}: FunctionComponent<${meta.pascalName}Props> = ({ ${destructStr}...rest }) => {`);
    lines.push(`  const ref = useRef<HTMLElement>(null);`);
    lines.push(`  useLayoutEffect(() => {`);
    lines.push(`    const el = ref.current;`);
    lines.push(`    if (!el) return;`);
    lines.push(`    const listeners: Array<[string, EventListener]> = [];`);
    for (const event of meta.events) {
      const handler = eventToHandlerName(event);
      lines.push(`    if (${handler}) {`);
      lines.push(`      const fn: EventListener = (e) => ${handler}(e as CustomEvent);`);
      lines.push(`      el.addEventListener('${event}', fn);`);
      lines.push(`      listeners.push(['${event}', fn]);`);
      lines.push(`    }`);
    }
    lines.push(`    return () => listeners.forEach(([name, fn]) => el.removeEventListener(name, fn));`);
    lines.push(`  }, [${meta.events.map(eventToHandlerName).join(', ')}]);`);
    if (takesChildren) {
      lines.push(`  return h('${meta.tag}', { ${propsObj} }, children);`);
    } else {
      lines.push(`  return h('${meta.tag}', { ${propsObj} });`);
    }
    lines.push(`};`);
  } else {
    const propsObj = [...propEntries, '...rest'].join(', ');
    lines.push(`export const ${meta.pascalName}: FunctionComponent<${meta.pascalName}Props> = ({ ${destructStr}...rest }) =>`);
    if (takesChildren) {
      lines.push(`  h('${meta.tag}', { ${propsObj} }, children);`);
    } else {
      lines.push(`  h('${meta.tag}', { ${propsObj} });`);
    }
  }
  lines.push('');

  writeFileSync(outPath, lines.join('\n'));
  return { path: outPath, written: true, priorVersion: claim.priorVersion };
}
