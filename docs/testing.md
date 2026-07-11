# Testing

Two test layers, both colocated with the editor source:

| Layer | Runner     | Location        | Scope                                                  |
| ----- | ---------- | --------------- | ------------------------------------------------------ |
| Unit  | Vitest     | `src/lib/test/` | Pure logic — parser, serializer, tree ops, merge rules |
| E2E   | Playwright | `src/lib/e2e/`  | User interactions in a real browser                    |

The entire editor module is self-contained: components, core logic, unit tests, and E2E tests all live under `src/lib/` — the property that made extraction into this standalone repo mechanical.

## Running Tests

```bash
npm run test           # full suite
npm run test:editor    # all unit tests
npm run test:e2e       # all E2E tests (auto-starts dev server)
```

### By category

Unit tests can be scoped to a single concept area:

| Script                       | Covers                                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `test:editor:core`           | Parser, serializer, round-trip invariants                                                                                                     |
| `test:editor:tree-ops`       | Tree mutation helpers                                                                                                                         |
| `test:editor:editor-actions` | Editor action bundles and commit primitives                                                                                                   |
| `test:editor:ambient`        | Ambient-marker DOM and offset translation                                                                                                     |
| `test:editor:cursor`         | Cursor utilities, sticky column, overlay rect measurement                                                                                     |
| `test:editor:schema`         | Block-kind descriptors, op vocabulary, openers, container raw rebuild, merge rules                                                            |
| `test:editor:reactivity`     | Block-list state and state registry                                                                                                           |
| `test:editor:selection`      | Selection-state logic                                                                                                                         |
| `test:editor:blocks`         | Per-block unit tests (code block, etc.)                                                                                                       |
| `test:editor:image`          | Image dimensions, resize, source bytes, widget selection                                                                                      |
| `test:editor:plugins`        | Plugin dogfood kinds and authoring seams — container round-trips, chrome leaves, directive tiers, paste transforms, reference-plugin metadata |
| `test:editor:simulation`     | Simulation-engine internals — seeded RNG, expectation tracker                                                                                 |
| `test:editor:undo`           | Undo stack and entry management                                                                                                               |
| `test:editor:search`         | Find/replace engine — document scan and search state                                                                                          |
| `test:editor:conformance`    | commonmark.js differ slice — spec examples + seeded corpus vs the committed divergence baseline                                               |
| `test:editor:debug`          | Debug engine helpers and operations log                                                                                                       |
| `test:editor:invariants`     | Invariant catalog — property/fuzz tests + source-scan guards                                                                                  |
| `test:editor:perf`           | Perf commit gate — counter ceilings, amplification report, fixture goldens, instrument behavior                                               |

E2E tests are grouped into Playwright projects:

