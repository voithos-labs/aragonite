# Debugging

The debug panel, the console helpers it mirrors, and how to use the debug engine from inside a
test. Reach for these before you hand-trace editor state.

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

**Copy all** concatenates every section into a timestamped fenced Markdown snapshot on the clipboard. Paste it straight into a bug report or an AI conversation.

The debug engine itself (`src/lib/debug/`) is internal, and not exported from `src/lib/index.ts`.

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

**Before you hand-trace editor state, dump it.** Both runners can reach the engine; it is internal, not sealed. Hand-tracing a CST from memory is how you spend an hour proving something the dump would have told you in a second.

```ts
// unit test
import { dumpTree, dumpSelection } from '$lib/debug/inspect';

// e2e spec
const cst = await page.evaluate(() => (window as any).__test.dumpTree());
```

**Diagnostic narration only, never an assertion target.** Drop these into a `console.log`, an assertion-failure message, or `test.info().annotations.push(...)` when you want to see what the CST looked like at the moment of failure. Do **not** write `expect(dumpTree(doc)).toBe('[0] heading …')`: the output format is intentionally internal and may change without notice, which would turn every formatter tweak into a suite-wide churn wave. Assert on structured accessors instead: `getSource()`, `getBlockKind(i)`, `getSelectionPaths()`, or the CST itself.
