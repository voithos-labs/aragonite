# Testing

So, two layers:

| Layer | Runner     | Location        | Tests                                                 |
| ----- | ---------- | --------------- | ----------------------------------------------------- |
| Unit  | Vitest     | `src/lib/test/` | Pure logic: parser, serializer, tree ops, merge rules |
| E2E   | Playwright | `src/lib/e2e/`  | Real user interaction in a real browser               |

Where to jump:

- [Unit tests (Vitest)](#unit-tests-vitest): where a file goes, the area scripts, mounting a
  block without the whole editor, and the console-warning gate.
- [E2E tests (Playwright)](#e2e-tests-playwright): the fixture import rule, the test bridge, the
  app the suite serves, the area scripts, the plugins route and what's installed on it, the browser engines, the
  requirement files, and the gotchas.
- [The conformance differ](#the-conformance-differ): our inline parser diffed against
  commonmark.js.
- [Property suites and fresh seeds](#property-suites-and-fresh-seeds): why the random tests
  aren't random, and the switch that makes them random again.
- [The live-mode gesture fuzzer](#the-live-mode-gesture-fuzzer): seeded destructive gestures at
  hidden construct edges.
- [The note-taking simulation](#the-note-taking-simulation): whole documents typed keystroke by
  keystroke, the best test this repo has at catching a corrupted document.
- [The consumer smoke](#the-consumer-smoke): the example app that installs the packed tarball,
  what CI checks with it, and how to run it yourself.
- [The adapter suite](#the-adapter-suite): the same idea for the framework wrappers, one suite
  over React, Next, Vue and Nuxt apps.
- [Size budgets](#size-budgets): the first-load budget that reds when it moves, how to accept a
  move on purpose, and the report numbers that don't gate.
- [The behavior differential](#the-behavior-differential): every key at every offset of a set of
  documents, compared before and after your change, so a refactor can show it changed nothing.
- [Every short input](#every-short-input): every string up to a few characters long, parsed,
  round-tripped and edited at every offset.
- The performance harness (fixtures, instruments, threshold policy) lives in
  `docs/design/performance.md` § The numbers and the gate.
- The debug panel, its console helpers, and dumping editor state inside a test are in
  [`debugging.md`](debugging.md).

Beside the two layers sits `src/lib/testing/`, which isn't a test layer but **shipped code**:
the published `@voithos-labs/aragonite/testing` module, the kits a plugin author runs inside their
own test suite. Don't put tests there.

The three commands you'll type most:

```bash
npm test               # full suite: unit, then every e2e project
npm run test:editor    # all unit tests
npm run test:e2e       # all E2E tests (builds and serves the app first)
```

Both layers are also sliced into area scripts for the inner loop, `test:editor:<area>` and
`test:e2e:<area>`. **`package.json` is the authoritative list**; the tables below say what each area
covers. An area run is a few seconds. A unit area is just a directory, so its script is one
`vitest run` line:

```
$ npm run test:editor:undo

> @voithos-labs/aragonite@… test:editor:undo
> vitest run src/lib/test/undo

 Test Files  … passed (…)
      Tests  … passed (…)
```

## Unit tests (Vitest)

No browser. Node by default, with a file opting into jsdom via a
`// @vitest-environment jsdom` docblock where it needs a DOM (every `*.svelte.test.ts` that mounts
a component does). The round-trip tests at `test/` root check that parsing then serializing gives
back the exact input, so if you touch the parser or the serializer, that's the suite to watch
first.

### Where a test file goes

`src/lib/test/` mirrors the source tree one-for-one, with the leading `components/` segment
dropped for its subfolders, so `components/blocks/list/X.ts` maps to `test/blocks/list/X.test.ts`.
The files sitting directly in `components/` (`BlockHost.svelte`, `Editor.svelte`) test under
`test/components/`; `components/editor-root/` tests under `test/editor-root/`. When the module under test moves into a subdirectory, its test
follows.

Mirror **import depth**, not just the module's directory: a test importing
`tree-operations/list/ordered-markers` directly (rather than the `tree-operations` barrel) lives
at `test/tree-operations/list/ordered-markers.test.ts`.

Four deliberate exceptions, and no, a fifth isn't on offer:

- **Cross-cutting tests for editor-root services** (round-trip, editor events, block identity,
  dev warnings) stay at `test/` root, because the code they exercise sits at the editor root.
- **The invariant catalog** (`test/invariants/`, with shared arbitraries under `arbitraries/`
  and source-scan guards under `lint/`) lives in one place so the whole set is legible in one
  read. See `docs/design/invariants.md`.
- **Simulation-engine unit tests** (`test/simulation/`) mirror `e2e/simulation/`, an e2e-owned
  engine exercised by the unit runner rather than a `src/lib/` module.
- **The debug-panel state test** (`test/debug/panel-state`) covers a route-level module outside
  `src/lib/`, so it has no in-library module to mirror.

Two helper folders sit beside the mirrored tests. `test/support/` holds only what Vitest loads by
itself (the setup files in `vitest.config.ts` and the data they read). Anything a test file imports
to mount, drive or fixture something goes in `test/harness/`. Neither holds a test file; a test of
that machinery (the warn gate, the growth harness) sits at `test/` root, since there's no source
folder for it to mirror.

A source scan (a test under `lint/` that reads source files and fails on a pattern) takes every
path it reads from `src/lib/test/invariants/lint/source-paths.ts`, so moving a file is one edit
there. Hand-write a path in a scan instead and `source-paths.test.ts` fails, naming the path. A scan
that matches imports uses the helpers in `src/lib/test/invariants/lint/scan-source.ts` rather than
spelling `#lib` (the import alias for `src/lib`) itself.

The one naming rule that changes how a file runs: a `*.deep.test.ts` file runs in its own Vitest
project (`deep-stack` in `vitest.config.ts`) on a 150 KB stack. That's small enough that a
recursive walk overflows at a depth jsdom still renders in a few seconds, so it's the place for a
test proving some walk never recurses.

Test files take turns in a shared Node process, which bites in three ways:

- a test that changes `process.env` or patches a Node built-in (`fs`, say) restores it in that
  same test, or the next file on the worker inherits it
- values Node itself makes, like an `fs` error or a `structuredClone` result, aren't `instanceof`
  your file's own `Error` or `Array`, so check them some other way (`Array.isArray`, the error's
  `code`)
- a test that calls vite's `resolveConfig` fails with a type error out of rolldown; a file like
  that goes in `NODE_REALM` in `vitest.config.ts`, which runs it in a plain worker

### By area

| Script                       | Covers                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `test:editor:core`           | Parser, serializer, inline scanner, directive grammar, round-trip invariants                                |
| `test:editor:tree-ops`       | Tree mutation helpers                                                                                       |
| `test:editor:editor-actions` | Editor action bundles and commit primitives                                                                 |
| `test:editor:schema`         | Block-kind descriptors, op vocabulary, openers, container raw rebuild, merge rules                          |
| `test:editor:browser`        | Offset translation, the caret writer, the selection readers, line and point reads                           |
| `test:editor:caret`          | Caret memory, sticky column, drawn caret, delete extents                                                    |
| `test:editor:windowing`      | Virtual rendering: height model, scroll owner, per-list windowing                                           |
| `test:editor:block-lists`    | Block-list state and state registry                                                                         |
| `test:editor:selection`      | Selection-state logic                                                                                       |
| `test:editor:decorations`    | Decoration engine: sources, edit-epoch invalidation, path buckets, widget model                             |
| `test:editor:blocks`         | Per-block unit tests                                                                                        |
| `test:editor:image`          | Image dimensions, resize, source bytes, widget selection                                                    |
| `test:editor:plugins`        | Plugin authoring APIs and the plugins built on them: container round-trips, chrome leaves, paste transforms |
| `test:editor:undo`           | Undo stack and entry management                                                                             |
| `test:editor:search`         | Find/replace engine: document scan and search state                                                         |
| `test:editor:simulation`     | Simulation-engine internals: seeded RNG, expectation tracker                                                |
| `test:editor:conformance`    | commonmark.js differ slice: spec examples + seeded corpus vs the committed baseline                         |
| `test:editor:invariants`     | Invariant catalog: property/fuzz tests + source-scan guards                                                 |
| `test:editor:debug`          | Debug engine helpers and operations log                                                                     |
| `test:editor:perf`           | Perf commit gate: counter ceilings, amplification report, fixture goldens                                   |
| `test:editor:exhaustive`     | Every short input, at the lengths `npm test` runs                                                           |

The inline-scanner suite (`test/core/inline/scan/`) and the directive suite
(`test/core/directive/`) fold under `test:editor:core`. Anything without a script of its own
(the root-level tests, `test/components/`, `test/editor-root/`, `test/inline-menu/`) runs in the
full `test:editor` suite. A new area is one `vitest run src/lib/test/<dir>` line in `package.json`.

### Mounting a block in isolation

A block component reads its wiring from the editor's context tree, so a bare
`mount(SomeBlock, …)` needs that context present. `src/lib/test/harness/mount-block.ts :: mountBlock`
mounts one block over a parsed document with every context stubbed (the stubs are in
`test/harness/mount-context.ts`), and a test overrides only what it asserts on. From
`test/blocks/text/text-crlf-commit.test.ts`, which mounts a real prose block and hands it a
decoration engine that reports no widgets:

```ts
import TextEditableBlock from '#lib/components/blocks/text/TextEditableBlock.svelte';
import { mountBlock } from '../../harness/mount-block';

const { target, blockEdit, dispose } = mountBlock(TextEditableBlock, {
	source: 'hello\n',
	overrides: { services: { decorations: noIslands } }
});
// blockEdit is spied: expect(blockEdit.updateBlockContent).toHaveBeenCalledWith(...)
```

If you add a context the blocks require, give it a stub in `mount-context.ts`. One catch: a bare
mount keeps the node it was handed, since nothing above it re-renders after a commit. So a test that
makes more than one gesture mounts the whole Editor with
`src/lib/test/harness/mount-editor.svelte.ts :: mountEditor` instead, and writes its `props` the way
a host would. After a gesture, either mount waits with
`src/lib/test/harness/settle.ts :: settleEditor` (or sends the key with `pressKey`), never with a
timer.

### Every test starts with just the built-ins

The unit setup (`src/lib/test/support/plugin-platform.ts`) resets the plugin platform before
every test, so you don't write that reset yourself. The catch: a plugin you install as the file
loads, or in `beforeAll`, is gone before the first test runs, and the suite quietly tests plain
GFM instead (your `$$` fence is a paragraph now). Install in `beforeEach` or inside the test.
`src/lib/test/invariants/lint/suite-file-rules.test.ts` fails a reset hook of your own and a
registration at load, in a `describe` body or in `beforeAll`. A test about the reset itself calls
`resetPluginPlatformForTests` in the test body.

The editor's environment flags (`devChecksOn` and `isTestProcess`: is this a dev build, is this a
test process) get the same treatment. The warning gate (next section) resets them after every
test, so a suite that configures them does it per test; a `beforeAll` override is gone by the
second case.

### A dev warning fails its test

Every `devWarn` fire reaches a sink the unit setup registers (a function `devWarn` hands entries
to instead of printing), and a fire no test claims fails that test. Svelte's own runtime warnings
have no sink, so the setup wraps `console.warn` and files them into the same records under
`svelte:<code>`; they claim through the same calls. Which console channel a fire belongs to, and
what each one means, is [`warnings.md`](warnings.md).

An unclaimed fire reads like this at the test's verdict, one line per fire in the middle (its
tag, the file that emitted it, and the message):

```
Error: 1 unclaimed devWarn fire(s) in this test:
  ...
A guard that should never fire has fired: fix it. A test whose subject is the fire asserts on takeDevWarns(); a fixture that provokes one declares allowDevWarns([tag]); a cross-cutting benign diagnostic joins src/lib/test/support/warn-allowlist.json.
```

Some tests light a fire on purpose (a test proving a guard works has to violate the contract).
How a test claims one, four ways from narrowest to widest, is
[`warnings.md` § Claiming a fire in a unit test](warnings.md#claiming-a-fire-in-a-unit-test); the
claim helpers (`takeDevWarns`, `drainDevWarns`, `allowDevWarns`) import from
`src/lib/test/support/warn-gate.ts`.

Two rules the gate holds you to:

- A guard that defers its fire past a tick (`reportContestedClaim`, say) still lands on the test
  that provoked it, but after the file's own claim helpers have run. Claim it inside the test
  (`await tick()`, then `takeDevWarns()`), never with a file-level `allowDevWarns`.
- Don't mock or spy your way around it. A `vi.mock` of `@voithos-labs/aragonite/dev-checks` deletes the emitter, and
  a `console.warn` spy either sees nothing (the sink took the line) or hides the Svelte warnings
  too, so a source scan (G4.41 in `invariants/scans.md`) fails both.

## E2E tests (Playwright)

The editor component driven in a real browser, Chromium unless you pick another engine
([Browser engines](#browser-engines)). No backend needed; it's self-contained.

**Every spec imports `test` and `expect` from `src/lib/e2e/fixtures.ts`, never from
`@playwright/test` directly.** This isn't a style preference, and I will be tedious about it in
review. The shared `test` watches the page and fails the spec that caused a problem, so a dev
guard firing surfaces right there instead of passing silently and turning up a release later.
What it fails a spec on:

- a dev warning, which reaches the browser console under the `[aragonite:…]` prefix
- a Svelte runtime warning, under `[svelte] <code>`
- an uncaught page error or rejection, under the tag `pageerror`
- an error only `window.onerror` sees (Chromium reports a ResizeObserver loop there and nowhere
  else), which the fixture relays under `onerror:<message>`
- a request to any host but the app server, which it blocks and names by URL. The harness's
  images live in `static/test-fixtures/`, and a spec that needs a page from elsewhere answers a
  made-up host (`https://e2e-link.test/`, say) with its own `route`

The verdict lands at teardown and names the fire:

```
Error: unexpected [aragonite:…] / [svelte] console fires or uncaught errors:
warning: [aragonite:demo] a fire the spec did not declare
```

A spec that trips one on purpose names it up front, with the option for its kind:

```ts
test.use({ expectInvariants: ['late-opener-registration'] }); // a guard (an invariant fire)
test.use({ expectWarns: ['demo'] }); // a plain dev warning: the fire above would have passed
test.use({ expectSvelteWarns: ['derived_inert'] }); // a Svelte warning code
test.use({ expectPageErrors: [RESIZE_OBSERVER_LOOP] }); // a window.onerror message
```

All four cut both ways: a named tag that stops firing fails the spec too.

### Architecture

```
Playwright spec
    ↓
EditorPage (page object, src/lib/e2e/editor-page.ts)
    ↓
Test route (/test/editor) + test bridge (window.__test)
    ↓
Editor.svelte (production component, unchanged)
```

- **The test route** (`src/routes/test/editor/+page.svelte`) renders the Editor with a bridge on
  `window.__test` exposing source and block queries.
- **EditorPage** wraps Playwright with editor-specific _interaction_ helpers: cursor
  positioning, text insertion, key presses.
- **`editor.bridge`** is the _state_ accessor: `getSource` / `getBlockCount` / `getBlockKind`,
  plus the `waitForSource*` / `waitForBlockCount` settling predicates. Reach for these instead
  of `waitForTimeout` whenever you're waiting on document state.
- **Absence checks** prove a gesture changed nothing, which no wait-for predicate can see, since
  there's no change to wait for. For keys, `pressDeclined(key)` and `typeDeclined(text)` return once
  the editor has recorded what it did with each keydown; if one fails naming a key, that press
  reached no editable element, which is a finding, not a timeout to widen. In reading mode,
  `expectSurfaceInert()` checks that no editable element is left. `waitForNoSourceMutation` is the
  fallback for a gesture with no keydown (a click, a drag, a paste, a menu item), and each call gets
  a comment naming the gesture (`// A toggle click, not a keystroke.`).

The two halves side by side, on a two-block document with the caret parked at the end of the
paragraph:

```ts
await editor.loadContent('# Hello\n\nWorld.\n');
await editor.focusBlockEnd(1);

await editor.bridge.getSource(); // '# Hello\n\nWorld.\n'
await editor.bridge.getBlockCount(); // 2
await editor.bridge.getBlockKind(0); // 'heading'
await editor.bridge.getSelectionPaths(); // { anchor: { path: [1], offset: 6 }, focus: { path: [1], offset: 6 } }
await editor.getBlockText(0); // '# Hello', the dimmed marker included
```

### The app under test is a build

Every run starts by building the app (a development build, so every dev check, warning and test
bridge is still in it) and serves that with `vite preview` on port 1430.

Two things follow from serving a build:

- A run tests the tree as it stood when the run started. Saving a file mid-run changes nothing,
  and the next run picks it up.
- Nothing is ever reused. Each run builds its own app into `.svelte-kit/e2e-<port>`, so a server
  left over from an interrupted run fails the next one loudly (the port is taken) instead of
  serving it stale code. Kill it and rerun.

`E2E_PORT=1440` moves the run to another port (the perf gate's prod preview takes the next one),
so two runs on one machine, from two worktrees say, never fight over 1430:

```
$ node scripts/run-with-env.mjs E2E_PORT=1440 -- npm run test:e2e -- --project=e2e-top smoke.spec.ts

[WebServer] > node scripts/run-with-env.mjs NODE_ENV=development ARAGONITE_E2E_BUILD=1 -- vite build
[WebServer] ✓ built in …
[WebServer] > node scripts/run-with-env.mjs ARAGONITE_E2E_BUILD=1 -- vite preview --host 127.0.0.1 --port 1440 --strictPort
[WebServer]   ➜  Local:   http://127.0.0.1:1440/

Running 1 test using 1 worker

  ✓  1 [e2e-top] › src/lib/e2e/tests/smoke.spec.ts:6:2 › editor smoke tests › the editor mounts, the bridge answers, and loadContent replaces the document (…)

  1 passed (…)
```

(`scripts/run-with-env.mjs` is what sets the variable, since `KEY=1 cmd` doesn't work in a
Windows shell. Go through the npm script rather than calling it yourself; from a bare shell
`playwright` isn't on the path.)

`E2E_SERVER=dev` serves the Vite dev server instead (reusing one already on 1420 unless `E2E_PORT`
says otherwise), for Playwright's UI and watch modes, which want it to reload when you save.

**A spec that dies with `Failed to fetch dynamically imported module`** under `E2E_SERVER=dev`
caught the dev server finding a package after the page loaded and reloading it. A package the app
loads with `import()` goes in `optimizeDeps.include` in `vite.config.js`; the unit lint usually
tells you first.

### By area

Specs are organized by feature area at the top level, and per block inside `tests/blocks/`.

| Script                    | Covers                                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test:e2e:top`            | Top-level specs: smoke, text editing, keyboard nav, undo, inline, containers                                                                                                                                 |
| `test:e2e:blocks`         | All per-block specs under `tests/blocks/`                                                                                                                                                                    |
| `test:e2e:blocks:<block>` | One block only: `list`, `code`, `image`, `table`, `blockquote`                                                                                                                                               |
| `test:e2e:plugins`        | Plugin authoring: plugin containers, reserved chrome, collapse, the `plugins` prop, inline widgets drawn by Svelte components, editable leaves, and the browser conformance sweep over every registered kind |
| `test:e2e:clipboard`      | Cut / copy / paste                                                                                                                                                                                           |
| `test:e2e:selection`      | Cross-block selection behavior                                                                                                                                                                               |
| `test:e2e:sticky-column`  | Vertical cursor column tracking across block transitions                                                                                                                                                     |
| `test:e2e:search`         | Find/replace bar and controller behavior                                                                                                                                                                     |
| `test:e2e:decorations`    | Decoration engine in the browser: mark / widget / block paint, search as its first client                                                                                                                    |
| `test:e2e:presentation`   | Presentation modes: reading-mode inertness, block- and inline-granular preview reveal, mid-session mode flips                                                                                                |
| `test:e2e:recordings`     | Replays of the checked-in input recordings (see [Turning a recording into a test](#turning-a-recording-into-a-test))                                                                                         |
| `test:e2e:simulation`     | The note-taking simulation sessions (their own section below)                                                                                                                                                |
| `test:e2e:a11y`           | axe over `.editor`: fails on any violation outside the committed allowlist                                                                                                                                   |
| `test:e2e:vr`             | Virtual rendering on large fixtures: windowing, reveal, table-row windowing, mounted-count ceiling                                                                                                           |
| `test:e2e:webkit`         | The whole suite in WebKit; `test:e2e:firefox` is the same in Firefox ([Browser engines](#browser-engines))                                                                                                   |

The a11y allowlist and the VR ceilings both fail closed and only shrink. Neither is a perf gate;
both ride `npm test`.

### The plugins route

The plugin specs drive `/test/plugins` (`src/routes/test/plugins/+page.svelte`), the editor
route's sibling with a set of plugins installed that exist to be tested against. None of them
ship: the first-party plugins are packages of their own under `packages/`, and these install on
this route and nowhere else. `?seed=<name>` picks the document and, for some seeds, adds a plugin that only
installs under that seed (callout is the default). The always-on set is callout, memo, and
doc-stats, plus the bundled details, latex, admonitions, mermaid, and toc. The rest are scoped
to their seed because they'd change what every other seed's test sees: by claiming a common
character (`:` for emoji, `!` for wiki-embed, `[^` for footnotes, `#` for tags), by painting
decorations a sibling test is counting, or, in the parrot's case, by animating on a timer. The
seed table is in `+page.svelte`. What each fixture is for, so you can pick one:

- `callout/`: `:::callout Title` (and `:::aside`, so a kind switch has somewhere to go), a
  container with a title line it always keeps (reserved chrome: block furniture a range delete or
  a merge has to step around). Minimal on purpose, for the `reserved-chrome-*` specs, the chrome
  unit suites and the simulation's plugin gestures. Don't let any other fixture use its two directive
  names: when two plugins want one name, install order decides, and the shared server installs in a
  different order than a fresh tab does. Always on.
- `memo/`: a `%%` leaf you edit as plain text, the only `createEditableLeaf` in `'plain'` mode, for
  the `editable-leaf-*` specs. Always on; seed `memo`.
- `doc-stats/`: counts blocks and edits per editor and publishes them on `window`; it's the
  fixture for `registerGlobalCommand` plus per-editor context. It's installed without options here,
  and with a label per editor on `multi/`.
  Always on; seed `docstats`.
- `ghost-text/`: one Svelte-drawn decoration widget at the end of the focused paragraph, for the
  spec proving typing beside it never captures the ghost text. Seed `ghost`.
- `fold/`: `[>hidden<]` ranges collapse to a clickable `…`; the `ReplaceDecoration.widget`
  fixture, with a live click handler and decorations in table cells. Seeds `fold` and
  `fold-table`.
- `block-badge/`: a class plus an `H` badge on every heading at any depth; the
  `BlockDecoration.badge` fixture, including a badge that survives scrolling out of the window. Seed
  `badge`.
- `wiki-embed/`: `![[path|width]]` read as a built-in image. It pins an inline syntax that
  produces a built-in kind, and `rewriteImage`. Seed `wiki-embed`.
- `tags/`: tags on a bare `#` trigger, registered the way limestone (the app aragonite was
  extracted from) registers them. Seed `tags`.
- `inline-menu/`: a document picker on `[[` and a mention menu on `@` whose pick doesn't commit
  until the spec releases it, installed beside the demo tag menu and the bundled slash list so all four triggers share
  one editor. Seed `inline-menu`.
- `hloccur-scan/`: the bundled highlight-occurrences plugin with an `onScan` counter on `window`,
  for counting rescans. Seed `hloccur-memo`.
- `sim-mark/` and `sim-island/`: standing decoration sources for the simulation (its own section
  below). One marks every whole-word `paragraph`; the other turns three sentinel strings in the
  text into a replace widget, an inline widget, and a block badge. Both under `?seed=sim`, so
  the simulation runs with the decoration engine live on every keystroke.

Four subroutes carry the multi-editor cases: `multi/` (two editors with per-editor `doc-stats`
options and a button that unmounts the second), `staggered/` (editor one installs callout, editor
two mounts later with details added, for the staggered-mount spec), `enablement/` (two editors
sharing one memo registration, the left with the kind switched off through the harness-only
`__registryEnablement` prop), and `activation/` (two editors in one process, only the first listing
the parrot and the block badge, for the per-instance activation spec).

### Browser engines

Every e2e project runs in Chromium by default, and the `ENGINE` variable swaps the browser under
all of them at once:

- `chromium`, the default, and the only engine `npm test` runs.
- `firefox`, the Firefox you have installed (not Playwright's patched build), driven over WebDriver
  BiDi. Set `FIREFOX_PATH` if yours isn't where Firefox installs by default.
- `webkit`, Playwright's WebKit build.

The perf rows and the docs captures stay Chromium-only, since their numbers and pixels are
calibrated there. Everything else runs under every engine, and the project names don't change,
so any area script works under any engine. The commands are the same in bash and PowerShell:

```
npm run test:e2e:firefox
npm run test:e2e:webkit
node scripts/run-with-env.mjs ENGINE=webkit -- npm run test:e2e:clipboard
```

Run them alone. Firefox and WebKit are slower than Chromium, and a machine already busy with
another battery makes their timing-sensitive rows flake for a reason the product never had.

**In CI.** All three engines' full suites run, sharded, on every pull request to `dev` or `main`
and every push to either. A change that only touches docs skips the e2e and perf work. macOS
WebKit runs nightly on `dev` and on every pull request to `main` (`webkit-macos.yml`). How the
shards split and which engine checks block a merge are in the headers of `scripts/ci/e2e-shards.mjs`
and `scripts/release/branch-protection-contexts.mjs`.

To read a red run, open the job summary: it has the pass, fail, flaky and skip counts and every
failing test, and the job's artifact holds the same rows as `ci-summary.json`. A failure you
can't match to an open issue is new, and it's yours.

**There's no list of expected failures.** A red on one engine is fixed, or skipped where it can't
mean anything there:

- a gesture the driver can't make on that engine (no touch in Firefox, no CDP session outside
  Chromium) skips through `skipUnlessSupported(page, capability)` in `e2e/browser-engine.ts`,
  which carries the reason;
- a behavior where the engines rightly differ (where a click at a line's exact middle lands, say)
  skips on that engine with `test.skip(browserName === 'firefox', '<what Firefox does instead>')`;
- a real bug gets an issue and a `test.fixme(browserName === 'firefox', '#<issue>: what it does')`
  as the test's first line, with `browserName` taken from the test's fixture args. The other
  engines keep running it.

A flake gets the same `fixme` while its issue is open (`severity: watch` until it's confirmed),
with the command that repeats it in the issue:

```
node scripts/run-with-env.mjs ENGINE=webkit -- npx playwright test selection/pointer.spec.ts --repeat-each 10 --trace on
```

Either way, leave the requirement bullet as it is (the claim still holds on the other engines) and
add an indented line under it saying where the skip is, so the two files stay paired (G4.23). When
the issue closes, the `fixme` goes with it.

A `fixme` reason has to start with `#<issue>: `, or `src/lib/e2e/lint/fixme-names-issue.test.ts`
fails. That's what makes the release step useful: `npm run release:fixme-recheck` runs every
`fixme` row written the way above (inside the test, with a condition) on all three engines as if it
weren't marked, and lists the ones that pass now next to the issue each one names. A
`test.fixme('title', ...)` or `test.describe.fixme` stays skipped, so the recheck never sees it. It
never edits a spec either, so un-fixme'ing a row is still your call.

**Helpers that branch on the engine.** The clipboard and IME helpers keep one signature across
engines, so a spec never needs to know which one it got. Every clipboard touch goes through them:
`editor.seedClipboard`, `editor.paste()` and `editor.readClipboard` (or `createClipboardArm(page)`
from `e2e/clipboard-arm.ts` when there's no `EditorPage`). A spec that presses the paste chord or
calls `navigator.clipboard` itself fails a source scan (G4.212 in `invariants/scans.md`).

Outside Chromium the real clipboard is out of reach (WebKit refuses the permissions, Firefox
refuses a write before a user gesture), so the `page` fixture puts an in-page store behind
`navigator.clipboard` and the copy and cut events, and a paste is a dispatched clipboard event
carrying what the store holds. The IME driver hand-fires the composition sequence there, since
only Chromium has a CDP session, and lets the page's microtasks drain after `compositionstart` the
way a browser does before it writes the composed text. That hand-fired sequence is the one
exemption another scan (G4.49) grants, and no spec may copy it. So event order and the real paste
chord stay pinned in Chromium. Firefox over BiDi needs a few more helpers: `e2e/multi-click.ts`
(BiDi can't send a double click), `e2e/selection-drag.ts` and `e2e/insert-text.ts`. And one that
bites quietly: over BiDi, every locator action (`click`, `hover`, `scrollIntoViewIfNeeded`)
scrolls its target to the middle of the screen first, even when it's already showing. So a spec
that reads or sets the scroll position, and any shared helper, clicks through `e2e/click-in-place.ts`,
which scrolls only a target that's off screen (G4.228 fails a raw one).

**What a green run doesn't tell you.** Playwright's WebKit isn't Safari and isn't a WKWebView,
just the closest proxy there is; the macOS run gets nearer (the platform's key bindings and
fonts), and that's it. Nor does a green run say anything about an embedding host (a desktop app's
webview, say): clipboard retargeting, a webview that refuses `navigator.clipboard` (the in-page
store answers every call), the host's own accelerator keys and image-src scheme policy are the
host's decisions, so that class of bug is found by a real host or by a user.

### Requirements pair one-to-one with specs

Every spec under `src/lib/e2e/tests/` pairs with a requirement file under
`src/lib/e2e/requirements/`, a plain-English list of scenarios, written _before_ the spec (yes,
before). The filesystem is the authoritative list of what's covered: a spec with no requirement
file, or a requirement file with no spec, means one of the two is out of lockstep. Fix it, don't
work around it.

The details:

- The requirements mirror the spec tree: `tests/plugins/callout-container.spec.ts` pairs with
  `requirements/plugins/callout-container.md`. When a subdirectory's specs split further, the
  requirements split with them.
- G4.23 (`src/lib/e2e/lint/requirement-spec-lockstep.test.ts`) enforces the lockstep, and also
  fails a requirement list that runs 3× ahead of its spec's test count (what
  `playwright test --list` reports, so a test generated in a loop counts once per row). One test
  routinely walks several bullets, so padding the suite to satisfy a count is never the fix; an
  exception goes in that lint's allowlist with its reason.
- Bullets under a `## Pinned below the browser` heading don't count, since a unit test runs them
  instead. Each one names that test by its backticked path from `src/lib/`, and the lint fails a
  bullet that names none, or names a file that isn't there.
- `e2e/tests/perf/` holds two families, and the basename decides which project collects a spec:
  `*.perf.spec.ts` goes to the env-gated `e2e-perf` (and `e2e-perf-prod`), `vr-*.spec.ts`
  directly under `perf/` goes to `e2e-vr`, which rides `npm test`. Name a spec into the wrong
  family and it silently stops running in the suite you meant. The lockstep scan fails a
  spec no project lists, and G4.17 fails one that two projects list. Requirement files pair by
  the stem with the `.perf` suffix stripped.
- **Per-block subfolder rule.** A block area earns a subfolder under `tests/blocks/` and a
  `test:e2e:blocks:<block>` script at 3 spec files. Below that, specs stay flat under the
  parent category.
- **A bug fix's miss-analysis lives here too**: one line saying what test should have caught it
  and why none did, in the requirement file the regression spec pairs with (a unit regression
  puts it in the test's own header line instead).
- **Requirement files are written in plain words.** The reader is someone who opened the repo
  today, same as for a comment ([`code-style.md`](code-style.md) § Comments). The house-word scan
  holds their body text to zero private words; a heading keeps its wording, since specs and docs
  point at it.

### Writing a new E2E spec

```typescript
import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';

test.describe('my feature', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('description', async () => {
		await editor.loadContent('# Hello\n\nWorld.\n');
		expect(await editor.bridge.getBlockCount()).toBe(2);
		expect(await editor.bridge.getBlockKind(0)).toBe('heading');
	});
});
```

A spec on any other route calls `gotoReady` instead of `page.goto`:

```ts
await gotoReady(page, '/test/syntax'); // waits for window.__syntax, then the fonts
```

It lives in `src/lib/e2e/goto-ready.ts` and waits for the global the route sets once it's
hydrated, since the server-rendered markup shows up well before any click handler does.
`reloadReady(page)` is the reload version, and `editor.goto()` already calls `gotoReady` for you.
To check what a page shows before it hydrates, `gotoUnhydrated(page, url)` loads it with every
script request held back.
A raw `page.goto` or `page.reload` fails `src/lib/e2e/lint/e2e-drivers.test.ts`. All three also
wait for the page they're leaving to finish loading, images included, so a spec that holds an image
request open and then navigates again fails, naming that image.

One navigation per test, though. If a test wants a different URL than its `beforeEach` gave it
(another mode, a flag in the query), it gets its own `describe` with its own `beforeEach`, instead
of navigating again inside the test. Mounting in a mode and switching into it after load are
different code paths, so pick the one the test is actually about.
`src/lib/e2e/lint/one-navigation-per-test.test.ts` fails a test that navigates again.

A new route gets a row in `src/lib/e2e/goto-ready.ts :: READY_BY_ROUTE`, or `gotoReady` won't
compile for it. Every route that mounts an editor already sets `__parityDocuments`, so that's the
usual value. If the specs read a global the route sets for them (`__syntax`, say), that one goes in
instead.

To switch the presentation mode, call `editor.setPresentationMode(mode)`, or click the header
toggle with `clickModeToggle(page, mode)` from `src/lib/e2e/mode-switch.ts` (the showcase's
buttons take `clickModeButton`). Each one waits until the editor shows the mode.
A mode that never applied leaves you in source mode, where most live-mode assertions pass anyway,
so a raw bridge call or toggle click fails `src/lib/e2e/lint/e2e-drivers.test.ts`.

### Turning a recording into a test

An input recording (the file `getDiagnostics().recordInput()` makes, and the debug panel's Input
recording section, see [`debugging.md`](debugging.md)) can be a regression test as is. Every file in
`src/lib/e2e/recordings/` gets a test in `src/lib/e2e/tests/recordings/replay.spec.ts`, named after
the file. It loads the recording's starting document, replays each step through a real input
(key presses, inserted text, the IME driver, the clipboard helper), and checks the document hash and
the selection after every step. It also records the replay and checks the events match, so a red
says which one moved: different bytes means the editor changed, same bytes with different events
means the driver did.

To add one:

1. Record it on a small document you made up, with text included (the panel's **include text**
   box, or `window.__test.startInputRecording({ includeText: true })` on `/test/editor`). A user's
   report gets re-recorded on a cut-down document first, since the file holds every character.
2. Save it as `src/lib/e2e/recordings/<what-it-does>.json` and run
   `npx playwright test --project=e2e-recordings -g <what-it-does>`.
3. For a bug, change the broken step's `expected` entry (and every one after it) to what should
   have happened, so the test is red until the fix lands. The hash for a document is
   `window.__test.getSourceHash()` with that document loaded on `/test/editor`.

Only Chromium replays so far, and only the steps it has a real input for: a click (as setup: the
replay puts back the selection it left), a key or chord, text with no keydown, a composition and a
paste. Anything else (a soft keyboard rewriting a word, a drop, undo from a menu) can't replay yet,
so mark that file `"diagnosticOnly": true` and it's kept for reading. A browser joins
`src/lib/e2e/recording-fixtures.ts :: REPLAYABLE` after one green run, and a recording opts into it
with an `engines` list. `src/lib/e2e/lint/recordings.test.ts` (G4.213) fails on a recording that's
neither replayed nor marked, or whose steps don't chain.

When the editor changes what a recorded step should leave on purpose, re-bless it. That rewrites
`expected` alone, from the replay, so the file's diff is the review (same command in bash and
PowerShell):

```sh
node scripts/run-with-env.mjs RECORDINGS_BLESS=1 -- npx playwright test --project=e2e-recordings -g <name>
```

### Patterns and gotchas

**Every test runs on its own.** The suite is `fullyParallel` (the timed perf rows aside), so two
tests from one file can run at the same time in different workers, in any order, or in different
CI shards. A test that reads
something an earlier test in its file left behind (a `let` at the top of a `describe` that one test
sets and the next reads, say) passes when its file runs top to bottom and fails once the suite
splits it up. Set it up in `beforeEach` or in the test itself.

**Pace per-character typing with a state settle.** Two input helpers coexist.
`editor.typeText(text)` fires one `insertText` event, fast and atomic; use it when only the end
state matters. `editor.typeSlowly(text)` sends real per-character `keydown`/`input`/`keyup`
cycles; use it when per-keystroke behavior matters (`**` formatting, `# ` kind changes, code
auto-close). Per-character typing is correct **when each character settles** before the next,
via a `bridge.waitForSource*` or DOM-count predicate. Unsettled `keyboard.type` in a tight loop
races the inline re-render's caret restore and can type your text out of order, which is exactly
as much fun to diagnose as it sounds.

**Undo steps split where the spec says, never on a timer.** A user's typing groups into one
undo step until they stop for 250 ms, and a spec can't lean on that: a loaded runner fires the
page's timer late, and Firefox's driver can take longer than that between two keys. So every
navigation through `gotoReady` holds the pause, and keys typed at any speed stay one undo step until
the spec calls `editor.endTypingBatch()` (or `endTypingBatch(page)` from `e2e/typing-batch.ts`, when
there's no `EditorPage` around). An undo, a structural edit like Enter or Tab, and typing in another
block each end the batch on their own, so none of them needs the call first. A wait in between splits nothing, and G4.232 fails one next to an
undo anyway. The real pause runs in one spec only, `undo-typing-pause.spec.ts`.

**Container edits need Svelte's reactivity cycle to settle.** After typing inside a list item or
blockquote, `$effect`s and post-tick commits must flush before `getSource()` reflects the
change. Wait on `editor.bridge.waitForSourceContains('expected')` or a sibling predicate.
`waitForTimeout` is reserved for genuinely time-dependent waits (sticky-column layout settle,
copy-only clipboard verification, proving a gesture with no keydown changed nothing) and gets an
inline comment when used.

**Use `focusBlockEnd` / `focusBlockStart` / `focusBlock` to set up a caret.** They place it
through the editor's own `setSelection`, so the caret sits in a text node the way a click or a
key leaves it; `focusBlock` takes a raw offset, and `focusBlockAtPath` does the same for a nested
block or a table cell. When the placement itself is under test, click (`clickBlockAtPath`) and
walk with the keyboard instead.

**Aim a pointer through `src/lib/e2e/text-runs.ts`, never a DOM walk of your own.** `pointAtRaw`
asks the block where a raw offset sits on screen, and `textRunRect` finds a word in the text the
mode actually paints. A walk written in the spec counts a widget's glyph or a hidden marker its
own way and aims beside the offset it meant, so a source scan fails any `createTreeWalker` under
`src/lib/e2e/tests/`.

**Use `getBlockCount()` for structural assertions after a split.** The bridge reads the live
CST, so it sees a transient block the serializer would trim and a live-kind-vs-raw desync a
reparse can't. `getDomBlockCount()` counts _mounted_ top-level blocks, which under virtual
rendering is the window rather than the document, so reach for it only when the mount count is
the thing under test, and then on a fixture small enough that nothing windows.

**Test structural operations _through_ a container, not just flat paragraphs.** Split, merge,
and delete shift block indices, and containers use their `index` prop in the delegation chain
when focus exits them. A test that splits a paragraph and then arrows through more paragraphs
won't catch a stale-index or stale-ref bug, because that delegation chain is one hop deep.
Follow the structural op with navigation through a container. See the
focus-traversal-after-insertion pattern under `tests/keyboard-navigation/`.

**Assert focus by typing, not by reading source.** `getSource()` serializes the CST, which is
correct regardless of where focus landed, so it can't detect a focus bug at all. To verify
focus, type a marker character and assert on _where it appeared_.

**Selector helpers live in `EditorPage`.** Each block sits in a `.block-host` positioning
container next to its `SelectionOverlay` sibling, and `getBlock(i)` skips the overlay. Write
tests against the helpers; reach for raw selectors only when adding a new one.

**Markers count toward block text.** A heading renders its markers as dimmed spans inside the
contenteditable, a list item draws its marker in a cell beside it, and `getBlockText(i)` returns
the full text, markers included (the `'# Hello'` above).

**Geometry reads against an image widget need a decode barrier.** An `<img>` that hasn't decoded
lays out 0x0, so a rect read too early is degenerate, and a click computed from it lands _inside_
the widget once the image decodes (selecting the image instead of placing a caret).
`locator.waitFor()` and `locator.click()` wait for a non-empty box; `locator.boundingBox()` and
`page.evaluate(() => el.getBoundingClientRect())` don't. So a raw-`evaluate` or
bare-`boundingBox` read needs a guard first: `waitForFirstImageLoaded`
(`tests/blocks/image/helpers.ts`), a `waitFor()`/`click()` on the widget, or an explicit fixture
width (`![alt|120](url)`) when width is the only dimension you need. It only shows up as a
full-suite flake, since server latency under load decides whether the image beat your read.

**Driving IME composition.** Two complementary halves. For handler-level contract pins (the
composing gate, the end path, offset capture), use the unit harness:
`test/harness/editable-surface.ts` drives the real surface skeleton with synthetic event calls,
simulating the IME's writes by assigning `el.textContent` before firing the end. For browser
event order and full wiring, drive real sequences in e2e through `attachIme`
(`e2e/simulation/ime.ts`): `compose` per update, then `commit`. In Chromium that's CDP's
`Input.imeSetComposition` and `Input.insertText`; see `tests/ime-composition.spec.ts`. `compose`
already waits for the composed text to show up in the focused element's DOM, since there's no
source change mid-composition to wait on. A key pressed while the composition's still open goes
through `ime.press(key)`: WebKit's real keydown doesn't know about the hand-fired composition, so
it'd arrive saying `isComposing: false` and the editor would end the composition early. The key
that opens a composition, before it starts, goes through `ime.openingKey(key)`, which sends it with
code 229 the way Chromium and WebKit do. In the unit harness, a composition the browser drops is
heard by the editor's tracker, so a row that ends one dispatches the signal on the element before it
calls the surface's handler (`editable-surface-composition.test.ts` has the shape).

## The conformance differ

_Are we certain our inline parser is right?_ Of course not, which is why
`src/lib/test/gfm-conformance/` diffs it against commonmark.js, pinned to an exact version. Only
inputs commonmark.js reads as one paragraph spanning the whole input are compared, so a divergence
always means the _inline_ parsers disagree. Bumping the reference is a deliberate re-bless (re-recording the
committed reference as the new accepted truth) with a changelog note;
`scripts/vendor/extract-spec-examples.mjs` regenerates `spec-examples.json` from the new version's
downloaded spec.json.

| Tier       | Command                    | Scope                                                                                                               |
| ---------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Slice      | rides `npm test`           | Spec-example fixtures + deterministic seeded corpus vs `baseline.json`; fails closed both ways                      |
| Full sweep | `npm run conformance:full` | Brute-force enumeration + high-volume seeded random; writes a classed report to `conformance-results/` (gitignored) |

The baseline only shrinks: a divergence not in it fails the slice, and an entry that no longer
diverges fails until you remove it. The full sweep is a _meter_ rather than a gate.

Two more checks sit beside the differ:

- the **kind differential** (`gfm-conformance/kind-differential.property.test.ts`) compares inline
  node _kinds and nesting_ against commonmark over random inline source, so emphasis classified
  into the wrong kinds fails even when the bytes come out right
- link reference definitions, which the inline differ skips, are compared as whole documents in
  `gfm-conformance/definition-examples.test.ts`; a deliberate mismatch sits in the baseline's
  `definitionDeviations` with its reason, and fails the day it starts matching

## Property suites and fresh seeds

A gate that fails differently each time is a gate people learn to ignore, so the property/fuzz
suites (`fc.assert` over the shared arbitraries) run **fixed-seed** and the commit gate stays
deterministic: a regression surfaces the same way every run rather than as a flake. The cost is
no new-input discovery over time, since one seed explores one set of inputs.

**Fresh mode** is the opt-in escape hatch. `npm run test:editor:property:fresh` sets
`PROPERTY_FRESH=1`, which swaps each site's fixed seed for a random one (every `fc.assert` seed
threads through the `freshOrFixedSeed` helper) and runs just the property-bearing suites. Each
site prints the seed it drew beside the fixed one it replaced:

```
$ npm run test:editor:property:fresh

> node scripts/run-with-env.mjs PROPERTY_FRESH=1 -- vitest run .property.test src/lib/test/core/directive/roundtrip-coverage.test.ts

[property:fresh] seed 3969485434 (fixed default 424242)
[property:fresh] seed 120308511 (fixed default 424242)
[property:fresh] seed 887064650 (fixed default 424242)
```

Run it when touching the inline parser, the CST, or the arbitraries, or just periodically, to
hunt inputs the fixed seed never reaches. It's never part of the gate; reachability self-tests
keep their fixed seeds so they can't flake.

**What the generators must draw.** A generator that can't produce a shape proves nothing about
it, so the shared generators carry a reachability floor of their own:
`invariants/corpus-coverage.test.ts` samples each one and fails when non-ASCII text, an astral
scalar, a combining cluster, or CRLF stops being drawn, and when a generator draws source that
isn't well-formed UTF-16. The inline source generator carries a second floor over construct
adjacencies (nesting, a flanking-killing space, an enclosed autolink, a code span holding a
delimiter run), because the byte shapes say nothing about how constructs meet. It keeps a fixed
seed for the same reason the other reachability self-tests do.

Sometimes a guard's own check can't cope with a shape a shared generator draws. Teach the check
to tell that shape apart first; moving the shape out of the shared generator and into that
guard's fixed corpus is the last resort, since every other suite loses it too.

**Reproducing a fresh find.** The seed line above is the reproduction: pin that seed as the
site's fixed default and the same draw comes back. fast-check also echoes the failing seed and
the shrunk counterexample in any failure it raises itself. The durable fix is to add the
counterexample as a committed regression case, which guards the class without the mode.

## The live-mode gesture fuzzer

Scripted flows only ever cover the gestures somebody thought of.
`src/lib/test/simulation/live-gesture-fuzz.property.test.ts` searches the space between them: a
seeded stream of typing and destructive gestures at positions biased toward hidden construct
edges, driven through the real caret-edge, split, join and range-delete code and judged after
every gesture against what live mode is allowed to write (`docs/design/live-mode.md` § 2).
Each gesture also runs on a byte-literal twin from the same starting bytes, so a divergence the
source-mode edit already has is reported rather than gated.

Findings sort into two buckets. `seam` is a divergence live has and the twin does not, and fails
the sweep. `ambiguous` is both twins failing the same claim: markdown's own rebinding, or the
byte-literal fallback live-mode.md § 4.4 declares. It's held to a ceiling rather than gated, so
a new class can't grow there unwatched.

One check stands outside that sort: a gesture that writes a lone surrogate (half of a UTF-16
character) its input didn't hold fails the sweep whether or not the twin writes one too, since no
rebinding excuses bytes that can't be saved as UTF-8. So the split and the range delete, whose
offsets the harness computes itself, hand them over unsnapped: snapping them to a character
boundary first would hide the editor's own snap, which is what's under test.

It rides `npm test` at a bounded default and joins fresh mode. `LIVE_FUZZ_DOCS` and
`LIVE_FUZZ_STEPS` raise the sweep for an overnight run, and its budgets are rates over applied
gestures rather than counts, so raising them changes what the sweep searches and not what it
asserts.

## The note-taking simulation

Long, realistic note-taking sessions driven through real input, the complement to the short
per-feature specs. A session types a full GFM note from an empty document, character by
character, with all the messy human behavior (typos and corrections, click-back edits,
select/delete, copy/paste, image resize, undo/redo), held to strong correctness checks the
whole way.

Where a spec exercises one operation, a session accumulates state across hundreds of gestures
and surfaces interaction bugs no isolated test reaches.

```
seed + note fixture → UserSimulator → real keyboard/mouse → Editor (/test/editor)
                          │                                      │
                  Gestures · ExpectationTracker          window.__test reads
                          │
                  invariants (per-keystroke equality, undo/redo differential,
                  end-state equality, nested-state audit, no-errors, round-trip)
                          │
                  Recorder → simulation-captures/seed-<N>/{*.png, manifest.json}
```

The engine is in `src/lib/e2e/simulation/`; the specs are in `tests/simulation/`, with requirements
one-to-one in `requirements/simulation/`. The note set spans genres: a class note, a feature tour, a
project plan, a three-level outline, reading notes, meeting minutes, and a README. Every run asserts
that typing a note gives the same document as loading it. Some notes are there to type a construct
mid-session (deep bullet nesting in the outline, a nested `> >` blockquote in the reading notes), so
keep those when you edit a note.

A session that scripts its own gestures rather than typing a whole note starts the same way.
`makeSimContext` (`tests/simulation/helpers.ts`) bundles the page, the page object, an
expectation tracker seeded from the current source, and the error collector into the one
context every check reads; `assertCheckpoint` is the one checkpoint sweep (no errors, every
container's child ids in step, nested state, round-trip, a valid selection, and parse convergence
unless the note waives it). From `tests/simulation/table-ops.spec.ts`:

```ts
import { Gestures } from '../../simulation/gestures';
import { makeRng } from '../../simulation/rng';
import { assertCheckpoint } from '../../simulation/invariants';
import { makeSimContext } from './helpers';

await editor.loadContent(START_TABLE);
const ctx = await makeSimContext(page, editor, 'table-ops', { errors });
// { page, editor, tracker, errors, label: 'table-ops', ime: undefined }
const g = new Gestures(ctx, makeRng(1));

await g.insertColumnRight(0);
await assertCheckpoint(ctx, 'after-insert-column');
await g.editCell(1, 'C');
await assertCheckpoint(ctx, 'after-edit-cell');
```

**Determinism** comes from a single seeded PRNG: same seed ⇒ same gesture stream ⇒ same asserted
state, so a failure is replayable.

**Predict printable, resync after auto-behavior.** The tracker predicts only printable typing
(per-keystroke `waitForSourceEquals`). Every gesture that triggers editor auto-behavior (Enter,
Tab, paste, resize, toggle) performs, settles on an observable predicate, then resyncs to
observed state. Typing into a freshly-created list item, whose marker only materializes on its
first body character, is a resync point rather than a prediction, which is how the deep-nesting
cadence (Enter → indent empty item → type) fits the same rule.

**Multi-seed fuzzing.** A runner drives one note across many seeds, one test per seed. The seed
selects the typo stream and which **net-identity detours** fire: do a thing, undo it, and assert
the bytes came back exactly. A pause that fences the undo batch, then select-delete-undo, then
copy-paste-undo, each asserting byte-exact restoration of its pre-detour source. They exercise
undo, selection, and clipboard mid-session while end-state equality still holds for every seed.

**Parallelism.** The `e2e-simulation` project caps itself at four workers, one browser each, and
every session has its own page and its own seeded PRNG.

### Running it

| Command                                                                                       | Scope                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:e2e:simulation`                                                                 | Every session except the two capture suites. All ride `npm test`.                                                                                                                                                                   |
| `node scripts/run-with-env.mjs SIM_CAPTURE=1 -- npx playwright test --project=e2e-simulation` | Adds the two capture suites (every note, screenshotted), writing PNGs and a per-checkpoint `manifest.json` to `simulation-captures/` for the visual review. On bash, `SIM_CAPTURE=1 npm run test:e2e:simulation` is the same thing. |

One session on its own:

```
$ npm run test:e2e -- --project=e2e-simulation fenced-code-image-smoke.spec.ts

Running 1 test using 1 worker

  ✓  1 [e2e-simulation] › src/lib/e2e/tests/simulation/fenced-code-image-smoke.spec.ts:17:2 › note-taking simulation: fenced-code + image smoke › builds the code-and-image biology note and the invariant suite holds (…)

  1 passed (…)
```

A new feature gets a new simulation gesture. The simulation is the best test this repo has at
catching a corrupted document, but it only catches what it types.

### Agentic visual review

A capture run pairs each checkpoint screenshot with the source known to be correct at that
moment (in `manifest.json`). What the user actually _sees_ (heading sizes, dimmed markers,
bold/italic, list alignment, a resized image's width, the right block kind) isn't easily
asserted in code, so a vision-capable agent reviews it: open `manifest.json`, view each PNG
alongside its `expectedSource`, report mismatches by severity.

This is **discovery and a periodic quality report, not a CI gate**, because agent vision is
subjective. Re-run it after substantive editor changes.

Artifacts persist under `simulation-captures/seed-<N>/` (gitignored, one directory per seed),
outside `test-results/` on purpose, since Playwright wipes that directory at the start of every
run.

## The consumer smoke

`examples/consumer/` is a tiny SvelteKit app that installs aragonite the way a stranger would:
from the packed tarball, importing only published entry points. It's a test, not documentation
(if something is only learnable from that folder, that's a docs bug; file it). CI's
`consumer-smoke` job runs `scripts/smoke/consumer-smoke.mjs`, which:

1. builds and packs `dist/`, and checks the tarball holds every published path and no test file.
   It checks the prebuilt build too (`dist/prebuilt/`, what a bundler with no Svelte plugin gets):
   no Svelte import of its own, every entry loads in Node, one plugin registry across entries, and
   a size budget (`scripts/pack/verify-prebuilt.mjs`). Each plugin package gets the same, plus a
   check that its prebuilt installs into the core's as one copy of the core
   (`scripts/pack/verify-plugin-package.mjs`)
2. packs every workspace package and installs the ones the example depends on (the core and
   eight plugins) with `--no-save`
3. typechecks and builds the example, where an import cycle through a published entry point is
   a build error
4. runs the example's own Playwright specs: the page server-renders without a 5xx, hydrates with
   no console errors and takes a keystroke, the editor's text has readable contrast against the
   page on every route, the plugins page mounts the bundled plugins from their packages plus a
   copy of the callout fixture, and the editor's dev-only warnings still fire under a consumer's
   `vite dev`

To run the example yourself, from a fresh clone (same commands in bash and PowerShell):

```bash
npm install        # at the repo root, once
npm run package    # builds dist/, which the example imports through the package's exports map

cd examples/consumer
npm install        # links the local library + the example's own deps
npm run dev        # http://localhost:5173
```

Locally the example depends on `@voithos-labs/aragonite` as `file:../..` and on each plugin as
`file:../../packages/<name>`, links to the working tree you cloned, so there's no tarball to refresh; after a library change, `npm run package`
again and the example sees it. Don't edit `examples/consumer/src/plugins/`: it's a git-ignored
copy of the callout fixture (`src/routes/test/plugins/callout/`) that
`scripts/smoke/sync-consumer-plugins.mjs` regenerates before every `dev`, `build`, `check`, and `test`,
with its `#lib` imports rewritten to the package name.

## The adapter suite

The framework wrappers (`packages/*`) get the consumer smoke's treatment, with one twist: every
app renders the same page (the editor, a mirror of the value, load and revert buttons, a theme
toggle, an unmount toggle, a header input), so one spec directory in `examples/adapter-suite/`
drives all of them. The page is spelled out in `examples/adapter-suite/requirements/page-contract.md`.
The apps today are `examples/react` and `examples/vue` (Vite, each built and in dev, plus a build
on the oldest React or Vue the wrapper supports), and `examples/next` and `examples/nuxt` (server
rendered). `examples/adapter-suite/apps.mjs` lists every project: its app, port, the specs it
runs, and whether it gates each PR. A new app goes in there, or a lint test fails (G4.187).

The React and Vue apps also carry the showcase, the same page as the Svelte one at `/`, on a second
page the suite doesn't load. To try it by hand, `npm run showcase:react` or `npm run showcase:vue`
builds and packs this checkout, installs it into the app the way a user would, and serves
`http://localhost:1490/showcase.html` or `http://localhost:1495/showcase.html`.

The wrappers are npm workspaces of the root, so the root `npm install` installs them too, and
`npm run package` builds them after the core. Each carries the core's version and peers the core at
exactly that version, since all three packages publish together (`npm run release:publish`);
`src/lib/test/invariants/lint/lockstep-versions.test.ts` fails when one drifts.

`scripts/smoke/adapter-smoke.mjs` packs the core and every wrapper, installs the tarballs into each app,
checks no Svelte came along, builds the apps and runs the suite. CI runs the `perPr` projects on
every PR (`--per-pr`) and everything on the release PR into `main`. To iterate on one project
once its app is built (`npm run package` at the root, then `npm install` and `npm run build` in
the app), name it in `ADAPTER_PROJECTS`, since the config starts a server for every app it's
told about:

```bash
ADAPTER_PROJECTS=react npx playwright test -c examples/adapter-suite/playwright.config.ts
```

```powershell
$env:ADAPTER_PROJECTS = 'react'; npx playwright test -c examples/adapter-suite/playwright.config.ts
```

Heads up if you're mutating a wrapper to see what reds: outside CI the config reuses any server already on an app's port, so one left over from an earlier run keeps serving the old build. Stop it first, or set `CI=1` for the run.

## Size budgets

One number has a budget: how much JS a minimal app loads, since that's what every consumer pays
for. It lives in `scripts/pack/size-budget.json` with a baseline and a tolerance (how far it may
move before anything complains, about one normal change).

| Number                                     | What it counts                                                                                                                                                                                                                                                                                                                                                                                                                 | Checked by                                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| The minimal app: first load, total, chunks | A page that imports `createEditor`, built minified for production, once through the Svelte build and once through the prebuilt one. Three numbers each: the gzipped JS the page loads before it runs (the entry plus what it imports up front), all the JS it could ever load, and how many chunks that is. It's one chunk today, so the first two match; a lazy split shows up as a new chunk, which fails until you bless it | `scripts/pack/verify-dev-strip.mjs`, which runs inside `verify-pack.mjs` (before a publish, and in CI's consumer smoke) |

A number fails when it moves past its tolerance in either direction. Growing past it means more
than one change's worth landed. Shrinking past it means the baseline is stale: bless it, so the
next change can't quietly spend what you saved. Blessing writes the current numbers in as the new
baselines, and the tolerances stay put.

Everything else `npm run measure` prints is a report, and nothing gates on it: production code and
comment lines, how many unit test files are internal (they, or a helper under `test/` they import,
import, name a type from or mock something the package doesn't publish, where published means
reachable from an entry point in `package.json` `exports`) against published-only, and how many
source scans are active. A published-only test keeps passing through any rewrite behind the entry
points, which is the kind we want more of.

```bash
npm run measure                                          # every number, per directory, plus the test helpers that import internals
npm run measure -- --against $(git merge-base HEAD dev)  # how far each one moved since your branch left dev
node scripts/pack/verify-dev-strip.mjs --bless           # accept the app sizes (after `npm run package`)
```

Same commands in PowerShell. When a branch reports what it did to the numbers, it reports the
`--against` deltas.

The test split is a cheap stand-in for "this test guards behavior". The real check is whether a
module's behavior suites (the e2e specs and property tests that judge it) stay green while its
insides change shape, and nobody has scripted that one yet.

Each prebuilt entry point also has a gzipped budget of its own, in `scripts/pack/verify-prebuilt.mjs`,
edited by hand. And for how long CI takes, `node scripts/ci/ci-time.mjs` prints the latest dev push's
wall time and runner minutes, against the median of the last five. That one's report-only, since
CI time is too noisy to gate on.

## The behavior differential

A refactor is supposed to change nothing anyone can see, and "the tests are green" only says the
inputs somebody wrote down still pass. The differential asks the wider question: it presses keys in
the mounted editor (jsdom, the same mount the unit suites use), writes down what every key did,
and compares that with the same run on the commit your branch started from. One line per input:

```
{"in":"keys live bullets [0,1,0]@0 Backspace","took":"keydown","bytes":"- ab\n","caret":"0.0.0:1"}
```

| Field           | What it holds                                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `in`            | The input: which family, the mode, the document, where the caret was (the leaf's CST path, then `@` and the offset) and the key                                                                  |
| `took`          | Who acted on the key: the editor at `keydown` or at `beforeinput`, the browser's insert of a typed character (`inserted`), or a default action jsdom has no engine for (`browser`, a delete say) |
| `bytes`         | `getSource()` after the key. Past 100 characters it's a hash, where it first differs from the input, and the text around there                                                                   |
| `caret`         | `getSelection()` after the key, as `path:offset`                                                                                                                                                 |
| `undo`          | Only there when undo, then redo, doesn't give back the input and then the edit                                                                                                                   |
| `warns`         | The dev checks that fired                                                                                                                                                                        |
| `do`, `outline` | A seeded run's key, drawn from its seed; a document's block and inline kinds as parsed                                                                                                           |

What it runs, in four files under `src/lib/test/behavior/`:

- every key (a few printable markers, Enter, Shift+Enter, Backspace, Delete, Tab) at every offset of
  about thirty small documents, one per block kind, container and inline construct, in source and
  live mode, plus pairs of blocks that touch with no blank line between, each block also moved up
  and down (the only rows where two blocks merge or a moved block meets new neighbours)
- seeded runs of keys into one document, with the simulation's seeds, then undo everything and redo
  it all (how a typing run groups into undo steps only shows up here)
- how the CommonMark spec examples parse, and the documents the showcase and changelog pages mount,
  plus a few keys at the join of every pair of adjacent blocks in those. Whole, they'd mount only a
  window in jsdom, which is great for a real editor and useless here. The newest changelog family
  sits out, since every landing adds to it; editing the showcase or an older family moves the rows
  of the pairs you touched, so expect those in your list

The documents mount with the bundled plugins that add syntax (math with a stub renderer,
admonitions, details, the table of contents, footnotes, emoji), so `$x$` and `:::note` mean what the
showcase means by them.

It doesn't run inside `npm run test:editor`, since it needs two checkouts. One command does both:

```bash
npm run behavior                                          # against where your branch left dev
npm run behavior -- --against <ref>                       # against any commit
```

Same commands in PowerShell. It checks the base out into a temporary worktree under
`behavior-results/` (gitignored), records its rows with that commit's own suites, records yours,
and diffs the two. The worktree goes away when the run ends, fails or gets a Ctrl+C. The base's
rows are cached by commit, Node version and installed dependencies, so a second run against the
same base only records your side, which takes about half as long.

A change that means to change behavior lists exactly the inputs it meant to change. A refactor's
list is empty. The command exits 1 whenever the list isn't. A branch reports which base it picked,
then the counts and the changed inputs under them:

```
behavior: base merge-base HEAD dev (…)
behavior against merge-base HEAD dev (…): … rows compared, 1 changed (bytes 1, caret 1), 0 added, 0 removed
  changed keys live bullets [0,1,0]@0 Backspace
    bytes: "- ab\n" -> "- a\nb\n"
    caret: "0.0.0:1" -> "1:0"
```

It prints the first 20, and writes the full list to `behavior-results/diff.txt`. To compare with
another machine, `--record <file>` writes this checkout's rows there and `--against <file>` diffs
against such a file. Expect a few rows to move that aren't yours, though, since a different Node
or dependency install can move a row.

Two limits. It's jsdom, so where the editor hands a key back to the browser nothing happens and the
row says `browser`: the editor's own handling is real, Chromium's isn't. And the note-taking
simulation's browser sessions aren't in it yet; a trace mode for those is a later job.

## Every short input

Random generators keep missing the tiny inputs, a `>` and a newline and nothing else. So
`src/lib/test/exhaustive/` doesn't sample. It takes every string up to a length over 15 characters
that change how Markdown reads (`#`, `>`, `-`, `*`, `_`, `[`, `]`, `|`, a backtick, `$`, `:`, `!`, a
letter, a space and a newline) and checks each one.

| Suite          | Checks                                                                                                                                                                                                                                                   | `npm test` | `npm run test:exhaustive`                |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------- |
| `round-trip`   | Parsing never throws, and serializing gives back the input, with the built-in syntax and with the bundled plugins                                                                                                                                        | length 5   | 7 with plugins (183M strings), 6 without |
| `inline-parse` | Reading inline never throws, and each leaf's inline nodes cover its content with no gap or overlap                                                                                                                                                       | length 5   | 6 (12M strings)                          |
| `block-edits`  | Every edit at every offset (type each character, delete on either side, which merges at a leaf's edge and out of a container, split) changes the bytes, leaves the tree the editor would build reopening them, fires no dev check, and undoes and redoes | length 2   | 3                                        |

In `npm test` the three take a few seconds. `npm run test:exhaustive` takes several minutes, nearly
all of it the length-7 round trip. A branch that touches the parser or the commit runs it once and
says so in its report. Before a release, raise the edits to length 4 (about five more minutes):

```bash
node scripts/run-with-env.mjs EXHAUSTIVE_FULL=1 EXHAUSTIVE_EDIT_LENGTH=4 -- vitest run src/lib/test/exhaustive
```

Some inputs already fail, and `KNOWN_DEFECTS` in `src/lib/test/exhaustive/known-failures.ts` names
the defects behind them, one entry each: what's broken, the shortest input length that reaches it,
and a pattern over its failure lines. A suite fails on a failure no entry matches, and on an entry
nothing matched in a run long enough to reach it. So a fix deletes one entry however many inputs it
covered, and a longer run reaching a known defect from more inputs passes as is. A failure no entry
matches is a new defect: name it in a new entry (or fix it).
