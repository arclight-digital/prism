/**
 * Generates Angular standalone component (.ts) files from ComponentMeta.
 *
 * The component attaches to the custom element itself (element selector, no
 * inner element in the template). The v2 shape rendered a second `<arc-x>`
 * inside the template while the host — carrying the same tag — upgraded into
 * a real instance of the element too, so every wrapper double-rendered:
 * doubled borders and ARIA, with the bindings reaching only the inner copy.
 *
 * Host attachment also retires the entire attr-vs-property binding matrix the
 * v2 generator carried (boolean/array/object props, names that change under
 * lowercasing, template-grammar reserved words like `as`): inputs are accessor
 * pairs that write the DOM property on the host directly, which works
 * uniformly for every prop name and type.
 *
 * Events need no re-emit outputs — they fire natively from the host, so
 * `(arc-change)` binds as a plain DOM event. Only the `xChange` outputs that
 * desugar Angular's `[(x)]` two-way form are generated, fed by host listeners.
 *
 * Form-associated elements also get a ControlValueAccessor, which is what makes
 * `formControlName`, `formControl` and `[(ngModel)]` work. Without one they do
 * not fail — they bind nothing and report nothing, leaving the control pristine
 * and empty while the element on screen holds the user's text. Which property a
 * form binds, and when it commits, is decided in form-control.js.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { HEADER, claimOutput } from './header.js';
import { tsType, projectsChildren } from './types.js';
import { deriveBindings, boundPropNames } from './bindings.js';
import { formBinding } from './form-control.js';
import { registerImport } from './imports.js';

/**
 * Convert a custom event name to a sync-method name that can't collide with
 * an @Input (props are never underscore-prefixed): 'arc-change' → '_onArcChange'.
 */
function syncMethodName(eventName) {
  const pascal = eventName.replace(/(?:^|-)([a-z])/g, (_, c) => c.toUpperCase());
  return `_on${pascal}`;
}

/**
 * The ControlValueAccessor members, appended inside the class body.
 *
 * Four details here each cost something to find:
 *
 * 1. **The listener is attached in the constructor, not through `host`.** The
 *    decorator's host metadata already maps the change event to this
 *    component's own `@Output`, and a host object cannot carry two handlers for
 *    one event. Field initializers run before the constructor body, so `_el` is
 *    populated and `inject()` has already done its work in an injection context.
 *
 * 2. **`writeValue` must not call `_onChangeFn`.** It is the form writing *into*
 *    the element; echoing it back marks the control dirty on every programmatic
 *    `setValue`. Easy to add "for symmetry" and wrong.
 *
 * 3. **The change handler reads the element, not the event.** The element has
 *    already updated itself by the time it dispatches, so there is no detail
 *    shape to agree on and a control whose event carries nothing still works.
 *
 * 4. **The reset value follows the property's declared type** — `''` for string,
 *    `false` for boolean, `0` for number, `[]` for arrays, and a union's own
 *    default for a union, because `''` is not a member of `'sm' | 'md'` and the
 *    package would not compile. Angular calls `writeValue(null)` on reset
 *    routinely, so this path is not an edge case.
 *
 * @param {ReturnType<import('./form-control.js').formBinding>} cva
 * @returns {string[]}
 */
