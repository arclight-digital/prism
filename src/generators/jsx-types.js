/**
 * Generates the opt-in JSX declaration files for consumers who render the
 * custom elements *directly* — `<arc-input value="…">` — rather than through a
 * wrapper package. Prism knows both halves: the per-component surface, from
 * the same parse the wrappers come from, and the per-framework attribute
 * conventions, from writing six wrappers against them.
 *
 * The base attribute set is per framework, and that is where the content is:
 * one shared shape would type `className` for Solid (where it does nothing)
 * and omit `on:` — Solid's event directive, and the only way to reach a
 * custom event from JSX with no ref. Preact's `on${string}` stays loose for
 * the opposite reason: Preact lowercases handler names, so a dashed event
 * isn't reachable from a plain prop at all.
 *
 * The activation instruction written into each file's header is load-bearing:
 * a tsconfig `types` entry and a `/// <reference types=…>` both look right and
 * both silently do nothing, because TypeScript resolves a `types` entry as a
 * *package* and never follows an export-map subpath — with no diagnostic.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { HEADER, claimOutput } from './header.js';
import { tsType } from './types.js';

/* Shared across all three: every framework passes data-* and aria-* through
   untouched, and none of them validates the value. */
const OPEN_ATTRS =
  '} & { [attr: `data-${string}`]: unknown } & { [attr: `aria-${string}`]: unknown } & {';

/**
 * The frameworks this generator knows how to write for, and the module each one
 * resolves `JSX.IntrinsicElements` through.
 */
const TARGETS = {
  react: {
    file: 'react-jsx.d.ts',
    module: 'react',
    label: 'React 19',
    /* React accepts `class` on a custom element and `className` on everything,
       and both are spelled out because consumers write both. */
    base: [
      '  children?: unknown;',
      '  key?: string | number | null;',
      '  ref?: unknown;',
      '  class?: string;',
      '  className?: string;',
      '  style?: unknown;',
      '  id?: string;',
      '  slot?: string;',
      '  part?: string;',
      '  hidden?: boolean;',
      '  title?: string;',
      '  role?: string;',
      '  tabIndex?: number;',
      OPEN_ATTRS,
      '  [attr: `on${string}`]: unknown;',
    ],
  },
  preact: {
    file: 'preact-jsx.d.ts',
    module: 'preact',
    label: 'Preact 10',
    /* Preact sets a DOM property when one exists and falls back to an attribute,
       so both spellings of class and tabindex are real. `on${string}` is
       deliberately loose — see the note at the top of this file. */
    base: [
      '  children?: unknown;',
      '  key?: string | number | null;',
      '  ref?: unknown;',
      '  class?: string;',
      '  className?: string;',
      '  style?: unknown;',
      '  id?: string;',
      '  slot?: string;',
      '  part?: string;',
      '  hidden?: boolean;',
      '  title?: string;',
      '  role?: string;',
      '  tabIndex?: number;',
      '  tabindex?: number;',
      '  dangerouslySetInnerHTML?: { __html: string };',
      OPEN_ATTRS,
      '  [attr: `on${string}`]: unknown;',
    ],
  },
  solid: {
    file: 'solid-jsx.d.ts',
    /* `solid-js/jsx-runtime`, not `solid-js` — the same distinction the Solid
       wrapper generator gets wrong at its peril. Under `jsxImportSource:
       "solid-js"` TypeScript resolves JSX.IntrinsicElements through the
       jsx-runtime entry; augmenting the main entry declares a second, unrelated
       JSX namespace that nothing consults, with no diagnostic. */
    module: 'solid-js/jsx-runtime',
    label: 'Solid 1',
    /* Solid's is the base set carrying real information. `on:` binds a listener
       by exact event name, which is how `arc-change` is reached from JSX with no
       ref; `prop:` forces a DOM property rather than an attribute, which is how
       an array or object reaches a component that declares one; `attr:` forces
       the other direction. None of the three exists in React or Preact, and
       `classList` is Solid's own. */
    base: [
      '  children?: unknown;',
      '  ref?: unknown;',
      '  class?: string;',
      '  classList?: Record<string, boolean | undefined>;',
      '  style?: unknown;',
      '  id?: string;',
      '  slot?: string;',
      '  part?: string;',
      '  hidden?: boolean;',
      '  title?: string;',
      '  role?: string;',
      '  tabindex?: number | string;',
      OPEN_ATTRS,
      '  [directive: `on:${string}`]: unknown;',
      '  [directive: `oncapture:${string}`]: unknown;',
      '  [directive: `prop:${string}`]: unknown;',
      '  [directive: `attr:${string}`]: unknown;',
      '  [directive: `use:${string}`]: unknown;',
      '  [attr: `on${string}`]: unknown;',
    ],
  },
};

/** Frameworks `config.jsxTypes.frameworks` may name. */
export const JSX_FRAMEWORKS = Object.keys(TARGETS);

/**
 * The type of a prop as written in *markup*. A documented union stays a union
 * — a wrong enum value being a compile error is most of what these files are
 * worth. A number widens to accept its string form (`count="3"` is not wrong);
 * everything else is the wrapper's own type, since all three frameworks set a
 * DOM property when the element has one.
 */
