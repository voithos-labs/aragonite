# Contributing to aragonite

aragonite is a CST-based block editor for GFM Markdown, shipped as an embeddable Svelte + TypeScript library. This page is the on-ramp: **Quickstart** gets you running and oriented, **Workflow** is what a change has to clear. Read [`docs/contributing/rules.md`](docs/contributing/rules.md) before your first edit; it is five rules long, and every one of them was paid for by a real bug.

For the deeper material: [`docs/design/editor.md`](docs/design/editor.md) is the system spec, [`docs/guide/consumer-guide.md`](docs/guide/consumer-guide.md) covers embedding, [`docs/guide/plugin-guide.md`](docs/guide/plugin-guide.md) covers plugins, and [`docs/README.md`](docs/README.md) maps the rest.

# Quickstart

## Setup

Node 22 (an `.nvmrc` pins it), then:

```bash
npm install
npx playwright install chromium   # add --with-deps on Linux
npm run dev
```

That browser download is not optional: the E2E battery and the perf gate both drive Chromium, so without it the commit gate fails on its first Playwright project rather than on anything you wrote.

Two routes matter. `/` is the showcase, the editor with the bundled plugins installed, which is roughly what a consumer sees. `/test/editor` is the dev harness: bare, wired with test probes, and where most editor work actually happens.

## How it fits together

Raw Markdown is the single source of truth. It parses into a lossless concrete syntax tree, renders as styled blocks with dimmed markers, and serializes back byte-for-byte. The key invariant is `serialize(parse(source)) === source` for all valid GFM.

```
Raw Markdown
      │  parse
      ▼
  CST (mutable plain objects)  ·  single source of truth
      │  render
      ▼
  Contenteditable DOM (styled inline spans)
      │  serialize
      ▼
  Raw Markdown
```

The component tree follows the CST:

```
Editor (owns CST, undo stack, editor-actions contexts)
  └─ BlockList (keyed loop over CST children, windowed)
       └─ BlockHost (dispatches by block kind)
            ├─ TextEditableBlock / CodeBlock / ThematicBreakBlock
            ├─ BlockquoteBlock (recursive) / ListBlock → ListItemBlock (recursive)
            └─ TableBlock (per-cell editable grid)
```

## Where the code lives

The library is `src/lib/`; `src/routes/test/editor` is the dev harness.

```
components/      block components (Editor, BlockList, BlockHost, per-kind blocks)
editor-actions/  upward action bundles (split, merge, paste, container overrides)
tree-operations/ pure CST mutations, plus the structural-sharing primitive
schema/          cross-cutting block-kind metadata (descriptors, registries, openers,
                 merge rules, commands, keybindings)
core/            parser, serializer, inline pipeline, CST node types
ambient/         marker DOM and offset translation
cursor/          caret and measurement geometry: the DOM↔raw walk, sticky column,
                 edge affinity, visual lines, the height model and oracle windowing
                 reads, and the scrollport
reactivity/      block-list state, the state registry, and windowing (scope hooks,
                 slice math, content version)
selection/       cross-block selection model and dispatch
decorations/     view-only annotation model and its reactive state
undo/            undo/redo stack and the snapshot entry it stores
invariants/      pure predicates guarding load-bearing contracts
perf/            dev-mode performance instruments
debug/           dev debug engine (CST / selection / undo / ops dumps)
search/          read-only find/replace lens over the CST
plugins/         first-party bundled plugins, shipped as aragonite/plugins/<name>
testing/         published test seam (aragonite/testing)
test/  e2e/      Vitest unit suites and Playwright E2E (plus requirements/)
styles/          editor.css (structural) and editor-theme.css (tokens)
index.ts         the public barrel, which is the supported API surface
```

**`schema/` has no `tree-operations/` dependency, and it cross-imports with `core/inline/` in both directions**; the edges that would close a loop land on dependency-free leaf modules (`backticks`, `register-once`), so the directory-level cycle is no module cycle and both sides read the other's registries. A cross-cutting block-kind fact belongs in `schema/`. Both also share `core/` and `perf/`. `invariants/` is not a leaf: its predicates read `core/`, `schema/`, and `dev-warn`.

[`docs/contributing/codebase-map.md`](docs/contributing/codebase-map.md) is the next level down: you know the editor did something wrong, and it names the one file to open.

## Commands

| Command                      | Purpose                                                |
| ---------------------------- | ------------------------------------------------------ |
| `npm run dev`                | Showcase at `/`, dev harness at `/test/editor`         |
| `npm run test:editor`        | Unit tests (all)                                       |
| `npm run test:editor:<area>` | Unit tests by area (`package.json` is the list)        |
| `npm run test:e2e`           | E2E tests (all)                                        |
| `npm run test:e2e:<area>`    | E2E tests by area                                      |
| `npm test`                   | Full suite, the commit gate                            |
| `npm run check`              | svelte-check, 0 errors baseline                        |
| `npm run lint`               | Prettier, the docs-pack and codebase-map gates, ESLint |

