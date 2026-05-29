# Testing

Two test layers, both colocated with the editor source:

| Layer | Runner     | Location               | Scope                                                  |
| ----- | ---------- | ---------------------- | ------------------------------------------------------ |
| Unit  | Vitest     | `src/lib/editor/test/` | Pure logic — parser, serializer, tree ops, merge rules |
| E2E   | Playwright | `src/lib/editor/e2e/`  | User interactions in a real browser                    |

The entire editor module is self-contained: components, core logic, unit tests, and E2E tests all live under `src/lib/editor/`. If the editor is ever extracted, everything moves together.

## Running Tests

```bash
npm run test           # full suite
npm run test:editor    # all unit tests
npm run test:e2e       # all E2E tests (auto-starts dev server)
```

### By category

Unit tests can be scoped to a single concept area:

| Script                       | Covers                                                     |
| ---------------------------- | ---------------------------------------------------------- |
| `test:editor:core`           | Parser, serializer, round-trip invariants                  |
| `test:editor:tree-ops`       | Tree mutation helpers                                      |
| `test:editor:editor-actions` | Editor action bundles and commit primitives                |
| `test:editor:ambient`        | Ambient-marker DOM and offset translation                  |
| `test:editor:cursor`         | Cursor utilities, sticky column, overlay rect measurement  |
| `test:editor:schema`         | Block-kind descriptors, container raw rebuild, merge rules |
| `test:editor:reactivity`     | Block-list state and state registry                        |
| `test:editor:selection`      | Selection-state logic                                      |
| `test:editor:blocks`         | Per-block unit tests (code block, etc.)                    |
| `test:editor:image`          | Image dimensions, resize, source bytes, widget selection   |
| `test:editor:undo`           | Undo stack and entry management                            |
| `test:editor:debug`          | Debug engine helpers and operations log                    |

E2E tests are grouped into Playwright projects:

| Script                       | Covers                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `test:e2e:top`               | Top-level specs — smoke, text editing, keyboard nav, undo, inline, containers |
| `test:e2e:blocks`            | All per-block specs under `tests/blocks/`                                     |
| `test:e2e:blocks:list`       | List block specs only                                                         |
| `test:e2e:blocks:code`       | Code block specs only                                                         |
| `test:e2e:blocks:image`      | Image block specs only                                                        |
| `test:e2e:blocks:table`      | Table block specs only                                                        |
| `test:e2e:blocks:blockquote` | Blockquote block specs only                                                   |
| `test:e2e:clipboard`         | Cut / copy / paste (excludes exploration)                                     |
| `test:e2e:exploration`       | Clipboard exploration / manual-verification scenarios                         |
| `test:e2e:selection`         | Cross-block selection behavior                                                |
| `test:e2e:sticky-column`     | Vertical cursor column tracking across block transitions                      |

## Unit Tests (Vitest)

Pure TypeScript — no DOM, no browser. The most important invariant: `serialize(parse(source)) === source` for all valid GFM.

Unit tests live under `src/lib/editor/test/`, mirroring the source tree one-for-one (the leading `components/` segment is elided — `components/blocks/list/X.ts` maps to `test/blocks/list/X.test.ts`). Cross-cutting tests for top-level editor services (`round-trip`, `round-trip-complex`, `round-trip-task-items`, `editor-events`, `append-block-event`) stay at `test/` root because their SUTs sit at the editor root. When a SUT moves into a subdirectory the test follows — e.g. the undo manager lives at `undo/manager.ts` and its test at `test/undo/manager.test.ts`. Vitest discovers `*.test.ts` anywhere under the root, so no config change is needed. The top-level tests run only via the full `test:editor` suite; every other area has a dedicated `test:editor:<area>` script (see `package.json`).

Tests that import a sub-path directly (e.g. `tree-operations/list/m1-contract` rather than the `tree-operations` barrel) mirror at the deeper path — `test/tree-operations/list/m1-contract.test.ts`. Test directory depth follows import depth, not just the directory the SUT lives in.

## E2E Tests (Playwright)

Tests the editor component in a real Chromium browser. No Tauri backend needed — the editor is self-contained.

### Architecture