| Script                       | Covers                                                                                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test:e2e:top`               | Top-level specs — smoke, text editing, keyboard nav, undo, inline, containers                                                                                                                                             |
| `test:e2e:blocks`            | All per-block specs under `tests/blocks/`                                                                                                                                                                                 |
| `test:e2e:blocks:list`       | List block specs only                                                                                                                                                                                                     |
| `test:e2e:blocks:code`       | Code block specs only                                                                                                                                                                                                     |
| `test:e2e:blocks:image`      | Image block specs only                                                                                                                                                                                                    |
| `test:e2e:blocks:table`      | Table block specs only                                                                                                                                                                                                    |
| `test:e2e:blocks:blockquote` | Blockquote block specs only                                                                                                                                                                                               |
| `test:e2e:plugins`           | Plugin-authoring specs — plugin containers, reserved chrome, collapse, the plugins prop / staggered mount, component-portal widgets, editable-leaf editing                                                                |
| `test:e2e:clipboard`         | Cut / copy / paste (excludes exploration)                                                                                                                                                                                 |
| `test:e2e:exploration`       | Clipboard exploration / manual-verification scenarios                                                                                                                                                                     |
| `test:e2e:selection`         | Cross-block selection behavior                                                                                                                                                                                            |
| `test:e2e:sticky-column`     | Vertical cursor column tracking across block transitions                                                                                                                                                                  |
| `test:e2e:search`            | Find/replace bar and controller behavior                                                                                                                                                                                  |
| `test:e2e:a11y`              | axe baseline-ratchet over `.editor` — fails on any violation outside the committed (fails-closed, only-shrinks) allowlist                                                                                                 |
| `test:e2e:vr`                | Virtual-rendering correctness on large fixtures — windowing, reveal, and table-row windowing, with the mounted-count ceiling plus the layouts-per-mount and anchor-compensation guards; runs in `npm test` (no PERF gate) |

## Unit Tests (Vitest)

Pure TypeScript — no DOM, no browser. The most important invariant: `serialize(parse(source)) === source` for all valid GFM.

Unit tests live under `src/lib/test/`, mirroring the source tree one-for-one (the leading `components/` segment is elided — `components/blocks/list/X.ts` maps to `test/blocks/list/X.test.ts`). Cross-cutting tests for top-level editor services (`round-trip`, `round-trip-complex`, `round-trip-task-items`, `editor-events`, `append-block-event`) stay at `test/` root because their SUTs sit at the editor root. When a SUT moves into a subdirectory the test follows — e.g. the undo manager lives at `undo/manager.ts` and its test at `test/undo/manager.test.ts`. Vitest discovers `*.test.ts` anywhere under the root, so no config change is needed. The top-level tests run only via the full `test:editor` suite; every other area has a dedicated `test:editor:<area>` script (see `package.json`).

Tests that import a sub-path directly (e.g. `tree-operations/list/m1-contract` rather than the `tree-operations` barrel) mirror at the deeper path — `test/tree-operations/list/m1-contract.test.ts`. Test directory depth follows import depth, not just the directory the SUT lives in.

The invariant catalog (`test/invariants/`, with shared arbitraries under `test/invariants/arbitraries/` and source-scan guards under `test/invariants/lint/`) deliberately bends the mirror rule: the catalog is cross-cutting — like the root-level `round-trip*.test.ts` — and lives in one place so the whole set is legible. See `docs/design/editor/invariants.md`.

## Conformance Harness (commonmark.js differ)

`src/lib/test/conformance/` diffs the inline parser against commonmark.js (pinned exact — bumping the reference is a deliberate re-bless with a changelog note). Both trees normalize to one minimal shape; unmapped constructs throw rather than being silently absorbed, and the few deliberate reconciliations are recorded in the baseline's `normalizerReconciliations` audit array. A like-for-like guard accepts an input only when the reference's single paragraph spans the entire input (its block layer neither trimmed nor consumed anything), with per-reason skip counts — so a divergence always means the inline parsers disagree.

| Tier       | Command                    | Scope                                                                                                                  |
| ---------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Slice      | rides `npm test`           | Spec-example fixtures + deterministic seeded corpus vs `baseline.json` — fails closed in both directions               |
| Full sweep | `npm run conformance:full` | Full brute-force enumeration + high-volume seeded random; writes a classed report to gitignored `conformance-results/` |

The baseline is a ratchet: a divergence not in it fails the slice, and a stale entry (no longer divergent) fails until removed — the count only shrinks, by mechanism. The full sweep is a meter, not a gate: its classed report (plus unclassified inputs) is the standing divergence meter for the inline parser.

## E2E Tests (Playwright)

Tests the editor component in a real Chromium browser. No Tauri backend needed — the editor is self-contained.

### Architecture

```
Playwright test files
    ↓
EditorPage (page object — src/lib/e2e/editor-page.ts)
    ↓
Test route (/test/editor) + test bridge (window.__test)
    ↓
Editor.svelte (production component, unchanged)
```

- **Test route** (`src/routes/test/editor/+page.svelte`): renders the Editor with a test bridge on `window.__test` exposing source and block queries.
- **EditorPage**: page object wrapping Playwright with editor-specific helpers for cursor positioning, text insertion, key presses, and state queries.
- **EditorBridge** (`editor.bridge`): polled-state accessor on `EditorPage`. Hosts `getSource` / `getBlockCount` / `getBlockKind` plus the `waitForSource*` / `waitForBlockCount` settling predicates. Reach for these instead of `waitForTimeout` whenever the test waits on document state.
- **Test suites**: organized by feature area at the top level, and per-block inside `tests/blocks/`.

### Test Suites

Feature-level specs live in `src/lib/e2e/tests/` and cover: test-harness smoke, text editing (typing / split / merge / kind change), keyboard navigation (arrow keys, container traversal, sticky column), undo/redo, inline editing (bold / italic / code / links), container editing (blockquotes, lists, nested structure, exit behavior), and selection + clipboard (cut / copy / paste / select-all).

Requirement files in `src/lib/e2e/requirements/` pair one-to-one with spec files under `src/lib/e2e/tests/`. When a subdirectory's specs split further (e.g. `tests/sticky-column/` into several files), the requirements split with them. The filesystem is the authoritative list of what's covered — if a spec has no requirement file or vice versa, one or the other is out of lockstep.

**Per-block subfolder rule.** Create a per-block subfolder under `tests/blocks/` and a `test:e2e:blocks:<block>` npm script when a block area reaches 3 or more spec files. Below that threshold, specs live flat under the parent category. The per-block subfolders (list, code, image, table, blockquote) each earned their own category script this way.

### Writing New E2E Tests

A typical test:

```typescript
import { test, expect } from '@playwright/test';
import { EditorPage } from '../editor-page';

