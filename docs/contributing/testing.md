# Testing

## What this is

Two layers, both living inside `src/lib/` next to the code they test.

| Layer | Runner     | Location        | Tests                                                  |
| ----- | ---------- | --------------- | ------------------------------------------------------ |
| Unit  | Vitest     | `src/lib/test/` | Pure logic — parser, serializer, tree ops, merge rules |
| E2E   | Playwright | `src/lib/e2e/`  | Real user interaction in a real browser                |

The whole editor module is self-contained — components, core logic, and both test layers under one root. That's the property that made extracting aragonite from limestone a file move rather than a project.

```bash
npm test               # full suite — the commit gate
npm run test:editor    # all unit tests
npm run test:e2e       # all E2E tests (auto-starts the dev server)
```

Both layers are also sliced into area scripts for the inner loop — `test:editor:<area>` and `test:e2e:<area>`. **`package.json` is the authoritative list**; the tables below say what each area covers.

Above the two layers sit three things worth knowing about before you go looking for them: a **conformance harness** that diffs the inline parser against commonmark.js, a **note-taking simulation** that types whole documents through real keystrokes and checks correctness oracles continuously, and a **performance harness** with a commit-gated ceiling. Each has a section below.

## Unit tests (Vitest)

No browser — Node by default, with a file opting into jsdom via a `// @vitest-environment jsdom` docblock where it needs a DOM (about a third of the suite does, including the `*.svelte.test.ts` files that mount real components through the harness). The invariant that matters most: `serialize(parse(source)) === source` for all valid GFM.

### Where a test file goes

`src/lib/test/` mirrors the source tree one-for-one, with the leading `components/` segment elided — `components/blocks/list/X.ts` maps to `test/blocks/list/X.test.ts`. When a SUT moves into a subdirectory, its test follows.

Mirror **import depth**, not just the SUT's directory: a test importing `tree-operations/list/terminator` directly (rather than the `tree-operations` barrel) lives at `test/tree-operations/list/terminator.test.ts`.

Four deliberate exceptions:

- **Cross-cutting tests for editor-root services** (round-trip, editor events, block identity, dev warnings) stay at `test/` root, because their SUTs sit at the editor root.
- **The invariant catalog** (`test/invariants/`, with shared arbitraries under `arbitraries/` and source-scan guards under `lint/`) lives in one place so the whole set is legible in one read. See `docs/design/invariants.md`.
- **Simulation-engine unit tests** (`test/simulation/`) mirror `e2e/simulation/`, an e2e-owned engine exercised by the unit runner rather than a `src/lib/` module.
- **The debug-panel state test** (`test/debug/panel-state`) covers a route-level module outside `src/lib/`, so it has no in-library SUT to mirror.

Vitest discovers `*.test.ts` anywhere under the root, so adding a file needs no config change.

### By area

| Script                       | Covers                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| `test:editor:core`           | Parser, serializer, inline scanner, directive grammar, round-trip invariants                      |
| `test:editor:tree-ops`       | Tree mutation helpers                                                                             |
| `test:editor:editor-actions` | Editor action bundles and commit primitives                                                       |
| `test:editor:schema`         | Block-kind descriptors, op vocabulary, openers, container raw rebuild, merge rules                |
| `test:editor:ambient`        | Ambient-marker DOM and offset translation                                                         |
| `test:editor:cursor`         | Cursor utilities, sticky column, overlay rect measurement                                         |
| `test:editor:reactivity`     | Block-list state and state registry                                                               |
| `test:editor:selection`      | Selection-state logic                                                                             |
| `test:editor:decorations`    | Decoration engine — sources, edit-epoch invalidation, path buckets, island model                  |
| `test:editor:blocks`         | Per-block unit tests                                                                              |
| `test:editor:image`          | Image dimensions, resize, source bytes, widget selection                                          |
| `test:editor:plugins`        | Plugin authoring seams and dogfood kinds — container round-trips, chrome leaves, paste transforms |
| `test:editor:undo`           | Undo stack and entry management                                                                   |
| `test:editor:search`         | Find/replace engine — document scan and search state                                              |
| `test:editor:simulation`     | Simulation-engine internals — seeded RNG, expectation tracker                                     |
| `test:editor:conformance`    | commonmark.js differ slice — spec examples + seeded corpus vs the committed baseline              |
| `test:editor:invariants`     | Invariant catalog — property/fuzz tests + source-scan guards                                      |
| `test:editor:debug`          | Debug engine helpers and operations log                                                           |
| `test:editor:perf`           | Perf commit gate — counter ceilings, amplification report, fixture goldens                        |

