# Debugging

Something broke and you want to see what the editor is thinking. There are two pages for that.
[`codebase-map.md`](codebase-map.md) takes the behavior you watched break and names the file to
open. This one takes "what's the editor's state right now" and hands you a dump you can actually
read: the CST (the parsed block tree), the selection, the undo stack, the operations log. Reach
for these before you hand-trace anything. I've spent an hour proving something the dump would've
told me in a second, and I'd rather you didn't.

## Debug panel

A collapsible side panel on the `/` showcase and the `/test/editor` harness, closed until you
toggle it open. It's for poking at a live editor and for pasting a snapshot into a bug report. It
lives in the demo app (`src/routes/debug-panel/`), not in the published library.

**Toggle:** `Ctrl+Shift+D` / `Cmd+Shift+D`. `Escape` closes it while focus is inside it.
**Resize:** drag the left edge. Minimum 300px, and the width persists in localStorage next to the
open/expanded state (key `aragonite.debug-panel.state.v1`, should you ever want to wipe it).

| Section                     | Contents                                                                                                                                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Raw source                  | Read-only view of the live source. Edit it through the editor; on `/test/editor`, `window.__test.setSource(md)` in DevTools works too                                                                                        |
| CST tree                    | The live tree, then a reparse of `getSource()` under it, both as compact text. Where the two differ is usually the bug                                                                                                       |
| Selection                   | The anchor and focus paths. Read off the browser's own selection while the caret sits in one block, off the editor's selection state once it spans blocks                                                                    |
| Undo stack                  | The newest entries first, each with the selection it captured, then the undo and redo depths                                                                                                                                 |
| Inline tree (focused block) | The inline parse (text, strong, links, and so on) of the prose block the caret is in                                                                                                                                         |
| Operations log              | The tail of the structural-operation ring buffer: how long ago, which op, at which path, plus the op's own detail (`at=5` for a split)                                                                                       |
| Interaction trace           | A ring buffer of inline-layer transitions (rebuild, cursor capture and restore, pending cursor, reveal open and fold, widget pool, composition, islands, sticky column). Expanding the section is what turns the recorder on |

**Copy all as text** puts every section on the clipboard as one Markdown snapshot: a
`# Debug snapshot` heading with a timestamp, then each section under a `###` heading in its own
fence. Paste it straight into a bug report or an AI conversation.

The engine behind the panel is `src/lib/debug/`. It's internal and isn't exported from
`src/lib/index.ts`.

### From the console

On `/test/editor` the same helpers hang off `window.__test`, so you can call them from DevTools
without opening the panel:

| Call                              | Returns                                                                   |
| --------------------------------- | ------------------------------------------------------------------------- |
| `__test.dumpTree(opts?)`          | Compact text rendering of the live CST                                    |
| `__test.dumpSelection()`          | The current selection, one line (a few while the caret sits in one block) |
| `__test.dumpInlineTree()`         | Inline tree for the currently-focused prose block                         |
| `__test.dumpUndoStack(n?)`        | The top `n` undo entries, 10 by default                                   |
| `__test.dumpOperationsLog(n?)`    | The last `n` structural ops, 20 by default                                |
| `__test.dumpInteractionTrace(n?)` | The last `n` trace entries, 50 by default                                 |

The test-bridge calls (`getSource`, `setSource`, `getBlockCount`, …) live alongside them.

Here's what each one prints. The document is a heading, a paragraph with one bold word, and a
two-item list; the caret sits in the paragraph.

```
> __test.dumpTree()
[0] heading level=1 "# Hello"
[1] paragraph "Some **bold** text." trivia="\n"
[2] list kind=bullet children=2 trivia="\n"
  "- one
   - two"
  [0] listItem marker="- " children=1 "- one"
    [0] paragraph "one"
  [1] listItem marker="- " children=1 "- two"
    [0] paragraph "two"
```

One line per block: its index in its parent, its kind, whichever metadata is worth printing
(`level`, `marker`, `info`), `children=N` for a container, then its raw bytes in quotes. A
multi-line raw continues on the lines below, and `trivia` is the blank line above the block.
`dumpTree` reads the live tree rather than reparsing `getSource()`, so a block that drifted from
its own bytes shows up as it is. Two options: `{ maxRawChars: 8 }` truncates each raw
(`"Some **b…"`, 40 by default) and `{ showAllMetadata: true }` appends the whole metadata object
as `metaRaw={...}`.

```
> dumpSelection(selectionState)
anchor=[1]@5 focus=[1]@5 cross-block=false
```

`[path]@offset`: the path is the child indices from the document root down to the block
(`[2,1,0]` is the list's second item's paragraph), the offset a character index into that
block's raw. A cross-block selection adds its ordered ends:

```
anchor=[0]@2 focus=[2,1,0]@3 cross-block=true start=[0]@2 end=[2,1,0]@3
```

Those two are what `dumpSelection` from `$lib/debug/inspect` prints in a unit test, given the
editor's selection state. On the bridge, `__test.dumpSelection()` prints the same `[path]@offset`
pairs, with a few extra lines while the caret sits in one block: the mode, and the browser
range's own container and offset.

```
> __test.dumpUndoStack()
[0] selection=[1]@5→[1]@9
[1] selection=[0]@0→[0]@0
undo-depth=2 redo-depth=0
```

Newest first, each entry the selection it was pushed with (anchor→focus, or
`selection=gap[parentPath]#index` when the caret was parked in the gap between two blocks), then
the two depths.

```
> __test.dumpInlineTree()
text [0,5] "Some "
strong [5,13]
  text [7,11] "bold"
text [13,19] " text."
```

Kind, then `[start,end]` offsets into the block's raw, then the text of a text node; a link adds
`url=`.

```
> __test.dumpOperationsLog()
[0ms ago] op=split path=[1] at=5
[0ms ago] op=merge path=[2] direction=prev
```

Milliseconds since the op, the op, the path it hit, and the op's own detail where there is one
(`at` for a split, `direction` for a merge, `rowIdx` and `side` for a table row insert). These two
were recorded a moment before the dump, hence the zeros.

```
> __test.dumpInteractionTrace()
[0ms ago] text-render/rebuild changed=raw force=false
[0ms ago] text-render/cursor-capture walk=12
```

`site/kind`, then the entry's detail fields. An empty buffer prints `(no operations recorded)` or
`(no interactions recorded)`, and no selection prints `(no selection)`.

### Using the debug engine inside tests

Both runners can reach the engine; it's internal, not sealed.

```ts
// unit test
import { dumpTree, dumpSelection } from '$lib/debug/inspect';

// e2e spec
const cst = await page.evaluate(() => (window as any).__test.dumpTree());
```

**Diagnostic narration only, never an assertion target.** Put a dump in a `console.log`, an
assertion-failure message, or a Playwright annotation, so it shows you the CST at the moment of
failure and stays quiet otherwise:

```ts
// unit: the dump rides the message, so it only prints when the assertion fails
expect(doc.children.length, `after the split:\n${dumpTree(doc)}`).toBe(3);

// e2e: attached to the report, next to the failure
test.info().annotations.push({ type: 'cst', description: cst });
```

Don't write `expect(dumpTree(doc)).toBe('[0] heading …')`. The output format is internal and
changes without notice, and every formatter tweak would then churn the whole suite. Assert on
structured accessors instead: `getSource()`, `getBlockKind(i)`, `getSelectionPaths()`, or the CST
itself.
