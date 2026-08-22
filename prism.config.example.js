// Example prism config — copy to `prism.config.js` in your own project root
// and adjust the paths. Prism only ever loads `prism.config.js` from the
// directory it runs in, so this file is documentation, never live config.
export default {
  // Component tag prefix (e.g. 'arc' → arc-button, ArcButton)
  prefix: 'arc',
  // Where to find Lit web components
  components: 'packages/web-components/src',
  // Tier directories to scan (maps to output subdirectories)
  tiers: ['content', 'reactive', 'application'],
  // Ignore patterns
  ignore: ['**/shared-styles.js', '**/index.js', '**/icon-registry.js', '**/icon-library.js', '**/icons/**', '**/*.register.js', '**/register.js'],

  // Two-way binding opt-outs. Bindings are derived two ways: an event whose
  // `detail` carries a key matching a declared prop name is that prop's
  // write-back path, and so is a payload the dispatch site shows carrying the
  // new value of a prop the component assigns outside its constructor — which
  // is how `detail.value` announcing `sidebarOpen` is found. List the
  // exceptions here, by prop name: cases where the key means something other
  // than the prop it shares a name with, or where the element only echoes its
  // own unchanged value back.
  bindings: {
    // detail.label is the *selected option's* text, not the field's own label
    'arc-select': { exclude: ['label'] },
    // detail.value is the copied string — the button never changes it
    'arc-copy-button': { exclude: ['value'] },
  },

  // Resolve properties from the component class by importing it — the only way
  // a property contributed by a mixin or a base class is visible at all.
  // Opt-in because importing a module runs it; a module that won't import is
  // reported and falls back to the source reader. With this on, `propsFrom`
  // and `formAssociated` below are both unnecessary.
  runtime: true,
  // runtime: { setup: './scripts/dom-shim.js' },  // if imports need a DOM

  // Resolve property declarations prism's own reader can't. It understands
  // object literals and `@property()` decorators; a declaration built by a
  // helper — `selected: int({ min: 0, clamp: 'toRange' })` — means something
  // only your repo knows. Return an array of props, or undefined to fall
  // through, so this only has to handle the files it knows about. Omit it
  // entirely if your components declare props as plain literals.
  //
  // propsFrom(source, filePath) {
  //   return readDeclarations(source)?.map((d) => ({
  //     name: d.name,           // required
  //     type: d.type,           // String | Boolean | Number | Array | Object
  //     default: d.defaultSrc,  // source text — "'md'", not "md"
  //     reflect: d.reflect,
  //     state: d.internal,      // true keeps it off the public surface
  //   }));
  // },

  // Whether an element is form-associated, where a mixin declares it in a file
  // prism was never handed. Form-associated elements are the ones whose Angular
  // wrappers get a ControlValueAccessor. Omit this entirely if your components
  // declare `static formAssociated = true` themselves.
  //
  // formAssociated(source) {
  //   return /FormControlMixin\(/.test(source) || undefined;
  // },

  // The property a form binds, where the convention doesn't answer. Prism binds
  // `checked` if a control declares it and `value` otherwise; these are the
  // controls whose value is a *pair*, which a ControlValueAccessor carries as an
  // object because it carries exactly one value.
  formValue: {
    'arc-date-range-picker': ['start', 'end'],
    'arc-range-slider': ['low', 'high'],
  },

  // Findings you've already decided about, so `--strict` can pass. Some
  // findings are correct and stay correct — the fix was made, and the finding
  // is still true. Waived findings are still printed under `prism: accepted:`,
  // and an entry that matches nothing is itself a strict failure, so the list
  // can't quietly rot. `code` is required; `tag` and `prop` narrow it.
  acknowledge: [
    {
      code: 'framework-reserved',
      tag: 'arc-column',
      prop: 'key',
      note: 'aliased as `field`; key still works in HTML/Vue/Svelte/Angular/Solid',
    },
  ],

  // React output. `packageJson` opts the package into having its `exports` map
  // written from the generated file tree — a subpath per component, so a
  // consumer that can't tree-shake a barrel imports one without the rest.
  react: {
    outDir: 'packages/react/src',
    wcPackage: '@arclux/arc-ui',
    barrels: true,
    packageJson: 'packages/react/package.json',
  },

  // Opt-in JSX typings, for consumers who render <arc-button> directly instead
  // of importing a wrapper. One file per framework, each augmenting the module
  // that framework actually resolves JSX.IntrinsicElements through.
  jsxTypes: {
    outDir: 'packages/web-components/types',
    frameworks: ['react', 'preact', 'solid'],
  },

  // HTML/CSS output
  html: {
    outDir: 'packages/html/examples',
    baseCSS: 'shared/tokens.css',
    inlineVariant: true,
  },

  // Standalone CSS output
  css: {
    outDir: 'packages/html/css',
    baseCSS: 'shared/tokens.css',
  },

  // Vue 3 output
  vue: {
    outDir: 'packages/vue/src',
    wcPackage: '@arclux/arc-ui',
    barrels: true,
  },

  // Svelte 5 output
  svelte: {
    outDir: 'packages/svelte/src',
    wcPackage: '@arclux/arc-ui',
    barrels: true,
  },

  // Angular standalone components
  angular: {
    outDir: 'packages/angular/src',
    wcPackage: '@arclux/arc-ui',
    barrels: true,
  },

  // Solid components
  solid: {
    outDir: 'packages/solid/src',
    wcPackage: '@arclux/arc-ui',
    barrels: true,
  },

  // Preact components
  preact: {
    outDir: 'packages/preact/src',
    wcPackage: '@arclux/arc-ui',
    barrels: true,
  },
};