test.describe('my feature', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('description', async () => {
		await editor.loadContent('# Hello\n\nWorld.\n');
		expect(await editor.getBlockCount()).toBe(2);
		expect(await editor.getBlockKind(0)).toBe('heading');
	});
});
```

### Key Patterns and Gotchas

**Pace per-character typing with a state settle.** Two input helpers coexist. `editor.typeText(text)` fires one `insertText` event (fast, atomic) — use it when only the end state matters. `editor.typeSlowly(text)` sends real per-character `keydown`/`input`/`keyup` cycles — use it when per-keystroke behavior matters (formatting like `**`, kind changes like `# `, code auto-close). Per-character typing is correct **when each character settles** before the next (a `bridge.waitForSource*` or DOM-count predicate); an older reversed-text bug came from fast _unsettled_ `keyboard.type` racing the inline re-render's cursor restore — a settle avoids it. Don't fire unsettled `keyboard.type` in a tight loop.

**Use `focusBlockEnd` / `focusBlockStart` for precise cursor placement.** These use `evaluate()` to set the cursor via the Selection API. The native `End`/`Home` keys work for simple cases but can be unreliable with inline-rendered spans.

**Use `getDomBlockCount()` for structural assertions after split.** The test bridge's `getBlockCount()` re-parses the serialized source, which may absorb empty blocks as whitespace. `getDomBlockCount()` counts DOM elements, reflecting the editor's true internal state.

**Test structural operations with container navigation, not just flat paragraphs.** Structural operations (split, merge, delete) shift block indices. Container blocks (blockquote, list) use their `index` prop in delegation chains when focus exits the container. A test that splits a paragraph and then navigates through flat paragraphs won't catch stale-index or stale-ref bugs — the delegation chain is only one hop deep. Always include a test that performs the structural operation and then navigates _through_ a container block to verify the full delegation chain works. See the "focus traversal after block insertion" pattern under `tests/keyboard-navigation/`.

**Use "type and check where it appeared" for focus assertions.** `getSource()` serializes the CST, which is always correct regardless of focus state. To verify where focus actually landed after a navigation operation, type a marker character and assert on its position in the source. `getSource()`-only assertions can't detect focus bugs.

**Container edits need Svelte's reactivity cycle to settle.** After typing inside a nested container (list item, blockquote), Svelte's reactive `$effect`s and post-tick commits must flush before `getSource()` reflects the new state. Wait via `editor.bridge.waitForSourceContains('expected')` (or one of the other `waitForSource*` / `waitForBlockCount` predicates) — they poll until the assertion would pass and stop immediately. `waitForTimeout` is reserved for genuinely time-dependent waits (sticky-column layout settle, copy-only clipboard verification) and should be commented inline when used. Raw rebuilds themselves are synchronous — the wait is for reactivity and render flush, not for a debouncer.

**Selector helpers live in `EditorPage`.** Each block sits inside a `.block-host` positioning container alongside its `SelectionOverlay` sibling — `getBlock(i)` skips the overlay sibling. Write tests against the helpers; reach for raw selectors only when adding a new helper.

**Marker prefixes count toward block text.** Headings, list items, and other ambient-marker blocks render their markers as dimmed spans inside the contenteditable. `getBlockText(i)` returns the full text including the marker.

## Note-Taking Simulation

Long, realistic note-taking sessions driven through real input, complementing the short per-feature specs. Each session types a full GFM note from an empty document character-by-character with messy human behavior (typos+corrections, click-back edits, select/delete, copy/paste, image resize, undo/redo) and checks strong correctness oracles continuously. Where single-scenario specs each exercise one operation, a session accumulates state across hundreds of gestures and surfaces interaction bugs no isolated test reaches (its first run caught a list-exit nested-state desync the per-feature specs missed).

The note set spans genres — a class note, a markdown feature-tour, a project plan, a three-level outline, reading notes, meeting minutes, a README, plus a short smoke. Several deliberately place a previously-blind-spot construct in their **equality spine** — deep bullet nesting (the outline), a nested `> >` blockquote (the reading notes) — so the typing≡loading guards exercise it on every run.

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