The inline-scanner suite (`test/core/inline/scan/`) and the directive suite (`test/core/directive/`) fold under `test:editor:core`. Root-level cross-cutting tests without their own script run in the full `test:editor` suite.

### Mounting a block in isolation

A block component reads its wiring from the editor's context tree, so a bare `mount(SomeBlock, …)` needs that context present. `test/harness/mount-context.ts` supplies it: `editorMountContext(overrides?)` returns the Map a block requires — the action triple, history, and the three editor facets (services, policies, document) pre-stubbed. A test states only what it asserts on (`editorMountContext({ blockEdit, doc: { doc: () => parsed } })`) and takes sensible stubs for the rest. A newly required context becomes one harness edit rather than a fix across every block-mount test.

## E2E tests (Playwright)

The editor component driven in real Chromium. No backend needed — it's self-contained.

**Every spec imports `test` and `expect` from `src/lib/e2e/fixtures.ts`, never from `@playwright/test` directly.** This is not a style preference. The shared `test` fails any spec whose page emits an `[invariant:…]` console fire, so a dev-guard violation surfaces at the spec that _caused_ it rather than passing silently and being discovered a release later. A spec that deliberately triggers an invariant opts out with `test.use({ expectInvariants: true })` and asserts the fires itself.

### Architecture

```
Playwright spec
    ↓
EditorPage (page object — src/lib/e2e/editor-page.ts)
    ↓
Test route (/test/editor) + test bridge (window.__test)
    ↓
Editor.svelte (production component, unchanged)
```

- **Test route** (`src/routes/test/editor/+page.svelte`) renders the Editor with a bridge on `window.__test` exposing source and block queries.
- **EditorPage** wraps Playwright with editor-specific _interaction_ helpers — cursor positioning, text insertion, key presses.
- **`editor.bridge`** is the _state_ accessor: `getSource` / `getBlockCount` / `getBlockKind`, plus the `waitForSource*` / `waitForBlockCount` settling predicates. Reach for these instead of `waitForTimeout` whenever you're waiting on document state.

Specs are organized by feature area at the top level, and per-block inside `tests/blocks/`. They cover the harness smoke test, text editing (typing / split / merge / kind change), keyboard navigation (arrows, container traversal, sticky column), undo/redo, inline editing, container editing, and selection + clipboard.

### By area

| Script                    | Covers                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `test:e2e:top`            | Top-level specs — smoke, text editing, keyboard nav, undo, inline, containers                                                  |
| `test:e2e:blocks`         | All per-block specs under `tests/blocks/`                                                                                      |
| `test:e2e:blocks:<block>` | One block only — `list`, `code`, `image`, `table`, `blockquote`                                                                |
| `test:e2e:plugins`        | Plugin authoring — plugin containers, reserved chrome, collapse, the `plugins` prop, component-portal widgets, editable leaves |
| `test:e2e:clipboard`      | Cut / copy / paste (excludes exploration)                                                                                      |
| `test:e2e:exploration`    | Clipboard exploration / manual-verification scenarios                                                                          |
| `test:e2e:selection`      | Cross-block selection behavior                                                                                                 |
| `test:e2e:sticky-column`  | Vertical cursor column tracking across block transitions                                                                       |
| `test:e2e:search`         | Find/replace bar and controller behavior                                                                                       |
| `test:e2e:decorations`    | Decoration engine in the browser — mark / island / block paint, search as its first client                                     |
| `test:e2e:presentation`   | Presentation modes — reading-mode inertness, block- and inline-granular preview reveal, mid-session mode flips                 |
| `test:e2e:simulation`     | The note-taking simulation sessions (below)                                                                                    |
| `test:e2e:a11y`           | axe baseline-ratchet over `.editor` — fails on any violation outside the committed allowlist                                   |
| `test:e2e:vr`             | Virtual rendering on large fixtures — windowing, reveal, table-row windowing, mounted-count ceiling                            |

