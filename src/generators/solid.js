/**
 * Generates Solid component (.tsx) files from ComponentMeta.
 * Uses splitProps() for reactivity-safe prop forwarding.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { HEADER, claimOutput } from './header.js';
import { tsType, passthroughMembers, projectsChildren } from './types.js';
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
 * Generate a Solid component .tsx file.
 * @param {import('./parser.js').ComponentMeta} meta
 * @param {object} config - solid config section
 * @param {string} root - project root
 * @returns {{ path: string, written: boolean }}
 */
export function generateSolid(meta, config, root) {
  const outDir = join(root, config.outDir, meta.tier);
  const outPath = join(outDir, `${meta.pascalName}.tsx`);

  // Safety: never overwrite files without our header.
  const claim = claimOutput(outPath);
  if (!claim.ours) return { path: outPath, written: false };

  mkdirSync(outDir, { recursive: true });

  const lines = [HEADER, ''];

  lines.push(`import { splitProps, type Component, type JSX } from 'solid-js';`);
  lines.push(`import '${registerImport(meta, config)}';`);
  lines.push('');

  // Solid's JSX has no IntrinsicElements entry for custom elements, so the
  // tag below wouldn't compile without this augmentation. Deliberately just
  // Record<string, unknown> — the wrapper's props interface is the typed
  // surface consumers touch, and intersecting HTMLAttributes here would be
  // stricter than the passthrough members the wrapper itself declares.
  //
  // `solid-js/jsx-runtime`, not `solid-js`. Under the standard Solid setup —
  // `jsx: "preserve"`, `jsxImportSource: "solid-js"` — TypeScript resolves
  // JSX.IntrinsicElements through the *jsx-runtime* entry, which re-exports the
  // namespace from `solid-js/types/jsx`. Augmenting the main entry declares a
  // second, unrelated JSX namespace that nothing consults, and merging into an
  // unused namespace is not an error, so there is no diagnostic: 201 wrappers
  // in the reference consumer carried the block and none of it applied. Not
  // visible from the solid package's own build either — it compiles either way,
  // because the wrapper types its props separately and the intrinsic lookup only
  // matters to a consumer writing `<arc-input>` directly.
  lines.push(`declare module 'solid-js/jsx-runtime' {`);
  lines.push(`  namespace JSX {`);
  lines.push(`    interface IntrinsicElements {`);
  lines.push(`      '${meta.tag}': Record<string, unknown>;`);
  lines.push(`    }`);
  lines.push(`  }`);
  lines.push(`}`);
  lines.push('');

  // Props interface
  lines.push(`export interface ${meta.pascalName}Props {`);
  for (const prop of meta.props) {
    lines.push(`  ${prop.name}?: ${tsType(prop)};`);
  }
  for (const event of meta.events) {
    lines.push(`  ${eventToHandlerName(event)}?: (e: CustomEvent) => void;`);
  }
  // Any declared slot, not just the default one. Solid's spread does not insert
  // children the way Preact's `h(tag, props)` does, so without the member and
  // the `{local.children}` below there is nowhere for a consumer's
  // `<div slot="logo">` to go — it doesn't type-check, and if it did it would
  // render nothing.
  const takesChildren = projectsChildren(meta);
  if (takesChildren) lines.push('  children?: JSX.Element;');
  lines.push(...passthroughMembers(meta.props, '  '));
  lines.push('}');
  lines.push('');

  // Component. Handler props are split out and bound via Solid's `on:` custom
  // event namespace, which uses the literal (hyphenated) event name.
  const propNames = meta.props.map((p) => `'${p.name}'`);
  for (const event of meta.events) {
    propNames.push(`'${eventToHandlerName(event)}'`);
  }
  if (takesChildren) propNames.push(`'children'`);

  // Solid's `prop:` namespace sets a property rather than an attribute, which is
  // the only way a name that changes under lowercasing can reach the element —
  // `confirmLabel` as an attribute becomes `confirmlabel`, which Lit ignores.
  const propAttrs = meta.props.map((p) => (
    p.name === p.name.toLowerCase()
      ? `${p.name}={local.${p.name}}`
      : `prop:${p.name}={local.${p.name}}`
  ));
  const eventAttrs = meta.events.map(
    (e) => `on:${e}={local.${eventToHandlerName(e)}}`
  );
  const bound = [...propAttrs, ...eventAttrs].join(' ');
  const attrStr = bound ? ` ${bound} {...rest}` : ' {...rest}';

  lines.push(`export const ${meta.pascalName}: Component<${meta.pascalName}Props> = (props) => {`);
  lines.push(`  const [local, rest] = splitProps(props, [${propNames.join(', ')}]);`);
  lines.push(`  return (`);
  lines.push(`    <${meta.tag}${attrStr}>`);
  if (takesChildren) lines.push(`      {local.children}`);
  lines.push(`    </${meta.tag}>`);
  lines.push(`  );`);
  lines.push(`};`);
  lines.push('');

  writeFileSync(outPath, lines.join('\n'));
  return { path: outPath, written: true, priorVersion: claim.priorVersion };
}
