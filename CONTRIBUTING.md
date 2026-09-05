Welcome. Hello. 你好。こんにちは。

So you want to work on this thing. Condolences.

Anyways, for more in depth stuff, find them here:

- [`docs/contributing/rules.md`](docs/contributing/rules.md): rules to abide by
- [`docs/contributing/codebase-map.md`](docs/contributing/codebase-map.md): behavior to file mapping
- [`docs/contributing/testing.md`](docs/contributing/testing.md): the two test layers, and how to write into them
- [`docs/contributing/code-style.md`](docs/contributing/code-style.md): naming, comments, etc.
- [`docs/design/editor.md`](docs/design/editor.md): system specccccc
- [`docs/README.md`](docs/README.md): roadmap to every other doc

## Setup

Be on node 24.

```
npm install
npx playwright install chromium
npm run dev
```

Currently, the e2e suite and the perf gate both drive chromium, so don't skip the second line please.

## The shape of the thing

The editor keeps one tree, the CST (the parsed form of your markdown, where every node holds its own slice of the original text, markers included). Markdown parses into it, the blocks on screen render from it, and saving concatenates it back out.

The components follow the tree, one component per block, nesting where the tree nests:

```
Editor (owns the CST, the undo stack, the editor-actions contexts)
  └─ BlockList (keyed loop over CST children, windowed)
       └─ BlockHost (dispatches by block kind)
            ├─ TextEditableBlock / CodeBlock / ThematicBreakBlock
            ├─ BlockquoteBlock (recursive) / ListBlock → ListItemBlock (recursive)
            └─ TableBlock (per-cell editable grid)
```

fyi,

1. a block's **kind** is the string on its node saying what block it is (`paragraph`, `list`, your plugin's name), and
2. **windowed** means only the blocks near the viewport are mounted at all.

### Where the code lives

The library is `src/lib/`; `src/routes/test/editor` is the dev harness. Inside `src/lib/`:

