# Editor design spec

The orientation point for the whole design tree. The first three sections (What this is, The shape of it, Data flow) orient any task; after that it's per-subsystem reading, and each subsystem's own spec goes deeper than this one does. Nobody reads this end to end (please don't), so jump:

| Section                                                                 | What's in it                                                                                          |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [What this is](#what-this-is)                                           | the one promise the editor is built on, and the four rules that fall out of it                        |
| [The shape of it](#the-shape-of-it)                                     | the parse, render, serialize loop, the components that run it, and six terms the rest of the doc uses |
| [Data flow](#data-flow)                                                 | how an edit travels from a block to the tree and back to the screen                                   |
| [The editing surface](#the-editing-surface)                             | what a block is made of while you edit it, and how a caret lands in one                               |
| [Schema](#schema)                                                       | the per-block-type metadata: how a kind merges, what its keys do, and the registries that hold it     |
| [CST ↔ DOM synchronization](#cst--dom-synchronization)                  | how the tree and the browser's editable text stay in agreement while you type, on every engine        |
| [CST mutability and reactive state](#cst-mutability-and-reactive-state) | who may change the tree, and the three rules that keep Svelte's reactivity honest                     |
| [Serialization](#serialization)                                         | how a document becomes text again                                                                     |
| [Block identity](#block-identity)                                       | the stable ids that keep rendering and focus pointed at the right block                               |
| [Block kinds](#block-kinds)                                             | every built-in block type and how the editor treats it                                                |
| [Extension points](#extension-points)                                   | where plugins attach; a pointer, since the real spec lives elsewhere                                  |
| [Standing directions](#standing-directions)                             | four watch-outs for future work                                                                       |

Three subsystems have docs of their own:

- [`structural-edits.md`](structural-edits.md): every edit that adds, removes or moves blocks (split, merge, delete, reorder) and the keys that trigger it, plus the containers (quotes, lists, tables) and what nesting costs
- [`commit-and-undo.md`](commit-and-undo.md): one undo stack with snapshots that share memory with the live document, the commit every structural edit runs through, and the events a host can subscribe to
- [`selection.md`](selection.md): selection inside one block and across blocks, find and replace, and copy, cut and paste

## What this is

aragonite is a block editor for GFM Markdown. You hand it Markdown, it shows you a stack of styled, editable blocks with the syntax still on screen (`##` and `**` are there, just dimmed), and it hands the same bytes back. The one idea the rest of this doc hangs off: there's no rich-text model in the middle that Markdown gets exported from. The parser cuts your source into a tree whose every node holds its own slice of the original text, the blocks render from those slices, and saving glues the slices back together. Nothing gets rewritten into a canonical form on the way through. As a formula:

```
serialize(parse(source)) === source     for all valid GFM
```

And it's the rule every layer here obeys:

> **Slice bytes from `raw`. Never reconstruct them from parsed structure.**

`raw`, here and everywhere below, is a node's verbatim source bytes, markers included. The block layer follows the rule (a container's `raw` holds its own outer syntax, so serializing is concatenation, not reassembly), and so does the inline layer (a `**` marker in the DOM is `raw.slice(...)`, never a `**` printed because the node said "strong"). Every round-trip bug this project has had was some code path deciding it could rebuild bytes it should've copied.

Four design principles:

- The CST (concrete syntax tree: the parse tree that keeps every byte) decides structure. If the tree and the DOM disagree, the tree wins.
- Each block is an independent editing unit with its own rendering surface.
- Cross-block coordination flows through a small, typed interface. No signal bus, no runtime patching.
- Adding a block type is additive: a component, a descriptor, a registration. A genuinely new cross-cutting capability lands once, at the one place every path crosses, and every later kind inherits it. The bug to refuse is shell, orchestration, or selection code branching on a specific kind name.

## The shape of it

```
Raw Markdown ──parse──▶ CST (mutable plain objects, the single source of truth)
                          │ render                      ▲
                          ▼                             │ serialize
                        Contenteditable DOM (styled spans, dimmed markers)
```

The component tree mirrors the tree of blocks:

```
Editor  (shell: owns the CST, the undo stack, the editor-actions contexts)
  └─ BlockList  (keyed loop over a node's children; windows itself when large)
       └─ BlockHost  (resolves a component by node.kind; hosts the overlays)
            ├─ leaf blocks  (TextEditableBlock, CodeBlock, ThematicBreakBlock, ...)
            ├─ containers  (BlockquoteBlock / ListBlock → ListItemBlock: nested BlockList; TableBlock: per-cell grid)
            └─ plugin blocks  (containers, editable leaves, opaque blocks)
```

`Editor` owns the document, the undo stack and the action contexts, and it manages focus after a structural operation with `await tick()`. `BlockList` is the one rendering primitive, reused at every nesting level; a large one renders only a windowed slice ([`virtual-rendering.md`](virtual-rendering.md) is the windowing spec). `BlockHost` resolves the component for a node's kind, and it also mounts the two per-block overlays (selection, and decorations, which is what search paints through), the drag handle when the consumer asked for one, and a `<svelte:boundary>` that degrades a throwing block to a readable fallback instead of taking the document down. A kind with no registered component renders as a raw-editable text surface rather than as nothing.

Six terms the rest of this doc leans on:

| Term             | Meaning                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `raw`            | a node's verbatim source bytes, markers included; what serialization reads                                                        |
| kind             | the string on a node that says what block it is (`'paragraph'`, `'table'`, a plugin's own name); every registry lookup keys on it |
| leaf / container | a container holds child nodes (blockquote, list, listItem, table, tableRow, plugin containers); a leaf doesn't                    |
| descriptor       | the per-kind metadata record: how it merges, edits, renders (§ Schema)                                                            |
| scope            | one block list and its children; the unit of addressing and windowing, and the unit a commit operates on                          |
| path             | child indices from the document root down to a block; how everything off the render path addresses one                            |

The first three are visible in any parsed document. A blockquote followed by a paragraph, trimmed to those fields:

```ts
parse('> quoted\n\nplain\n').children;
// [
//   { kind: 'blockquote', leadingTrivia: '', raw: '> quoted\n',
//     children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'quoted\n' }] },
//   { kind: 'paragraph', leadingTrivia: '\n', raw: 'plain\n' }
// ]
```

The inner paragraph's path is `[0, 0]` and the outer one's is `[1]`. `leadingTrivia` is the blank line that separated them, kept on the block below it so no byte goes missing. Nodes carry a few more fields (`metadata`, for one); `syntax-tree.md` § Node shape has them all.

## Data flow

A block notices a boundary event (Enter, Backspace at offset 0, an arrow at an edge) and calls a typed context function. The editor shell mutates the tree, Svelte reactivity re-renders the affected blocks, and after `await tick()` the shell calls `focus()` on the target block. Four channels, and only four:

| Direction      | Mechanism                                      | What flows                                        |
| -------------- | ---------------------------------------------- | ------------------------------------------------- |
| Block → Editor | Context callbacks (editor-actions sub-bundles) | Boundary events: split, merge, delete, move focus |
| Editor → CST   | Direct tree mutation                           | Structural change                                 |
| CST → Blocks   | Svelte reactivity                              | Blocks re-render from the new tree                |
| Editor → Block | Component refs (`bind:this`)                   | `focus(offset)` after a structural op             |

The context function is one member of an action bundle (a set of functions the editor hands its blocks through Svelte context). The one for editing blocks is `src/lib/action-contracts.ts` :: `BlockEditActions`, and each member's docstring says what it promises. A member's `blockIndex` is always relative to the calling block's own list, never the document. Every member resolves to whether bytes landed, so a focus move that writes nothing (say, `descendToBody` onto a block that's already there) resolves `false`.

The one a block reaches for most, `updateBlockContent(blockIndex, text, mode, preEditOffset, postEditFocusOffset?)`, hands back the write's promise with a bit more on it, readable the moment the call returns. `admitted` says whether the write got through at all (reading mode turns it away, and so does a block with no text of its own, like a list), and only an admitted write has a caret. That's `caret`, the landing offset counted in the bytes as stored (the kind's write rule can move it, § The block-kind descriptor), and `keepsCaret`, which is false when the write puts the caret somewhere itself (a new kind, a merge into the block above, a container that changed kind).

```ts
const write = blockEdit.updateBlockContent(index, 'Hello!\n', 'authored', 5, 6);
if (write.admitted && write.keepsCaret) requestCaret(write.caret); // 6, unless a rule moved it
await write; // true once the bytes are in
```

A block's own editable element doesn't call it by hand for typing, though. The input read-back, the keys a surface types for you (an auto-pair's partner, a Tab) and a plugin source's commit all go through one call, `src/lib/components/blocks/editable/surface-write.ts` :: `writeText`. You hand it the new text, where the caret goes and whether it's typing or a command (`history`, `commit-and-undo.md` § Undo / redo), and it picks where undo will put the caret, keeps the block's line ending, and puts the caret back.

If you add a new place that reads the browser's own edits back, pass them through `src/lib/core/line-ending-pairs.ts` :: `keepLineEndingPairs` first, since WebKit and Firefox will happily put a typed letter between a CRLF's `\r` and `\n` (G1.117 warns when a pair gets split anyway).

A few commands (the format toggle, a cut inside one block) still call `updateBlockContent` themselves and keep the line ending through `withOwnEnding` from the same file. A paste inside one block goes through the paste dispatch instead (`docs/design/selection.md` § The paste pipeline).

`structural-edits.md` § Orchestration says who provides these bundles, and § Containers there says what a local index means inside a container.

## The editing surface

Markdown syntax is on screen by default, styled: markers dimmed, content styled by what it means, one rendering path per block type. That isn't a stepping stone to something else. The alternative (an authoritative inline tree, with `raw` derived from it) was evaluated and rejected, and the appendix of [`syntax-tree.md`](syntax-tree.md) has the post-mortem.

The presentation modes sit on top of that as view treatments over the same render path. `presentationMode` is `'source'` (the default, and the editing substrate), then `'reading'`, `'preview-block'`, `'preview-inline'` and `'live'`. Marker visibility flips via CSS keyed on focus and caret proximity, so no mode can break the round-trip. A mode that hides the markers at the caret does change editing, though: where a caret may sit (a code block's fence lines included), and how a few rewrites write their bytes (a format toggle, a paste, a split or join, the delimiter auto-pair).

A press is the one wrinkle: the browser focuses the block first and only then works out where the caret goes, so the markers wait for the button (or a tap's late mouse press) to come up, or they'd move the text under the pointer (`src/lib/components/editor-root/focus.ts`). How a plugin reads the mode is in `plugin-contract.md` § Presentation-mode reads.

Live mode hides every marker standing over content and stays editable, which turns the hidden runs into a caret problem rather than a paint one: a hidden run paints nothing, so one screen position names two raw offsets. Two mechanisms answer that:

- **The edge rule** says which side such a boundary means: the letter takes the format of the visible character before it, the way a word processor does, unless a record says otherwise (a fresh start after Enter or a click past a line's end, a typed closer, a held space, Edit link's caret in a URL, a code chip's stop). Every insertion reads it in the same write, so a key, a soft keyboard, an IME commit and a paste all land on the same side (`caret-placement.md` § 6 walks it, `live-mode.md` § 4.2 has the rules).
- **The inline-construct policy table** is where each construct declares what its own delimiters do: which side a typed byte lands on, whether emptying it unwraps, how a split treats it, whether it reveals its source to an entering caret (§ Atomic inline widgets). Every reader takes one row instead of testing a kind (`schema/inline-construct-policy.ts`).

The records live in the **caret memory** (`caret/caret-memory.ts`), the one place that keeps what the caret means beyond its offset. It also keeps the sticky column (`structural-edits.md` § Focus traversal), the pending marks, the pending break (next subsection), the held space and Edit link's caret in a URL, and a caret move that isn't a key forgets them all together.

The full editing-rule catalog is [`live-mode.md`](live-mode.md).

### Shift+Enter at the end of a block

A hard break in Markdown is a backslash at the end of a line, and a backslash with no line after it is just a backslash. So Shift+Enter at the end of a block's text writes nothing yet. It opens an empty line under the text, in every mode that edits, puts the caret on it, and leaves a record in the caret memory, the pending break (`src/lib/caret/pending-break.svelte.ts`).

The next insertion writes the break in front of itself, whichever way it arrives (a typed key, text the browser put in, an IME commit, a paste), as one write and one undo entry. The line goes, with no byte left, as soon as the caret leaves it, and Delete, a click, blur, an undo, a mode switch and a document swap end it too.

Every route spends the pending break in one place. While `writeText` (§ Data flow) writes, it holds whatever the caret memory keeps for its block (`src/lib/caret/next-insertion.ts` :: `createInsertionRecords`). A composition and a paste have to clear the caret memory before they write, so they take the hold earlier, for the whole gesture. The pending marks (`live-mode.md` § 4.3), the pending break, the held space and Edit link's caret in a URL (`live-mode.md` § 4.2) are the kinds of record in that list, so another kind is one more entry every route picks up.

Once the break is written it's ordinary bytes, until you delete everything after it. Then the bytes would end on a backslash with nothing after it, which a reload reads as a plain backslash, so the write drops the break with that text (`src/lib/tree-operations/content-write.ts` :: `droppedOpenLines`, for every prose block on every route). If the caret was on that line, it goes back to being a pending break, caret and all, whether the text went by Backspace, a word delete or a cut: the block's own `updateBlockContent`, which all of those write through, opens it again (`src/lib/components/blocks/editable/editable-surface.ts`). Type and the break comes back; leave the line and it's gone.

Shift+Enter anywhere inside the text still writes its `\` and line ending right away. Both routes get their bytes from one writer, `src/lib/core/inline/index.ts` :: `withHardBreak`.

Outside prose, Shift+Enter is a code block's newline with no indent (`code.softBreak`) and a table cell's `<br>` (`cell.lineBreak`), since a cell can't hold a line ending. Each is a keymap binding, so the keydown decides the key whatever input the browser would've sent for it (Playwright's WebKit sends `insertParagraph`, Chromium `insertLineBreak`). A soft keyboard's `insertLineBreak` with no keydown in front runs the same command, and one that turns up while the Enter keydown's own handler is still running writes nothing, since that handler writes the break (G4.216).

### A line break over a selection

Over a selection inside one block, Enter and Shift+Enter take the selection out first, the way Backspace would, then break the line where it started, as one undo entry. It never leaves the block: the "Enter on an empty line" exits and the Enter completions (`structural-edits.md` § Structural operations) answer to the block as it was when you pressed the key, so a line the removal just emptied doesn't count.

The command dispatch asks the block's `afterSelectionRemoved` to take the selection out before it runs any command in `src/lib/schema/commands.ts` :: `AFTER_SELECTION_REMOVAL_COMMAND_IDS`, then tells the command a removal came first, so the exits stand down. A block can decline the removal (a code block does, for a range that only covers fence lines the mode hides), and then the command doesn't run at all. Same goes for a removal whose bytes don't land. A plugin command opts in with `overSelection` and reads `ctx.afterRemoval`. A line break that comes in as input rather than as a command (a soft keyboard's `insertLineBreak`, an editable leaf's own Enter) asks for the same removal itself.

### Three block surfaces

A block picks its own editing surface, and three exist:

- **`TextEditableBlock`.** The built-in contenteditable prose surface: paragraphs, headings, setext headings, and the raw-editable fallback. Parameterized by CSS class.
- **`createEditableLeaf`.** The plugin-facing text-leaf factory, with the same native caret, IME, undo, clipboard and cross-block-selection behavior as the built-in. Two modes: `plain` (always editable, commits per keystroke) and `render-primary` (a rendered view that reveals its source on entry and commits once on blur). A `singleLine` leaf spends Enter on a block split rather than a literal newline.
- **`createContainerBlock`.** The plugin-facing container factory: a nested `BlockList` with its own scoped contexts, wired exactly as `BlockquoteBlock` wires it. The built-in list, list item, table and table row share its children's actions directly (`src/lib/editor-actions/nested/container-actions.ts` :: `createContainerActions`).

Beyond those, a block may render anything (a grid of cells, a static focusable element, an opaque diagram). It only has to conform to the block interface below, and not every block needs contenteditable. Images aren't a block kind at all: they render inline, as atomic widgets inside prose blocks (§ Atomic inline widgets).

### The block interface

Every block component exposes a common shape. `src/lib/block-component.ts` is authoritative, each member's docstring stating its own contract, and the required core is four members:

```ts
focus(offset: number): void    // place the caret; also ends any live cross-block range
getCursorOffset(): number | null
readonly editable: boolean     // a report: mirrors the descriptor's editable declaration
readonly focusable: boolean    // the flag focus dispatch reads before landing anything
```

Everything else is optional, and a block implements what its surface can honestly answer: selection reads (`getSelectedText`, `setSelection`), pixel-column landing (`focusAtColumn`), selection-rect measurement (`measurePartialRects`, `docs/design/selection.md` § Cross-block selection), path descent for nested surfaces (`focusByPath`), command dispatch (`runCommand`), and `afterSourceCommit` for a block that can show a source the tree hasn't seen yet, so a command from outside it waits until that source is written. Every editable surface also publishes `afterSelectionRemoved` (§ A line break over a selection), `insertMarkdown` and `typeText`; the list is `src/lib/block-component.ts` :: `EDITABLE_SURFACE_MEMBERS`.

**Caret placement is two verbs.** `focus` places a caret and ends any live cross-block range. That's the safe default, since a caret landing inside a range left live is content the next keystroke type-replaces. The optional `parkCaret` is the same landing _without_ the range-ending, and it's for the selection-extend paths only, where the dispatcher parks a caret in an endpoint it has just revealed (to reveal a block: mount it while it's off screen, so its DOM exists before something touches it) while the extend is still growing the range. Its callers are an allowlist a lint holds.

The caret surface reads as three layers, and a new gesture composes them rather than adding a verb:

1. **Landing.** Place a caret, one entry per addressing mode: `focus` and `parkCaret` (raw offset), `focusAtColumn` (editor-relative pixel X on the first or last visual line that can show a caret, with park semantics), `focusByPath` (descent to a nested leaf). Every implementation is built on the same `placeCaret` core (`selection/place-caret.ts`), so the range-ending policy lives in one place.
2. **Point resolution.** Turn a viewport point into a landing first. A kind that resolves a point through its own DOM answers through the `caretTargetAtPoint` descriptor hook: a table names a cell, and a render-primary leaf names the source offset under its rendered view. Its sibling `foreignDragHitTest` answers the same question for a drag. A point inside a text element becomes an offset in `src/lib/browser/point.ts`, the one place for that; a plugin leaf's hook usually calls its `caretOffsetAtPoint`, which is on the plugin barrel.
3. **Boundary policy.** Where a landing meets an atomic widget (§ Atomic inline widgets). `enterEdgeWidget` takes a keyboard arrival at the widget a block draws first or last (a vertical arrival at a widget-only block too), and `readSnapAtPoint` refines a click after it lands beside or on a widget, from the point read before the caret went down. Both dispatch the kind's one registered `InlineWidgetEditingPolicy`.

[`caret-placement.md`](caret-placement.md) walks one click through all three layers, and then through what the caret does on the next keystroke, one file per stage.

A block publishes the shape one of four ways, and `BlockHost` resolves them all at the single point it stores a ref (`resolveBlockSurface`): a hand-built leaf as its own instance exports, a plugin leaf built on `createEditableLeaf` under one `blockApi` export, a container under one `containerApi` export, and a block drawn by `defineBlockView` through its host's `viewRef`. The two factories hand their surface over as one object because Svelte 5 instance exports can't be spread. `svelteBlockView` types the first three shapes as a union, so a block publishing none of them doesn't compile. A DOM view reaches BlockHost as one more component, `DomBlockHost`, which `blockViewEntry` picks from the view's form, so BlockHost holds no branch for it. The host builds the leaf or container surface the view asked for and publishes that. A view drawn whole publishes the members its handle has, out of the ones `MEMBER_SOURCES` lets a view supply.

## Schema

Cross-cutting block-kind metadata lives in `src/lib/schema/`, and both `core/inline/` and `tree-operations/` read it. It isn't the only thing those two share (`core/` and `perf/` are too), but it's the one carrying the kind vocabulary, which is why a cross-cutting block-kind fact belongs here.

How it sits in the import graph:

- The schema imports nothing from `tree-operations/`, which reads it.
- It does import from `core/`, `core/inline/` included, and `core/` imports it back, since each reads the other's registries. None of those imports closes a loop, though. `src/lib/test/invariants/lint/directory-layering-baseline.ts` lists every import edge between directories, and the directory cycles still waiting to be broken.

### The block-kind descriptor

Each kind registers once. A plugin kind goes through `registerBlockKind`, which takes its `view` in the same call. A built-in goes through `registerBuiltinBlockKind` in `src/lib/schema/built-in-descriptors.ts` and gets its view later. Here's a built-in leaf, trimmed to the fields this doc talks about:

```ts
registerBuiltinBlockKind('thematicBreak', {
	pageRole: 'object',
	estimateHeight: singleLineEstimate,
	mergeRole: 'not-mergeable',
	editable: false,
	supportsInline: false,
	blockFocus: 'whole-block',
	gapEdges: 'before'
	// closure, conformanceFixture, ...: plugin-contract.md § The descriptor field reference
});
```

No `keymap` there, and it still moves on Alt+ArrowUp/Down: a whole-block kind gets those two reorder chords added whenever its keymap is read, unless it binds them itself (`schema/commands.ts`).

And a container, which carries one extra group:

```ts
registerBuiltinBlockKind('blockquote', {
	pageRole: 'prose',
	estimateHeight: containerEstimate,
	mergeRole: 'container',
	editable: true,
	supportsInline: false,
	gapEdges: 'none',
	container: {
		contract: 'strip',
		rebuildRaw: rebuildBlockquoteRaw,
		containerPaste: { matchesAncestor: () => true, siblingAbsorb: false },
		unwrapRole: { firstChildBackspace: 'lift-first-child-drop-opener', middleChildBackspace: 'default-merge' },
		contentStartSpace: 'complete-marker',
		reorderChildren: {}
	}
});
```

Every field, and what leaving it out means, is in `plugin-contract.md` § The descriptor field reference. One pair is worth knowing here. `rawWrite` is a kind's rule for its own bytes, and `bodyWrite` is a container's rule for a child's. Every content write runs the block's rule, then its container's (`tree-operations/content-write.ts :: legalizeWrite`), and hands the caller a caret that's already been moved to match, so no block has to map a caret by hand.

The group is why an illegal leaf/container mix is a compile error rather than a runtime surprise: `contract` and `rebuildRaw` are required together inside it, and `isContainer` is derived from the group's presence, never declared.

### Commands and keybindings

A kind's `keymap` maps a chord to a command id. Registration checks each chord and stores it normalized (`schema/keybindings.ts` :: `registeredChord`), so a mistyped `Ctrl+B` throws there instead of turning into a bare `B`. A keypress gets the same normal form (`eventToChord`), and `Mod` folds Ctrl and Cmd into one token, so a binding is `{ chord: 'Mod+B', command: 'format.toggleStrong' }` on every platform; why nothing in the tree detects the platform, and what that costs the test harness, is `docs/contributing/codebase-map.md` § Keyboard and chords. Global commands (undo/redo, a plugin's registered global) are free functions rather than per-kind entries. What still reads keys by hand is what a keymap can't carry: handling that depends on where the caret is (a block edge, a widget, a table cell) and transient UI (an open menu, the search bar, the link card). Every such file is listed in `src/lib/schema/reserved-chords.ts` :: `HARDCODED_CHORD_SITES`.

A focused leaf resolves a chord through the consumer's overrides first, then three keymap tiers (`schema/commands.ts` :: `resolveBinding`):

1. an override on the kind (the `keybindings` prop, scoped by `kind`), then an override on the global table,
2. the kind's own keymap,
3. the editor-global keymap,
4. the plugin-global tier, where a plugin's `registerGlobalCommand` binds its chord.

Override source beats specificity, so a consumer disabling a chord globally suppresses one a kind defines; and a plugin's global chord never beats a built-in one, on any kind.

The resolved id is then spent on three tiers in order: the global table; a registered `(kind, id)` block command (created by the one authorized registration, where a duplicate throws), which runs its own registered handler; and the built-in vocabulary on the focused component's `runCommand`. The two reorder ids skip that last step: `block.moveUp` and `block.moveDown` move whichever block reports its path, through the editor's reorder action (once the block has written any source it's showing), so every block (a plugin container too) moves on whatever chord the keymap binds to the two ids. Container bubble handlers resolve kind-only, so they never double-fire a leaf's global command, and `runCommand` reads the caret live rather than an offset captured at keydown.

### The dispatch point

Chord resolution and the public `EditorInstance.runCommand` entry meet at one id-keyed dispatch point (`schema/block-commands.ts`), where the rules that hold _whatever_ invoked a command live. Reading mode dead-keys the vocabulary there. A painted cross-block range gets one of three answers:

- a command whose handler spends one block's own offsets and has no cross-block reading **declines** outright (the link editor, which writes a link into one block);
- a format toggle routes to the **cross-block executor**, injected into the dispatch point's checks because a schema leaf may not import selection machinery;
- everything else is range-safe and **runs on the focused surface**.

The editor builds one command context (`schema/block-commands.ts` :: `CommandDispatchContext`), and every entry path reads that same object, so a dispatch site added later can't turn up with its own copy missing a piece. A container a key bubbles up to never takes the cross-block route, since the toggles belong to the leaf below it, and it leaves alone any key a live range owns. The range's handler claims its key only after an await, so both sides ask one function which keys those are (`selection/cross-block/keydown.ts` :: `rangeOwnsKey`); otherwise a list item would indent itself on the same key the range is indenting it with.

<details>
<summary>How the cross-block toggle actually works</summary>

- It decomposes the range into one span per participating block (the start's tail, every block the range holds whole, the end's head) and runs each through the single-block format toggle, so it has no branches, candidates, or mode verification of its own. What the range holds is `rangeCoverage`'s answer, the one the delete and the copy read, so a range that reaches a closed details' title formats the hidden body too. Direction is the whole range's coverage, decided once and applied to every span: all covered unapplies, anything else applies, which keeps an apply from walking an already-marked block back.
- Participation is the kind descriptor's declaration (inline-bearing, editable, not a container), never a kind name.
- Tables are where the format gets cell-shaped. A table keeps a range endpoint as a cell number, not a text position, so the coverage also says which cells count (the rows a range runs into, the rectangle of a selection inside one table, or every cell of a table it holds whole), and each of those cells gets marked whole. A plugin grid with no table metadata isn't special: an endpoint in one of its cells is a text position like any other.
- The whole press is one undo entry through the multi-scope commit (`commit-and-undo.md` § The commit primitive), and the range is restored over the result through the shared restore route (`docs/design/selection.md` § Cross-block selection).

</details>

The same dispatch point answers `EditorInstance.canRunCommand`, the read a host greys a button from, so what a button shows and what a press does can't drift apart. Its sibling `isCommandActive` answers a command's pressed paint from whoever would spend the press: the focused surface at a caret, the range's own coverage across blocks. Paint and press decide by the same guards, so the two can't drift on the three range answers either.

### The other registries

- **Block openers.** Not a registry of their own: an opener is the part of the parser that recognizes the syntax a block starts with, and a kind the block parser dispatches carries one on its `registerBlockKind` call:

  ```ts
  registerBlockKind(kind, {
  	// ...the descriptor fields and the view
  	opener: {
  		priority: 25, // lower dispatches first; ties break by kind name
  		tryOpen(ctx) {
  			/* claim the lines from ctx.index: return { node, consumed }, or null to decline */
  		},
  		interruptsParagraph: (lineText) => lineText.startsWith(':::') // or false
  	}
  });
  ```

  Both the parser's dispatch order and its paragraph-interrupt scan derive from the registrations (`schema/block-openers.ts`). Built-in openers live in `core/parsers/built-in-openers.ts`, ride on the built-in registrations, and register on the first read of the grammar, so a parse finds them whichever module loaded first (G4.197), and their priorities are published as one constant, `OPENER_PRIORITIES` (`schema/opener-priorities.ts`), so a plugin opener whose matcher is a superset of a built-in's prices below that built-in's entry, and one that only slots between built-ins prices into the gap.

- **Enter completion.** The opener's sibling, for kinds whose grammar spans adjacent lines and so can't be typed into existence. A registered completer reads one typed line and answers the lines completing it plus where the caret lands; `structural-edits.md` § Structural operations shows the call.
- **Views.** Not a registry of their own: what draws a kind rides on its `registerBlockKind` call, and `BlockHost` reads it through the editor's activation (`schema/block-kind-descriptor.ts` :: `blockViewFor`). Built-ins register without one, since `schema/` can't import a component, and get theirs from `components/built-in-blocks.ts`, which every editor calls when it's created; only the first call does anything.

Two more things live in `schema/` that read like registries but aren't: the merge rules (eligibility predicates for Backspace-merge, plus the walker that finds the deepest mergeable leaf, `structural-edits.md` § Merge eligibility) and the container raw rebuild (per-kind rebuild plus ancestry dispatch, so an edit deep in a nesting chain re-emits every enclosing container's `raw`, `structural-edits.md` § The container `raw` contract). Both are functions over descriptor fields (`mergeRole`, `container.rebuildRaw`).

Registries are code, not state: register once, throw on duplicate, no unregister (the `customElements` model), in production and under test.

```ts
registerBlockKind('paragraph', {
	/* again */
});
// throws: registerBlockKind: "paragraph" is already registered. Kinds are register-once ...
```

Strict on purpose, because a registry you can quietly overwrite is a registry two plugins can fight over. Under a dev server the editor re-registering one of its own entries replaces it with a note instead (`schema/register-once.ts`), so a re-evaluated editor module survives hot reload rather than 500-ing every route. A plugin never gets that: it registers only inside its setup, which runs once per process (G1.104), and a duplicate from it throws, a built-in's key included.

## CST ↔ DOM synchronization

The tree is the document-level truth. Inside one block, while you're typing, the DOM leads and the tree follows, and that's no contradiction: the tree is written on every input event, so following isn't lagging, and the DOM is patched only when the tree's structural reading diverges from what's rendered. Typing stays fast because the editor doesn't fight the browser over ordinary keystrokes; it reads the result back.

### Reading the DOM back

On `input`, the block reads its own DOM content back as raw text, writes it to `node.raw`, and re-parses to refresh metadata and inline content; if the kind changed, it re-renders with the new component. What it never does is reconstruct that text from parsed structure (the rule in § What this is, one level down). Each surface supplies its own reader: code blocks and plain editable leaves can read `textContent` directly, while a prose block reads through a raw-aware DOM walk, since its atomic widgets and its container's ambient prefix (the read-only marker a container lends its first child, a footnote definition's `[^label]: `) both put `textContent` out of step with `raw`. Why, and the walk itself, is `inline-parsing.md` § 2.

The common case (no kind change) needs no DOM patching, since the browser's update and the tree agree; prose blocks rebuild their styled span tree from `raw` on every input, and offsets map unchanged.

When the edited text re-parses to **several** blocks (a hard-break line followed by an interrupter, an early fence close), the block structurally replaces itself with all of them: the first keeps the slot's identity, the rest splice in as siblings, and the caret follows the edit position into whichever block it lands in. Every input crosses this one point, and it's what keeps the live tree from cramming multi-block text into one node's `raw`. Before that split, a construct the write itself left **open** is closed: a typed unterminated fence writes its own closing fence over an empty body, so the blocks below stand instead of being absorbed. A fence you type on a line of its own gets its own closer. An opener you type back onto its body (you put back the backtick you just deleted) doesn't: it takes the closer still sitting flush under it, and the two read as one fence again. A gesture that merely _exposes_ an already-open fence still absorbs what follows, because that's the reload's honest reading, and the settling in `structural-edits.md` § Structural operations converges to it. Breaking a code block's opener is one: its closer stays and reads on, pairing with whichever fence below a reload pairs it with.

### Intercepted operations

These the editor owns, not the browser:

| Operation          | Trigger                                                                 | Behavior                                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enter              | `keydown` → `preventDefault`                                            | Split the CST node at the cursor offset                                                                                                            |
| Backspace at start | `keydown` → `preventDefault`                                            | Merge, unwrap, delete, or focus (`structural-edits.md` § Backspace at the start of a block)                                                        |
| Paste              | `paste` → `preventDefault`                                              | Read `text/plain`, dispatch through the paste pipeline                                                                                             |
| Copy / Cut         | `copy` / `cut` → `preventDefault`                                       | Slice the selected range out of the CST's `raw`; cut then deletes it                                                                               |
| Undo / Redo        | `keydown`, or the browser's own Undo (`beforeinput`) → `preventDefault` | Pop/push the editor's own undo stack in every editable element, a plugin leaf's included; a shown painted source steps through its own edits first |

One thing the editor deliberately doesn't own: between `compositionstart` and `compositionend` there's no sync and no reconciliation. The browser owns the IME sequence outright (and is welcome to it), and `compositionend` enters the same input path as a keystroke. If the browser drops a composition and never sends `compositionend`, the next key, typed text or new composition it sends outside one ends it instead. The block then saves what it shows, the dropped update included (it can't tell which text the browser meant), and a dev build warns under the `composition` tag so you hear about it.

### Atomic inline widgets

Some inline nodes render as opaque widgets: `contenteditable="false"` spans with no interior the caret can enter. Images, `<br>`, inline directives, decoded HTML entities, and the bundled plugins' inline math, footnote references and emoji are the shipped set, and the inline-widget registry (`core/inline/inline-widgets.ts`) is the one place that says which inline kinds are widgets. A widget's shell carries its raw byte range on the root element rather than in `textContent`:

```html
<span data-inline-widget="" data-source-start="4" data-source-end="20" contenteditable="false">…</span>
```

So the caret is addressable only at its leading and trailing edges, and the generic machinery keys off `[data-inline-widget]` alone (`inline-parsing.md` § The textContent invariant).

**`browser/offsets.ts` is the single translation point between DOM Range positions and raw offsets**, and everything that needs the translation routes through it. Why there's exactly one home, and what happened when arithmetic lived elsewhere, is `inline-parsing.md` § Coordinate spaces.

Two cross-block focus behaviors compose on top:

- **Vertical stop.** A block whose only inline content is widgets (an image, a lone formula) is one stop for ArrowUp/Down in either direction: the first press enters it as an object (the image selected, a formula's source revealed) and the next press moves on, so a run of Up presses and the Down run back retrace the same stops. `isVerticallyTransparent()` names such a block, and the arrival tries to enter it as an object (`editor-actions/focus/focus-landing.ts` :: `verticalArrival`), passing over it only when it can't be entered. Containers recurse, so a list item holding one image-only paragraph is the stop. The check reads the block as the mode draws it when the caret arrives. In live and preview-inline a link's markers stay hidden until the caret's inside it, so there a picture wrapped in a link counts as a picture alone. The check and the edge entry below read the block through one walk (`core/inline/inline-widgets.ts` :: `drawnInlines`). A block holding only a step-over glyph (a decoded entity, an emoji) is a plain caret stop beside the glyph.
- **Edge entry.** When a cross-block ArrowLeft/Right lands at the far edge of a paragraph that ends (or starts) with a widget, the dispatcher enters the widget rather than parking a caret at a boundary with nothing to show for it.

What "entering" means splits by the kind's editing policy:

- **Reveal-capable kinds** (inline math, inline directive, a footnote reference): horizontal caret entry against either edge (ArrowLeft/Backspace from the right, ArrowRight/Delete from the left, within-block or as a cross-block landing) opens the source reveal with the caret at the entered edge of the raw source. The caret then walks the raw bytes, and the escape rules below close the reveal when it leaves. The widget-selected state is unreachable for these kinds, so the caret never parks somewhere with no visual representation, and an adjacent Backspace degrades the widget one visible delimiter byte at a time instead of silently deleting the whole thing.
- **Images** keep select-then-step and select-then-delete on the same keys. **A decoded entity** (and an emoji) is atomic and step-over: a plain arrow walks the caret across the glyph like a character, a caret-adjacent Backspace removes the whole reference in one press, and a press on the glyph puts the caret at the edge on that side of its box.
- **Shift+Arrow never reveals**, on any kind.

The editor crosses a step-over glyph itself. Left to the browser, WebKit's arrow lands one character past the widget, and WebKit and Firefox both stop between a CRLF line ending's `\r` and `\n`. So `selection/shared-keydown.ts` :: `handleSharedKeydown` takes a horizontal arrow beside anything the caret can't stop inside (a step-over widget, a replace decoration, a CRLF pair, or any widget at all under Shift) and puts the caret at its far edge. Adding a new kind of span? It goes in the block's `CaretUnitSource` (the inline ones are in `components/blocks/text/edge-policy-dispatch.ts` :: `inlineUnits`), not in a key handler of its own.

**Source-reveal editing.** A revealed widget is drawn as its raw bytes: the block's render keeps one range open (`components/blocks/text/shown-source.svelte.ts`) and draws every widget it overlaps as plain text, tinted. Three facts orient the rest: the gesture is editor-owned end to end (pointerdown on the widget suppresses the browser's default caret placement, so the reveal's own landing has no racing writer, and a click lands where it pressed when the kind maps its render back to bytes through `revealOffsetAtPoint`); a key typed in the source takes the ordinary typed write, so the bytes are always current and a burst batches into one undo entry like typing anywhere; and the range stays open while the caret is inside it and the block keeps its kind, so `$x $` on the way to `$x y$` keeps looking like the source it is, and `#` then Space at a line's start turns `#few` into a heading at once. A caret an edit or an undo restores strictly inside such a widget opens it there (G1.115). The escape rules:

- An in-block escape closes in place; blur owns the focus-leaving close; a cross-block sweep keeps the source revealed, so selection rects measure real text. Clicking widget B while A is revealed closes A and reveals B as one sequenced gesture.
- Containment is decided by raw offset through the shared walk, and an escape must survive a `tick()` re-check before closing, so a transient selection state the editor's own machinery manufactures (cross-block entry clearing the native selection) never closes a reveal the user still wants open.
- A clipboard splice and every branch of the block's command dispatch close the reveal first, so they act on the rendered block. That's what keeps Enter meaning "split" inside a revealed source (the command dispatch closes the reveal, then splits at the caret) rather than the reveal claiming the key and costing the user the press.
- The reveal claims exactly one key of its own, Escape, which closes it and keeps what was typed (Ctrl+Z is the undo). A table cell carries one carve-out at its own keydown: a cell's Enter is a row hop rather than a split, so inside a revealed source it only closes the source and the caret stays in the cell.

To add a widget kind, register it in the inline-widget registry so recognition stays in one place, then give it a `view` that draws into the span the editor makes for it (`inline-parsing.md` § Widget render paths).

### Browser engines

aragonite runs on Chromium, Firefox and WebKit, and the three disagree about a lot of small things: where a click puts the caret, what Backspace takes next to a widget, how a selection spells its line breaks. Almost every engine bug so far had the same shape. The editor let a browser default run, or read something the browser owns straight off it, and then trusted the answer. The engines differ mostly in their defaults, so wherever the editor decides for itself, they mostly stop mattering.

So the rule is **decide, don't delegate, and read the browser in one place per kind of thing**. The selection's readers, the caret writer and the point lookups all live in `src/lib/browser/`, and G4.270 fails a selection read, a selection write or a point lookup anywhere else, so a new read goes there too. Here's where each kind of browser behaviour comes in, and what fails when a new route skips it:

| Browser behaviour                                       | Read or decided in                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Held by                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| A key                                                   | the keydown handlers, which prevent the default and write through the tree (the intercepted operations above)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | the key rows of each block's e2e specs                                                            |
| Backspace or Delete at a caret, in any block's own text | `components/blocks/editable/collapsed-delete.ts`, at `beforeinput`, so a soft keyboard's delete takes what the key takes; the unit (a character, a word, to a line's edge) lives in `caret/delete-extent.ts`, any unit at the block's edge runs what plain Backspace or Delete binds there, and any unit facing a widget does what the plain key does to it. A chord (a word or line delete, Shift+Backspace) gets both answers at its keydown (`decideDeleteChord`), since WebKit can send no input for one at the block's edge, or beside an image when the caret's in the text touching it (on macOS, also right after an image that ends the block) | G1.132, G4.239, `collapsed-delete-class`, `word-line-delete`                                      |
| The clipboard, outside a clipboard event                | `editor-actions/system-clipboard.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | G4.220                                                                                            |
| A paste with no paste event (menu Paste)                | the focused block's `insertMarkdown`, never a constructed `ClipboardEvent`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | G4.221                                                                                            |
| A selection's text                                      | `browser/selection-read.ts` :: `shownSelectionText`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | G4.221                                                                                            |
| A popover closing                                       | `components/menu/menu-presence.svelte.ts` :: `track`, never focus leaving                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | G4.219, G1.121                                                                                    |
| Which line the caret is on, where a line soft-wraps     | `browser/visual-lines.ts` holds the checks an arrow uses to decide whether it leaves the block, `lineEdgeOffset` (where a soft-line delete stops) and the column. Where one spot in the text is on two lines at once, they ask the caret writer's `focusEndsLine`, and the caret writer is the only code that calls `Selection.modify`                                                                                                                                                                                                                                                                                                                  | G4.243, G4.270, G1.141, `caret-line-at-wrap`                                                      |
| Where the caret sits                                    | `browser/caret-writer.ts` :: `canonicalizeCaret`, on `selectionchange` and the next keydown (`caret-placement.md` § 2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | its rows in the caret e2e specs, G1.117                                                           |
| The selection itself                                    | the readers in `browser/selection-read.ts` (`readNativeSelection`, `rawSelectionIn`, `nativeRangeIn`, `holdsNativeRange`, `rawSelectionFocus`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | G4.270                                                                                            |
| Where a drag ends                                       | `selection/pointer-session.ts`, at the release's own point, heard before any other listener (the last move can arrive after the release, and a popover the release shows can cover the point)                                                                                                                                                                                                                                                                                                                                                                                                                                                           | G4.225, `selection/drag-release-endpoint.spec.ts`                                                 |
| Where a press on chrome puts focus                      | the chrome, which prevents a press's default so the caret's block keeps focus; a field that borrows it gives it back through `selection/caret-restore.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | G4.224                                                                                            |
| Mod+Z with focus on chrome                              | `components/editor-root/keydown.ts` :: `chromeHoldsFocus`, which runs the editor's undo where neither a block nor a text field took the key                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | G4.230                                                                                            |
| What a right-click selects                              | `components/editor-root/gestures.ts` :: `placeCaretForMenu`, before any menu reads the caret: a word Safari selects or a widget the editor holds stays for the clipboard rows, a press on any other widget gets a caret beside it                                                                                                                                                                                                                                                                                                                                                                                                                       | G4.231                                                                                            |
| Where Tab goes in reading mode                          | `components/editor-root/reading-focus.svelte.ts`, the editor's one tab stop, which also clears a click's caret; the caret writer's `placeCaretAtRaw`, which writes none in reading mode (Firefox and WebKit start Tab from a caret, Chromium from focus)                                                                                                                                                                                                                                                                                                                                                                                                | G1.131, G1.133, G4.235, `plugins/reading-keyboard.spec.ts`, `plugins/reading-press-focus.spec.ts` |
| Which engine this is                                    | nowhere: `src/lib` outside `debug/` doesn't ask                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | G4.223                                                                                            |

What's still left to the browser is a short list, each for a reason: typing inside a line, read back on `input` as above, which is what keeps typing fast, IME composition (the browser owns it outright), caret motion and a click's caret (moved onto the editor's spot afterwards by `canonicalizeCaret`), spellcheck's replacements, and text dropped in from outside the editor. That list is where the next engine bug is most likely to come from, ofc.

When it does, here's the fix, in order:

1. Write the test first, one that runs on all three engines, and watch it fail on the one that broke.
2. Find the row of the table above the behaviour came in through. If the editor let a default run, the fix is usually to decide it: prevent the default and write through the tree. If it read the browser raw, fix the reader.
3. Fix it there, the same way for every engine. Never `if (isFirefox)`: G4.223 fails it, and a branch for one engine just hides the rule the other two break next month. Platform is fine (Mac's Cmd is `Mod`, like Ctrl).
4. No row fits? Then the editor just met a new kind of browser behaviour. Give it one place it's read or decided, plus a scan that fails when a second route shows up, the way G4.220, G4.221 and G4.270 do.

## CST mutability and reactive state

The tree is mutable plain objects, no class hierarchy: the parser produces mutable nodes, the editor mutates them in place, and `serialize()` reads `raw` only. It's structurally typed over readonly fields, so it also works on the bytes-readonly node views (`core/node-views.ts`) that readers outside the mutation layers hold. The only allowed routes from a view back to a mutable node are the unshare and clone helpers and the owned scope views the commit steps hand out (the fixed steps every commit runs, `commit-and-undo.md` § The commit primitive).

- `parse(source)` yields a mutable `Document`, and the editor works with those nodes directly. No wrapping, no cloning on load.
- Re-parse runs `parse()` on the block's `raw` and transfers the result into the existing tree through one entry. A same-kind edit writes the block's fields in place, so routine typing keeps the node object (its component and IME state ride along); a kind change or a multi-block result creates fresh nodes and splices them into the slot, the ID carried across at the index (`structural-edits.md` § Structural operations). The transfer never rewrites `kind` in place, and readers can't either, because the bytes-readonly `NodeView` makes a `kind` write a compile error ([`syntax-tree.md`](syntax-tree.md)). On a mutable node the union still permits the write, so the mutation layer holds the line by routing every re-parse through this one entry.
- Undo snapshots **share** the live tree's nodes; a mutation copies the shared spine (the chain of parents from the root down to the edited node) before writing (`commit-and-undo.md` § Undo / redo).
- Some container metadata feeds the container's `rebuildRaw` (a list item's `taskMarker` is emitted back into its serialized text), so a write to such a field must trigger the rebuild in the same commit or `raw` drifts from metadata. The `updateBlockMetadata` action runs the rebuild after its shallow merge, so a new metadata-driven field inherits the guarantee by going through that action rather than by someone remembering a rule.

### Reactive state plumbing (Svelte 5)

Three rules govern how tree state crosses into Svelte's reactivity. The types won't tell you about any of them, and breaking one corrupts state silently ([`../contributing/casebook.md`](../contributing/casebook.md) has the incidents).

1. **Reactive state crosses module boundaries as getters, never values.** Re-init effects and bootstrap helpers read mutable state through `() => state` closures or getter properties. The `source` effect in `Editor.svelte` is the one to copy: it reads the prop, then runs the swap inside `untrack`, since a tracked read of the whole document would re-run it on every keystroke.
2. **The document is not its own memo key; the content version is.** The `$state` document is mutated in place, so its object identity survives every edit. Anything derived from the whole tree (footnote numbering, a table of contents) keys on the editor's **content version**, a counter each route writing the document's bytes bumps and nothing else moves:

   ```ts
   // editor-actions/commit/content-version.svelte.ts
   interface ContentVersion {
   	read(): number; // read it inside a $derived, and that derived re-runs on every edit
   	bump(): void; // announce that this write moved the document's bytes
   }
   ```

   Don't confuse it with the decoration engine's `editEpoch`, which follows it one `tick()` later. The version is the reactive read a `$derived` subscribes to; the epoch is the plain number a decoration source's `provide` receives.

3. **The render path computes inline content locally and reads no cache.** There's no `inlineContent` node field: prose blocks compute the inline tree from `node.raw` on each render, so a render effect's reactive read set is `node.raw` plus its closure inputs, nothing more. Non-render consumers (event handlers, exported methods, click-snap) read inline content through an accessor backed by an external, non-reactive WeakMap.

## Serialization

**Serialization doesn't recurse.** `serialize()` walks the document's **top-level** children only, and that's the whole function:

```ts
// core/serializer.ts
export function serialize(document) {
	return document.prefix + concatChildren(document.children) + document.suffix;
}
// concatChildren: each child's leadingTrivia + raw, in order
```

It never descends into a container, and it doesn't have to, because a container's `raw` already holds its entire subtree's source (`structural-edits.md` § The container `raw` contract). Parsing a strip container is strip-and-recurse (strip the prefix, parse the inner content into children, keep the original un-stripped lines as `raw`; a table parses its rows and cells instead), and editing inside one writes the child's `raw` and then rebuilds every enclosing container's `raw` on the way out.

**`getSource()` serializes once per edit.** The text is cached on the content version (§ Reactive state plumbing), so two reads with no edit between them get the same string back. A dev build serializes again the first time `getSource()` reuses a version's text and complains if the two differ, since a writer that forgot to bump the version would otherwise have the editor report text it no longer holds. The cache is one more copy of the text per editor (a 10 MB note keeps about 20 MB more, JS strings being UTF-16).

That cached text is also what a `source` prop write gets compared with. The write replaces the document only when it differs from what the editor holds right now, never from the prop's previous value. So a host that keeps `source` in step from `edit` hands the editor its own text and nothing happens (undo survives), and a write back to the text the editor mounted with, after the user typed, still loads. Every prop the editor re-applies follows the same rule: it's a change only against the editor's own state.

## Block identity

Nodes need stable IDs for two reasons: Svelte's keyed `{#each}` (without stable keys, a split or merge destroys and recreates DOM nodes, losing cursor and composition state) and focus management (the editor must target a specific block between the mutation and the post-`tick()` focus call). IDs are an editor-level concern, not part of round-trip serialization, and they live in two places:

- top-level, a parallel `string[]` on the editor shell, aligned with `doc.children` and restored with every undo entry (the `blockIds` field of an undo entry, `commit-and-undo.md` § Undo / redo);
- per-container, `childIds` on the container node itself, lazy-initialized on first mount and carried on the node, so undo snapshots and copy-on-write spine copies keep the IDs alongside `children` with no parallel structure to sync.

Both arrays are the `{#each}` key source for their list, and both update atomically with every children mutation: split inserts an ID after the original, merge and delete remove one, reorder moves one, and a kind change keeps the ID at that index (only the node object is swapped).

**The state registry.** A lot of code needs to look up a `BlockListState` (ID array + ref array) from a node reference: the commit scopes, reorder, the list and table contexts, the ancestry collapse, paste, and the cross-block delete. That mapping is a module-global WeakMap keyed by the container node (`block-lists/state-registry.ts`). A container registers on mount and leaves on unmount, so a container the window scrolled away isn't found, and a commit that reaches one takes the ids its node still holds (`scopeStateFor`). During a remount, the lookup finds the new mount. Being module-global, the registry is shared by every editor instance on a page, which is safe because instances never share nodes. (The consumer-facing statement of the multi-instance boundary, global grammar and per-instance state, is in [`../guide/consumer-guide.md`](../guide/consumer-guide.md).)

## Block kinds

The built-in kinds and what the editor does with each. A kind with no dedicated component renders as a **raw-editable block**: its `raw` in a monospace contenteditable, fully editable, no special merge behavior.

| Kind                      | Editor behavior                                                                                                                                                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `paragraph`               | The primary text block. Contenteditable, inline-parsed.                                                                                                                                                                                                  |
| `heading`                 | Styled ATX heading. Contenteditable, inline-parsed. A closing `#` run is drawn as a marker after the text. Where the markers hide, an edit that takes the hidden `# ` takes the run too; where they show, the run stays unless the selection covered it. |
| `setextHeading`           | Identical to `heading` for editing purposes. Not normalized to ATX: that would rewrite bytes the user typed. A title any edit leaves blank loses its underline, which would otherwise read as a block of its own.                                        |
| `fencedCode`              | Live syntax-highlighted code surface. Dimmed fence and info-string markers, editable wherever the mode paints them and out of reach where it hides them. Participates in sticky-column traversal.                                                        |
| `thematicBreak`           | Non-editable, focusable, reorderable. The one built-in on the whole-block focus model (`structural-edits.md` § Whole-block focus).                                                                                                                       |
| `indentedCode`            | Raw-editable. Not mergeable.                                                                                                                                                                                                                             |
| `htmlBlock`               | Raw-editable. Not mergeable.                                                                                                                                                                                                                             |
| `linkReferenceDefinition` | Raw-editable. Editing one changes the link-reference map's signature, so reference-style links and images update; a signature change re-parses only the blocks holding a `[` (`src/lib/components/link-reference-map.ts`). Not mergeable.                |
| `table`                   | Container (grid). A per-cell editable grid with cell navigation and column-aware traversal. Not mergeable.                                                                                                                                               |
| `tableRow` / `tableCell`  | The table's children. Cells are inline-parsed; images in a cell fall back to alt text rather than rendering as widgets. `tableCell` is context-dependent: no standalone recognizer, so an edit keeps its kind instead of re-deriving it as a paragraph.  |
| `blockquote`              | Container (strip). Recursive `BlockList`.                                                                                                                                                                                                                |
| `list` / `listItem`       | Containers (strip). The list renders items; each item renders its own `BlockList`.                                                                                                                                                                       |
| `unrecognized`            | Raw-editable, self-merging. **Reserved: no parser path emits it today**; `paragraph` is the total fallback. [`syntax-tree.md`](syntax-tree.md) says why the kind is kept anyway.                                                                         |

Plugin kinds sit alongside these in the same registries, keyed by their own strings.

## Extension points

Everything above is reachable by a plugin without touching an editor internal. The surface itself is specified in [`plugin-contract.md`](plugin-contract.md), and [`../guide/plugin-guide.md`](../guide/plugin-guide.md) is the authoring guide. One design fact belongs here rather than there: `plugin.ts` is a **facade** over the library's internals (chiefly `schema/`, `core/` and `components/`), the curated public face of those directories rather than a layer sitting above them, and `svelte.ts` is its sibling for everything typed with Svelte's types. Both are **sinks**, meaning nothing they re-export may import them back, because a bundler that splits the two sides of such a re-export cycle into different chunks can break execution order in a consumer's build. The proof the surface is complete is `plugins/`, whose bundled packages import those two barrels and nothing else from the editor.

## Standing directions

The design rules this codebase runs on live in [`../contributing/rules.md`](../contributing/rules.md). Four directions came out of the first real integration (limestone, the app aragonite was extracted from), and each one should steer the next milestone that touches its area:

1. **Inline-widget _editing_ is where a consumer's defect density concentrates.** What happens when a caret, a keystroke, or a command meets an inline widget is one region, and consumer-reported defects cluster there. A new inline-editing capability picks its key space deliberately (a syntax handler at one inline priority, or an inline kind; the split is the design, not an accident of it) and enrols in the inline conformance kit, which is where a handler's behavior is held.
2. **The in-repo test harness can't see a webview host** (a desktop shell like Tauri or Electron). What a green run misses there is in `docs/contributing/testing.md` § Browser engines ("What a green run doesn't tell you").
3. **A process-global singleton is a deliberate choice with a written second-claimant story.** One slot works until the second claimant arrives, and by then the interleaving is a consumer-visible defect rather than a design question.
4. **Every gesture that places a caret is a data-loss candidate until proven otherwise.** A live cross-block range sitting there before the gesture is what turns a caret landing into a whole-document loss. Every placement through `src/lib/selection/place-caret.ts` ends a live range, but a route that parks a caret directly (a block's `parkCaret`) ends nothing, so a new caret-placing entry joins the simulation's range-interrupt family (`src/lib/e2e/simulation/gestures/range-interrupt.ts`) by hand or goes unprobed.
