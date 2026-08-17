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

`test/fixtures/corpus/` holds component sources, and `test/corpus.test.js` runs every generator over all of them in one pass. Its members are not examples: each one is a **shape that has broken**, and each file says which failure it stands for — a component whose slots are all named, a form-associated element, a dashed custom event, a component held out of the barrels, a barrel a formatter has wrapped.

It exists because generator unit tests build `meta` by hand and so can only prove the generators did as they were told. Every serious defect prism has shipped — an Angular package that registered no custom elements, a Solid augmentation that typed nothing, wrappers that discarded every child — passed those tests and was found downstream, in a consuming repo, against a real catalog.

**If you fix a defect that a shape can stand for, add the shape.** That is how the next one gets caught here rather than three packages away.

`test/fixtures/runtime/` is the same idea for `config.runtime`, and it needs real modules rather than source strings — a mixin contributing properties to a component in another file is the shape, and the only way to test it is to import both. That is why `lit` is a devDependency: the thing being verified is what Lit itself computes.

### The acceptance suite

The corpus is deliberately small, and small is its limit: five components cannot stand in for a 200-component catalog, and most of what prism does only goes wrong at catalog scale.

So the second half of the arrangement is explicit rather than accidental: **before publishing, a release candidate is run against the reference consumer** — `arc-ui`, which regenerates 235 wrapper files across six framework packages, then runs its own checks and a browser suite that mounts all six. Its checks assert the properties prism cannot check from the inside: that wrappers forward slots, that `barrelExclude` round-trips in both directions, that the emitted types are what they claim, and that the JSX augmentations actually apply.

Publishing without that pass is how a release gets verified by whoever next runs `pnpm generate`.

## AI / LLM policy

Using LLMs (Claude, ChatGPT, Copilot, etc.) to help write code is fine, but **all LLM output must be reviewed and understood by the contributor before submission**. You are responsible for every line in your PR.

PRs generated entirely by bots (OpenClaw, Dependabot-like AI agents, etc.) without human review will be closed automatically.

## Reporting issues

Please include:
- Node.js version (`node --version`)
- Steps to reproduce
- Expected vs actual behavior
