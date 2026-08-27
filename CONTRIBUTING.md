# Contributing to aragonite

So you want to work on this thing. Genuinely, thank you, and also: sorry in advance [^1].

The bar here is higher than it has any right to be for a markdown editor, and I want to tell you why up front instead of letting you discover it in review. The failure mode of this codebase is not a crash. It is silent byte corruption that shows up three releases later in somebody's notes, and by then nobody can tell which commit ate the file. Everything annoying below exists because of that one sentence.

**Quickstart** gets you running. **Workflow** is what your change has to survive. And [`docs/contributing/rules.md`](docs/contributing/rules.md) is five rules long, each one paid for by a real bug, so please read it before your first edit rather than after your first review.

If you want the deeper stuff: [`docs/design/editor.md`](docs/design/editor.md) is the system spec, [`docs/guide/consumer-guide.md`](docs/guide/consumer-guide.md) covers embedding, [`docs/guide/plugin-guide.md`](docs/guide/plugin-guide.md) covers plugins, and [`docs/README.md`](docs/README.md) maps everything else.

# Quickstart

## Setup

Node 24 (there's an `.nvmrc`), then:

```bash
npm install
npx playwright install chromium   # add --with-deps on Linux
npm run dev
```

That browser download is not optional, and skipping it is the single most common way to have a bad first day. The E2E battery and the perf gate both drive Chromium, so without it your very first commit gate dies on a Playwright project instead of on anything you actually wrote, and you will spend twenty minutes debugging your own code for no reason.

Two routes matter. `/` is the showcase: the editor with the bundled plugins installed, roughly what a consumer sees. `/test/editor` is the dev harness, which is bare, wired with test probes, and where most editor work actually happens.

## How it fits together

Raw Markdown is the single source of truth. It parses into a lossless concrete syntax tree, renders as styled blocks with dimmed markers, and serializes back byte-for-byte. The whole project hangs off one invariant:

```
serialize(parse(source)) === source     for all valid GFM
```

Break that and nothing else matters.

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

The component tree follows the CST, because of course it does:

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
plugins/         first-party bundled plugins, shipped as @voithos-labs/aragonite/plugins/<name>
testing/         published test seam (@voithos-labs/aragonite/testing)
test/  e2e/      Vitest unit suites and Playwright E2E (plus requirements/)
styles/          editor.css (structural) and editor-theme.css (tokens)
index.ts         the public barrel, which is the supported API surface
```

One layering note that will otherwise confuse you: **`schema/` has no `tree-operations/` dependency, and it cross-imports with `core/inline/` in both directions.** The edges that would close a loop land on dependency-free leaf modules (`backticks`, `register-once`), so the directory-level cycle is not a module cycle and both sides read the other's registries. A cross-cutting block-kind fact belongs in `schema/`. Both also share `core/` and `perf/`. And `invariants/` is not a leaf, since its predicates read `core/`, `schema/`, and `dev-warn`.

When you know the editor did something wrong but not where, [`docs/contributing/codebase-map.md`](docs/contributing/codebase-map.md) names the one file to open. It is the most useful document in the repo and nobody reads it.

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

**Run `git status` first.** This tree usually has work in flight, and an uncommitted call site is not precedent. Copy a pattern out of one and you are copying something that has not passed a gate yet, which is a fun conversation to have in review.

# Workflow

## Gate tiers

How much you run scales with what you did. Scope follows the **files you touched**, not what the task was "about": a change under `editor-actions/` runs that area's suite even if you were thinking about selection the whole time.

- **Inner loop**, seconds to a minute: the per-area scripts while you iterate. Fast, and nowhere near enough to commit.
- **Commit gate**: `npm test` plus `npm run check` and `npm run lint`. Green before every commit. This takes tens of minutes, so start it and go do something else with your life.
- **Ship gate**: the commit gate plus `npm run perf:check` before a merge or release. It builds and previews the app first, so it measures the editor rather than the dev server, and takes several minutes for that reason. Not `test:editor:perf`, which already runs inside `npm test` and tells you nothing new.

**`perf:check` will read red on your machine, and that is fine.** The ceilings are calibrated against one pinned host, so an unscaled run anywhere else is a diagnostic, not a verdict ([`docs/design/performance.md`](docs/design/performance.md) explains why). CI runs a scaled perf job and that job is the arbiter. A red local perf run is not you breaking the editor and it does not block your change.

Two rules from the rule set, both bought with incidents: **never pipe a gate command** (`npm test | tail` reports the pipe's exit code, not the gate's, so capture to a file and check the exit yourself), and **long batteries run alone**, never next to other work on the same tree.

Three honest warnings about the battery on real hardware, because I would rather you hear them from me than from a red run at midnight:

- A few specs still carry absolute wall-clock budgets, so a slower laptop or a busy host can tip one red without your change being wrong. Most of that class was engineered away: G4.48 forces new timing assertions onto a machine-speed-cancelling ratio instead, and what is left is a reasoned allowlist in `src/lib/test/invariants/lint/wall-clock-budgets.test.ts`. CI is the arbiter, same as perf.
- A battery you interrupt can leave a dev server alive on port 1420, and the next run will cheerfully reuse it and serve stale code, which looks exactly like everything failing at once. Kill leftover node processes before rerunning.
- **Pre-warm that server on a cold checkout.** Playwright starts it with a short `webServer` timeout, and a cold Vite boot on fresh `node_modules` can outrun it. Run `npm run dev` once and let it come up, or learn to read your first E2E run's instant failure as the phantom it is.

## Commit messages

Symbol-prefixed, lowercase, one logical change per commit, and the summary line is capped at 72 characters. `npm install` points git at `.githooks/`, where a `commit-msg` hook rejects a message that breaks the shape before the commit exists, and CI reads your pull request's commits again in case you never ran it. Full convention in [`docs/contributing/commit-conventions.md`](docs/contributing/commit-conventions.md).

## Submitting a change

Fork the repo (collaborators can branch in place), branch from `dev`, and open the pull request against `dev`. Never against `main`. `main` is the release branch, and `dev` into `main` is a maintainer-run merge.

CI runs on every PR: lint, svelte-check and the unit suite in one job; the E2E battery across four shards; a scaled perf job against a production build; a consumer smoke test that packs the library, installs the tarball into a real app and checks it survives SSR and hydration; and the emoji-table provenance check. Merging needs one code-owner approval.

Review is root-cause first, and it will ask for the test alongside the fix. I know that is a lot to ask of a drive-by contributor, and I am asking anyway, for the reason at the top of this page. None of it is about you. All of it is about the code. If you would rather start somewhere with edges, issues labelled `good first issue` are picked to be exactly that.

## Filing defects

Defects and proposals go straight to [GitHub Issues](https://github.com/voithos-labs/aragonite/issues). The form sets the issue's type, and a maintainer adds one `area:` label at triage, plus one `severity:` if it is a defect. The forms ask for the shape we want, so filling one in honestly is the whole job: what is wrong, how to reproduce it, and where it seems to live. A repro beats a description of a repro every single time.

A note on reading the ledger, because the open count looks alarming and is not: it is a memory, not a scoreboard. `severity: watch` entries record observed signals with no confirmed defect, and small true things stay open until they are fixed rather than being tidied away to make a number look nice. The labels are the sort order.

Friction that is real but is not a defect (a convention nobody wrote down, a doc that sent you the wrong way) belongs in [`docs/contributing/friction-log.md`](docs/contributing/friction-log.md). If you trip over something while getting oriented, put it there while you can still see it. Give it a week and it will be invisible to you, same as it is to me [^2].

## Fixing bugs

Root-cause first, never a patch around the edge case you happened to find. Add the regression test **red first**, meaning it fails on the pre-fix code for the right reason, then fix it. Then record a one-line miss-analysis, which is what test should have caught this and why none did, in the regression test's requirement file (e2e) or as the test's own header line (unit).

That last one feels like paperwork and isn't. It is how the suite's blind spots get named instead of rediscovered.

A dev warning is a gate failure, not console noise; [`docs/contributing/warnings.md`](docs/contributing/warnings.md) says which channel means what.

## What a real change looks like

[`docs/contributing/anatomy-of-a-change.md`](docs/contributing/anatomy-of-a-change.md) walks one cross-cutting feature from first design decision to ship: where the seams went, which guards caught the drift, and the two tests that passed for the wrong reason. Read it if you want to know what you are signing up for.

# Licensing

aragonite is [GPL-3.0-or-later](LICENSE), and contributions come in under the same terms (inbound = outbound): by submitting a change you agree it is licensed under the project license. That is the whole ceremony, there is no CLA to sign.

# Footnote

[^1]: both halves of that are sincere.

[^2]: the whole point of the friction log is that orientation problems are only visible to people who are currently disoriented, and I stopped being that a long time ago.
