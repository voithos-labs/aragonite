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
  area scripts, the plugins route and what's installed on it, the WebKit run, the requirement
  files, and the gotchas.
- [The conformance differ](#the-conformance-differ): our inline parser diffed against
  commonmark.js.
- [Property suites and fresh seeds](#property-suites-and-fresh-seeds): why the random tests
  aren't random, and the switch that makes them random again.
- [The live-mode gesture fuzzer](#the-live-mode-gesture-fuzzer): seeded destructive gestures at
  hidden construct edges.
- [The note-taking simulation](#the-note-taking-simulation): whole documents typed keystroke by
  keystroke, the strongest corruption oracle in the repo.
- [The consumer smoke](#the-consumer-smoke): the example app that installs the packed tarball,
  what CI checks with it, and how to run it yourself.
- The performance harness (fixtures, instruments, threshold policy) lives in
  `docs/design/performance.md` § The numbers and the gate.
- The debug panel, its console helpers, and dumping editor state inside a test are in
  [`debugging.md`](debugging.md).

Beside the two layers sits `src/lib/testing/`, which isn't a test layer but **shipped code**:
the published `@voithos-labs/aragonite/testing` module, holding the plugin-platform reset and the
kind, container and inline conformance kits a plugin author runs inside their own test suite.

The three commands you'll type most:

```bash
npm test               # full suite: unit, then every e2e project
npm run test:editor    # all unit tests
npm run test:e2e       # all E2E tests (auto-starts the dev server)
```

Both layers are also sliced into area scripts for the inner loop, `test:editor:<area>` and
`test:e2e:<area>`. **`package.json` is the authoritative list**; the tables below say what each
area covers. An area run is a few seconds, and the summary block is all you read:

```
$ npm run test:editor:undo

> @voithos-labs/aragonite@… test:editor:undo
> vitest run src/lib/test/undo

 Test Files  6 passed (6)
      Tests  32 passed (32)
   Start at  14:46:02
   Duration  2.51s (transform 5.30s, setup 3.63s, import 3.70s, tests 110ms, environment 1.38s)
```

## Unit tests (Vitest)

No browser. Node by default, with a file opting into jsdom via a
`// @vitest-environment jsdom` docblock where it needs a DOM. About a third of the suite does,
including the `*.svelte.test.ts` files that mount real components through the harness. The
round-trip promise (`serialize(parse(source)) === source` for all valid GFM) is asserted
directly by the round-trip tests at `test/` root, so if you touch the parser or the serializer,
that's the suite to watch first.

### Where a test file goes

`src/lib/test/` mirrors the source tree one-for-one, with the leading `components/` segment
elided, so `components/blocks/list/X.ts` maps to `test/blocks/list/X.test.ts`. When the module
under test moves into a subdirectory, its test follows.

Mirror **import depth**, not just the module's directory: a test importing
`tree-operations/list/terminator` directly (rather than the `tree-operations` barrel) lives at
`test/tree-operations/list/terminator.test.ts`.

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

Vitest discovers `*.test.ts` anywhere under the root, so adding a file needs no config change.

### By area

| Script                       | Covers                                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `test:editor:core`           | Parser, serializer, inline scanner, directive grammar, round-trip invariants                        |
| `test:editor:tree-ops`       | Tree mutation helpers                                                                               |
| `test:editor:editor-actions` | Editor action bundles and commit primitives                                                         |
| `test:editor:schema`         | Block-kind descriptors, op vocabulary, openers, container raw rebuild, merge rules                  |
| `test:editor:ambient`        | Ambient-marker DOM and offset translation                                                           |
| `test:editor:cursor`         | Cursor utilities, sticky column, overlay rect measurement                                           |
| `test:editor:reactivity`     | Block-list state and state registry                                                                 |
| `test:editor:selection`      | Selection-state logic                                                                               |
| `test:editor:decorations`    | Decoration engine: sources, edit-epoch invalidation, path buckets, island model                     |
| `test:editor:blocks`         | Per-block unit tests                                                                                |
| `test:editor:image`          | Image dimensions, resize, source bytes, widget selection                                            |
| `test:editor:plugins`        | Plugin authoring surfaces and dogfood kinds: container round-trips, chrome leaves, paste transforms |
| `test:editor:undo`           | Undo stack and entry management                                                                     |
| `test:editor:search`         | Find/replace engine: document scan and search state                                                 |
| `test:editor:simulation`     | Simulation-engine internals: seeded RNG, expectation tracker                                        |
| `test:editor:conformance`    | commonmark.js differ slice: spec examples + seeded corpus vs the committed baseline                 |
| `test:editor:invariants`     | Invariant catalog: property/fuzz tests + source-scan guards                                         |
| `test:editor:debug`          | Debug engine helpers and operations log                                                             |
| `test:editor:perf`           | Perf commit gate: counter ceilings, amplification report, fixture goldens                           |

The inline-scanner suite (`test/core/inline/scan/`) and the directive suite
(`test/core/directive/`) fold under `test:editor:core`. Root-level cross-cutting tests without
their own script run in the full `test:editor` suite. A new area is cheap to create once a
directory earns one: it's one `vitest run src/lib/test/<dir>` line in `package.json`, nothing
else.

### Mounting a block in isolation

A block component reads its wiring from the editor's context tree, so a bare
`mount(SomeBlock, …)` needs that context present. `test/harness/mount-context.ts` supplies it:
`editorMountContext(overrides?)` returns the Map a block requires, with the action triple,
history, and the three editor facets (services, policies, document) pre-stubbed. A test states
only what it asserts on and takes sensible stubs for the rest. From
`test/blocks/text/text-crlf-commit.test.ts`, which mounts a real prose block over a parsed
document and hands it a decoration engine that reports no islands:

```ts
import { mount, flushSync } from 'svelte';
import TextEditableBlock from '$lib/components/blocks/text/TextEditableBlock.svelte';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import { editorMountContext } from '../../harness/mount-context';

const doc = parse(source);
const blockEdit = makeStubBlockEdit();
const instance = mount(TextEditableBlock, {
	target,
	props: { node: doc.children[0], index: 0, myPath: [0] },
	context: editorMountContext({
		blockEdit,
		doc: { doc: () => doc },
		services: { decorations: noIslands }
	})
});
flushSync();
```

When the editor grows a newly required context, that costs one harness edit instead of a fix
across every block-mount test.

### A dev warning fails its test

Every `devWarn` fire reaches a structured sink the unit setup registers, and a fire no test
claims fails that test. The sink takes reporting over, so under the unit runner the console line
never happens and a `console.warn` spy sees nothing. The same per-test hook resets `editorEnv`,
so a suite that configures the environment configures it per test; a `beforeAll` override is
gone by the second case. Which console channel a fire belongs to, and what each one means, is
[`warnings.md`](warnings.md).

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

The machinery, for when you're inside it:

- Both teardown guards live in `src/lib/test/support/warn-gate.ts`. The per-test `afterEach` is
  the verdict; the claim helpers sit in file-level `afterEach` hooks that must run before it,
  which is why `vitest.config.ts` pins `sequence.hooks: 'stack'`. The per-file `afterAll` is the
  aggregate, next bullet.
- Two per-file aggregates close what a per-test verdict can't see: an `allowDevWarns` tag that
  never fired, and a fire arriving after the last test's verdict. Either fails the file.
- A guard that defers its fire past a tick (`reportContestedClaim` is the shipped shape) still
  lands on the test that provoked it: the verdict awaits a tick before reading. That tick lands
  after the file's own claim helpers, so claim such a fire inside the test (`await tick()`, then
  `takeDevWarns()`), never with a file-level `allowDevWarns`.
- A file that swaps the sink out and never restores it fails itself rather than blinding the
  rest of the worker, and the gate re-arms.
- There's no exemption. A file that `vi.mock`s `$lib/dev-warn` deletes the emitter outright,
  and a file that spies `console.warn` reads a channel the sink silences; either one blinds the
  gate for that whole file, so a source scan (G4.41) fails on both. Two files pin the warning
  channels themselves and are named in its allowlist with the reason.

## E2E tests (Playwright)

The editor component driven in real Chromium. No backend needed; it's self-contained.

**Every spec imports `test` and `expect` from `src/lib/e2e/fixtures.ts`, never from
`@playwright/test` directly.** This isn't a style preference, and I will be tedious about it in
review. Every `devWarn` reaches the browser console under the `[aragonite:…]` prefix, and the
shared `test` fails any spec whose page emitted one, so a dev-guard violation surfaces at the
spec that _caused_ it rather than passing silently and turning up a release later. The verdict
lands at teardown and names the fire:

```
Error: unexpected [aragonite:…] console fires:
warning: [aragonite:demo] a fire the spec did not declare
```

A spec that deliberately trips one names its tags,
`test.use({ expectInvariants: ['late-opener-registration'] })` for an invariant fire or
`test.use({ expectWarns: ['tree-ops'] })` for a plain dev warning, and the fire above would have
passed under `test.use({ expectWarns: ['demo'] })`. Both run in both directions: a named tag that
stops firing fails too.

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

**Every project shares one dev server**, started by the Playwright config on port 1420 and
reused when something is already listening there. That reuse is the convenience and the trap: an
interrupted run leaves a server alive, and the next run serves whatever that tree was mid-edit.
`E2E_ISOLATED=1` starts the run's own servers instead, on 1430 (and 1431 for the `PERF_PROD`
preview), reusing neither, so a run can only measure the checkout it was launched from.
`npm run test:e2e:isolated` runs the whole suite that way, and anything narrower is the same
script with Playwright's own arguments appended:

```
$ npm run test:e2e:isolated -- --project=e2e-top smoke.spec.ts

> node scripts/run-with-env.mjs E2E_ISOLATED=1 -- playwright test --project=e2e-top smoke.spec.ts

[WebServer] > vite dev --port 1430 --strictPort
[WebServer]   ➜  Local:   http://localhost:1430/

Running 6 tests using 1 worker

  ✓  1 [e2e-top] › src\lib\e2e\tests\smoke.spec.ts:13:2 › editor smoke tests › editor container is visible after goto (3.2s)
  ...
  6 passed (7.5s)
```

(`scripts/run-with-env.mjs` is what sets the variable, since `KEY=1 cmd` doesn't work in a
Windows shell. Go through the npm script rather than calling it yourself; from a bare shell
`playwright` isn't on the path.)

Specs are organized by feature area at the top level, and per-block inside `tests/blocks/`. They
cover the harness smoke test, text editing (typing / split / merge / kind change), keyboard
navigation (arrows, container traversal, sticky column), undo/redo, inline editing, container
editing, and selection + clipboard.

### By area

| Script                    | Covers                                                                                                                                                                                                                                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test:e2e:top`            | Top-level specs: smoke, text editing, keyboard nav, undo, inline, containers                                                                                                                                                                                                                                     |
| `test:e2e:blocks`         | All per-block specs under `tests/blocks/`                                                                                                                                                                                                                                                                        |
| `test:e2e:blocks:<block>` | One block only: `list`, `code`, `image`, `table`, `blockquote`                                                                                                                                                                                                                                                   |
| `test:e2e:plugins`        | Plugin authoring: plugin containers, reserved chrome, collapse, the `plugins` prop, component-portal widgets, editable leaves, plus the browser conformance sweep (`tests/plugins/conformance-sweep.spec.ts`), which drives every registered kind declaring a `conformanceFixture` through the mounted-DOM cells |
| `test:e2e:clipboard`      | Cut / copy / paste (excludes exploration)                                                                                                                                                                                                                                                                        |
| `test:e2e:exploration`    | Clipboard exploration / manual-verification scenarios                                                                                                                                                                                                                                                            |
| `test:e2e:selection`      | Cross-block selection behavior                                                                                                                                                                                                                                                                                   |
| `test:e2e:sticky-column`  | Vertical cursor column tracking across block transitions                                                                                                                                                                                                                                                         |
| `test:e2e:search`         | Find/replace bar and controller behavior                                                                                                                                                                                                                                                                         |
| `test:e2e:decorations`    | Decoration engine in the browser: mark / island / block paint, search as its first client                                                                                                                                                                                                                        |
| `test:e2e:presentation`   | Presentation modes: reading-mode inertness, block- and inline-granular preview reveal, mid-session mode flips                                                                                                                                                                                                    |
| `test:e2e:simulation`     | The note-taking simulation sessions (their own section below)                                                                                                                                                                                                                                                    |
| `test:e2e:a11y`           | axe over `.editor`: fails on any violation outside the committed allowlist                                                                                                                                                                                                                                       |
| `test:e2e:vr`             | Virtual rendering on large fixtures: windowing, reveal, table-row windowing, mounted-count ceiling                                                                                                                                                                                                               |
| `test:e2e:webkit`         | The second-engine run: a curated slice under the WebKit binary, env-gated, per release rather than per commit (next section)                                                                                                                                                                                     |

The a11y allowlist and the VR ceilings both fail closed and only shrink. Neither is a perf gate;
both ride `npm test`.

### The plugins route

The plugin specs drive `/test/plugins` (`src/routes/test/plugins/+page.svelte`), the editor
route's sibling with a set of plugins installed that exist to be tested against. None of them
ship: the package's own plugins live in `src/lib/plugins/`, and these install on this route and
nowhere else. `?seed=<name>` picks the document and, for some seeds, adds a plugin that only
installs under that seed (callout is the default). The always-on set is callout, memo, and
doc-stats, plus the bundled details, latex, admonitions, mermaid, and toc. The rest are scoped
to their seed because they'd change what every other seed's test sees, by claiming a common
character (`:` for emoji, `!` for wiki-embed, `[^` for footnotes), by painting decorations a
sibling test is counting, or, in the parrot's case, by animating on a timer. The seed table is
in `+page.svelte`, and `+page.ts` reads the query so server and client render the same document.
What each fixture is for:

- `callout/`: `:::callout Title` (and `:::aside`, so a kind switch has somewhere to go), a
  container with a title line the block always keeps, which the editor calls reserved chrome
  (block furniture rather than content; a range delete or a merge has to step around it).
  Minimal on purpose, so the five `reserved-chrome-*` specs, the chrome unit suites, and the
  simulation's plugin gestures observe the editor's chrome handling and not a plugin feature.
  As a product it duplicates admonitions; as a fixture it's what those tests stand on. Its two
  directive names are claimed by no other plugin, since a contended name resolves by install
  order, and the dev server (every route in one process) installs in a different order than a
  fresh tab would. Always on.
- `memo/`: a `%%` leaf you edit as plain text, the one plugin anywhere that builds
  `createEditableLeaf` in `'plain'` mode (the bundled leaves all use `'render-primary'`), so
  the `editable-leaf-*` specs drive it. Always on; seed `memo` loads its document.
- `doc-stats/`: counts blocks and edits per editor and publishes them on `window`. Installed
  bare here (the no-options path) and with per-editor options on the `multi/` subroute; the
  working example of `registerGlobalCommand` plus a per-editor context. Always on; seed
  `docstats`.
- `ghost-text/`: one component widget at the end of the focused paragraph, with no completion
  backend behind it; its spec proves typing next to the widget never captures the ghost text
  into the document. Seed `ghost`.
- `fold/`: `[>hidden<]` ranges collapse to a clickable `…` that reopens on click; the
  `ReplaceDecoration.widget` fixture, covering a live click handler inside a decoration and
  decorations inside table cells. Seeds `fold` and `fold-table`.
- `block-badge/`: a class plus an `H` badge on every heading at any depth; the
  `BlockDecoration.badge` fixture, including a badge surviving its heading scrolling out of the
  window and back. Seed `badge`.
- `wiki-embed/`: `![[path|width]]` recognized as a built-in image, resize handles and all;
  covers an inline syntax producing a built-in kind, and `rewriteImage`, without which a resize
  would write GFM over the embed. Seed `wiki-embed`.
- `hloccur-scan/`: the bundled highlight-occurrences plugin configured with an `onScan` counter
  on `window`, so its spec can count how often it rescans. Seed `hloccur-memo`.
- `sim-mark/` and `sim-island/`: standing decoration sources for the simulation (its own section
  below). One marks every whole-word `paragraph`; the other turns three sentinel strings in the
  text into a replace island, a widget island, and a block badge. Both under `?seed=sim`, so
  the simulation runs with the decoration engine live on every keystroke.

`walk-views.ts` is the leaf walk they share. Four subroutes carry the multi-editor cases:
`multi/` (two editors with per-editor `doc-stats` options and a button that unmounts the
second), `staggered/` (editor one installs callout, editor two mounts later with details added,
for the staggered-mount spec), `enablement/` (two editors sharing one memo registration, the
left with the kind switched off through the harness-only `__registryEnablement` prop), and
`activation/` (two editors in one process, only the first listing the parrot and the block
badge, for the per-instance activation spec).

### The WebKit run

A second contenteditable implementation, run per release rather than per commit. The reason to
keep it out of `npm test` is signal, not time: a second engine in the per-commit loop doubles the
flake surface for a class of bug that doesn't appear between releases.
`npm run test:e2e:webkit` sets `WEBKIT=1`, and that variable is what makes the `e2e-webkit`
project exist at all, so the run can't half-happen inside the default suite. It collects a
curated slice of the existing typing, split/merge, selection and round-trip specs, plus
everything under `tests/webkit/`, which holds the specs only this run executes, covering the two
helpers that branch on the engine. It fails rather than reports, and it can afford to because it
carries no known-red backlog for a regression to hide behind. Run it alone, and on a quiet tree:
it shares the dev server with every other project, and a save into `src/` mid-run triggers an
SSR reload whose component re-registration turns the run red for a reason the product never had.

Two harness helpers branch on the engine, both behind unchanged signatures, so no spec knows
which side it got. WebKit rejects the clipboard permissions at **context creation**, which no
spec-level guard can reach, and its `writeText` resolves into a clipboard the synthetic paste
chord can't see; so the WebKit side seeds, pastes and reads through a dispatched clipboard event
carrying a `DataTransfer`, which is where the editor's own handlers already read and write.
WebKit exposes no CDP session, so the IME driver hand-fires the composition sequence: the one
exemption G4.49 grants, which no spec may copy.

What the run proves: editor behavior survives a second engine, and the commit path survives a
WebKit-shaped composition without double-applying at `compositionend`. What it doesn't: event
ORDER, which only the CDP side can assert, and the paste chord itself, which the dispatched
event bypasses. Both stay pinned in Chromium.

**The engine is not the host.** A second engine says nothing about the webview host boundary,
which no in-repo suite can see at all: clipboard retargeting, the host's own accelerator keys,
and image-src scheme policy are the embedding host's decisions rather than the page's, so that
class of bug is found by a real host or by a user.

**The caveat, wherever this run is described.** WebKit-on-Windows through Playwright isn't
Safari and isn't a WKWebView. It's the closest available proxy, so a green run is weaker
evidence than its pass count suggests, and #37 stays open until something runs on Apple
hardware. The browser build is pinned by the `@playwright/test` version in `package.json`, so a
Playwright upgrade that turns this run red is telling you something real.

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
- G4.23 (`src/lib/e2e/lint/requirement-spec-lockstep.test.ts`) enforces the lockstep: both
  directions, the stem collision two specs could hide behind, per-file shape, and a requirement
  list that ran 3× ahead of its spec's test count. That last rule is allowlisted, and an entry
  there states its reason: count EQUALITY is refuted by measurement (one test routinely walks
  several bullets), so padding the suite to satisfy a count is never the fix.
- `e2e/tests/perf/` holds two families, and the basename decides which project collects a spec:
  `*.perf.spec.ts` goes to the env-gated `e2e-perf` (and `e2e-perf-prod`), `vr-*.spec.ts`
  directly under `perf/` goes to `e2e-vr`, which rides `npm test`. Name a spec into the wrong
  family and it silently stops running in the suite you meant; G4.17 catches a basename in
  neither. Requirement files pair by the stem with the `.perf` suffix stripped.
- **Per-block subfolder rule.** A block area earns a subfolder under `tests/blocks/` and a
  `test:e2e:blocks:<block>` script at 3 spec files. Below that, specs stay flat under the
  parent category.
- **A bug fix's miss-analysis lives here too**: one line saying what test should have caught it
  and why none did, in the requirement file the regression spec pairs with. A unit-level
  regression has no requirement file, so its miss-analysis is that test's own header line
  instead.

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

Note the import path: `../fixtures`, not `@playwright/test`. That's the invariant watcher, and
it's the one line in this file most worth not copying wrong.

### Patterns and gotchas

**Pace per-character typing with a state settle.** Two input helpers coexist.
`editor.typeText(text)` fires one `insertText` event, fast and atomic; use it when only the end
state matters. `editor.typeSlowly(text)` sends real per-character `keydown`/`input`/`keyup`
cycles; use it when per-keystroke behavior matters (`**` formatting, `# ` kind changes, code
auto-close). Per-character typing is correct **when each character settles** before the next,
via a `bridge.waitForSource*` or DOM-count predicate. An old reversed-text bug came from
unsettled `keyboard.type` racing the inline re-render's cursor restore, which was exactly as
much fun to diagnose as it sounds. Don't fire unsettled `keyboard.type` in a tight loop.

**Container edits need Svelte's reactivity cycle to settle.** After typing inside a list item or
blockquote, `$effect`s and post-tick commits must flush before `getSource()` reflects the
change. Wait on `editor.bridge.waitForSourceContains('expected')` or a sibling predicate; they
poll until the assertion would pass and stop immediately. `waitForTimeout` is reserved for
genuinely time-dependent waits (sticky-column layout settle, copy-only clipboard verification)
and gets an inline comment when used. The raw rebuild itself is synchronous; you're waiting on
reactivity and render flush, not a debouncer.

**Use `focusBlockEnd` / `focusBlockStart` for precise cursor placement.** They set the cursor
through the Selection API. Native `End`/`Home` work for simple cases but are unreliable across
inline-rendered spans.

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

**Marker prefixes count toward block text.** Headings and list items render their markers as
dimmed spans inside the contenteditable, and `getBlockText(i)` returns the full text including
the marker (the `'# Hello'` above).

**Geometry reads against an image widget need a decode barrier, and not every Playwright API is
one.** An `<img>` that hasn't decoded lays out 0x0, and `.md-image-widget` shrink-wraps it, so a
rect read too early is degenerate. Compute a point from that rect and the click lands _inside_
the widget once the image decodes, which selects the image instead of placing a caret, so
whatever the spec was waiting for is never painted at all. `locator.waitFor()` and
`locator.click()` block until the box is non-empty; `locator.boundingBox()` and
`page.evaluate(() => el.getBoundingClientRect())` don't. So a raw-`evaluate` or
bare-`boundingBox` read needs an explicit guard: `waitForFirstImageLoaded`
(`tests/blocks/image/helpers.ts`), a preceding `waitFor()`/`click()` on the widget, or an
explicit fixture width (`![alt|120](url)`) when width is the only dimension you need. Which
regime you land in is set by dev-server latency, so this is invisible in isolation and surfaces
only as a full-suite flake.

**Driving IME composition.** Two complementary halves. For handler-level contract pins (the
composing gate, the end path, offset capture), use the unit harness:
`test/harness/editable-surface.ts` drives the real surface skeleton with synthetic event calls,
simulating the IME's writes by assigning `el.textContent` before firing the end. For browser
event ORDER and full wiring, drive real sequences in e2e via CDP:
`page.context().newCDPSession(page)`, then `Input.imeSetComposition` per update and
`Input.insertText` to commit; see `tests/ime-composition.spec.ts`. Mid-composition there's no
source change to settle on; settle on the composed text arriving in the focused element's DOM
instead.

## The conformance differ

_Are we certain our inline parser is right?_ Of course not, which is why
`src/lib/test/gfm-conformance/` diffs it against commonmark.js, pinned to an exact version.
Bumping the reference is a deliberate re-bless (re-recording the committed reference as the new
accepted truth) with a changelog note; `scripts/extract-spec-examples.mjs` regenerates
`spec-examples.json` from the new version's downloaded spec.json. Both trees normalize to one
minimal shape; an unmapped construct throws rather than being silently absorbed, and the few
deliberate reconciliations are recorded in the baseline's audit array. A like-for-like guard
accepts an input only when the reference's single paragraph spans the whole input, so a
divergence always means the _inline_ parsers disagree and not that the block layers trimmed
differently.

| Tier       | Command                    | Scope                                                                                                               |
| ---------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Slice      | rides `npm test`           | Spec-example fixtures + deterministic seeded corpus vs `baseline.json`; fails closed both ways                      |
| Full sweep | `npm run conformance:full` | Brute-force enumeration + high-volume seeded random; writes a classed report to `conformance-results/` (gitignored) |

The baseline only shrinks, by mechanism rather than by good intentions: a divergence not in it
fails the slice, and a stale entry that is no longer divergent fails until removed. The full
sweep is a _meter_ rather than a gate, and its classed report is the standing divergence reading
for the inline parser.

The **kind differential** (`gfm-conformance/kind-differential.property.test.ts`) is the semantic
complement: over the adversarial inline-source arbitrary it compares inline node _kinds and
nesting_ against commonmark, so emphasis classified into the wrong kinds fails even when the
bytes still tile. That's the gap a byte-conservation or offset-tiling property can't see. It
allows only the divergence classes the baseline documents as deliberate.

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

A shape a guard's own oracle can't survive belongs in that guard's fixed corpus rather than in a
shared generator; but shedding the shape is the second answer, and teaching the oracle to
CLASSIFY it is the first. Asterisk delimiter nesting is the standing example, both ways round:
it rebinds under a neighbouring byte, so the typing-seat net once read that as its own failure
and the generator shed it; the net now separates a seat that missed an answer from a parse that
offers none, and the shape is back in `arbInlineSource`.

**Reproducing a fresh find.** The seed line above is the reproduction: pin that seed as the
site's fixed default and the same draw comes back. fast-check also echoes the failing seed and
the shrunk counterexample in any failure it raises itself. The durable fix is to add the
counterexample as a committed regression case, which guards the class without the mode.

## The live-mode gesture fuzzer

Scripted flows only ever cover the gestures somebody thought of.
`src/lib/test/simulation/live-gesture-fuzz.property.test.ts` searches the space between them: a
seeded stream of typing and destructive gestures at positions biased toward hidden construct
edges, driven through the real caret-edge, split, join and range-delete code and judged after
every gesture against the live-mode license (`docs/design/live-mode.md` § 2). Each gesture also
runs on a byte-literal twin from the same starting bytes, so a divergence the source-mode edit
already has is reported rather than gated.

Findings sort into three buckets. `seam` is a live-only divergence and fails the sweep.
`ambiguous` is both twins failing the same claim: markdown's own rebinding, or the byte-literal
fallback § 4.4 declares. `known` is a live-only divergence an open ledger issue owns; every one
of those names its issue and is pinned by a deterministic case in the same file, so closing the
issue turns the pin red and the exclusion goes with it. An exclusion without an issue number
isn't allowed, no matter how obvious it looks at the time.

One oracle stands outside that sort: UTF-16 well-formedness. A gesture that writes a lone
surrogate its input didn't hold fails the sweep whether or not the twin writes one too, because
no rebinding excuses bytes that no UTF-8 boundary round-trips and no inverse gesture restores.
It's why the two gestures whose offset a caller computes rather than the engine reporting it,
the split and the range delete, reach their entry points unsnapped: the production snap is the
thing under test, and a harness that snapped first would be asserting the invariant instead of
checking it.

It rides `npm test` at a bounded default and joins fresh mode. `LIVE_FUZZ_DOCS` and
`LIVE_FUZZ_STEPS` raise the sweep for an overnight run, and every budgeted claim it makes is a
RATE over applied gestures rather than a count, so raising them changes what the sweep searches
and not what it asserts.

## The note-taking simulation

Long, realistic note-taking sessions driven through real input, the complement to the short
per-feature specs. A session types a full GFM note from an empty document, character by
character, with all the messy human behavior (typos and corrections, click-back edits,
select/delete, copy/paste, image resize, undo/redo), checking strong correctness oracles
continuously.

Where a spec exercises one operation, a session accumulates state across hundreds of gestures
and surfaces interaction bugs no isolated test reaches. Its very first run caught a list-exit
nested-state desync that every per-feature spec had missed, which tells you most of what
per-feature specs are worth on their own.

```
seed + note fixture → UserSimulator → real keyboard/mouse → Editor (/test/editor)
                          │                                      │
                  Gestures · ExpectationTracker          window.__test oracles
                          │
                  invariants (per-keystroke equality, undo/redo differential,
                  end-state equality, nested-state audit, no-errors, round-trip)
                          │
                  Recorder → simulation-captures/seed-<N>/{*.png, manifest.json}
```

The engine is in `src/lib/e2e/simulation/`; the specs are in `tests/simulation/`, with
requirements one-to-one in `requirements/simulation/`. The note set spans genres: a class note,
a feature tour, a project plan, a three-level outline, reading notes, meeting minutes, a README,
plus a short smoke. Several deliberately place a previously-blind-spot construct in their
**equality spine** (the constructs whose typing ≡ loading equality is asserted on every run):
deep bullet nesting in the outline, a nested `> >` blockquote in the reading notes.

A session that scripts its own gestures rather than typing a whole note starts the same way.
`makeSimContext` (`tests/simulation/helpers.ts`) bundles the page, the page object, an
expectation tracker seeded from the current source, and the error collector into the one
context every oracle reads; `assertCoreOracles` is the checkpoint sweep (no errors, round-trip
stable, nested state consistent). From `tests/simulation/table-ops.spec.ts`:

```ts
import { Gestures } from '../../simulation/gestures';
import { makeRng } from '../../simulation/rng';
import { assertCoreOracles } from '../../simulation/invariants';
import { makeSimContext } from './helpers';

await editor.loadContent(START_TABLE);
const ctx = await makeSimContext(page, editor, 'table-ops', { errors });
// { page, editor, tracker, errors, label: 'table-ops', ime: undefined }
const g = new Gestures(ctx, makeRng(1));

await g.insertColumnRight(0);
await assertCoreOracles(ctx, 'after-insert-column');
await g.editCell(1, 'C');
await assertCoreOracles(ctx, 'after-edit-cell');
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

**Parallelism.** The `e2e-simulation` project runs `fullyParallel`: sessions are fully
independent (own page, own seeded PRNG, no shared state) and the asserted artifact is the
timing-independent source. The full capture suite finishes in seconds.

### Running it

| Command                                                                                       | Scope                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:e2e:simulation`                                                                 | The ungated oracle sessions: smoke notes, multi-seed fuzz, and the loaded-ops sessions (tables, math, plugins, directives, decorations, IME composition, error collection). All ride `npm test`.                                    |
| `node scripts/run-with-env.mjs SIM_CAPTURE=1 -- npx playwright test --project=e2e-simulation` | Adds the two capture suites (every note, screenshotted), writing PNGs and a per-checkpoint `manifest.json` to `simulation-captures/` for the visual review. On bash, `SIM_CAPTURE=1 npm run test:e2e:simulation` is the same thing. |

One session on its own, to see the shape of a run (the full script runs them all, four at a
time):

```
$ npm run test:e2e:isolated -- --project=e2e-simulation transcription-smoke.spec.ts

Running 1 test using 1 worker

  ✓  1 [e2e-simulation] › src\lib\e2e\tests\simulation\transcription-smoke.spec.ts:14:2 › note-taking simulation: transcription smoke › drives a short note from empty and the oracle suite holds (9.9s)

  1 passed (12.7s)
```

New feature surface gets a new simulation gesture. The simulation is the strongest corruption
oracle in the repo, and its coverage has to track the product: the plugin surface once went a
full minor version without it looking, which isn't a stretch I'd like to repeat.

### Agentic visual review

A capture run pairs each checkpoint screenshot with the source known to be correct at that
moment (in `manifest.json`). What the user actually _sees_ (heading sizes, dimmed markers,
bold/italic, list alignment, a resized image's width, the right block kind) isn't easily
asserted in code, so a vision-capable agent reviews it: open `manifest.json`, view each PNG
alongside its `expectedSource`, report mismatches by severity.

This is **discovery and a periodic quality report, not a CI gate**, because agent vision is
subjective. Re-run it after substantive editor changes.

Artifacts persist under `simulation-captures/seed-<N>/` (gitignored, one directory per seed).
They live _outside_ `test-results/` deliberately: Playwright wipes that directory at the start
of every run, so captures kept there wouldn't survive the next invocation, which is the one the
review needs them for.

## The consumer smoke

`examples/consumer/` is a tiny SvelteKit app that installs aragonite the way a stranger would:
from the packed tarball, importing only published entry points. It's a test, not documentation
(if something is only learnable from that folder, that's a docs bug; file it). CI's
`consumer-smoke` job runs `scripts/consumer-smoke.mjs`, which builds and packs `dist/`, checks
the tarball holds every published path and no test file, installs it into the example with
`--no-save`, typechecks and builds the example (a Rollup "reexported through module" warning
fails the build, since it means a published barrel sits inside an import cycle), then runs the
example's own Playwright specs: the page server-renders without a 5xx, hydrates with no console
errors and takes a keystroke, the plugins page mounts the bundled plugins through their subpaths
plus a copy of the callout fixture, and the editor's dev-only warnings still fire under a
consumer's `vite dev`.

To run the example yourself, from a fresh clone (same commands in bash and PowerShell):

```bash
npm install        # at the repo root, once
npm run package    # builds dist/, which the example imports through the package's exports map

cd examples/consumer
npm install        # links the local library + the example's own deps
npm run dev        # http://localhost:5173
```

Locally the example depends on `@voithos-labs/aragonite` as `file:../..`, a link to the working
tree you cloned, so there's no tarball to refresh; after a library change, `npm run package`
again and the example sees it. `examples/consumer/src/plugins/` is generated, not written: before
every `dev`, `build`, `check`, and `test`, `scripts/sync-consumer-plugins.mjs` copies the callout
fixture from `src/routes/test/plugins/callout/` with its `$lib/plugin` imports rewritten to the
package name, and fails if any deep `$lib/` import survives the rewrite. The folder is
git-ignored and shows up on first run.