The a11y allowlist and the VR ceilings both fail closed and only shrink. Neither is a perf gate — both ride `npm test`.

### Requirements pair one-to-one with specs

Every spec under `src/lib/e2e/tests/` pairs with a requirement file under `src/lib/e2e/requirements/` — a plain-English list of scenarios, written _before_ the spec. The requirements mirror the spec tree: `tests/plugins/callout-container.spec.ts` pairs with `requirements/plugins/callout-container.md`. When a subdirectory's specs split further, the requirements split with them.

The filesystem is the authoritative list of what's covered. A spec with no requirement file, or a requirement file with no spec, means one of the two is out of lockstep — fix it, don't work around it. G4.23 (`src/lib/e2e/lint/requirement-spec-lockstep.test.ts`) enforces it: both directions, the stem collision two specs could hide behind, per-file shape, and a requirement list that ran 3× ahead of its spec's test count. That last rule is allowlisted, and an entry there states its reason: count EQUALITY is refuted by measurement (most pairs diverge legitimately, since one test routinely walks several bullets), so padding the suite to satisfy a count is never the fix.

`e2e/tests/perf/` holds two families, and the basename decides which project collects a spec: `*.perf.spec.ts` goes to the env-gated `e2e-perf` (and `e2e-perf-prod`), `vr-*.spec.ts` directly under `perf/` goes to `e2e-vr`, which rides `npm test`. Name a spec into the wrong family and it silently stops running in the suite you meant; G4.17 catches a basename in neither. Requirement files pair by the stem with the `.perf` suffix stripped.

**Per-block subfolder rule.** A block area earns a subfolder under `tests/blocks/` and a `test:e2e:blocks:<block>` script at 3 spec files. Below that, specs stay flat under the parent category.

**A bug fix's miss-analysis lives here too**: one line saying what test should have caught it and why none did, in the requirement file the regression spec pairs with. A unit-level regression has no requirement file, so its miss-analysis is the test file's own header line instead.

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

Note the import path — `../fixtures`, not `@playwright/test`. That's the invariant watcher, and it's the one line in this file most worth not copying wrong.

### Patterns and gotchas

**Pace per-character typing with a state settle.** Two input helpers coexist. `editor.typeText(text)` fires one `insertText` event — fast and atomic; use it when only the end state matters. `editor.typeSlowly(text)` sends real per-character `keydown`/`input`/`keyup` cycles; use it when per-keystroke behavior matters (`**` formatting, `# ` kind changes, code auto-close). Per-character typing is correct **when each character settles** before the next — a `bridge.waitForSource*` or DOM-count predicate. An old reversed-text bug came from unsettled `keyboard.type` racing the inline re-render's cursor restore. Never fire unsettled `keyboard.type` in a tight loop.

**Container edits need Svelte's reactivity cycle to settle.** After typing inside a list item or blockquote, `$effect`s and post-tick commits must flush before `getSource()` reflects the change. Wait on `editor.bridge.waitForSourceContains('expected')` or a sibling predicate — they poll until the assertion would pass and stop immediately. `waitForTimeout` is reserved for genuinely time-dependent waits (sticky-column layout settle, copy-only clipboard verification) and gets an inline comment when used. The raw rebuild itself is synchronous; you're waiting on reactivity and render flush, not a debouncer.

**Use `focusBlockEnd` / `focusBlockStart` for precise cursor placement.** They set the cursor through the Selection API. Native `End`/`Home` work for simple cases but are unreliable across inline-rendered spans.

