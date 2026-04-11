# Testing

Two test layers: **unit tests** (Vitest) for the CST and editor logic, and **E2E tests** (Playwright) for the editor in a real browser.

## Running Tests

```bash
npm run test:editor    # unit tests
npm run test:e2e       # E2E tests (auto-starts dev server)
```

Run a specific E2E suite:

```bash
npx playwright test e2e/tests/text-editing.spec.ts
```

Debug a failing E2E test in headed mode:

```bash
npx playwright test --headed --debug e2e/tests/text-editing.spec.ts
```

## Unit Tests (Vitest)

Location: `src/lib/editor/test/*.test.ts`

These test the CST parser, serializer, tree operations, inline parser, undo manager, merge rules, and container raw reconstruction. Pure TypeScript — no DOM, no browser.

The most important invariant: `serialize(parse(source)) === source` for all valid GFM.

## E2E Tests (Playwright)

Tests the editor component in a real Chromium browser via Playwright. No Tauri backend needed — the editor is self-contained.

### Architecture

```
Playwright test files
    ↓
EditorPage (page object — e2e/editor-page.ts)
    ↓
Test route (/test/editor) + test bridge (window.__test)
    ↓
Editor.svelte (production component, unchanged)
```

- **Test route** (`src/routes/test/editor/+page.svelte`): renders the Editor with a test bridge on `window.__test` exposing `getSource()`, `setSource(md)`, `getBlockCount()`, `getBlockKind(i)`.
- **EditorPage** (`e2e/editor-page.ts`): page object wrapping Playwright with editor-specific helpers for cursor positioning, text insertion, key presses, and state queries.
- **Test suites** (`e2e/tests/*.spec.ts`): organized by feature area.

### Test Suites

| Suite                          | Focus                                                       |
| ------------------------------ | ----------------------------------------------------------- |
| `smoke.spec.ts`                | Test harness, loadContent, empty documents                  |
| `text-editing.spec.ts`         | Typing, Enter split, Backspace merge, kind change           |
| `keyboard-navigation.spec.ts`  | Arrow keys across blocks, container traversal               |
| `undo-redo.spec.ts`            | Undo/redo for splits, merges, typing, kind changes          |
| `inline-editing.spec.ts`       | Bold, italic, code, links — editing and rendering           |
| `container-editing.spec.ts`    | Blockquotes, lists, nested editing, exit behavior           |
| `selection-clipboard.spec.ts`  | Cut, copy, paste, select-all, type-to-replace               |
| `code-block-editing.spec.ts`   | Code block typing, Enter, exit, navigation                  |

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

**Container edits need time to propagate.** Edits inside nested containers (list items, blockquotes) trigger debounced raw rebuilds up the chain. Use `waitForTimeout(200)` after edits before asserting on `getSource()`.

**Block selectors use `.block-list > *`.** The editor renders as `.editor > .block-list > [block elements]`. Individual blocks are children of `.block-list`, not `.editor`.

**Heading contenteditables include the `## ` prefix.** The block marker is rendered as a dimmed `.md-marker` span inside the contenteditable. `getBlockText(i)` returns the full text including the marker prefix.