function jsxType(prop) {
  if (!prop.docType && !(prop.values?.length > 0) && prop.type === 'Number') {
    return 'number | string';
  }
  return tsType(prop);
}

/** An interface key, quoted only when it has to be. */
function key(name) {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : `'${name}'`;
}

/**
 * The members for one element: its attribute spellings, plus the property
 * spelling wherever the two differ. Both are emitted because both work —
 * `confirmLabel` is `confirmlabel` as an attribute (Lit lowercases, it does
 * not kebab-case), and the camelCase form sets the DOM property. Typing only
 * one makes the other a compile error against an element that handles it fine.
 */
function elementMembers(meta, indent) {
  const lines = [];
  const seen = new Set();
  for (const prop of meta.props) {
    const type = jsxType(prop);
    if (prop.attribute && !seen.has(prop.attribute)) {
      seen.add(prop.attribute);
      lines.push(`${indent}${key(prop.attribute)}?: ${type};`);
    }
    if (!seen.has(prop.name)) {
      seen.add(prop.name);
      lines.push(`${indent}${key(prop.name)}?: ${type};`);
    }
  }
  return lines;
}

/** The header block that says how to actually apply the file. */
function activation(target, packageName, typesDir) {
  const published = `${packageName}/${typesDir}/${target.file}`;
  const subpath = `${packageName}/${target.file.replace(/\.d\.ts$/, '')}`;
  return [
    HEADER,
    `// Opt-in JSX typings for using these custom elements directly in ${target.label}`,
    '// — no wrapper. The wrapper package is the other supported path; both are.',
    '//',
    '// Add this file to your program. Either in tsconfig:',
    '//',
    `//   { "include": ["src", "node_modules/${published}"] }`,
    '//',
    '// or from one file in the project:',
    '//',
    `//   /// <reference path="./node_modules/${published}" />`,
    '//',
    `// NOT \`{ "types": ["${subpath}"] }\` and NOT`,
    `// \`/// <reference types="${subpath}" />\`. Both look right and both`,
    '// silently do nothing: TypeScript resolves a `types` entry as a *package*',
    '// — node_modules/@types/<name>, or <name>/package.json#types — and never',
    '// follows an export-map subpath. Nothing resolves, nothing is included,',
    '// every tag stays untyped, and there is no diagnostic. A `files` entry',
    '// pointing outside the consuming project is a third silent no-op.',
    '',
    // Makes the file a module, which is what a `declare module` augmentation
    // requires; without it the block below declares a new module instead of
    // augmenting the framework's.
    'export {};',
    '',
  ];
}

/**
 * Write the JSX declaration files for every configured framework.
 *
 * Whole-catalog output, like the CSS bundle: one file per framework naming every
 * tag, so it needs the complete meta set and never runs in single-file mode.
 *
 * @param {import('../parser.js').ComponentMeta[]} metas
 * @param {object} config - the `jsxTypes` config section
 * @param {string} root - project root
 * @returns {Array<{ path: string, written: boolean, framework: string, tags: number }>}
 */
export function generateJSXTypes(metas, config, root) {
  const outDir = join(root, config.outDir);
  const frameworks = config.frameworks ?? JSX_FRAMEWORKS;
  const packageName = config.wcPackage || `@${config.prefix}/${config.prefix}-ui`;
  // The directory as the *package* publishes it, which is the last segment of
  // outDir — `packages/web-components/types` is shipped as `<pkg>/types`.
  const typesDir = basename(config.outDir);
  // Named from the prefix, like everything else prism emits — a project whose
  // components are `<ui-button>` gets `UiBaseAttributes`.
  const baseType = `${config.prefix.charAt(0).toUpperCase()}${config.prefix.slice(1)}BaseAttributes`;

  // Sorted by tag: these files are one long list, and the order components
  // happen to be discovered in would otherwise churn the diff on every rename.
  const elements = [...metas].sort((a, b) => a.tag.localeCompare(b.tag));

  const results = [];
  for (const framework of frameworks) {
    const target = TARGETS[framework];
    if (!target) continue;

    const outPath = join(outDir, target.file);
    const claim = claimOutput(outPath);
    if (!claim.ours) {
      results.push({ path: outPath, written: false, framework, tags: elements.length });
      continue;
    }
    mkdirSync(outDir, { recursive: true });

    const lines = [
      ...activation(target, packageName, typesDir),
      `type ${baseType} = {`,
      ...target.base,
      '};',
      '',
      `declare module '${target.module}' {`,
      '  namespace JSX {',
      '    interface IntrinsicElements {',
    ];

    for (const meta of elements) {
      const members = elementMembers(meta, '        ');
      if (members.length === 0) {
        lines.push(`      '${meta.tag}': ${baseType};`);
        continue;
      }
      lines.push(`      '${meta.tag}': ${baseType} & {`);
      lines.push(...members);
      lines.push('      };');
    }

    lines.push('    }', '  }', '}', '');

    writeFileSync(outPath, lines.join('\n'));
    results.push({
      path: outPath,
      written: true,
      framework,
      tags: elements.length,
      priorVersion: claim.priorVersion,
    });
  }

  return results;
}