**Use `getBlockCount()` for structural assertions after a split.** The bridge reads the live CST, so it sees a transient block the serializer would trim and a live-kind-vs-raw desync a reparse cannot. `getDomBlockCount()` counts _mounted_ top-level blocks, which under virtual rendering is the window rather than the document — reach for it only when the mount count is the thing under test, and then on a fixture small enough that nothing windows.

**Test structural operations _through_ a container, not just flat paragraphs.** Split, merge, and delete shift block indices, and containers use their `index` prop in the delegation chain when focus exits them. A test that splits a paragraph and then arrows through more paragraphs won't catch a stale-index or stale-ref bug — that delegation chain is one hop deep. Always follow the structural op with navigation through a container. See the focus-traversal-after-insertion pattern under `tests/keyboard-navigation/`.

**Assert focus by typing, not by reading source.** `getSource()` serializes the CST, which is correct regardless of where focus landed — so it cannot detect a focus bug. To verify focus, type a marker character and assert on _where it appeared_.

**Selector helpers live in `EditorPage`.** Each block sits in a `.block-host` positioning container next to its `SelectionOverlay` sibling, and `getBlock(i)` skips the overlay. Write tests against the helpers; reach for raw selectors only when adding a new one.

**Marker prefixes count toward block text.** Headings and list items render their markers as dimmed spans inside the contenteditable, and `getBlockText(i)` returns the full text including the marker.

**Geometry reads against an image widget need a decode barrier, and not every Playwright API is one.** An `<img>` that has not decoded lays out 0x0, and `.md-image-widget` shrink-wraps it, so a rect read too early is degenerate. Compute a point from that rect and the click lands _inside_ the widget once the image decodes, which selects the image instead of placing a caret, so whatever the spec was waiting for is never painted at all. Measured against a 1.2s stalled response: `locator.waitFor()` and `locator.click()` block until the box is non-empty (they ran the full stall), while `locator.boundingBox()` and `page.evaluate(() => el.getBoundingClientRect())` both returned a 0x0 box in under 6ms. So a raw-`evaluate` or bare-`boundingBox` read needs an explicit guard: `waitForFirstImageLoaded` (`tests/blocks/image/helpers.ts`), a preceding `waitFor()`/`click()` on the widget, or an explicit fixture width (`![alt|120](url)`) when width is the only dimension you need. Which regime you land in is set by dev-server latency, so this is invisible in isolation and surfaces as a full-battery flake: the 2026-07-25 measurement was 0 of 120 repeats pre-decode on a warm cache, 80 of 180 with two heavy projects running alongside.

**Driving IME composition.** Two complementary halves. For handler-level contract pins (the composing gate, the end funnel, offset capture), use the unit harness — `test/harness/editable-surface.ts` drives the real surface skeleton with synthetic event calls, simulating the IME's writes by assigning `el.textContent` before firing the end. For browser event ORDER and full wiring, drive real sequences in e2e via CDP: `page.context().newCDPSession(page)`, then `Input.imeSetComposition` per update and `Input.insertText` to commit — see `tests/ime-composition.spec.ts`. Mid-composition there is no source change to settle on; settle on the composed text arriving in the focused element's DOM instead.

## Conformance harness (commonmark.js differ)