Engine lives in `src/lib/e2e/simulation/`; specs in `tests/simulation/` (requirements 1:1 in `requirements/simulation/`). Determinism comes from a single seeded PRNG — same seed ⇒ same gesture stream ⇒ same asserted state, so a failure is replayable. The tracker predicts only printable typing (per-keystroke `waitForSourceEquals`); every gesture that triggers editor auto-behavior (Enter, Tab, paste, resize, toggle) performs, settles on an observable predicate, then resyncs to observed state. Typing into a freshly-created item — whose marker only materializes on its first body char — is one such resync point, not a prediction, so the deep-nesting cadence (press-Enter → indent-empty-item → type-fresh-item) fits the same predict-printable / resync-after-auto-behavior principle.

**Multi-seed fuzzing.** A runner drives one note across many seeds, one test per seed. The seed selects the typo stream and which **net-identity detours** fire, so each seed is a distinct interleaving where transient-state bugs hide. `runSession` injects those detours — a pause that fences the undo batch, then select-delete-undo, then copy-paste-undo — each asserting byte-exact restoration of its pre-detour source. They exercise undo, selection, and clipboard mid-session while end-state equality still holds for every seed.

**Parallelism.** The `e2e-simulation` project runs `fullyParallel` across multiple workers — sessions are fully independent (own page, own seeded PRNG, no shared state), and the asserted artifact is the timing-independent source — so the full capture suite finishes in seconds (~20s on a typical machine).

**Running it:**