| Directory                                                                  | What's in it                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/`                                                              | the Svelte components: Editor, BlockList, BlockHost, and one component per block kind                                                                                                                                                              |
| `editor-actions/`                                                          | what a block asks the editor to do for it (split, merge, paste), and the versions of those a container substitutes for its children                                                                                                                |
| `tree-operations/`                                                         | pure functions that change the tree (paste, list, blockquote, the primitives), plus the copy-on-write sharing (`sharing.ts`) that lets undo snapshots share nodes with the live tree                                                               |
| `schema/`                                                                  | everything about a block kind that more than one subsystem reads: its metadata record (the descriptor), the registries, the parser piece that recognizes the syntax it starts with (the opener), merge rules, commands and their keybindings       |
| `core/`                                                                    | the parser, the serializer, the inline pipeline (how the text inside a block becomes styled spans), and the node types                                                                                                                             |
| `ambient/`                                                                 | the dimmed marker a container lends its first child (today the list item's `- ` / `1. `): its DOM, and translating caret offsets across it                                                                                                         |
| `cursor/`                                                                  | caret and measurement geometry: DOM position to raw offset and back, the sticky column, edge affinity (which side of a boundary the caret sits on), visual lines, the block heights windowing reads, and the scrollport (the element that scrolls) |
| `reactivity/`                                                              | block-list state, the state registry, and windowing (the per-list hooks, the slice math, the content version)                                                                                                                                      |
| `selection/`                                                               | cross-block selection: the model and the dispatch                                                                                                                                                                                                  |
| `decorations/`                                                             | view-only annotations (squiggles, ghost text, that kind of thing): the model and its reactive state                                                                                                                                                |
| `undo/`                                                                    | the undo/redo stack and the snapshot entry it stores (the fixed steps a commit runs are in `editor-actions/commit/`)                                                                                                                               |
| `invariants/`                                                              | the pure predicates behind the dev-mode guards (checks that fail a test when a contract breaks)                                                                                                                                                    |
| `perf/`                                                                    | dev-mode performance instruments                                                                                                                                                                                                                   |
| `debug/`                                                                   | the dev debug engine: dumps of the tree, the selection, the undo stack, the operations log                                                                                                                                                         |
| `search/`                                                                  | find/replace: a read-only scan over the tree, plus its reactive state                                                                                                                                                                              |
| `plugins/`                                                                 | the bundled first-party plugins, each published as `@voithos-labs/aragonite/plugins/<name>`                                                                                                                                                        |
| `testing/`                                                                 | the published testing helpers (`@voithos-labs/aragonite/testing`): a platform reset plus the conformance kits a plugin's own test suite runs                                                                                                       |
| `test/`, `e2e/`                                                            | the Vitest unit suites and the Playwright specs (with their requirement files)                                                                                                                                                                     |
| `styles/`                                                                  | `editor.css` (structure) and `editor-theme.css` (the color and spacing tokens)                                                                                                                                                                     |
| `index.ts`, `plugin.ts`, `testing.ts`                                      | the three public entry points, one per audience: the editor, the plugin API, the plugin test helpers. what's exported here is supported, what isn't is internal                                                                                    |
| `editor-props.ts`, `editor-events.ts`, `editor-keys.ts`, `editor-rects.ts` | the host-facing surface: the props the editor takes, the events it emits, the url and image hooks, and the on-screen geometry a host can measure                                                                                                   |
| `action-contracts.ts`, `block-component.ts`                                | the two interfaces the layers meet at: everything a block can ask the editor to do, and everything a rendered block has to answer                                                                                                                  |
| `presentation-mode.ts`, `block-id.ts`, `active-editor.ts`                  | the five presentation modes, the stable block ids that keep keyed rendering pointed at the right block, and which editor a document-level chord goes to when two are on the page                                                                   |
| `dev-warn.ts`, `assert.ts`, `env.ts`                                       | the dev channel: the warning relay every guard fires through, and the build flag that folds it out of production                                                                                                                                   |
| `a11y-strings.ts`, `bounded-memo.ts`, `scan-index.ts`                      | the small shared pieces: screen reader names and announcements in one table, an LRU memo for expensive render work, and the scan index that keeps a trigger-dense paragraph to one pass                                                            |

## Commands

| Command                      | Purpose                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm run dev`                | Showcase at `/`, dev harness at `/test/editor`                                                   |
| `npm run test:editor`        | Unit tests (all)                                                                                 |
| `npm run test:editor:<area>` | Unit tests by area (`package.json` is the list)                                                  |
| `npm run test:e2e`           | E2E tests (all)                                                                                  |
| `npm run test:e2e:<area>`    | E2E tests by area                                                                                |
| `npm run test:e2e:isolated`  | E2E tests on a dev server of their own, reusing nothing already running                          |
| `npm test`                   | Full suite: unit, then every e2e project                                                         |
| `npm run check`              | svelte-check, 0 errors baseline                                                                  |
| `npm run lint`               | Prettier, the docs link check, the codebase-map check, ESLint                                    |
| `npm run format`             | Prettier, writing the fixes                                                                      |
| `npm run perf:check`         | Builds and previews the app, then times keystrokes against that build (the ship gate, see below) |

## Making a change

Read [`docs/contributing/rules.md`](docs/contributing/rules.md) before your first edit, not after your first review; it's short.

If the change is a bug fix, three habits:

1. Root-cause it, and fix the class, not the one edge case you happened to find.
2. Write the regression test **red first**: it fails on the pre-fix code, for the right reason, and then you fix it. Without that red run nobody knows the test can fail.
3. Record a one-line **miss-analysis**: what test should have caught this, and why none did. It goes in the regression test's requirement file (e2e) or as the test's own header line (unit).

One more thing that bites people: a dev warning in the console (the `[aragonite:...]` lines) is a gate failure, not noise. [`docs/contributing/warnings.md`](docs/contributing/warnings.md) says which kind means what and how a test claims one it triggered on purpose.

If you'd like to see what all of this looks like on a real feature, [`docs/contributing/anatomy-of-a-change.md`](docs/contributing/anatomy-of-a-change.md) walks one from the first design decision to ship, including two tests that passed for the wrong reason.

## The gates

How much you run scales with what you did, in three tiers:

| Tier        | What you run                                                                                                                                           | When                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| inner loop  | the area scripts for the directories you touched                                                                                                       | while iterating; seconds to a minute, and nowhere near enough to commit on       |
| commit gate | `npm test`, plus `npm run check` and `npm run lint`                                                                                                    | green before every commit; tens of minutes, so start it and go do something else |
| ship gate   | the commit gate, plus `npm run perf:check`; a release adds the WebKit run ([testing.md § The WebKit run](docs/contributing/testing.md#the-webkit-run)) | before a merge or a release; several minutes on top                              |

`perf:check` builds and previews the app first, so it measures the editor rather than the dev server. Not `test:editor:perf`: that one already runs inside `npm test` and tells you nothing new.

**`perf:check` will read red on your machine, and that's fine.** The ceilings are calibrated against one pinned host, so an unscaled run anywhere else is a diagnostic, not a verdict ([`docs/design/performance.md`](docs/design/performance.md) has the why). CI runs a scaled perf job, and that job is the arbiter.

Two rules from the rule set, both bought with incidents. Never pipe a gate command: `npm test | tail` reports the pipe's exit code, not the gate's, so capture to a file and read the exit yourself ([rules.md § Working the gates](docs/contributing/rules.md#working-the-gates) shows the trap in both shells). And the long suites (the full e2e run, the simulation) run alone, never next to other work on the same tree.

Three warnings though, about the e2e suite on real hardware:

- A few specs still carry absolute wall-clock budgets, so a slower laptop or a busy host can tip one red without your change being wrong. Most of that class is gone (a guard, G4.48, prices timing as a growth ratio instead, which cancels machine speed); what's left is the allowlist in `src/lib/test/invariants/lint/wall-clock-budgets.test.ts`, each entry with its reason. CI is the arbiter, same as perf.
- A run you interrupt can leave a dev server alive, and the next run will cheerfully reuse it and serve stale code, which looks exactly like everything failing at once. Kill leftover node processes before rerunning. `npm run test:e2e:isolated` sidesteps the whole class by starting the run's own server on its own port and reusing nothing ([testing.md § E2E tests](docs/contributing/testing.md#e2e-tests-playwright) has the ports).
- Pre-warm the dev server on a cold checkout. Playwright's server timeout is short enough that a cold Vite boot on fresh `node_modules` can outrun it. Run `npm run dev` once and let it come up, or learn to read your first e2e run's instant failure as the phantom it is.

## Commit messages

A symbol prefix saying what kind of change it is, then lowercase text, no trailing period, at most 72 characters, one logical change per commit:

```
+ (parrot) an eleventh frame, for the truly committed
```

`npm install` points git at `.githooks/` (a `prepare` script sets `core.hooksPath`), where a `commit-msg` hook runs the same linter CI runs over your pull request's commits. So if you never ran `npm install`, CI catches it; if you did, the hook does, before the commit exists:

```
$ git commit -m "Add the contributing guide" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
commit message rejected:
  line 1  subject-shape: expected `<symbol> [(scope)] lowercase text`, symbol one of + - ~ > ! @
    Add the contributing guide
  line 3  attribution-trailer: the git history is not a credits reel
    Co-Authored-By: Claude <noreply@anthropic.com>
  convention: docs/contributing/commit-conventions.md
```

The symbols, the scope rule, the multi-change shape, and how to run the linter over a message before you commit it are all in [`docs/contributing/commit-conventions.md`](docs/contributing/commit-conventions.md).

## Opening a pull request

If you don't have push access (which you prob don't), fork the repo and branch from dev in your fork, and make a cross repo pr to dev. Ofc, collaborators can branch in place. Don't pr to main, thats the release branch, and dev into main is a merge a maintainer runs.

CI runs on every pull request:

- lint, svelte-check and the unit suite, in one job (it also re-reads your commit messages, see above)
- the e2e suite, split four ways
- the perf job, scaled for the runner, against a production build
- a consumer smoke test, which packs the library, installs the tarball into a real app and checks it survives server rendering and hydration
- a check that the committed emoji table still matches the upstream it was generated from

Merging needs one code-owner approval. Review is root-cause first, and it'll ask for the test alongside the fix; I know that's a lot to ask of a drive-by contributor, but I have to ask anyway, for the sake of aragonite's health. If you want to start somewhere that's beginner friendly, issues labelled `good first issue` are picked to be exactly that.

## Filing an issue

Bugs (aka defect), features (proposal) and tasks go to [GitHub Issues](https://github.com/voithos-labs/aragonite/issues), through one of three forms (Defect, Proposal, Task). Questions go to discussions. The form sets the issue's type, and a maintainer adds one `area:` label at triage, plus one `severity:` if it's a defect.

Note,

1. Fill the form in honestly: what's wrong, how to reproduce it, where it seems to live.
2. Task is the form for work the codebase owes itself (a coverage gap, a refactor, a doc job, etc.); it asks for an edit site and an acceptance signal instead of a repro.
3. Yes, I see the open count. The issues, in this repo, partly acts as a to-watch ledger; `severity: watch` tracks observed signals with no confirmed defect, those and `severity: minor` stay open - i believe knowing of their existence is relatively more improtant than recklessly tidying them away.

## The paperwork

Before your first pull request, sign the contributor license agreement, [`CLA.md`](CLA.md). It's a comment on the pull request, the bot tells you the exact sentence, and it covers every pr after.

Basically, the implications of the cla is that you keep your copyright, your code stays open source forever, and voithos-labs gets to license the project as a whole under other terms too. That last bit is for [limestone](https://github.com/voithos-labs/limestone), the app this editor came out of; it's under FSL-1.1-Apache-2.0, and the AGPL won't let it carry your code without your say-so.

I do recommend you to read the whole thing anyway; it's a page.

## Two ton slab of stone

![stone](./docs/assets/stone.png)