`src/lib/test/gfm-conformance/` diffs the inline parser against commonmark.js, pinned to an exact version — bumping the reference is a deliberate re-bless with a changelog note (`scripts/extract-spec-examples.mjs` regenerates `spec-examples.json` from the new version's downloaded spec.json). Both trees normalize to one minimal shape; an unmapped construct throws rather than being silently absorbed, and the few deliberate reconciliations are recorded in the baseline's audit array. A like-for-like guard accepts an input only when the reference's single paragraph spans the whole input — so a divergence always means the _inline_ parsers disagree, never that the block layers trimmed differently.

| Tier       | Command                    | Scope                                                                                                               |
| ---------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Slice      | rides `npm test`           | Spec-example fixtures + deterministic seeded corpus vs `baseline.json` — fails closed both ways                     |
| Full sweep | `npm run conformance:full` | Brute-force enumeration + high-volume seeded random; writes a classed report to `conformance-results/` (gitignored) |

The baseline is a ratchet: a divergence not in it fails the slice, and a stale entry that is no longer divergent fails until removed. The count only shrinks, by mechanism. The full sweep is a _meter_, not a gate — its classed report is the standing divergence reading for the inline parser.

The **kind differential** (`gfm-conformance/kind-differential.property.test.ts`) is the semantic complement: over the adversarial inline-source arbitrary it compares inline node _kinds and nesting_ against commonmark, so emphasis classified into the wrong kinds fails even when the bytes still tile — the gap a byte-conservation or offset-tiling property cannot see. It allows only the divergence classes the baseline documents as deliberate.

## Property suites and the fresh lane

Property/fuzz suites (`fc.assert` over the shared arbitraries) run **fixed-seed** so the commit gate is deterministic — a regression surfaces the same way every run rather than as a flake. The cost is no new-input discovery over time: one seed explores one set of inputs.

The **fresh lane** is the opt-in escape hatch. `npm run test:editor:property:fresh` sets `PROPERTY_FRESH=1`, which swaps each site's fixed seed for a random one — every `fc.assert` seed threads through the `freshOrFixedSeed` helper — and runs just the property-bearing suites. Run it when touching the inline parser, the CST, or the arbitraries, or periodically, to hunt inputs the fixed seed never reaches. It is never part of the gate; reachability self-tests keep their fixed seeds so they cannot flake.

**Reproducing a fresh find.** Fresh mode prints its seed (`[property:fresh] seed <N> …`) before the run, and fast-check echoes the failing seed and shrunk counterexample in any failure. To replay, pin that seed as the site's fixed default; the durable fix is to add the counterexample as a committed regression case, which guards the class without the lane.

## Note-taking simulation

Long, realistic note-taking sessions driven through real input — the complement to the short per-feature specs. A session types a full GFM note from an empty document, character by character, with messy human behavior (typos and corrections, click-back edits, select/delete, copy/paste, image resize, undo/redo), checking strong correctness oracles continuously.

Where a spec exercises one operation, a session accumulates state across hundreds of gestures and surfaces interaction bugs no isolated test reaches. Its first run caught a list-exit nested-state desync that the per-feature specs had all missed.

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

The engine is in `src/lib/e2e/simulation/`; the specs are in `tests/simulation/`, with requirements one-to-one in `requirements/simulation/`. The note set spans genres — a class note, a feature tour, a project plan, a three-level outline, reading notes, meeting minutes, a README, plus a short smoke. Several deliberately place a previously-blind-spot construct in their **equality spine** (deep bullet nesting in the outline, a nested `> >` blockquote in the reading notes) so the typing ≡ loading guards exercise it on every run.

**Determinism** comes from a single seeded PRNG: same seed ⇒ same gesture stream ⇒ same asserted state, so a failure is replayable.

**Predict printable, resync after auto-behavior.** The tracker predicts only printable typing (per-keystroke `waitForSourceEquals`). Every gesture that triggers editor auto-behavior — Enter, Tab, paste, resize, toggle — performs, settles on an observable predicate, then resyncs to observed state. Typing into a freshly-created list item, whose marker only materializes on its first body character, is a resync point rather than a prediction — which is how the deep-nesting cadence (Enter → indent empty item → type) fits the same rule.

**Multi-seed fuzzing.** A runner drives one note across many seeds, one test per seed. The seed selects the typo stream and which **net-identity detours** fire — a pause that fences the undo batch, then select-delete-undo, then copy-paste-undo, each asserting byte-exact restoration of its pre-detour source. They exercise undo, selection, and clipboard mid-session while end-state equality still holds for every seed.

**Parallelism.** The `e2e-simulation` project runs `fullyParallel`: sessions are fully independent (own page, own seeded PRNG, no shared state) and the asserted artifact is the timing-independent source. The full capture suite finishes in seconds.

### Running it

| Command                                     | Scope                                                                                                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:e2e:simulation`               | The ungated oracle sessions — smoke notes, multi-seed fuzz, and the loaded-ops sessions (tables, math, plugins, directives, decorations, IME composition, error collection). All ride `npm test`. |
| `SIM_CAPTURE=1 npm run test:e2e:simulation` | Adds the two capture suites — every note, screenshotted — writing PNGs and a per-checkpoint `manifest.json` to `simulation-captures/` for the visual review.                                      |

New feature surface gets a new simulation gesture. The simulation is the strongest corruption oracle in the repo, and its coverage has to track the product — the plugin surface once went a full minor version without it looking.

### Agentic visual review

A capture run pairs each checkpoint screenshot with the source known to be correct at that moment (in `manifest.json`). What the user _sees_ — heading sizes, dimmed markers, bold/italic, list alignment, a resized image's width, the right block kind — isn't easily asserted in code, so a vision-capable agent reviews it: open `manifest.json`, view each PNG alongside its `expectedSource`, report mismatches by severity.

This is **discovery and a periodic quality report, not a CI gate** — agent vision is subjective. Re-run it after substantive editor changes.

Artifacts persist under `simulation-captures/seed-<N>/` (gitignored, one directory per seed). They live _outside_ `test-results/` deliberately: Playwright wipes that directory at the start of every run, so captures kept there wouldn't survive the next invocation — which is the one the review needs them for.

## Performance harness

Two layers measure the editor over shared deterministic fixtures, and one of them is a gate.

| Layer   | Command               | Measures                                                                                              |
| ------- | --------------------- | ----------------------------------------------------------------------------------------------------- |
| Bench   | `npm run perf:editor` | Parse / clone / ancestry-rebuild / snapshot-push timings → `perf-results/`                            |
| Browser | `npm run perf:e2e`    | Fixture load wall-time + per-keystroke p50/p95 through real Chromium                                  |
| Gate    | `npm run perf:check`  | Keystroke p50 of every renderable shape at 1MB and 10MB vs baseline + tolerance — fails on regression |

The browser and gate scripts arm their own env gates (`PERF` / `PERF_GATE`). Outside them — in the full `npm test` battery, for instance — the `e2e-perf` specs self-skip in seconds.

### Fixtures

`src/lib/test/perf/fixtures/generate.ts` builds nine seeded shapes at any byte target: flat-prose, nested-containers, many-small-blocks, single-giant-paragraph, reference-heavy, table-heavy, giant-single-list, giant-single-blockquote, giant-single-table. The same (shape, size, seed) always yields identical bytes, golden-pinned — so numbers stay comparable across runs and machines.

### Instruments

`src/lib/perf/instruments.ts` holds the dev-mode counters: snapshot clone bytes, rebuild-depth histogram, parse timing, inline-refresh node counts, and an undo live-byte gauge. Recording is off until enabled, and the switch only arms under dev/Vitest — production pays one boolean check per record site.

On `/test/editor` the bridge exposes them as `__test.perf.enable()` / `.reset()` / `.snapshot()`, callable from DevTools or `page.evaluate`.

**The undo gauge is push-sampled.** It updates only when a snapshot is pushed; undo, redo, and clear don't refresh it. Read it as "live bytes as of the last push", not a live value.

### Threshold policy

| Kind                         | Examples                                          | Treatment                                                                                                                                                                                |
| ---------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Machine-independent counters | Clone byte parity, container-raw amplification    | Hard ceilings — fail the commit gate (`test:editor:perf`, inside `npm test`)                                                                                                             |
| Keystroke p50 (renderable)   | Five 1MB shapes + six 10MB shapes                 | Gated by `npm run perf:check` — deliberate, not in `npm test`; ceiling = `baseline × 1.1 + 5ms`, × `PERF_RUNNER_SCALE` (1 locally — the tight gate; CI sets 2.5, a gross-regression net) |
| Other time rows              | Parse/clone bench ms, p95, single-giant-paragraph | Report-only vs `src/lib/test/perf/baseline.json`                                                                                                                                         |

Ceiling and baseline bumps are deliberate decisions with a changelog note, never reflexive edits.

**What `perf:check` actually gates.** The dev machine is the pinned hardware — same-machine run-to-run p50 spread is a few percent, so an absolute baseline plus tolerance catches regressions without a CI runner. Re-bless the baseline after a Chromium/OS/toolchain bump moves the floor.

It gates **steady-state** p50, which means it is blind to a one-slow-keystroke regression: a single slow first-edit full re-render barely moves a 30-sample median. That class is guarded separately, by the `block-render-scoping` count assertion inside the fast `npm test` gate. p95 is reported, not gated — it catches single GC-pause keystrokes and is noisy.

**Dev-overhead caveat.** Both layers run under DEV (Vitest / dev server) with invariant assertions active. Every timing number is a conservative upper bound on production, not a production latency.

## Debug panel

A collapsible side panel on the `/` showcase and `/test/editor` routes, closed until it is toggled open, for ad-hoc debugging and for capturing snapshots in bug reports. Not present in production builds.

**Toggle:** `Ctrl+Shift+D` / `Cmd+Shift+D`. `Escape` closes it when focus is inside.
**Resize:** drag the left edge. Minimum 300px; width persists in localStorage alongside the open/expanded state.

| Section                     | Contents                                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Raw source                  | Read-only view of the live source (edit via the editor, or `window.__test.setSource(md)` in DevTools)                                                                |
| CST tree                    | Compact text rendering of the full parsed block tree                                                                                                                 |
| Selection                   | Live anchor/focus paths in both single-block (native DOM) and cross-block (SelectionState) modes                                                                     |
| Undo stack                  | Top-N entries with type, selection snapshot, and timestamp                                                                                                           |
| Inline tree (focused block) | Inline parse tree for the currently-focused prose block                                                                                                              |
| Operations log              | Tail of the structural-operation ring buffer — op type, path, elapsed time                                                                                           |
| Interaction trace           | Ring buffer of inline-layer transitions — rebuild, cursor capture/restore, reveal, widget pool, composition, island, sticky; expanding the section arms the recorder |

**Copy all** concatenates every section into a timestamped fenced Markdown snapshot on the clipboard — paste it straight into a bug report or an AI conversation.

The debug engine itself (`src/lib/debug/`) is internal — not exported from `src/lib/index.ts`.

### From the console

The same helpers are wired to `window.__test` on the test route, callable from DevTools without opening the panel:

| Call                              | Returns                                            |
| --------------------------------- | -------------------------------------------------- |
| `__test.dumpTree(opts?)`          | Compact text rendering of the parsed CST           |
| `__test.dumpSelection()`          | Current selection state as a one-line summary      |
| `__test.dumpInlineTree()`         | Inline tree for the currently-focused prose block  |
| `__test.dumpUndoStack(n?)`        | Top-N undo entries                                 |
| `__test.dumpOperationsLog(n?)`    | Tail-N of the structural-op ring buffer            |
| `__test.dumpInteractionTrace(n?)` | Tail-N of the inline interaction-trace ring buffer |

The test-bridge calls (`getSource`, `setSource`, `getBlockCount`, …) live alongside them.

### Using the debug engine inside tests

**Before you hand-trace editor state, dump it.** Both runners can reach the engine — it's internal, not sealed.

```ts
// unit test
import { dumpTree, dumpSelection } from '$lib/debug/inspect';

// e2e spec
const cst = await page.evaluate(() => (window as any).__test.dumpTree());
```

**Diagnostic narration only — never an assertion target.** Drop these into a `console.log`, an assertion-failure message, or `test.info().annotations.push(...)` when you want to see what the CST looked like at the moment of failure. Do **not** write `expect(dumpTree(doc)).toBe('[0] heading …')`: the output format is intentionally internal and may change without notice, which would turn every formatter tweak into a suite-wide churn wave. Assert on structured accessors instead — `getSource()`, `getBlockKind(i)`, `getSelectionPaths()`, or the CST itself.
