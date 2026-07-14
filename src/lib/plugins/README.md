# Bundled plugins

First-party plugins that ship inside the package, each at its own `aragonite/plugins/<name>` subpath export. They install through the standard `<Editor plugins={...}>` prop — importing a plugin module is inert; only installing registers anything.

## Tier list

The owner-decided split between what ships and what stays a dev fixture:

- **Bundled (in-package):** admonitions, details, latex, mermaid, toc, highlight-occurrences.
- **Dev fixtures (stay in `src/routes/test/plugins/`):** callout, memo, block-badge, fold, doc-stats, ghost-text (+ sim-mark and the `multi/` + `staggered/` route fixtures).

## External-shaped

A bundled plugin imports only the public authoring barrel (`$lib/plugin`) — no editor-internal deep paths, no sibling plugin. It authors against the exact surface a third-party plugin sees, so the set is the standing dogfood proof that the barrel is complete: a bundled plugin that needs something the barrel lacks is a signal to grow the barrel, not to reach past it. The `plugin-import-boundary` lint enforces this.

## Renderer adapter

An engine-bearing plugin splits its core from its heavy dependency: the core stays engine-free and the engine wiring lives in a `renderer.ts` reached through a `/renderer` subpath, so a consumer opts into the dependency (or supplies its own). latex (katex) and mermaid arrive in the next batch; the boundary lint already reserves each `renderer.ts` its declared engine.

## Test layout

Bundled-plugin tests mirror the source tree — `src/lib/test/plugins/<name>/`. Fixture-plugin tests stay flat in `src/lib/test/plugins/`.