## Before you read a file

**Check `git status` first.** This tree often carries in-flight work, and an uncommitted call site is not precedent: copying a pattern out of one is copying something that has not passed a gate yet.

# Workflow

## Gate tiers

Which gate you run scales with what you're doing. Gate scope follows the **files you touched**, not the task's theme: a change under `editor-actions/` runs that area's suite even if the task was "about" something else.

- **Inner loop**, seconds to a minute: the per-area scripts while iterating. Fast feedback, not sufficient to commit.
- **Commit gate**: `npm test` plus `npm run check` and `npm run lint`. Green before every commit. Expect tens of minutes for the full battery, so start it and go find something else to do.
- **Ship gate**: the commit gate plus `npm run perf:check` (the browser-measured performance ceilings) before a merge or release. Not `test:editor:perf`, which already runs inside `npm test` and adds no signal the commit gate did not have.

**`perf:check` reads red on your machine, by design.** The ceilings are calibrated against one pinned host, so an unscaled run anywhere else is diagnostic rather than a verdict ([`docs/design/performance.md`](docs/design/performance.md) carries the why). CI runs a scaled perf job, and that job is the arbiter for a PR. A red local perf run is not you breaking the editor, and it does not block your change.

Two rules from the rule set, both paid for by incidents: **never pipe a gate command** (`npm test | tail` reports the pipe's exit code, not the gate's, so capture to a file and check the exit explicitly), and **long batteries run alone**, never concurrently with other work on the same tree.

Three honest warnings about the battery on real hardware:

- A handful of heavy specs carry wall-clock budgets sized on the pinned machine, so a slower laptop or a loaded host can tip one red without your change being wrong. The tracked set lives in [issue #81](https://github.com/voithos-labs/aragonite/issues/81), and CI is the arbiter, same as perf.
- A battery you interrupt can leave a dev server alive on port 1420, and the next run will happily reuse it and serve stale code, which looks like everything failing instantly. Kill leftover node processes before rerunning.
- **Pre-warm that server on a cold checkout.** Playwright starts it with a short `webServer` timeout, and a cold Vite boot on a fresh `node_modules` can outrun it. Run `npm run dev` once and let it come up, or read your first E2E run's instant failure as the phantom it is.

## Commit messages

Symbol-prefixed, lowercase, one logical change per commit. Full convention: [`docs/contributing/commit-conventions.md`](docs/contributing/commit-conventions.md).

## Submitting a change

Fork the repo (collaborators can branch in place), branch from `dev`, and open the pull request against `dev`. Never against `main`: `main` is the release branch, and `dev` into `main` is a maintainer-run merge.

CI runs on every PR: lint, svelte-check and the unit suite in one job; the E2E battery across four shards; a scaled perf job against a production build; a consumer smoke test that packs the library, installs the tarball into a real app and checks it survives SSR and hydration; and the emoji-table provenance check. Merging needs one code-owner approval.

Review is root-cause first, and it will ask for the test alongside the fix. The bar is deliberately high, because the failure mode of this codebase is silent byte corruption that surfaces three releases later. None of that is about you, all of it is about the code. If you want an entry point rather than a cold start, issues labelled `good first issue` are picked to be exactly that.

## Filing defects

Defects and proposals go straight to [GitHub Issues](https://github.com/voithos-labs/aragonite/issues), each labelled with one `severity:` and one `area:` label. The issue forms ask for the shape we want, so filling one in is the whole job: what is wrong, how to reproduce it, and where it seems to live.

A note on reading the ledger: it is deliberately a memory, not a scoreboard. `severity: watch` entries record observed signals with no confirmed defect, and small true things stay open until fixed rather than being tidied away, so the open count runs higher than the defect count. The labels are the sort order.

Friction that is real but is not a defect (a convention nobody wrote down, a doc that sends you the wrong way) belongs in [`docs/contributing/friction-log.md`](docs/contributing/friction-log.md). If you trip over something while getting oriented, add it there before it becomes invisible to you.

## Fixing bugs

Root-cause first, never a patch around an edge case. Add the regression test **red first** (it fails on the pre-fix code, for the right reason), then fix. Record a one-line miss-analysis, what test should have caught this and why none did, in the regression test's requirement file (e2e) or as the regression test's own header line (unit).

A dev warning is a gate failure rather than console noise; [`docs/contributing/warnings.md`](docs/contributing/warnings.md) says which channel means what.

## What a real change looks like

[`docs/contributing/anatomy-of-a-change.md`](docs/contributing/anatomy-of-a-change.md) walks one cross-cutting feature from first design decision to ship: where the seams went, which guards caught the drift, and the two tests that passed for the wrong reason.

# Licensing

aragonite is licensed under [GPL-3.0-or-later](LICENSE). Contributions are accepted under the same terms (inbound = outbound): by submitting a change you agree it is licensed under the project license.
