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
  // A function component drops `ref` before it reaches props, so the element is
  // unreachable from a consumer's ref unless the component is wrapped. That is
  // what `forwardRef` is for, and `preact/compat` ships with preact itself.
  const handle = needsHandle(meta, 'preact');
  const usesRef = hasEvents || handle;
  const register = registerImport(meta, config);

  lines.push(handle ? `import { h } from 'preact';` : `import { h, type FunctionComponent } from 'preact';`);
  if (handle) lines.push(`import { forwardRef } from 'preact/compat';`);
  // Preact lowercases `on*` handler names, so hyphenated custom events like
  // `arc-click` can't be bound as JSX props — attach them via addEventListener
  // in a layout effect against a ref instead.
  const hooks = [
    ...(handle ? ['useImperativeHandle'] : []),
    ...(hasEvents ? ['useLayoutEffect'] : []),
    ...(usesRef ? ['useRef'] : []),
  ];
  if (hooks.length > 0) {
    lines.push(`import { ${hooks.join(', ')} } from 'preact/hooks';`);
  }
  lines.push(`import '${register}';`);
  if (handle) lines.push(`import type { ${meta.className} } from '${register}';`);
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

  const propsObj = [...(usesRef ? ['ref'] : []), ...propEntries, '...rest'].join(', ');
  const call = takesChildren
    ? `h('${meta.tag}', { ${propsObj} }, children)`
    : `h('${meta.tag}', { ${propsObj} })`;

  // A one-expression component for the shape that needs no hooks; anything else
  // opens a body. `forwardRef` takes the same parameter list with the consumer's
  // ref beside it.
  if (!usesRef) {
    lines.push(`export const ${meta.pascalName}: FunctionComponent<${meta.pascalName}Props> = ({ ${destructStr}...rest }) =>`);
    lines.push(`  ${call};`);
  } else {
    if (handle) {
      lines.push(`/** Driven by its methods: ${methodPhrase(meta)}. A ref on it holds the element. */`);
      lines.push(`export const ${meta.pascalName} = forwardRef<${meta.className}, ${meta.pascalName}Props>(({ ${destructStr}...rest }, forwarded) => {`);
    } else {
      lines.push(`export const ${meta.pascalName}: FunctionComponent<${meta.pascalName}Props> = ({ ${destructStr}...rest }) => {`);
    }
    lines.push(`  const ref = useRef<${handle ? meta.className : 'HTMLElement'}>(null);`);
    if (handle) {
      // The element is the handle, rather than a facade over it: everything the
      // component declares stays reachable without prism restating any of it.
      lines.push(`  useImperativeHandle(forwarded, () => ref.current as ${meta.className}, []);`);
    }
    if (hasEvents) {
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
    }
    lines.push(`  return ${call};`);
    lines.push(handle ? `});` : `};`);
  }
  lines.push('');

  writeFileSync(outPath, lines.join('\n'));
  return { path: outPath, written: true, priorVersion: claim.priorVersion };
}
