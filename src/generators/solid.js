/**
 * Generates Solid component (.tsx) files from ComponentMeta.
 * Uses splitProps() for reactivity-safe prop forwarding.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { HEADER, claimOutput } from './header.js';
import { tsType, passthroughMembers, projectsChildren } from './types.js';
import { needsHandle, methodPhrase } from './handles.js';
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

  // `JSX` is imported only where the children member below uses it: an unused
  // type import fails `tsc` under `noUnusedLocals`, which is on in the template
  // every Solid consumer starts from — and a component with `@slot none` has no
  // children member at all.
  const takesChildren = projectsChildren(meta);
  lines.push(
    takesChildren
      ? `import { splitProps, type Component, type JSX } from 'solid-js';`
      : `import { splitProps, type Component } from 'solid-js';`
  );
  const register = registerImport(meta, config);
  lines.push(`import '${register}';`);
  const handle = needsHandle(meta, 'solid');
  if (handle) lines.push(`import type { ${meta.className} } from '${register}';`);
  lines.push('');

  // Solid's JSX has no IntrinsicElements entry for custom elements, so the tag
  // below wouldn't compile without this augmentation. Deliberately just
  // Record<string, unknown> — the wrapper's props interface is the typed
  // surface consumers touch.
  //
  // `solid-js/jsx-runtime`, not `solid-js`: under `jsxImportSource: "solid-js"`
  // TypeScript resolves JSX.IntrinsicElements through the jsx-runtime entry.
  // Augmenting the main entry declares a second, unrelated JSX namespace that
  // nothing consults — with no diagnostic, since merging into an unused
  // namespace is not an error.
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
  if (takesChildren) lines.push('  children?: JSX.Element;');
  if (handle) {
    lines.push(`  /** The element, for the methods it is driven by: ${methodPhrase(meta)}. */`);
    // Both spellings: Solid compiles `ref={el}` at the call site into a setter
    // function, so what arrives is always callable — but what the consumer
    // wrote, and what has to type-check, is the variable.
    lines.push(`  ref?: ${meta.className} | ((el: ${meta.className}) => void);`);
  }
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
  if (handle) propNames.push(`'ref'`);

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
  // Forwarded through a function rather than as `ref={local.ref}`: Solid's
  // element ref assigns to the expression when it isn't callable, and `local`
  // is a read-only view of props.
  const refAttr = handle
    ? [`ref={(el: ${meta.className}) => { if (typeof local.ref === 'function') local.ref(el); }}`]
    : [];
  const bound = [...propAttrs, ...eventAttrs, ...refAttr].join(' ');
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