function accessorMembers(cva) {
  const { parts, composite, type, empty, event, disabled } = cva;
  const readBack = composite
    ? `{ ${parts.map((p) => `${p.name}: this._el.${p.name}`).join(', ')} }`
    : `this._el.${parts[0].name}`;

  const lines = [
    '',
    '  /* ── ControlValueAccessor ──',
    '',
    `     Bound to \`${parts.map((p) => p.name).join('` / `')}\`, committed on \`${event}\`.`,
    '     The listener is attached here rather than through the host metadata,',
    '     which already maps that event to this component’s own @Output and',
    '     cannot carry two handlers for one event.',
    '',
    '     writeValue deliberately does not call _onChangeFn: it is the form',
    '     writing into the element, and echoing it back would mark the control',
    '     dirty on every programmatic setValue. */',
    `  private _onChangeFn: (value: ${type}) => void = () => {};`,
    '  private _onTouchedFn: () => void = () => {};',
    '',
    '  constructor() {',
    `    this._el.addEventListener('${event}', () => {`,
    `      this._onChangeFn(${readBack});`,
    '      this._onTouchedFn();',
    '    });',
    '  }',
    '',
    `  writeValue(value: ${type} | null | undefined): void {`,
  ];

  if (empty === null) {
    // Nothing this property's declared type admits as empty — a documented
    // object shape with no default. Writing one anyway is a compile error in the
    // consumer's package, so a reset leaves the element as it is and says so.
    lines.push('    // No value this property\'s type admits as empty, so a reset leaves');
    lines.push('    // the element holding what it has rather than emitting a value that');
    lines.push('    // would not compile against its declared type.');
    lines.push('    if (value === null || value === undefined) return;');
    for (const p of parts) {
      lines.push(`    this._el.${p.name} = value${composite ? `.${p.name}` : ''};`);
    }
  } else {
    lines.push(`    const next = value ?? ${empty};`);
    for (const p of parts) {
      lines.push(`    this._el.${p.name} = next${composite ? `.${p.name}` : ''};`);
    }
  }

  lines.push(
    '  }',
    '',
    `  registerOnChange(fn: (value: ${type}) => void): void {`,
    '    this._onChangeFn = fn;',
    '  }',
    '',
    '  registerOnTouched(fn: () => void): void {',
    '    this._onTouchedFn = fn;',
    '  }',
  );

  if (disabled) {
    lines.push(
      '',
      '  setDisabledState(isDisabled: boolean): void {',
      '    this._el.disabled = isDisabled;',
      '  }',
    );
  } else {
    lines.push(
      '',
      '  /* No `disabled` property on this element, so a disabled form control',
      '     cannot be expressed here. The method is optional in the interface. */',
    );
  }

  return lines;
}

/**
 * Generate an Angular standalone component .ts file.
 * @param {import('./parser.js').ComponentMeta} meta
 * @param {object} config - angular config section
 * @param {string} root - project root
 * @returns {{ path: string, written: boolean }}
 */
