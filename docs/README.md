# aragonite docs

aragonite is a block editor for GFM Markdown (GitHub's dialect): the raw text is the document, edited as styled blocks and written back byte for byte, shipped as an embeddable Svelte library.

New here? Run it with the root [`README.md`](../README.md) (which also argues why any of this is a good idea), work in it with [`CONTRIBUTING.md`](../CONTRIBUTING.md). This page is just the map.

## Start here

| If you want to…                     | Read                                                                                                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Understand how the editor works** | [`design/editor.md`](design/editor.md)                                                                                             |
| **Embed the editor in an app**      | [`guide/consumer-guide.md`](guide/consumer-guide.md)                                                                               |
| **Write a plugin**                  | [`guide/plugin-guide.md`](guide/plugin-guide.md), then its [testing](guide/plugin-testing.md) and [API](guide/plugin-api.md) pages |
| **Contribute to the editor itself** | [`../CONTRIBUTING.md`](../CONTRIBUTING.md), then [`contributing/rules.md`](contributing/rules.md)                                  |

Everything else hangs off those four. The folders split by **audience**, not by topic, which is why the same subsystem shows up in two of them wearing different hats.

## `design/`: how it works

One spec per subsystem, for anyone changing the editor's insides. `editor.md` orients any task; read another only when your task touches its subsystem. Working through all eight up front is a great way to feel productive without becoming useful, so let the other seven be somebody else's afternoon.

| Doc                                                          | Scope                                                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| [`design/editor.md`](design/editor.md)                       | The whole system in one spec: **start here**                                                                       |
| [`design/syntax-tree.md`](design/syntax-tree.md)             | The document tree, where every node keeps its exact source bytes: the node model, the parser, the Markdown covered |
| [`design/inline-parsing.md`](design/inline-parsing.md)       | How the text inside a block (`**bold**` and friends) becomes styled spans, markers still visible                   |
| [`design/virtual-rendering.md`](design/virtual-rendering.md) | Why a 10 MB document types like a small one: only the blocks on screen are rendered                                |
| [`design/live-mode.md`](design/live-mode.md)                 | The fully rendered mode that stays editable: the rules for editing around markers nobody can see                   |
| [`design/invariants.md`](design/invariants.md)               | The rules that would cost someone their file, each numbered and each with a check that fails when it breaks        |
| [`design/plugin-contract.md`](design/plugin-contract.md)     | What the plugin API promises: the shapes already settled, the ones still moving before 1.0, what was left out      |
| [`design/performance.md`](design/performance.md)             | Why typing cost does not grow with document size, the exceptions, and the checks that enforce the numbers          |

## `guide/`: using aragonite

The published pack. This folder ships inside the npm package, and it is the only docs folder that does, so the copy in a plugin author's `node_modules` matches the version they installed.

| Doc                                                                          | Scope                                                                                                                             |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [`guide/consumer-guide.md`](guide/consumer-guide.md)                         | Embedding the editor: props, events, theming, and everything else a host app touches                                              |
| [`guide/plugin-guide.md`](guide/plugin-guide.md)                             | Teaching the editor your own blocks and inline syntax, from a first working plugin to full recipes                                |
| [`guide/plugin-testing.md`](guide/plugin-testing.md)                         | Proving a plugin never eats bytes: the checks to write, and the ready-made suites the built-in blocks answer to, pointed at yours |
| [`guide/plugin-api.md`](guide/plugin-api.md)                                 | Every `@voithos-labs/aragonite/plugin` export, grouped by job; a page for Ctrl+F, not for reading                                 |
| [`guide/directives.md`](guide/directives.md)                                 | The `:::name` fence: a named box in Markdown, and how a plugin claims a name                                                      |
| [`guide/plugin-guide/parrot-frames.md`](guide/plugin-guide/parrot-frames.md) | All ten party-parrot frames, ready to paste over the quickstart's two                                                             |

The pack ships the whole `guide/` folder as is, subfolders included (a doc's gifs live in a folder named after it), so a markdown link inside it may only target a file the pack carries. Name any other doc as inline code instead. `npm run lint` fails on a link that would dangle once the pack leaves the repo, and hearing it from the linter is faster than hearing it from a reader with a 404.

## `contributing/`: how we work

| Doc                                                                          | Scope                                                                                                                                       |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [`contributing/rules.md`](contributing/rules.md)                             | Five rules, each one paid for by a real bug: **read before your first edit**                                                                |
| [`contributing/casebook.md`](contributing/casebook.md)                       | The eight incidents behind the rules: read before your first structural change                                                              |
| [`contributing/anatomy-of-a-change.md`](contributing/anatomy-of-a-change.md) | One real feature traced from first design decision to ship, for the shape of a change here                                                  |
| [`contributing/codebase-map.md`](contributing/codebase-map.md)               | From the behavior you watched break to the one file to open                                                                                 |
| [`contributing/testing.md`](contributing/testing.md)                         | Where a test goes, how the unit and browser layers run, and the heavier machinery (fuzzers, a typing simulation)                            |
| [`contributing/debugging.md`](contributing/debugging.md)                     | Dumping the editor's state (tree, selection, undo) instead of hand-tracing it: the panel, the console helpers, the same dumps inside a test |
| [`contributing/warnings.md`](contributing/warnings.md)                       | The three kinds of console output a dev build emits, and which test run goes red when each fires                                            |
| [`contributing/adding-a-block.md`](contributing/adding-a-block.md)           | Adding a block type to the editor itself; plugin authors want the plugin guide instead                                                      |
| [`contributing/code-style.md`](contributing/code-style.md)                   | How we name, shape, comment, and format code; nothing exotic                                                                                |
| [`contributing/commit-conventions.md`](contributing/commit-conventions.md)   | Commit message format: the symbols, the 72-character line, what a body may carry                                                            |
| [`contributing/friction-log.md`](contributing/friction-log.md)               | Friction that is real but not a bug: where newcomers have tripped, open and retired                                                         |

## Records and reference

The moving state, and the background material behind it. Forward-looking plans are not kept in the repo: a decision lives with the contract it binds, and everything shipped is in the changelog.

| Doc                                                                              | Scope                                                                                                               |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [`changelog.md`](changelog.md)                                                   | Everything shipped, newest first; this page is the index, the entries live one file per 0.x line under `changelog/` |
| [GitHub Issues](https://github.com/voithos-labs/aragonite/issues)                | Every known defect as an issue, labelled by area and severity, closed by naming the commit that shipped the fix     |
| [`research/gfm-reference.md`](research/gfm-reference.md)                         | Every piece of GFM syntax the editor handles, on one page                                                           |
| [`research/plugin-extension-surfaces.md`](research/plugin-extension-surfaces.md) | What everyone else's plugin systems expose, and where aragonite stands against them                                 |
