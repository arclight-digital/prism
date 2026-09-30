/**
 * Generates HTML snippet files from ComponentMeta.
 * Two variants:
 *   - component.html — clean template HTML with CSS classes (requires external CSS)
 *   - component.inline.html — same template with inline styles + <style> block for pseudo-states
 *
 * Templates are derived from the Lit render() method, stripped of bindings and slots.
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { HEADER_HTML as HEADER, isPrismGenerated, removeGenerated } from './header.js';
import { loadTokenMap, readHostProperties, readPageDefaults, resolveTokens } from '../resolve-tokens.js';
import {
  compareSpecificity, elementOf, matchesSelector, parseSelector, specificity, splitSelectorList,
} from '../selector-match.js';
import { shadowToLight } from '../css-transform.js';

/**
 * Parse CSS text into an array of rule objects.
 * Handles nested @-rules (media queries, keyframes) by extracting inner rules.
 * @param {string} css
 * @returns {Array<{ selector: string, declarations: string }>}
 */
function parseCSSRules(css) {
  const rules = [];
  const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, '');

  // First extract @media rules
  const mediaPattern = /(@media[^{]+)\{([\s\S]*?\})\s*\}/g;
  let mediaMatch;
  const mediaRanges = [];
  while ((mediaMatch = mediaPattern.exec(cleaned)) !== null) {
    mediaRanges.push({ start: mediaMatch.index, end: mediaMatch.index + mediaMatch[0].length });
    const mediaSelector = mediaMatch[1].trim();
    const innerCSS = mediaMatch[2];
    const innerPattern = /([^{}]+)\{([^{}]*)\}/g;
    let innerMatch;
    while ((innerMatch = innerPattern.exec(innerCSS)) !== null) {
      const selector = innerMatch[1].trim();
      const declarations = innerMatch[2].trim();
      if (selector && declarations) {
        rules.push({ selector, declarations, media: mediaSelector });
      }
    }
  }

  // Then extract top-level rules (not inside @media)
  const rulePattern = /([^{}@]+)\{([^{}]*)\}/g;
  let match;
  while ((match = rulePattern.exec(cleaned)) !== null) {
    // Skip if inside a @media range
    const inMedia = mediaRanges.some(r => match.index >= r.start && match.index < r.end);
    if (inMedia) continue;

    const selector = match[1].trim();
    const declarations = match[2].trim();
    if (selector && declarations && !selector.startsWith('@')) {
      rules.push({ selector, declarations });
    }
  }
  return rules;
}

/**
 * Collect declarations from a rule string into a Map, skipping transitions.
 */
function parseDeclarations(declarationStr) {
  const props = new Map();
  const decls = declarationStr.split(';').map((d) => d.trim()).filter(Boolean);
  for (const decl of decls) {
    const colonIdx = decl.indexOf(':');
    if (colonIdx === -1) continue;
    const prop = decl.slice(0, colonIdx).trim();
    const value = decl.slice(colonIdx + 1).trim();
    if (prop === 'transition') continue;
    props.set(prop, value);
  }
  return props;
}


/* ── Template conversion ─────────────────────────────────────── */

/** Default placeholder values for common bound attributes. */
const ATTR_VALUE_DEFAULTS = {
  href: '#',
  src: '#',
  type: 'button',
  role: 'presentation',
  'aria-expanded': 'false',
  'aria-hidden': 'true',
  'aria-busy': 'false',
};

/** Whether a prop's known default value is truthy (unknown defaults → falsy). */
function isDefaultTruthy(defaults, prop) {
  const d = defaults[prop];
  if (d === undefined) return false;
  const t = String(d).trim();
  return !['', 'false', '0', 'null', 'undefined', "''", '""'].includes(t);
}

/** True if an expression can't be resolved statically (call or private member). */
function isUnresolvable(expr) {
  const t = expr.trim();
  return t.includes('(') || /^this\._/.test(t);
}