| Command                                     | Scope                                                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:e2e:simulation`               | The ungated oracle runs — smoke note, multi-seed fuzz, fenced-code/image session, loaded-table ops; all run in `npm test`.                        |
| `SIM_CAPTURE=1 npm run test:e2e:simulation` | Adds the gated capture suites (every note) — writes screenshots + per-checkpoint `manifest.json` to `simulation-captures/` for the visual review. |

### Agentic visual review

A capture run pairs each checkpoint screenshot with the known source at that moment (in `manifest.json`). What the user _sees_ — heading sizes, dimmed markers, bold/italic, list alignment, resized image width, the correct block kind — isn't easily asserted in code, so a vision-capable agent reviews it: open `manifest.json`, view each PNG alongside its `expectedSource`, and report rendering/structural mismatches by severity. This is **discovery + a periodic quality report, not a CI gate** (agent vision is subjective). Re-run after substantive editor changes. The simulation project pins a tall viewport so a long note stays in frame (the editor scrolls internally, so a short viewport would clip the note's tail).

Artifacts persist under `simulation-captures/seed-<N>/` (gitignored, one directory per seed). They live **outside** `test-results/` on purpose — Playwright wipes that directory at the start of every run, so captures kept there wouldn't survive the next test invocation the review needs them for.

## Performance Harness

Two layers measure editor performance over shared deterministic fixtures:

| Layer   | Runner                               | Command               | Measures                                                                                |
| ------- | ------------------------------------ | --------------------- | --------------------------------------------------------------------------------------- |
| Bench   | Vitest bench (`*.bench.ts`)          | `npm run perf:editor` | Parse / clone / ancestry-rebuild / snapshot-push timings → `perf-results/` (gitignored) |
| Browser | Playwright `e2e-perf` (`PERF`-gated) | `npm run perf:e2e`    | Fixture load wall-time + per-keystroke p50/p95 through real Chromium                    |
| Gate    | Playwright `e2e-perf` (`PERF_GATE`)  | `npm run perf:check`  | Keystroke p50 of the renderable 1MB rows vs baseline+tolerance — fails on regression    |

The browser and gate scripts arm their own env gates (`PERF` / `PERF_GATE`); outside them — e.g. the full `npm test` battery — the `e2e-perf` specs self-skip in seconds. Each browser row writes one JSON artifact to `perf-results/`; capped shape×size rows and measurement details live in `src/lib/e2e/requirements/perf/typing-latency.md`.

### Fixtures

`src/lib/test/perf/fixtures/generate.ts` builds six seeded shapes at any byte target — flat-prose, nested-containers, many-small-blocks, single-giant-paragraph, reference-heavy, table-heavy. Same (shape, size, seed) always yields identical bytes (golden-pinned), so numbers stay comparable across runs and machines.

### Instruments

`src/lib/perf/instruments.ts` hosts dev-mode counters: snapshot clone bytes, rebuild-depth histogram, parse timing, inline-refresh node counts, and an undo live-byte gauge. Recording is off until explicitly enabled, and the switch only arms under dev/Vitest — production builds pay one boolean check per record site.

On `/test/editor` the bridge exposes them as `__test.perf.enable()` / `.reset()` / `.snapshot()`, callable from DevTools or `page.evaluate`.

**Push-sampled gauge.** The undo gauge updates only when a snapshot is pushed — undo, redo, and clear do not refresh it. Read it as "live bytes as of the last push", not a live value.

### Threshold policy

| Kind                         | Examples                                       | Treatment                                                                                            |
| ---------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Machine-independent counters | Clone byte parity, container-raw amplification | Hard ceilings — fail the commit gate (`test:editor:perf`, part of `npm test`)                        |
| Keystroke p50 (≤1MB rows)    | nested / flat / reference / table 1MB          | Gated by `npm run perf:check` — deliberate, not in `npm test`; fails past baseline + `max(10%, 5ms)` |
| Other time rows              | Parse/clone bench ms, p95, 10MB rows           | Report-only vs `src/lib/test/perf/baseline.json` (machine metadata + rme/samples)                    |

Ceiling and baseline bumps are deliberate decisions with a changelog note, never reflexive edits.

**`perf:check` scope.** The dev machine is the pinned hardware — same-machine run-to-run p50 spread is a few percent, so an absolute baseline + tolerance catches regressions without a CI runner; re-bless the baseline after a Chromium/OS/toolchain bump moves the floor. It gates **steady-state** p50: a one-slow-keystroke regression (e.g. a first-edit full re-render) barely moves a 30-sample median, so that class is guarded separately by the `block-render-scoping` count assertion inside the fast `npm test` gate. p95 is reported, not gated — it catches single GC-pause keystrokes and is noisier.

**Dev-overhead caveat:** both layers run under DEV (Vitest / dev server) with invariant assertions active — every timing number is a conservative upper bound on production, not a production latency.

## Debug Panel

A collapsible side panel overlaid on the `/test/editor` route for ad-hoc debugging during dev sessions and for capturing snapshots in bug reports. It is not present in production builds.

**Toggle:** `Ctrl+Shift+D` / `Cmd+Shift+D`. `Escape` closes it when focus is inside the panel.

**Resize:** drag the panel's left edge. Minimum width 300px; width persists in localStorage alongside the open/expanded state.

Six collapsible sections:

| Section                     | Contents                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Raw source                  | Read-only view of the editor's live source (edit via the editor itself or `window.__test.setSource(md)` from DevTools) |
| CST tree                    | Compact text rendering of the full parsed block tree                                                                   |
| Selection                   | Live anchor/focus paths in both single-block (native DOM) and cross-block (SelectionState) modes                       |
| Undo stack                  | Top-N undo entries with type, selection snapshot, and timestamp                                                        |
| Inline tree (focused block) | Inline parse tree for the currently-focused prose block                                                                |
| Operations log              | Tail of the structural-operation ring buffer with op type, path, and elapsed time                                      |

**Copy all:** The header button concatenates every section into a fenced Markdown snapshot (timestamped) and writes it to the clipboard — paste directly into bug reports or AI conversations.

The underlying debug engine (`src/lib/debug/`) is internal — not exported from `src/lib/index.ts`.

### Debug engine from the console

The same helpers are wired to `window.__test` on the test route, callable from DevTools without opening the panel:

| Call                           | Returns                                              |
| ------------------------------ | ---------------------------------------------------- |
| `__test.dumpTree(opts?)`       | Compact text rendering of the parsed CST             |
| `__test.dumpSelection()`       | Current selection state as a one-line summary        |
| `__test.dumpInlineTree()`      | Inline tree for the currently-focused prose block    |
| `__test.dumpUndoStack(n?)`     | Top-N undo entries (default 10)                      |
| `__test.dumpOperationsLog(n?)` | Tail-N of the structural-op ring buffer (default 20) |

The existing test-bridge calls (`getSource`, `setSource`, `getBlockCount`, etc.) remain on `window.__test` alongside these helpers.

### Using the debug engine inside tests

Both Vitest and Playwright tests can reach the engine — the module is internal, not sealed. From a unit test, import directly:

```ts
import { dumpTree, dumpSelection } from '$lib/debug/inspect';
```

From an E2E spec, read through the bridge:

```ts
const cst = await page.evaluate(() => (window as any).__test.dumpTree());
```

**Diagnostic narration only — never assertion targets.** Drop these inside `console.log`, an assertion-failure message, or `test.info().annotations.push(...)` when you want to see what the CST looked like during a failure. Do NOT write `expect(dumpTree(doc)).toBe('[0] heading …')` — the output format is intentionally internal and may change without a deprecation notice, which would turn every formatter tweak into a test-suite churn wave. Assert on structured accessors instead: `getSource()`, `getBlockKind(i)`, `getSelectionPaths()`, or the CST directly.
