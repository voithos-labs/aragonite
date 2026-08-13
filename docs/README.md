# aragonite docs

aragonite is a block editor for GFM Markdown. The raw Markdown is the source of truth: it's parsed into a lossless syntax tree, rendered as styled blocks with the markers left visible but dimmed, and written back byte-for-byte. It ships as an embeddable Svelte library.

New to the repo? Run it with the root [`README.md`](../README.md), work in it with [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Start here

| If you want to…                     | Read                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Understand how the editor works** | [`design/editor.md`](design/editor.md)                                                            |
| **Embed the editor in an app**      | [`guide/consumer-guide.md`](guide/consumer-guide.md)                                              |
| **Write a plugin**                  | [`guide/plugin-guide.md`](guide/plugin-guide.md)                                                  |
| **Contribute to the editor itself** | [`../CONTRIBUTING.md`](../CONTRIBUTING.md), then [`contributing/rules.md`](contributing/rules.md) |

Everything else hangs off those four. `CONTRIBUTING.md` gets you set up, oriented, and through the gates; `rules.md` is the second step, and the one to take before your first edit. The folders are split by **audience**, not by topic.

## `design/` — how it works

The system's shape and its load-bearing contracts. `editor.md` is the orientation point; read the rest only when your task touches that subsystem.

| Doc                                                          | Scope                                                    |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| [`design/editor.md`](design/editor.md)                       | The editor design spec — **start here**                  |
| [`design/syntax-tree.md`](design/syntax-tree.md)             | CST node model, parser design, GFM block coverage        |
| [`design/inline-parsing.md`](design/inline-parsing.md)       | Inline parser pipeline, ambient prefix, rendering        |
| [`design/virtual-rendering.md`](design/virtual-rendering.md) | Windowing for large documents                            |
| [`design/live-mode.md`](design/live-mode.md)                 | Fully live mode: editing semantics behind hidden markers |
| [`design/invariants.md`](design/invariants.md)               | The invariant catalog and how each is enforced           |
| [`design/plugin-contract.md`](design/plugin-contract.md)     | The plugin API and what freezes at 1.0                   |
| [`design/performance.md`](design/performance.md)             | Performance claims, the gate, key decisions              |

## `guide/` — using aragonite

The published docs pack: `docs/guide` is listed in the package's `files`, so this folder, and only this folder, is what a third-party plugin author receives with the npm install.

| Doc                                                  | Scope                                                    |
| ---------------------------------------------------- | -------------------------------------------------------- |
| [`guide/consumer-guide.md`](guide/consumer-guide.md) | Embedding the editor: public API, props, theming, events |
| [`guide/plugin-guide.md`](guide/plugin-guide.md)     | Plugin authoring: the unit, the tiers, recipes           |
| [`guide/directives.md`](guide/directives.md)         | The `:::name` directive grammar                          |

Because the pack ships flat, a markdown link inside `guide/` may only point at another file in `guide/`. Name any other doc as inline code instead — `npm run lint` fails on a link that would dangle once the pack leaves the repo.

## `contributing/` — how we work

| Doc                                                                          | Scope                                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [`contributing/rules.md`](contributing/rules.md)                             | The incident-backed rule set: **read before your first edit** |
| [`contributing/casebook.md`](contributing/casebook.md)                       | The eight incidents behind the rules, before structural work  |
| [`contributing/anatomy-of-a-change.md`](contributing/anatomy-of-a-change.md) | One cross-cutting feature traced from design to ship          |
| [`contributing/codebase-map.md`](contributing/codebase-map.md)               | Behavior → seam index: where a behavior lives                 |
| [`contributing/testing.md`](contributing/testing.md)                         | Test infrastructure and patterns                              |
| [`contributing/warnings.md`](contributing/warnings.md)                       | Dev-warning taxonomy: which console output fails which gate   |
| [`contributing/adding-a-block.md`](contributing/adding-a-block.md)           | Adding a built-in block kind                                  |
| [`contributing/code-style.md`](contributing/code-style.md)                   | Code style conventions                                        |
| [`contributing/commit-conventions.md`](contributing/commit-conventions.md)   | Commit message format                                         |
| [`contributing/friction-log.md`](contributing/friction-log.md)               | Known contributor-experience friction, open and retired       |

`rules.md` is the one to read before you write code, and the one people skip. Every rule in it was paid for by a real bug, and `casebook.md` holds the bug.

## Records + reference

The moving state, and the background material behind it.

| Doc                                                                              | Scope                                                                   |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [`roadmap.md`](roadmap.md)                                                       | Forward plan — nothing shipped                                          |
| [`changelog.md`](changelog.md)                                                   | Shipped history — nothing speculative; index over the per-family files  |
| [GitHub Issues](https://github.com/voithos-labs/aragonite/issues)                | Defect ledger — severity + area labelled, closed by the shipping commit |
| [`research/gfm-reference.md`](research/gfm-reference.md)                         | The GFM syntax the editor parses                                        |
| [`research/plugin-extension-surfaces.md`](research/plugin-extension-surfaces.md) | What a plugin system must expose; where aragonite stands                |
| [`research/code-smells.md`](research/code-smells.md)                             | Code-smell vocabulary used in reviews                                   |
