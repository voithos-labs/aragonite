# Testing

Two test layers, both colocated with the editor source:

| Layer | Runner | Location | Scope |
|---|---|---|---|
| Unit | Vitest | `src/lib/editor/test/` | Pure logic — parser, serializer, tree ops, merge rules |
| E2E | Playwright | `src/lib/editor/e2e/` | User interactions in a real browser |

The entire editor module is self-contained: components, core logic, unit tests, and E2E tests all live under `src/lib/editor/`. If the editor is ever extracted, everything moves together.

## Running Tests

```bash
npm run test:editor    # unit tests
npm run test:e2e       # E2E tests (auto-starts dev server)
```

## Unit Tests (Vitest)

Pure TypeScript — no DOM, no browser. The most important invariant: `serialize(parse(source)) === source` for all valid GFM.

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
- **Test suites**: organized by feature area at the top level, and per-block inside `tests/blocks/`.

### Test Suites

Feature-level tests in `src/lib/editor/e2e/tests/`:

| Suite                          | Focus                                                       |
| ------------------------------ | ----------------------------------------------------------- |
| `smoke.spec.ts`                | Test harness, loadContent, empty documents                  |
| `text-editing.spec.ts`         | Typing, Enter split, Backspace merge, kind change           |
| `keyboard-navigation.spec.ts`  | Arrow keys across blocks, container traversal               |
| `undo-redo.spec.ts`            | Undo/redo for splits, merges, typing, kind changes          |
| `inline-editing.spec.ts`       | Bold, italic, code, links — editing and rendering           |
| `container-editing.spec.ts`    | Blockquotes, lists, nested editing, exit behavior           |
| `selection-clipboard.spec.ts`  | Cut, copy, paste, select-all, type-to-replace               |

Block-specific tests in `src/lib/editor/e2e/tests/blocks/` with requirements in `src/lib/editor/e2e/requirements/blocks/`:

| Suite                          | Focus                                                       |
| ------------------------------ | ----------------------------------------------------------- |
| `blocks/code-block.spec.ts`    | Code block typing, Enter, exit, navigation                  |
| `blocks/list-block.spec.ts`    | List rendering, Enter, Backspace, Tab, Shift+Tab, navigation |

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

**Test structural operations with container navigation, not just flat paragraphs.** Structural operations (split, merge, delete) shift block indices. Container blocks (blockquote, list) use their `index` prop in delegation chains when focus exits the container. A test that splits a paragraph and then navigates through flat paragraphs won't catch stale-index or stale-ref bugs — the delegation chain is only one hop deep. Always include a test that performs the structural operation and then navigates *through* a container block to verify the full delegation chain works. See "focus traversal after block insertion" in `tests/keyboard-navigation.spec.ts` for the pattern.

**Use "type and check where it appeared" for focus assertions.** `getSource()` serializes the CST, which is always correct regardless of focus state. To verify where focus actually landed after a navigation operation, type a marker character and assert on its position in the source. `getSource()`-only assertions can't detect focus bugs.

**Container edits need time to propagate.** Edits inside nested containers (list items, blockquotes) trigger debounced raw rebuilds up the chain. Use `waitForTimeout(200)` after edits before asserting on `getSource()`.

**Block selectors use `.block-list > *`.** The editor renders as `.editor > .block-list > [block elements]`. Individual blocks are children of `.block-list`, not `.editor`.

**Heading contenteditables include the `## ` prefix.** The block marker is rendered as a dimmed `.md-marker` span inside the contenteditable. `getBlockText(i)` returns the full text including the marker prefix.
