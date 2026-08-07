# Contributing to aragonite

aragonite is a CST-based block editor for GFM Markdown, shipped as an embeddable Svelte + TypeScript library. Orient on the system from [`docs/design/editor.md`](docs/design/editor.md); for embedding it see [`docs/guide/consumer-guide.md`](docs/guide/consumer-guide.md), for extending it with plugins see [`docs/guide/plugin-guide.md`](docs/guide/plugin-guide.md). [`docs/README.md`](docs/README.md) maps the rest.

## Setup

Node 22 (an `.nvmrc` pins it), then:

```bash
npm install
npx playwright install chromium   # add --with-deps on Linux
npm run dev
```

That browser download is not optional: the E2E battery and the perf gate both drive Chromium, so without it the commit gate fails on its first Playwright project rather than on anything you wrote.

Two routes matter. `/` is the showcase, the editor with the bundled plugins installed, which is roughly what a consumer sees. `/test/editor` is the dev harness: bare, wired with test probes, and where most editor work actually happens.

## The rules the code can't tell you

[`docs/contributing/culture.md`](docs/contributing/culture.md) is the incident-backed rule set, the conventions that aren't derivable from reading the source, each one paid for by a real bug. It opens with five lines. Read those before your first edit, and the casebook under them before your first structural change.

## Gate tiers

Which gate you run scales with what you're doing. Gate scope follows the **files you touched**, not the task's theme: a change under `editor-actions/` runs that area's suite even if the task was "about" something else.

- **Inner loop**, seconds to a minute: the per-area scripts (`test:editor:<area>`, `test:e2e:<area>`) while iterating. Fast feedback, not sufficient to commit.
- **Commit gate**: `npm test` (full unit + every E2E project) plus `npm run check` (svelte-check, 0 errors) and `npm run lint` (Prettier, the docs-pack link gate, ESLint). Green before every commit. Expect tens of minutes for the full battery, so start it and go find something else to do.
- **Ship gate**: the commit gate plus `npm run perf:check` (the browser-measured performance ceilings) before a merge or release. Not `test:editor:perf`, which already runs inside `npm test` and adds no signal the commit gate did not have.

**`perf:check` reads red on your machine, by design.** The ceilings are calibrated against one pinned host, so an unscaled run anywhere else is diagnostic rather than a verdict ([`docs/design/performance.md`](docs/design/performance.md) carries the why). CI runs a scaled perf job, and that job is the arbiter for a PR. A red local perf run is not you breaking the editor, and it does not block your change.

Two rules from culture.md, both paid for by incidents: **never pipe a gate command** (`npm test | tail` reports the pipe's exit code, not the gate's, so capture to a file and check the exit explicitly), and **long batteries run alone**, never concurrently with other work on the same tree.

Two more honest warnings about the battery on real hardware. First, a handful of heavy specs carry wall-clock budgets sized on the pinned machine, so a slower laptop or a loaded host can tip one red without your change being wrong; the tracked set lives in [issue #81](https://github.com/voithos-labs/aragonite/issues/81), and CI is the arbiter, same as perf. Second, a battery you interrupt can leave a dev server alive on port 1420, and the next run will happily reuse it and serve stale code, which looks like everything failing instantly; kill leftover node processes before rerunning.

## Commit messages

Symbol-prefixed, lowercase, one logical change per commit. Full convention: [`docs/contributing/commit-conventions.md`](docs/contributing/commit-conventions.md).

## Submitting a change

Fork the repo (collaborators can branch in place), branch from `dev`, and open the pull request against `dev`. Never against `main`: `main` is the release branch, and `dev` into `main` is a maintainer-run merge.

CI runs on every PR: lint, svelte-check and the unit suite in one job; the E2E battery across four shards; a scaled perf job against a production build; a consumer smoke test that packs the library, installs the tarball into a real app and checks it survives SSR and hydration; and the emoji-table provenance check. Merging needs one code-owner approval.

Review is root-cause first, and it will ask for the test alongside the fix. The bar is deliberately high, because the failure mode of this codebase is silent byte corruption that surfaces three releases later. None of that is about you, all of it is about the code. If you want an entry point rather than a cold start, issues labelled `good first issue` are picked to be exactly that.

## Filing defects

Defects and proposals go straight to [GitHub Issues](https://github.com/voithos-labs/aragonite/issues), each labelled with one `severity:` and one `area:` label. The issue forms ask for the shape we want, so filling one in is the whole job: what is wrong, how to reproduce it, and where it seems to live.

A note on reading the ledger: it is deliberately a memory, not a scoreboard. `severity: watch` entries record observed signals with no confirmed defect, and small true things stay open until fixed rather than being tidied away, so the open count runs higher than the defect count. The labels are the sort order.

## Fixing bugs

Root-cause first, never a patch around an edge case. Add the regression test **red first** (it fails on the pre-fix code, for the right reason), then fix. Record a one-line miss-analysis, what test should have caught this and why none did, in the regression test's requirement file (e2e) or as the regression test's own header line (unit).

## Licensing

aragonite is licensed under [GPL-3.0-or-later](LICENSE). Contributions are accepted under the same terms (inbound = outbound): by submitting a change you agree it is licensed under the project license.
