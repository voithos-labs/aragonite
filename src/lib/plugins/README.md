# Bundled plugins

First-party plugins that ship inside the package, each at its own `aragonite/plugins/<name>` subpath export. They install through the standard `<Editor plugins={...}>` prop — importing a plugin module is inert; only installing registers anything.

## Tier list

The owner-decided split between what ships and what stays a dev fixture:

- **Bundled (in-package):** admonitions, details, footnotes, latex, mermaid, toc, highlight-occurrences.
- **Dev fixtures (stay in `src/routes/test/plugins/`):** callout, memo, block-badge, fold, doc-stats, ghost-text (+ sim-mark and the `multi/` + `staggered/` route fixtures).

## External-shaped

A bundled plugin imports only the public authoring barrel (`$lib/plugin`) — no editor-internal deep paths, no sibling plugin. It authors against the exact surface a third-party plugin sees, so the set is the standing dogfood proof that the barrel is complete: a bundled plugin that needs something the barrel lacks is a signal to grow the barrel, not to reach past it. The `plugin-import-boundary` lint enforces this.

## Renderer adapter

An engine-bearing plugin splits its core from its heavy dependency: the core stays engine-free and the engine wiring lives in a `renderer.ts` reached through a `/renderer` subpath, so a consumer opts into the dependency (or supplies its own). latex (katex) and mermaid ship this way. Each engine is an _optional_ peerDependency and the core carries no default renderer, so importing `aragonite/plugins/<name>` pulls no engine; the boundary lint reserves each `renderer.ts` its declared engine and fails a core file that imports one.

latex's adapter also imports `katex/dist/katex.min.css`, so `./dist/plugins/latex/renderer.js` is listed in the package `sideEffects` — without it a bundler drops the stylesheet.

## Test layout

Bundled-plugin tests mirror the source tree — `src/lib/test/plugins/<name>/`. Fixture-plugin tests stay flat in `src/lib/test/plugins/`.