export function generateAngular(meta, config, root) {
  const outDir = join(root, config.outDir, meta.tier);
  const outPath = join(outDir, `${meta.pascalName}.ts`);

  // Safety: never overwrite files without our header.
  const claim = claimOutput(outPath);
  if (!claim.ours) return { path: outPath, written: false };

  mkdirSync(outDir, { recursive: true });

  const register = registerImport(meta, config);
  const lines = [HEADER, ''];

  // Two-way bindings, derived from event detail keys that match prop names.
  // Angular's `[(x)]` desugars to `[x]` + `(xChange)`, so without the matching
  // output the banana-in-a-box form doesn't compile at all.
  const twoWay = deriveBindings(meta, config);
  const boundProps = boundPropNames(twoWay);
  const propTypes = new Map(meta.props.map((p) => [p.name, tsType(p)]));

  // A ControlValueAccessor, for the components a form can actually bind to.
  // `problem` means prism knows this is a form control but not what a form
  // should read on it; the wrapper is still generated, without an accessor, and
  // the CLI reports the same finding from the same function.
  const form = formBinding(meta, config);
  const cva = form && !form.problem ? form : null;

  // Imports. A component class can share its name with an Angular symbol
  // (arc-input's wrapper is `Input`, the decorator's name), so any colliding
  // import is aliased with an Ng prefix — the alias is a plain import binding,
  // which ngtsc resolves like the original.
  const alias = (name) => (name === meta.pascalName ? `Ng${name}` : name);
  const angularImports = ['Component', 'ElementRef', 'inject'];
  if (meta.props.length > 0) angularImports.push('Input');
  if (boundProps.size > 0) angularImports.push('Output', 'EventEmitter');
  // `forwardRef` because the provider below names the class from inside its own
  // decorator, where the binding does not exist yet.
  if (cva) angularImports.push('forwardRef');

  const ngName = new Map(angularImports.map((name) => [name, alias(name)]));
  const importSpecifiers = angularImports.map((name) =>
    ngName.get(name) === name ? name : `${name} as ${ngName.get(name)}`
  );

  lines.push(`import { ${importSpecifiers.join(', ')} } from '@angular/core';`);
  // `@angular/forms` becomes a peer dependency of the wrapper package. It is
  // first-party and present in any Angular app using forms, but it is a real
  // requirement added to every consumer — and `NG_VALUE_ACCESSOR` is a runtime
  // value rather than a type, so an optional peer would not do.
  const token = alias('NG_VALUE_ACCESSOR');
  const iface = alias('ControlValueAccessor');
  if (cva) {
    const specifiers = [
      token === 'NG_VALUE_ACCESSOR' ? token : `NG_VALUE_ACCESSOR as ${token}`,
      iface === 'ControlValueAccessor' ? `type ${iface}` : `type ControlValueAccessor as ${iface}`,
    ];
    lines.push(`import { ${specifiers.join(', ')} } from '@angular/forms';`);
  }
  // Two imports of one module, and the bare one is the load-bearing half. The
  // element class is used only to type the host reference below, so a single
  // `import { ArcTopBar }` is erased entirely by TypeScript — taking the
  // `customElements.define` side effect with it. That shipped: the built
  // package contained zero imports of the element library, every wrapper
  // rendered an unupgraded `HTMLUnknownElement`, and each `@Input()` wrote an
  // expando onto it. `import type` says the second line is meant to vanish, so
  // registration can't depend on it accidentally surviving.
  lines.push(`import '${register}';`);
  lines.push(`import type { ${meta.className} } from '${register}';`);
  lines.push('');

  // A single bare `<ng-content />` projects consumer children into the host's
  // light DOM; the element's own shadow slots then assign them, named ones
  // included, from the `slot` attribute the consumer wrote. So no
  // `<ng-content select=…>` per slot — Angular's job ends at the light DOM, and
  // assignment is the custom element's. Which is also why the outlet is needed
  // for a component whose slots are *all* named: it is the only route in.
  const template = projectsChildren(meta) ? '<ng-content />' : '';

  // Host listeners feed the `xChange` outputs. The element updates itself
  // before dispatching, so there is no local state to write back — the input
  // accessors below always read the live DOM property.
  const hostListeners = [...twoWay.keys()].map(
    (event) => `    '(${event})': '${syncMethodName(event)}($event)',`
  );

  // @Component decorator
  lines.push(`@${ngName.get('Component')}({`);
  lines.push(`  selector: '${meta.tag}',`);
  lines.push(`  standalone: true,`);
  lines.push(`  template: \`${template}\`,`);
  if (hostListeners.length > 0) {
    lines.push(`  host: {`);
    lines.push(...hostListeners);
    lines.push(`  },`);
  }
  if (cva) {
    lines.push(`  providers: [`);
    lines.push(`    { provide: ${token}, useExisting: ${ngName.get('forwardRef')}(() => ${meta.pascalName}), multi: true },`);
    lines.push(`  ],`);
  }
  lines.push(`})`);
  lines.push(`export class ${meta.pascalName}${cva ? ` implements ${iface}` : ''} {`);
  lines.push(`  private readonly _el: ${meta.className} = ${ngName.get('inject')}(${ngName.get('ElementRef')}).nativeElement;`);

  // @Input() accessor pairs forwarding to the host element's properties. No
  // local defaults: an unbound input never fires the setter and the element
  // keeps its own default, so wrapper and element can't disagree.
  for (const prop of meta.props) {
    const type = propTypes.get(prop.name);
    lines.push('');
    lines.push(`  @${ngName.get('Input')}() set ${prop.name}(value: ${type}) {`);
    lines.push(`    this._el.${prop.name} = value;`);
    lines.push(`  }`);
    lines.push(`  get ${prop.name}(): ${type} {`);
    lines.push(`    return this._el.${prop.name};`);
    lines.push(`  }`);
  }

  // `xChange` outputs — the second half of Angular's `[(x)]` two-way form.
  for (const prop of meta.props) {
    if (boundProps.has(prop.name)) {
      lines.push('');
      lines.push(`  @${ngName.get('Output')}() ${prop.name}Change = new ${ngName.get('EventEmitter')}<${propTypes.get(prop.name)}>();`);
    }
  }

  for (const [event, props] of twoWay) {
    lines.push('');
    lines.push(`  ${syncMethodName(event)}(event: CustomEvent) {`);
    lines.push(`    const detail = event.detail as Record<string, unknown> | null;`);
    lines.push('    if (!detail) return;');
    for (const name of props) {
      lines.push(`    if ('${name}' in detail) {`);
      lines.push(`      this.${name}Change.emit(detail.${name} as ${propTypes.get(name)});`);
      lines.push('    }');
    }
    lines.push('  }');
  }

  if (cva) lines.push(...accessorMembers(cva));

  lines.push('}');
  lines.push('');

  writeFileSync(outPath, lines.join('\n'));
  return { path: outPath, written: true, priorVersion: claim.priorVersion };
}
