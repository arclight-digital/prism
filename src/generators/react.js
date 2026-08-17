/**
 * Generates React wrapper TypeScript files from ComponentMeta.
 * Uses @lit/react createComponent for proper property/attribute handling and SSR.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { HEADER, claimOutput } from './header.js';
import { tsType, projectsChildren } from './types.js';
import { registerImport } from './imports.js';

/**
 * Convert a custom event name to a React handler prop name.
 * 'arc-change' → 'onArcChange'
 * 'click' → 'onClick'
 */
function eventToReactProp(eventName) {
  return 'on' + eventName
    .split('-')
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join('');
}

/**
 * Generate a React wrapper .ts file for a component.
 * @param {import('./parser.js').ComponentMeta} meta
 * @param {object} config - react config section
 * @param {string} root - project root
 * @returns {{ path: string, written: boolean }}
 */
export function generateReact(meta, config, root) {
  const outDir = join(root, config.outDir, meta.tier);
  const outPath = join(outDir, `${meta.pascalName}.ts`);

  // Safety: never overwrite files without our header.
  const claim = claimOutput(outPath);
  if (!claim.ours) return { path: outPath, written: false };

  mkdirSync(outDir, { recursive: true });

  const prefix = config.prefix;
  // Per-component register subpath ('arc-button' → '@arclux/arc-ui/button'):
  // registers the element (guarded) and pulls in only this component's chain,
  // instead of the root barrel which registers all components. Here the class
  // is also a value — `elementClass` below — so this import survives on its own.
  const register = registerImport(meta, config);

  // Compute events up front so the `EventName` type import can be omitted for
  // components with no events — an unused type import fails `tsc` under
  // `noUnusedLocals` (on by default in Vite's react-ts template).
  const eventMap = buildEventMap(meta, prefix);
  const hasEvents = Object.keys(eventMap).length > 0;

  const lines = [HEADER, ''];
  lines.push(`import React from 'react';`);
  lines.push(
    hasEvents
      ? `import { createComponent, type EventName } from '@lit/react';`
      : `import { createComponent } from '@lit/react';`
  );
  lines.push(`import { ${meta.className} } from '${register}';`);
  lines.push('');

  // Build props interface (exported for consumers)
  lines.push(`export interface ${meta.pascalName}Props {`);

  for (const prop of meta.props) {
    lines.push(`  ${prop.name}?: ${tsType(prop)};`);
  }

  // Always add className and children. Children for any declared slot, named or
  // default: `createComponent` forwards them to the light DOM either way, so
  // this interface is the only thing that would have said a component taking
  // `<span slot="logo">` doesn't take children.
  lines.push('  className?: string;');
  if (projectsChildren(meta)) lines.push('  children?: React.ReactNode;');

  // Add event handler props to interface
  for (const [propName, eventName] of Object.entries(eventMap)) {
    if (eventName.startsWith(prefix + '-')) {
      lines.push(`  ${propName}?: (e: CustomEvent) => void;`);
    } else {
      lines.push(`  ${propName}?: (e: Event) => void;`);
    }
  }

  lines.push('}');
  lines.push('');

  // Build createComponent call
  lines.push(`export const ${meta.pascalName} = createComponent({`);
  lines.push(`  tagName: '${meta.tag}',`);
  lines.push(`  elementClass: ${meta.className},`);
  lines.push(`  react: React,`);

  if (hasEvents) {
    lines.push(`  events: {`);
    for (const [propName, eventName] of Object.entries(eventMap)) {
      const eventType = eventName.startsWith(prefix + '-') ? 'CustomEvent' : 'Event';
      lines.push(`    ${propName}: '${eventName}' as EventName<${eventType}>,`);
    }
    lines.push(`  },`);
  }

  lines.push('});');
  lines.push('');

  writeFileSync(outPath, lines.join('\n'));
  return { path: outPath, written: true, priorVersion: claim.priorVersion };
}

/**
 * Build the event map for a component.
 */
function buildEventMap(meta, prefix = 'arc') {
  const eventMap = {};
  for (const event of meta.events) {
    eventMap[eventToReactProp(event)] = event;
  }
  // Add native click for button-like components
  if (!meta.events.includes('click') && (meta.tag === prefix + '-button' || meta.template.includes('<button'))) {
    eventMap.onClick = 'click';
  }
  return eventMap;
}
