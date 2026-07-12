# aragonite docs

The documentation map. New to the repo? Start with the root [`README.md`](../README.md) to run it and [`CONTRIBUTING.md`](../CONTRIBUTING.md) to work in it. Orient on the system from [`design/editor/editor.md`](design/editor/editor.md); read a subsystem's spec only when your task touches it.

## Design specs

The system's shape and its load-bearing contracts.

| Doc                                                                        | Scope                                                             |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [`design/editor/editor.md`](design/editor/editor.md)                       | Editor design spec — the orientation point                        |
| [`design/editor/syntax-tree.md`](design/editor/syntax-tree.md)             | CST node model, parser design, GFM block coverage                 |
| [`design/editor/inline-parsing.md`](design/editor/inline-parsing.md)       | Inline parser pipeline, ambient prefix, rendering                 |
| [`design/editor/invariants.md`](design/editor/invariants.md)               | Load-bearing invariants catalog + enforcement                     |
| [`design/editor/virtual-rendering.md`](design/editor/virtual-rendering.md) | Windowing for large documents                                     |
| [`design/editor/plugin-contract.md`](design/editor/plugin-contract.md)     | Plugin-API contract — the foundation the plugin surface builds on |

## Editor guides

How to use and extend the editor as a consumer.

| Doc                                                    | Scope                                                    |
| ------------------------------------------------------ | -------------------------------------------------------- |
| [`editor/consumer-guide.md`](editor/consumer-guide.md) | Embedding the editor: public API, theming, props, events |
| [`editor/plugin-guide.md`](editor/plugin-guide.md)     | Plugin authoring: the unit, kinds, factories, recipes    |
| [`editor/directives.md`](editor/directives.md)         | The `:::name` directive grammar for plugin authors       |
| [`editor/adding-a-block.md`](editor/adding-a-block.md) | Adding a new block type                                  |
| [`editor/gfm-reference.md`](editor/gfm-reference.md)   | GFM syntax reference                                     |

## Process

How the project is built and kept honest.

| Doc                                              | Scope                                               |
| ------------------------------------------------ | --------------------------------------------------- |
| [`culture.md`](culture.md)                       | Incident-backed rules — read before your first edit |
| [`code-style.md`](code-style.md)                 | Code style conventions                              |
| [`commit-conventions.md`](commit-conventions.md) | Commit message format                               |
| [`testing.md`](testing.md)                       | Test infrastructure and patterns                    |
| [`perf/performance.md`](perf/performance.md)     | Performance claims, the gate, and key decisions     |

## Records

The moving state — forward plan, shipped history, and research inputs.

| Doc                                                                          | Scope                                        |
| ---------------------------------------------------------------------------- | -------------------------------------------- |
| [`roadmap.md`](roadmap.md)                                                   | Forward-looking plan                         |
| [`changelog.md`](changelog.md)                                               | Shipped version history                      |
| [`issues.md`](issues.md)                                                     | Known-issues ledger                          |
| [`research/plugin-system-prior-art.md`](research/plugin-system-prior-art.md) | Prior-art review feeding the plugin contract |
| [`research/code-smells.md`](research/code-smells.md)                         | Code-smell reference                         |