/**
 * If `expr` is a ternary on a known prop (`this.x ? A : B`), evaluate it against
 * the prop's default value and return the chosen branch as a literal string
 * ('' when the branch is dynamic markup or empty). Returns null if not a ternary.
 * This turns `${this.dismissible ? html`…` : ''}` (default false) into nothing,
 * and `aria-busy=${this.loading ? 'true' : 'false'}` into "false".
 */
function evalTernary(expr, defaults) {
  const m = expr.trim().match(/^this\.(\w+)\s*\?([\s\S]*?):([\s\S]*)$/);
  if (!m) return null;
  const branch = (isDefaultTruthy(defaults, m[1]) ? m[2] : m[3]).trim();
  if (branch === '') return '';
  const lit = branch.match(/^(['"])([\s\S]*)\1$/);
  return lit ? lit[2] : '';
}

/** The default value of a simple `this.prop` reference (unquoted), or null. */
function defaultValueFor(expr, defaults) {
  const m = expr.trim().match(/^this\.(\w+)$/);
  if (!m) return null;
  const d = defaults[m[1]];
  if (d === undefined || d === '') return null;
  const lit = String(d).match(/^(['"])([\s\S]*)\1$/);
  return lit ? lit[2] : String(d).trim();
}

/**
 * Generate placeholder text for a simple public property, e.g. ${this.heading}.
 * Returns '' for anything that can't be resolved to static display text (method
 * or getter calls, private/computed members).
 */
function placeholderForExpr(expr) {
  const propMatch = expr.match(/this\.(\w+)/);
  if (!propMatch) return '';
  const prop = propMatch[1];
  if (isUnresolvable(expr) || prop.startsWith('_')) return '';
  const placeholders = {
    heading: 'Heading',
    title: 'Title',
    description: 'Description text goes here',
    icon: '★',
    label: 'Label',
    text: 'Text content',
    name: 'Name',
    href: '#',
    src: '#',
    value: 'Value',
    content: 'Content goes here',
    subtitle: 'Subtitle text',
    count: '0',
    badge: 'Badge',
  };
  if (placeholders[prop]) return placeholders[prop];
  return prop.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim();
}

/**
 * Resolve a ${...} expression to an attribute VALUE, or null to drop the whole
 * attribute. Prefers ternary evaluation, then the referenced prop's own default,
 * then a generic per-attribute fallback; unresolved dynamic values are dropped
 * so an example never carries junk like type="Type".
 *
 * The prop default outranks the generic fallback: `type=${this.type}` on a text
 * field whose `type` defaults to 'text' must not become `type="button"`, which
 * silently turns the example's input into a button. The generic table is for
 * expressions with no usable default of their own.
 */
function attrValueFor(attrName, expr, defaults) {
  const tern = evalTernary(expr, defaults);
  if (tern !== null) return tern === '' ? null : tern;
  if (!isUnresolvable(expr)) {
    const fromProp = defaultValueFor(expr, defaults);
    // An empty default is not a usable value — `href=""` points at the current
    // page, which is worse than the generic `#`. Fall through instead, and when
    // there's no generic either the attribute drops rather than emitting `name=""`.
    if (fromProp !== null && fromProp !== '') return fromProp;
  }
  return ATTR_VALUE_DEFAULTS[attrName] !== undefined ? ATTR_VALUE_DEFAULTS[attrName] : null;
}

/**
 * Strip ${...} expressions from a Lit template, handling nested braces.
 * Replaces with placeholder text based on context. Lit binding attributes
 * (@event, .prop, ?bool) and unresolvable attribute values are removed entirely.
 * @param {string} template
 * @param {Record<string,string>} defaults - prop name → default value source
 * @param {string} label - component label, used as fallback for empty elements
 */
function stripExpressions(template, defaults = {}, label = '') {
  let result = '';
  let i = 0;

  while (i < template.length) {
    if (template[i] === '$' && template[i + 1] === '{') {
      // Extract the expression by tracking brace depth.
      let depth = 1;
      let j = i + 2;
      while (j < template.length && depth > 0) {
        if (template[j] === '{') depth++;
        else if (template[j] === '}') depth--;
        j++;
      }
      const expr = template.slice(i + 2, j - 1).trim();

      const beforeExpr = result;
      const lastTagOpen = beforeExpr.lastIndexOf('<');
      const lastTagClose = beforeExpr.lastIndexOf('>');
      const inTag = lastTagOpen > lastTagClose;

      if (inTag) {
        const litBindingMatch = beforeExpr.match(/\s+([.?@][\w-]+)=$/);
        const tagContent = beforeExpr.slice(lastTagOpen);
        const doubleQuotes = (tagContent.match(/"/g) || []).length;
        const insideQuotes = doubleQuotes % 2 === 1;
        const unquotedAttrMatch = !insideQuotes && beforeExpr.match(/\s+([\w-]+)=$/);

        if (litBindingMatch) {
          // Remove the Lit binding attribute name + = from result.
          result = result.slice(0, result.length - litBindingMatch[0].trimStart().length);
        } else if (unquotedAttrMatch) {
          const attrName = unquotedAttrMatch[1];
          const value = attrValueFor(attrName, expr, defaults);
          if (value === null) {
            // Drop the whole attribute (strip the `attrName=` already emitted).
            result = result.slice(0, result.length - unquotedAttrMatch[0].length);
          } else {
            result += `"${value}"`;
          }
        } else {
          // Inside a quoted attribute value.
          const attrMatch = beforeExpr.match(/\s*([\w-]+)=(["'])[^"']*$/);
          const attrName = attrMatch ? attrMatch[1] : null;
          const tern = evalTernary(expr, defaults);

          // `style` is the one attribute whose value has internal syntax, so it
          // takes real values only — never a human-readable placeholder. Both
          // `--fill: ${this._pct}%` → "--fill: %" and `width: ${this.width}` →
          // "width: Width" are invalid CSS. When nothing real resolves, the
          // whole attribute goes, closing quote included. A token list (class)
          // or free text (aria-label) degrades harmlessly and is left alone.
          if (attrName === 'style') {
            const real = tern !== null ? tern : defaultValueFor(expr, defaults);
            if (real === null || real === '') {
              result = result.slice(0, result.length - attrMatch[0].length);
              const close = template.indexOf(attrMatch[2], j);
              i = close === -1 ? j : close + 1;
              continue;
            }
            result += real;
            i = j;
            continue;
          }

          let text;
          if (tern !== null) text = tern;
          else if (attrName === 'href' || attrName === 'src') text = '#';
          else if (attrName === 'class' || attrName === 'aria-label') text = placeholderForExpr(expr);
          else if (attrName && ATTR_VALUE_DEFAULTS[attrName] !== undefined) {
            text = ATTR_VALUE_DEFAULTS[attrName];
          } else text = placeholderForExpr(expr);
          result += text;
        }
      } else {
        // Text content position.
        const tern = evalTernary(expr, defaults);
        const text = tern !== null ? tern : placeholderForExpr(expr);
        if (text) {
          result += text;
        } else {
          // Unresolvable/empty. If this expression is the element's sole content
          // (immediately after an opening tag and before a closing tag), fall
          // back to the component label so the element isn't left blank — mirrors
          // empty-slot handling. Otherwise drop it (e.g. an optional inline
          // control sitting alongside other children).
          const beforeTrimmed = result.replace(/\s+$/, '');
          const restAfter = template.slice(j).replace(/^\s+/, '');
          const lastLt = beforeTrimmed.lastIndexOf('<');
          const afterOpeningTag =
            beforeTrimmed.endsWith('>') && lastLt !== -1 && beforeTrimmed[lastLt + 1] !== '/';
          if (afterOpeningTag && restAfter.startsWith('</')) result += label;
        }
      }

      i = j;
    } else {
      result += template[i];
      i++;
    }
  }

  return result;
}

/**
 * Remove Lit-specific attribute bindings from the template:
 *  - @event=${...}  (event bindings — already stripped by stripExpressions, but @ prefix remains)
 *  - .prop=${...}   (property bindings)
 *  - ?attr=${...}   (boolean attribute bindings)
 *  - part="..."     (shadow DOM parts)
 */
function stripLitBindings(html) {
  let result = html;

  // Remove @event="..." or @event=value attributes
  result = result.replace(/\s+@[\w-]+="[^"]*"/g, '');
  result = result.replace(/\s+@[\w-]+=\S+/g, '');
  // Remove .prop="..." or .prop=value attributes
  result = result.replace(/\s+\.[\w-]+="[^"]*"/g, '');
  result = result.replace(/\s+\.[\w-]+=\S+/g, '');
  // Remove ?attr="..." or ?attr=value attributes
  result = result.replace(/\s+\?[\w-]+="[^"]*"/g, '');
  result = result.replace(/\s+\?[\w-]+=\S+/g, '');
  // Remove part="..." attributes
  result = result.replace(/\s+part="[^"]*"/g, '');

  return result;
}

/**
 * Replace <slot> elements with placeholder content.
 * - <slot></slot> or <slot>...</slot> → component label text
 * - <slot name="x"></slot> → keep default content or use placeholder
 */
function replaceSlots(html, label) {
  // Named slots with plain-text fallback: <slot name="x">default</slot> → keep it
  let result = html.replace(
    /<slot\s+name="[^"]*">([^<]+)<\/slot>/g,
    (_, content) => content.trim() || label
  );
  // Named slots with element/mixed fallback (e.g. <slot name="icon"><arc-icon…>)
  // → drop entirely. The fallback is typically an internal or custom element
  // that can't render in a static example, so leaving it leaks shadow internals.
  result = result.replace(/<slot\s+name="[^"]*">[\s\S]*?<\/slot>/g, '');
  // Named slots without content: <slot name="x"></slot> → remove (empty)
  result = result.replace(/<slot\s+name="[^"]*"\s*><\/slot>/g, '');
  // Self-closing named slots
  result = result.replace(/<slot\s+name="[^"]*"\s*\/>/g, '');
  // Default slot with content: <slot>text</slot>
  result = result.replace(/<slot>([^<]+)<\/slot>/g, (_, content) => content.trim() || label);
  // Empty default slot: <slot></slot>
  result = result.replace(/<slot\s*><\/slot>/g, label);
  // Self-closing: <slot/>
  result = result.replace(/<slot\s*\/>/g, label);

  return result;
}

/**
 * Clean up the HTML output: normalize whitespace, remove empty attributes.
 */
function cleanHTML(html) {
  let result = html;

  // Remove empty aria-label=""
  result = result.replace(/\s+aria-label=""/g, '');
  // Remove empty class=""
  result = result.replace(/\s+class=""/g, '');
  // Remove empty style=""
  result = result.replace(/\s+style=""/g, '');
  // Collapse multiple spaces in line content, preserving leading indentation
  result = result.replace(/^(\s*)(.*)/gm, (_, indent, content) => {
    return indent + content.replace(/ {2,}/g, ' ');
  });
  // Remove blank lines
  result = result.replace(/\n\s*\n\s*\n/g, '\n\n');

  return result;
}

/**
 * Convert a Lit render template to clean static HTML.
 * @param {import('./parser.js').ComponentMeta} meta
 * @returns {string} clean HTML string (inner content only, no host wrapper)
 */
function templateToHTML(meta) {
  const label = meta.pascalName.replace(/([A-Z])/g, ' $1').trim();
  const defaults = {};
  for (const p of meta.props) defaults[p.name] = p.default;

  let html = meta.template;

  // 1. Strip ${...} expressions → sensible placeholders
  html = stripExpressions(html, defaults, label);

  // 2. Remove Lit attribute prefixes and parts
  html = stripLitBindings(html);

  // 3. Replace <slot> elements
  html = replaceSlots(html, label);

  // 4. Clean up
  html = cleanHTML(html);

  // 5. Dedent — strip the common leading whitespace from all lines
  html = dedent(html);

  return html;
}

/**
 * Strip the common leading whitespace from all non-empty lines,
 * and trim leading/trailing blank lines.
 */
function dedent(str) {
  const lines = str.split('\n');

  // Find minimum indent of non-empty lines
  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const spaces = line.match(/^(\s*)/)[1].length;
    if (spaces < minIndent) minIndent = spaces;
  }
  if (!isFinite(minIndent)) minIndent = 0;

  // Strip common indent
  const dedented = lines.map((line) => {
    if (line.trim().length === 0) return '';
    return line.slice(minIndent);
  });

  // Trim leading/trailing blank lines
  while (dedented.length > 0 && dedented[0].trim() === '') dedented.shift();
  while (dedented.length > 0 && dedented[dedented.length - 1].trim() === '') dedented.pop();

  return dedented.join('\n');
}

/**
 * Determine host element tag: span for inline display, div for block display.
 */
function hostTag(meta) {
  const d = meta.hostDisplay || 'block';
  return /^inline/.test(d) ? 'span' : 'div';
}

/**
 * Format HTML with consistent indentation (2-space indent inside host wrapper).
 */
function formatSnippet(innerHTML, wrapTag, wrapAttrs) {
  // Normalize the inner HTML whitespace
  const lines = innerHTML.split('\n').map((l) => l.trimEnd());

  // Find minimum indent of non-empty lines
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  let minIndent = Infinity;
  for (const line of nonEmpty) {
    const spaces = line.match(/^(\s*)/)[1].length;
    if (spaces < minIndent) minIndent = spaces;
  }
  if (!isFinite(minIndent)) minIndent = 0;

  // Re-indent to 2 spaces inside the wrapper
  const reindented = lines.map((line) => {
    if (line.trim().length === 0) return '';
    return '  ' + line.slice(minIndent);
  }).filter((l, i, arr) => {
    // Remove leading/trailing blank lines
    if (i === 0 && l === '') return false;
    if (i === arr.length - 1 && l === '') return false;
    return true;
  });

  const attrStr = wrapAttrs ? ' ' + wrapAttrs : '';
  return `<${wrapTag}${attrStr}>\n${reindented.join('\n')}\n</${wrapTag}>`;
}

/* ── External HTML generation (class-based) ──────────────────── */

/**
 * Generate the external-CSS HTML variant (component.html).
 * Outputs a clean snippet — no page wrapper.
 */
function generateHTMLExternal(meta, config, root) {
  const prefix = config.prefix;
  const outDir = join(root, config.outDir);
  const fileName = meta.tag.replace(new RegExp('^' + prefix + '-'), '') + '.html';
  const outPath = join(outDir, fileName);

  if (existsSync(outPath)) {
    const existing = readFileSync(outPath, 'utf-8');
    if (!isPrismGenerated(existing)) {
      return { path: outPath, written: false };
    }
  }

  mkdirSync(outDir, { recursive: true });

  const cssFileName = meta.tag.replace(new RegExp('^' + prefix + '-'), '') + '.css';
  const innerHTML = templateToHTML(meta);
  const tag = hostTag(meta);
  const snippet = formatSnippet(innerHTML, tag, `class="${meta.tag}"`);

  // Reference the actual base-CSS filename (config.baseCSS) rather than a
  // hard-coded "tokens.css", which may not exist for a given project.
  const baseName = config.baseCSS ? config.baseCSS.split(/[/\\]/).pop() : null;
  const requires = baseName
    ? `requires ${cssFileName} + ${baseName} (or ${prefix}-ui.css)`
    : `requires ${cssFileName} (or ${prefix}-ui.css)`;

  const lines = [
    HEADER,
    `<!-- ${meta.tag} — ${requires} -->`,
    snippet,
    '',
  ];

  writeFileSync(outPath, lines.join('\n'));
  return { path: outPath, written: true };
}

/* ── Inline HTML generation ──────────────────────────────────── */

/** Elements that never have children, so never become anyone's ancestor. */
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * `::slotted()` renamed so shadowToLight leaves it alone. Its light-DOM rewrite
 * (`::slotted(*)` → `.tag *`) is right for the CSS bundle, where slotted
 * content is the page's children; here it would match the component's own
 * elements, so the inline variant has to know which selectors it came from.
 */
const SLOTTED_MARK = '::-prism-slotted(';

const markSlotted = (css) => css.replaceAll('::slotted(', SLOTTED_MARK);

/**
 * Mark every declaration in a `<style>` rule `!important`.
 *
 * The rules there are the ones the browser matches — `:hover`, `:focus`,
 * `@media`, `:first-child` — and each competes with declarations this variant
 * wrote into a `style` attribute, which beats any selector. In the component's
 * own stylesheet the state rule wins by specificity (`.btn:hover` over `.btn`),
 * so without this a hover change to a property the element sets inline never
 * showed. `!important` restores that outcome: it beats an inline declaration
 * that isn't itself important.
 */
function important(declarations) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < declarations.length; i++) {
    const ch = declarations[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ';' && depth === 0) {
      parts.push(declarations.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(declarations.slice(start));
  return parts
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => (/!important$/i.test(d) ? d : `${d} !important`))
    .join('; ') + ';';
}

/**
 * Sort the component's rules by who decides whether they apply.
 *
 * A rule is inlined only where its whole selector can be matched against the
 * example's markup (see selector-match.js). Everything that depends on state
 * the markup can't settle — `:hover`, `::before`, `:first-child`, a sibling —
 * goes to the `<style>` block, for the browser to match. Merging those into a
 * style attribute applied them unconditionally: `.alert::before`'s
 * `position: absolute; height: 2px` became the alert's own.
 *
 * A rule that asks for an attribute a prop sets is a variant, and the example
 * sets no props, so it is left out.
 *
 * @returns {{ inline: object[], deferred: string[] }} `inline` in cascade
 *   order: specificity, then source order
 */
function classifyRules(rules, hostClass) {
  const inline = [];
  const deferred = [];
  const host = `.${hostClass}`;

  rules.forEach((rule, order) => {
    if (!rule.selector.startsWith(host)) return;
    // Slotted content is the page's, and an example has placeholder text in its
    // place. There is nothing for these to style, inline or in <style>, and
    // their light-DOM form (`.tag *`) would match the component's own elements.
    const selectors = splitSelectorList(rule.selector)
      .filter((sel) => sel.startsWith(host) && !sel.includes(SLOTTED_MARK));
    if (selectors.length === 0) return;
    const whole = selectors.length === splitSelectorList(rule.selector).length;
    if (rule.media) {
      const selectorText = whole ? rule.selector : selectors.join(',\n    ');
      deferred.push(`  ${rule.media} {\n    ${selectorText} { ${important(rule.declarations)} }\n  }`);
      return;
    }
    const dynamic = [];
    for (const sel of selectors) {
      const parsed = parseSelector(sel);
      if (parsed.kind === 'dynamic') dynamic.push(sel);
      else if (parsed.kind === 'static') {
        inline.push({ parsed, spec: specificity(parsed), order, declarations: rule.declarations });
      }
    }
    if (dynamic.length === 0) return;
    const selectorText = whole && dynamic.length === selectors.length ? rule.selector : dynamic.join(',\n  ');
    deferred.push(`  ${selectorText} { ${important(rule.declarations)} }`);
  });

  inline.sort((x, y) => compareSpecificity(x.spec, y.spec) || x.order - y.order);
  return { inline, deferred };
}

/**
 * The declarations every matching inlinable rule gives `el`, later rules
 * winning. Transitions are left out: nothing in a static example changes.
 */
function collectStyles(inline, el, ancestors) {
  const props = new Map();
  for (const rule of inline) {
    if (!matchesSelector(rule.parsed, el, ancestors)) continue;
    for (const [p, v] of parseDeclarations(rule.declarations)) props.set(p, v);
  }
  if (props.size === 0) return '';
  return [...props.entries()].map(([p, v]) => `${p}: ${v}`).join('; ');
}

function parseAttributes(text) {
  const attrs = new Map();
  for (const m of (text ?? '').matchAll(/([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    attrs.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Write each element's styles into its `style` attribute, and collect the rules
 * the browser must match into the `<style>` block.
 *
 * The markup is walked as a tree, so a descendant selector is matched against
 * the element's real ancestors, host included: `.input-group--error
 * .input-group__wrapper` applies only inside an element that has that class.
 * An element keeps its classes when a `<style>` rule names one of them, since
 * that rule needs something to match.
 */
function applyInlineStyles(html, rules, hostClass, hostTagName) {
  const { inline, deferred } = classifyRules(rules, hostClass);
  const deferredText = deferred.join('\n');
  const referenced = (cls) => new RegExp(`\\.${escapeRegExp(cls)}(?![\\w-])`).test(deferredText);

  const host = elementOf(hostTagName, new Map([['class', hostClass]]));
  const hostStyle = collectStyles(inline, host, []);

  const stack = [];
  const TAG = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)(\s*\/?)>/g;
  const result = html.replace(TAG, (match, close, open, attrText = '', tail) => {
    if (close) {
      const at = stack.map((e) => e.tag).lastIndexOf(close.toLowerCase());
      if (at !== -1) stack.length = at;
      return match;
    }
    if (!open) return match; // a comment

    const el = elementOf(open, parseAttributes(attrText));
    const style = collectStyles(inline, el, [host, ...stack]);
    if (!tail.includes('/') && !VOID_ELEMENTS.has(el.tag)) stack.push(el);

    // An element that already carries a `style` of its own — a custom
    // property the template sets from a prop — gets one attribute, not two: a
    // browser keeps the first and drops the second. Its own declarations go
    // last, since an inline style beats the class rules these came from.
    const own = [];
    let rest = attrText.replace(/\s+style="([^"]*)"/g, (_, value) => {
      if (value.trim()) own.push(value.trim().replace(/;$/, ''));
      return '';
    });
    const merged = [style, ...own].filter(Boolean).join('; ');
    const styleAttr = merged ? ` style="${merged}"` : '';
    const keepClass = [...el.classes].some(referenced);

    if (/\sclass="[^"]*"/.test(rest)) {
      rest = rest.replace(/\sclass="[^"]*"/, (classAttr) => (keepClass ? classAttr : '') + styleAttr);
    } else {
      rest += styleAttr;
    }
    return `<${open}${rest}${tail}>`;
  });

  return { html: result, pseudoRules: deferred, hostStyle };
}

/**
 * Generate the inline-styles HTML variant (component.inline.html).
 * Outputs a clean snippet with inline styles + <style> block for pseudo-states.
 */
function generateHTMLInline(meta, config, root) {
  const prefix = config.prefix;
  const outDir = join(root, config.outDir);
  const fileName = meta.tag.replace(new RegExp('^' + prefix + '-'), '') + '.inline.html';
  const outPath = join(outDir, fileName);

  if (existsSync(outPath)) {
    const existing = readFileSync(outPath, 'utf-8');
    if (!isPrismGenerated(existing)) {
      return { path: outPath, written: false };
    }
  }

  mkdirSync(outDir, { recursive: true });

  // Convert shadow→light CSS then resolve all tokens to literal values.
  //
  // A property the component sets on its own host is resolvable too, but only
  // where no token has the name: the tokens are what the page supplies, and a
  // component's :host copy of one exists to receive a page override, not to
  // replace the value. The class's assembled styles are read when
  // `config.runtime` supplied them, since a :host rule in an imported module is
  // in no file the source reader sees.
  //
  // With `config.runtime`, the class's own stylesheet is the rule source as well:
  // a component styled partly by an imported module (arc-ui's card takes its
  // surface from `cardHoverStyles`) has those rules in no file prism reads.
  let componentCSS = shadowToLight(markSlotted(meta.runtimeStyles ?? meta.css), meta.tag);
  const baseCSSPath = config.baseCSS ? join(root, config.baseCSS) : null;
  const tokenMap = baseCSSPath && existsSync(baseCSSPath) ? loadTokenMap(baseCSSPath) : new Map();
  const resolveMap = new Map(tokenMap);
  for (const [name, value] of meta.runtimeStyles ? readHostProperties(meta.runtimeStyles) : []) {
    if (!resolveMap.has(name)) resolveMap.set(name, value);
  }
  if (resolveMap.size > 0) componentCSS = resolveTokens(componentCSS, resolveMap);

  const rules = parseCSSRules(componentCSS);
  const innerHTML = templateToHTML(meta);

  const tag = hostTag(meta);
  const { html: styledInner, pseudoRules, hostStyle: componentHostStyle } = applyInlineStyles(
    innerHTML, rules, meta.tag, tag
  );

  // The page's inherited defaults go on the example's root, under the host's
  // own declarations: the root stands in for the page the component would sit
  // on, so what the component sets itself still wins.
  const pageCSSPath = config.pageCSS ? join(root, config.pageCSS) : baseCSSPath;
  const hostDeclarations = new Map();
  if (pageCSSPath && existsSync(pageCSSPath)) {
    for (const [name, value] of readPageDefaults(readFileSync(pageCSSPath, 'utf-8'))) {
      hostDeclarations.set(name, resolveMap.size > 0 ? resolveTokens(value, resolveMap) : value);
    }
  }
  for (const [name, value] of parseDeclarations(componentHostStyle)) {
    // A component's `:host` copy of a token is there to take a page override,
    // and every value that read it is already resolved; on the root it would
    // only repeat the token file, once per token.
    if (name.startsWith('--') && tokenMap.has(name)) continue;
    hostDeclarations.set(name, value);
  }
  const hostStyle = [...hostDeclarations].map(([name, value]) => `${name}: ${value}`).join('; ');
  const hostAttrs = [];
  hostAttrs.push(`class="${meta.tag}"`);
  if (hostStyle) hostAttrs.push(`style="${hostStyle}"`);

  const snippet = formatSnippet(styledInner, tag, hostAttrs.join(' '));

  const lines = [HEADER];
  lines.push(`<!-- ${meta.tag} — self-contained, no external CSS needed -->`);

  if (pseudoRules.length > 0) {
    lines.push('<style>');
    lines.push(pseudoRules.join('\n'));
    lines.push('</style>');
  }

  lines.push(snippet);
  lines.push('');

  writeFileSync(outPath, lines.join('\n'));
  return { path: outPath, written: true };
}


/* ── Public API ──────────────────────────────────────────────── */

/**
 * Generate HTML variants for a component.
 * - 'static' and 'hybrid' components get full HTML+CSS output
 * - 'interactive' components are skipped entirely
 * @param {import('./parser.js').ComponentMeta} meta
 * @param {object} config - html config section
 * @param {string} root - project root
 * @returns {{ results: Array<{ path: string, written: boolean }>, skipped: boolean }}
 */
export function generateHTML(meta, config, root, { prune = false } = {}) {
  // Interactive components get no HTML. Both variants are considered regardless
  // of `inlineVariant`: if the flag was on for an earlier run, its output is
  // just as stale as the external one.
  if (meta.interactivity === 'interactive') {
    const outDir = join(root, config.outDir);
    const base = meta.tag.replace(new RegExp('^' + config.prefix + '-'), '');
    const checked = [
      join(outDir, base + '.html'),
      join(outDir, base + '.inline.html'),
    ].map((p) => removeGenerated(p, { apply: prune }));
    return {
      results: [],
      skipped: true,
      stale: checked.filter((r) => r.stale).map((r) => r.path),
      removed: checked.filter((r) => r.removed).map((r) => r.path),
    };
  }

  const results = [];
  results.push(generateHTMLExternal(meta, config, root));

  if (config.inlineVariant) {
    results.push(generateHTMLInline(meta, config, root));
  }

  return { results, skipped: false, stale: [], removed: [] };
}