```
Playwright test files
    ↓
EditorPage (page object — src/lib/editor/e2e/editor-page.ts)
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

Feature-level specs live in `src/lib/editor/e2e/tests/` and cover: test-harness smoke, text editing (typing / split / merge / kind change), keyboard navigation (arrow keys, container traversal, sticky column), undo/redo, inline editing (bold / italic / code / links), container editing (blockquotes, lists, nested structure, exit behavior), and selection + clipboard (cut / copy / paste / select-all).

Requirement files in `src/lib/editor/e2e/requirements/` pair one-to-one with spec files under `src/lib/editor/e2e/tests/`. When a subdirectory's specs split further (e.g. `tests/sticky-column/` into several files), the requirements split with them. The filesystem is the authoritative list of what's covered — if a spec has no requirement file or vice versa, one or the other is out of lockstep.

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

**Use `insertText`, not `type`, for multi-character input.** Playwright's `keyboard.type()` sends one character at a time. The editor's inline re-rendering pipeline resets the cursor after each character, causing reversed text. Use `editor.typeText(text)` (which calls `keyboard.insertText()`) instead — it fires a single input event.

**Use `focusBlockEnd` / `focusBlockStart` for precise cursor placement.** These use `evaluate()` to set the cursor via the Selection API. The native `End`/`Home` keys work for simple cases but can be unreliable with inline-rendered spans.

**Use `getDomBlockCount()` for structural assertions after split.** The test bridge's `getBlockCount()` re-parses the serialized source, which may absorb empty blocks as whitespace. `getDomBlockCount()` counts DOM elements, reflecting the editor's true internal state.

**Test structural operations with container navigation, not just flat paragraphs.** Structural operations (split, merge, delete) shift block indices. Container blocks (blockquote, list) use their `index` prop in delegation chains when focus exits the container. A test that splits a paragraph and then navigates through flat paragraphs won't catch stale-index or stale-ref bugs — the delegation chain is only one hop deep. Always include a test that performs the structural operation and then navigates _through_ a container block to verify the full delegation chain works. See the "focus traversal after block insertion" pattern under `tests/keyboard-navigation/`.

**Use "type and check where it appeared" for focus assertions.** `getSource()` serializes the CST, which is always correct regardless of focus state. To verify where focus actually landed after a navigation operation, type a marker character and assert on its position in the source. `getSource()`-only assertions can't detect focus bugs.

**Container edits need Svelte's reactivity cycle to settle.** After typing inside a nested container (list item, blockquote), Svelte's reactive `$effect`s and post-tick commits must flush before `getSource()` reflects the new state. Wait via `editor.bridge.waitForSourceContains('expected')` (or one of the other `waitForSource*` / `waitForBlockCount` predicates) — they poll until the assertion would pass and stop immediately. `waitForTimeout` is reserved for genuinely time-dependent waits (sticky-column layout settle, copy-only clipboard verification) and should be commented inline when used. Raw rebuilds themselves are synchronous — the wait is for reactivity and render flush, not for a debouncer.

**Selector helpers live in `EditorPage`.** Each block sits inside a `.block-host` positioning container alongside its `SelectionOverlay` sibling — `getBlock(i)` skips the overlay sibling. Write tests against the helpers; reach for raw selectors only when adding a new helper.

**Marker prefixes count toward block text.** Headings, list items, and other ambient-marker blocks render their markers as dimmed spans inside the contenteditable. `getBlockText(i)` returns the full text including the marker.

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

The underlying debug engine (`src/lib/editor/debug/`) is internal — not exported from `src/lib/editor/index.ts`.

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
import { dumpTree, dumpSelection } from '$lib/editor/debug/inspect';
```

From an E2E spec, read through the bridge:

```ts
const cst = await page.evaluate(() => (window as any).__test.dumpTree());
```

**Diagnostic narration only — never assertion targets.** Drop these inside `console.log`, an assertion-failure message, or `test.info().annotations.push(...)` when you want to see what the CST looked like during a failure. Do NOT write `expect(dumpTree(doc)).toBe('[0] heading …')` — the output format is intentionally internal and may change without a deprecation notice, which would turn every formatter tweak into a test-suite churn wave. Assert on structured accessors instead: `getSource()`, `getBlockKind(i)`, `getSelectionPaths()`, or the CST directly.
