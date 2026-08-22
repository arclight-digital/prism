# Contributing to @arclux/prism

Thanks for your interest in contributing!

## Getting started

```bash
git clone https://github.com/Arclight-Digital/prism.git
cd prism
npm install
```

## Development workflow

```bash
npm test           # Run tests once
npm run test:watch # Run tests in watch mode
npm run lint       # Run ESLint
npm run test:types # Compile the corpus output with each framework's checker
```

## Making changes

1. Create a branch from `main`
2. Make your changes
3. Ensure `npm test` and `npm run lint` pass
4. Open a pull request

## Code style

- ESM only (`import`/`export`)
- No TypeScript — JSDoc types for documentation
- No build step — source ships as-is
- Regex-based parsing (no AST dependencies)

## Tests

Tests live in `test/` and use [vitest](https://vitest.dev/). Each source module has a corresponding test file. Generator tests use temporary directories for isolation.

### The corpus

`test/fixtures/corpus/` holds component sources, and `test/corpus.test.js` runs every generator over all of them in one pass. Its members are not examples: each is a **shape that has broken** — a component whose slots are all named, a form-associated element, a dashed custom event, a component that moves state its consumer also holds, one driven by its methods, a barrel a formatter has wrapped — and each file says which failure it stands for. Generator unit tests build `meta` by hand, so they can only prove the generators did as they were told; the corpus is what catches the parser being wrong.

**If you fix a defect that a shape can stand for, add the shape.**

`test/fixtures/runtime/` is the same idea for `config.runtime`, and needs real modules rather than source strings — a mixin contributing properties to a component in another file can only be tested by importing both. That is why `lit` is a devDependency.

### The type check

`npm run test:types` generates the corpus's wrappers and compiles them with each framework's own checker — `tsc` for React, Preact, Solid and Angular, `vue-tsc` for Vue, `svelte-check` for Svelte — against a stub of the element package built from the corpus metas. It is the only test here that asks the question a consumer asks: does the file compile where it lands. Two defects were found by its first two runs, both a type import that had stopped being used and neither visible to any string assertion.

It needs six framework toolchains, which is why it is not part of `npm test` — nobody should install TypeScript, Vue, Svelte, Solid, Preact, React and Angular to fix a regex. CI runs it as its own job; to run it locally:

```bash
npm install --no-save typescript@5 vue vue-tsc svelte svelte-check \
  solid-js preact react @types/react @lit/react @angular/core @angular/forms
npm run test:types
```

Each framework is checked twice: once against the generated tree, and once against a file with a deliberate type error in it, which it has to fail. A checker reading no files reports the same clean exit as one that read them all — the first working version of this put the tree under `node_modules/`, where svelte-check does not look, and it passed a file that could not compile.

### The acceptance suite

The corpus is deliberately small, and most of what prism does only goes wrong at catalog scale. So before publishing, a release candidate is run against the reference consumer — `arc-ui`, which regenerates 235 wrapper files across six framework packages, then runs its own checks and a browser suite that mounts all six. Those assert the properties prism cannot check from the inside: that wrappers forward slots, that `barrelExclude` round-trips, that the emitted types are what they claim, and that the JSX augmentations actually apply.

## AI / LLM policy

Using LLMs (Claude, ChatGPT, Copilot, etc.) to help write code is fine, but **all LLM output must be reviewed and understood by the contributor before submission**. You are responsible for every line in your PR.

PRs generated entirely by bots (OpenClaw, Dependabot-like AI agents, etc.) without human review will be closed automatically.

## Reporting issues

Please include:
- Node.js version (`node --version`)
- Steps to reproduce
- Expected vs actual behavior
