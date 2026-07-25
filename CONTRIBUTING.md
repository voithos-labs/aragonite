# Contributing to aragonite

aragonite is a CST-based block editor for GFM Markdown, shipped as an embeddable Svelte + TypeScript library. Orient on the system from [`docs/design/editor.md`](docs/design/editor.md); for embedding it see [`docs/guide/consumer-guide.md`](docs/guide/consumer-guide.md), for extending it with plugins see [`docs/guide/plugin-guide.md`](docs/guide/plugin-guide.md). [`docs/README.md`](docs/README.md) maps the rest.

## Setup

Node LTS, then:

```bash
npm install
npm run dev      # demo editor at /test/editor
```

## Gate tiers

Which gate you run scales with what you're doing. Gate scope follows the **files you touched**, not the task's theme — a change under `editor-actions/` runs that area's suite even if the task was "about" something else.

- **Inner loop** — the per-area scripts (`test:editor:<area>`, `test:e2e:<area>`) while iterating. Fast feedback; not sufficient to commit.
- **Commit gate** — `npm test` (full unit + every E2E project) plus `npm run check` (svelte-check, 0 errors) and `npm run lint` (Prettier, the docs-pack link gate, ESLint). Green before every commit.
- **Ship gate** — the commit gate plus `npm run perf:check` (the browser-measured performance ceilings) before a merge or release. Not `test:editor:perf`: that one already runs inside `npm test`, so it adds no signal the commit gate did not have.

Two rules from [`docs/contributing/culture.md`](docs/contributing/culture.md), both paid for by incidents: **never pipe a gate command** (`npm test | tail` reports the pipe's exit code, not the gate's — capture to a file and check the exit explicitly), and **long batteries run alone**, never concurrently with other work on the same tree.

## Commit messages

Symbol-prefixed, lowercase, one logical change per commit. Full convention: [`docs/contributing/commit-conventions.md`](docs/contributing/commit-conventions.md).

## The rules the code can't tell you

[`docs/contributing/culture.md`](docs/contributing/culture.md) is the incident-backed rule set — the conventions that aren't derivable from reading the source, each one paid for by a real bug. Read it before your first edit.

## Fixing bugs

Root-cause first — never patch around an edge case. Add the regression test **red first** (it fails on the pre-fix code, for the right reason), then fix. Record a one-line miss-analysis — what test should have caught this, and why none did — in the commit message.

## Licensing

aragonite is licensed under [GPL-3.0-or-later](LICENSE). Contributions are accepted under the same terms (inbound = outbound): by submitting a change you agree it is licensed under the project license.
