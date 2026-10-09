# Selection, search, clipboard

How the editor selects things (inside one block, across blocks, a widget selected whole, the caret parked between two blocks, and the caret bar it draws for itself), plus find and replace, and copy, cut and paste. It's for whoever's about to change any of that, and it leans on the terms [`editor.md`](editor.md) §§ 1 to 3 set up, so prob read those first.

1. Right below this list, with no heading of its own: selection inside one block, the clicks the editor takes over from the browser, a widget selected whole, and dragging a selection somewhere else.
2. [The drawn caret](#the-drawn-caret): the caret bar the editor paints itself, where it hands the job back to the browser, and what asks it to repaint.
3. [Cross-block selection](#cross-block-selection): a selection spanning several blocks, how you start one, how it's painted, and what each key does to it.
4. [The gap caret](#the-gap-caret): a caret parked between two blocks where neither one can hold it (a table right above a code block, say).
5. [Search](#search): find and replace, which reads the document and changes nothing until you replace something.
6. [Clipboard](#clipboard): copy, cut and paste, and the order a paste tries its options in ([The paste pipeline](#the-paste-pipeline)).

Single-block selection is the browser's: native selection inside the block's contenteditable, its caret (drawn by the editor on a fine pointer, at the browser's own position; see The drawn caret, below), native `::selection` paint, with only copy/cut intercepted. Except for the click sequence. From the second click of a run the editor takes the gesture over, because the browser's idea of a word depends on the platform (Windows grabs the space after it) and its word walk happily wanders into a rendered formula beside it. So: two clicks select the word, three select the block's content, and dragging from either grows the selection a word or a block at a time, across blocks too.

- The word comes from segmenting the block's own text with markers and widgets blanked out, which is how double-clicking `_word_` gets you `word` and not the underscores.
- There's no fourth level on purpose. Mod+A twice already selects the document, and a jittery triple-click that selects everything right before you type is a great way to lose a document.
- A double-click on an inline widget is still the widget's own business. The third click is the block's, unless the editor already holds that widget selected whole, which an image's own click handling does from the first click of the run.

A widget **selected whole** (an image after a click on it, or a live `<br>` an arrow key steps onto) is a selection the editor keeps for itself.

- While one is, the document holds no native caret. The paragraph keeps focus so the widget gets the keys, and the editor drops the caret the browser puts at the paragraph's start on any mouse input. Every read of the selection meanwhile (`getSelection()`, `selectionChange`, an undo entry) answers the widget's edge its selection came from.
- The widget lives in the same selection state as a cross-block range and the gap caret (`selection/selection-state.svelte.ts`), and that state has one writer for all three, so any caret or range the editor puts down ends the widget on its way in. `selection/place-caret.ts :: selectWidgetWhole` is the one place a widget gets selected.
- A Shift+click grows a range from the selected widget instead of from that dropped caret, into another block too.

Dragging a selection and dropping it somewhere else is the editor's too. The browser's own drop is two edits, each committed on its own (and the insert lands at offset 0 once the delete re-rendered the block), so `selection/selection-drop.ts` cancels the native pair and moves the source surface's own bytes through the paste transforms as one undo entry. A shape it can't move yet (a drop onto a table cell, or onto a block with no character position) is cancelled outright rather than left to the browser, because the native drop loses bytes on undo. Cancelling takes the browser's drop caret away too, so while the drag is held the editor draws its own where a click would land, and draws none over a shape it will decline.

## The drawn caret

On a fine pointer the editor draws the caret itself: one bar per editor, sitting inside the block it draws for, while the browser's selection stays exactly where it was, so typing, IME and screen readers keep reading the real one. The same bar also draws where the browser can't, on any pointer: beside an inline widget and across a gap between blocks. An attribute on that one editable (`data-caret-drawn`) hides the browser's caret there and nowhere else, so the find bar, the link card and any plugin's own field keep their native carets. Where it can't draw, it steps aside and the browser's caret shows, so there's always exactly one:

- a composition, or a shown inline source;
- beside an inline widget that no click put the caret beside (an arrow key got there, say), where the range has no box to draw at;
- anywhere the range's box isn't where the browser paints its caret: the spaces a line soft-wraps in, a caret a scroller inside the block has clipped out of view (a code block scrolled sideways; the bar comes back when it scrolls into view), and a code chip's edge, where each engine paints its caret on its own side of the chip's padding;
- forced colors, a touch screen, or a host that set the `caret` prop to `'native'`. Beside a widget and at a gap, only forced colors do.

A click beside a widget hands the drawn caret the edge it meant (`EditorServices.drawnCaret` :: `armWidgetEdge`), keyed by an object the block makes for itself. The editor holds one such edge, and a paint only reads it back through the focused block's own key. Typing, an arrow key or a click elsewhere lets it go.

Two things move the caret, and each gets painted its own way:

- **The editor writes it.** Every caret and range the editor puts down goes through the editor's one caret writer, `EditorServices.caretWriter` (`caret/widget-offset.ts :: createCaretWriter`), and each write asks for a paint. The paint runs once per task after `tick()`, past Svelte's flush and the block's height measure, so it reads a layout that's already clean and the bar lands in the same frame as the letter. If your code changes the caret's line after the paint without writing the caret, call `EditorServices.drawnCaret.request()` yourself. The dev check G1.76 catches a missing one only at a `selectionchange` that finds no paint pending, so don't count on it.
- **The browser moves it** (an arrow it handles, a click, a drag, IME). That arrives in a later task, so the paint for it runs at the next animation frame, armed by the key or pointer event. It's the one `requestAnimationFrame` that touches the caret, and it only reads and paints (`caret/drawn-caret.svelte.ts`).

The bar's shape shows the format the next typed letter will get: heavier for bold, slanted for italic, a tick for strikethrough. The answer is `components/blocks/text/next-byte.ts :: nextByte`, which runs the typing path's own write dry on a probe letter (the caret memory's records, then the block's move across a hidden edge), so the shape can't promise what typing won't deliver. Any change to what the caret memory answers asks for a paint itself, which is how an arrow that only switches sides, or a format chord, reshapes a caret that didn't move. So a new kind of insertion record goes in the memory's record list, and a new memory method that changes an answer calls the memory's change hook (G4.147 reds on one that doesn't).

## Cross-block selection

Two endpoints, anchor and focus, each a path plus an offset in that block. `selection/primitives.ts` :: `SelectionPoint` is the type, a union of two shapes told apart by `cellCoordinate`: a character offset into `raw`, or a row-major cell index inside a table. Code that reads an offset checks the flag, not the block's kind. `SelectionState` flags every endpoint on a table's path as it stores it, and a restore does the same to a snapshot's or a host's plain offset there.

Same path on both means single-block, and the browser handles it; different paths mean the editor manages all selection rendering. The native caret and native `::selection` are suppressed (via `[data-cross-block]` on the editor root) exactly when the overlay paints instead, one predicate for both, so a stored pair the overlay declines to paint keeps its native caret rather than showing nothing at all. The state is lazy, its fields null in single-block mode, with a normalized `start`/`end` pair in document order derived from anchor/focus.

- **Entering it:** a pointer drag that crosses out of the starting block (rAF-throttled, autoscrolling at viewport edges; a point off every block resolves to the nearest one, so a drag into the margin extends rather than stalls); Shift+Arrow past a block edge; Mod+Shift+Home/End to a document boundary; Shift+click into another block; a second Mod+A (the first selects within the focused block, natively).
- **Rendering it:** every `BlockHost` mounts a `SelectionOverlay`, and so does a list item, which renders no host of its own yet holds children at ordinary block paths. The overlay paints what `selection/range-coverage.ts` :: `rangeCoverage` says the range holds, the same answer the delete, the copy and the format toggle read (see Clipboard below), worked out once per selection change.
  - A subtree the range covers end to end takes one full-block box, its own markers and frame included, and its descendants take none, so nothing paints twice. `selection/primitives.ts` :: `classifyBlockForSelection` decides this for every block, from the coverage's `coveredWhole` (what a copy takes).
  - An endpoint block the range only partly covers measures partial rects and widens them to its line edges (`caret/overlay-rects.ts` :: `reachLineEdges`): the start block runs from its point to its right edge and takes every line below whole, and the end block the mirror of that. A container holding an endpoint paints no box of its own.
  - A block that scrolls internally (a wide table, a long-line code block) gets a passive scroll listener and a re-measure, so highlights track the content underneath.
- **One region:** a range across blocks reads as one selection, the shape a code editor paints. Every line between its first line and its last spans the block column, padding, margins and a container's rail included, and only the start line's text before its point and the end line's text after its point stay bare. `components/SelectionGapFill.svelte` fills whatever no block's own paint covers, and only while the range spans blocks.
- **Exiting it:** a click or an unshifted arrow collapses back to native single-block selection.
- **Replacing it:** anything destructive over the range (Backspace, Delete, cut, typing, an IME composition, paste, and a command key, below) goes through one replace, `selection/cross-block/range-replace.ts` :: `replaceRange`. It removes what the range covers, then does the key's usual thing at the caret that's left, all as one undo entry, and the replace itself lands one caret. (Inside one block it's different on purpose: Mod+1 there re-kinds the block and keeps its text, while over a range it's delete, then the key.) What goes depends on two things, the kind of gesture and what the range covers, and the replace keeps that as one table in the same file:
  - Backspace, Delete, cut and the command keys take a whole table, row or column inside one table out, however deeply the table's nested, so a command key ends exactly as Backspace and then the key would.
  - Typing or pasting over a row, a column or a smaller rectangle of cells clears them and puts the text in the first one instead, since a removed row leaves nowhere to type.
  - A range holding one block whole (a table with every cell selected, say) has no survivor to act at. Typing and paste replace the block in its own slot, while the other keys take it out. Focus parks on the editor root, whose keydown and clipboard handlers are that range's only entry.
  - An IME composition never changes block structure, because the IME writes into the element that had focus when it started, and taking that element out would lose the text. So it clears the range the way a plain delete does (a table keeps its cells, emptied) before the IME writes anything, and the composed text joins that undo entry.
- **Command keys over it:** a command key is whatever the keymap binds to a command that runs at a caret after the removal: a split, a hard break, a heading level, a code newline, a cell's Enter (`schema/commands.ts` :: `AFTER_RANGE_REMOVAL_COMMAND_IDS`), or a plugin command registered with `overRange: 'afterRemoval'`. By default that's Enter, Shift+Enter and Mod+digit, following the `keybindings` prop. The binding that counts is the one in the block the removal will leave the caret in, since that's where the command runs (`selection/removal-landing.ts` :: `removalLanding` picks it before anything moves).
- **Indenting it:** Tab, Shift+Tab and any other key bound to an indent command go to `selection/cross-block/range-indent.ts` :: `indentRange`, which asks each covered block what the key means for its own kind and does what that kind registered in `schema/range-indent-forms.ts` (a plugin kind registers with `registerRangeIndent`).
  - A list item nests or lifts exactly the way a caret's own Tab moves it, through `tree-operations/list/item-moves.ts`, and an item that can't move stays put while the rest still move. A code block shifts the lines the range covers. Prose and tables stay as they are.
  - Tab and Shift+Tab are taken over a range even when nothing indents, so focus never wanders off to the next control on the page. The range stays over the same text afterwards, and each press is one undo entry.
  - A selection inside one block asks its block the same question (`bindsIndentAt`), so prose takes the key and changes nothing rather than getting a tab typed over the selected text.
- **Restoring it:** one route (`selection/caret-landing.ts` :: `restore`) serves the undo swap (a gap caret it recorded included), the consumer's `setSelection`, a mode switch, an arrow that collapses the range, and the find bar or link card handing back the caret it borrowed.
  - It resolves and clamps both endpoints, mounts what the caret will park at, then writes the state and places the caret inside one change-notification batch, so no notification reports a selection the restore is about to move (`editor.md` § Serialization and the event channel).
  - The caret goes where one can sit: a point on a list's own path goes into its first item, a point in a closed `<details>` body onto its title row (nothing opens), and a pair spanning a block with no text (a rule) comes back held whole, focus on the editor root.
  - Then, unless it's a mode switch (which keeps its own scroll), a caret off screen comes in to the nearest edge.

Across containers, "start wins": the start endpoint's container context determines merge and cleanup behavior after a destructive operation.

**`measurePartialRects`: offset semantics by surface.** The hook's `(startOffset, endOffset)` shape is stable, but what an offset _means_ depends on the surface, and a new endpoint-capable kind picks one:

- **Text contenteditable** (paragraph, heading, code). Offset is a character index into `textContent`; a shared helper walks the DOM for wrapping-aware rects, so every contenteditable block reuses it with no per-block work; `SELECTION_END` clamps to the end of `textContent`.
- **Cell-based** (tables, any 2D grid). Offset is a cell index in row-major order, one rect per cell in `[start, end)`; the surface maps click/drag positions to cell indices on entry; `SELECTION_END` means "through the last cell".
- **Opaque single-unit** (thematic break, an embedded diagram). No interior positions: the valid offsets are 0 and the end of its own markdown, an endpoint landing inside snaps to whichever its side of the range needs (so copy and delete move the unit whole), and any non-empty range returns the bounding rect as a single element. A kind that needs finer granularity is the wrong kind.

A block that doesn't implement the hook still gets its box when the range covers it whole, but as an endpoint the range only partly covers, it paints nothing.

## The gap caret

One of the three selections the editor owns (the others are a cross-block range and a widget selected whole), and the only caret among them: a caret parked between two sibling blocks, at a boundary no block's own editing surface can reach. Between a table and a code fence, say, or above a document that opens with a table; without it those boundaries have no insertion point at all. A gap position is `{ parentPath, index }`: the boundary before child `index` of the container at `parentPath`, with the root as the empty path and `index === children.length` as the scope's trailing edge.

````ts
const doc = parse('| a |\n| - |\n\n```\nx\n```\n\nplain\n');
gapEligibleAt(doc, [], 0); // true: above a table that opens the document
gapEligibleAt(doc, [], 1); // true: between the table and the fence
gapEligibleAt(doc, [], 2); // false: a paragraph can host the caret itself
````

It's collapsed by construction and never half of a range.

**Eligibility is declared, never inferred.** Every kind declares `gapEdges` (`before`, `after`, `both`, or `none`) in its descriptor, and a boundary opens only when both blocks facing it declare the edge they present to it. `none` is the written-down no, required so that leaving the field out can't pass for a decision, and no selection or orchestration code names a kind. Among the shipped kinds:

- table, fenced code, and the bundled math block and math fence declare both edges;
- the thematic break and the mermaid diagram declare before only, since their focused Enter already grows a sibling below;
- the opaque containers (the callout kinds, details, the generic directive container) declare both edges, because their fences leave no textual escape hatch and two adjacent callouts would otherwise have no insertion point between them;
- strip containers (blockquote, list, GitHub alert) declare `none`, their unwrap and exit gestures already owning insertion at their boundaries.

The root's trailing boundary is excluded, since the move-past-end append already owns it; and reading mode, having no caret at all, has no arrival.

**Arrival** rides paths that already existed: a directional focus move stops at an eligible boundary instead of entering its target (covering the arrows and the Backspace/Delete-at-edge focus fallbacks together); a dead-space click whose y falls between two root bands lands there; the undo restore route parks one it recorded. A targeted landing (a numeric offset, a consumer's `setSelection`) never stops. Placing the gap ends whatever else the editor had selected, and any other caret the editor puts down ends the gap, through the selection state's one writer (above). A structural commit ends it as well, since the gap names a boundary index and an edit ahead of it moves what that index names.

**At the gap**, a printable key or an IME commit inserts a paragraph carrying the text, and Enter inserts an empty one; both go through the ordinary commit steps, so each is one undo entry and one `insertBlock` edit event. Arrows, Backspace and Delete leave for the neighbour in their direction, and Escape leaves for the block above (the one below, at the first boundary of its list). Shift+Arrow is deliberately the plain arrow: a single block selected whole isn't a representable cross-block state, and the per-kind shapes it would need are exactly the kind dispatch selection code refuses. Every other input, paste above all, is declined rather than guessed at. Focus lives on a hidden proxy (the drawn caret lays its bar across the boundary), which is what lets the editor-global chords resolve there as they do anywhere else.

**Undo stores it as itself.** An entry's recorded selection is either an editor selection or a gap position, so undoing the insertion returns the caret to the boundary the paragraph came from, and a restore whose container path no longer resolves degrades to the ordinary fallback landing rather than parking where nothing would paint it. **It isn't public in v1.** The gap stays outside the `SelectionPoint` union, a freeze decision [`plugin-contract.md`](plugin-contract.md) § Payloads bound as-is records.

## Search

Find/replace is a **read-only view over the tree**: it renders nothing itself and mutates nothing until you ask it to.

- **Scan** (`search/`) walks the document by path, matching each _editable leaf's_ `raw`. Containers are skipped, not because they lack text but because their `raw` duplicates their children's (`editor.md` § Containers); the one exception, a childless opaque container, has no children to duplicate and scans its own `raw` as a leaf. Literal, whole-word, case-sensitive, and regex modes compile to one matcher interface, and an invalid pattern surfaces as an error string, never a throw.
- **Paint.** Matches are published as mark decorations (source `editor:search`) and the shared decoration overlay paints them; search was the engine's first client. The scan is memoized on the engine's edit epoch plus query and options, so an edit re-scans while navigation only remaps the active highlight. Decorations are bucketed by owning path once per run, so an overlay reads only its own bucket, and windowing follows for free: an unmounted block simply doesn't paint.
- **Navigate.** The active match is revealed through the same reveal primitive focus uses ([`virtual-rendering.md`](virtual-rendering.md) § Doing something to a block you can't see), so a match thousands of blocks away mounts, scrolls in, and highlights.
- **Replace** reparses only the affected _top-level_ subtrees and commits once per subtree, O(affected subtrees) rather than O(document), with one edit event for the batch (`editor.md` § Serialization and the event channel). Replace-all lands under a single undo entry, and a replacement into a table cell escapes the delimiters the cell's `raw` reserves, so it can't split the row.
- **Cost when idle: zero.** The decoration source lives only while the bar is open (opening registers it, closing disposes it), and the post-commit re-run is deferred off the commit path, never a synchronous per-keystroke scan.

The bar is on by default and switchable off (`searchBar` prop), bound to Mod+F / Mod+H; a consumer can drive the same controller headlessly through `getSearch()` on the editor instance.

## Clipboard

Clipboard text is always plain Markdown sourced from the tree, and every copy, cut and paste is intercepted wherever it fires. The one extra flavor is a rectangle of table cells, which also goes on as an HTML table, because that's what spreadsheets read.

- **Copy.** Single-block: slice the block's `raw` at the selection offsets. Cross-block: the start block's tail, the raw of everything the range covers end to end (with leading trivia), and the end block's head. A container counts as covered once every byte in it is, so select-all over a document that's one quote copies the quote, markers and all. A closed details the range takes whole (see Cut) is copied whole too, hidden body and all. A rectangle of table cells copies as a GFM sub-table plus the HTML table, the same bytes whether the copy fires in a cell or at the editor root. The selection survives the copy.
- **Cut.** A cut is its copy and then a delete, wherever it fires. The copy writes the clipboard during the cut event, before anything waits, since a menu's Cut is a scripted cut and the browser closes its clipboard data the moment the event's handlers return. Then a shown source hides, and the delete removes the range the copy read (`components/blocks/clipboard-step.ts :: runClipboardCut` runs both halves for every kind of selection). Across blocks the delete is Backspace's, and the copy and the delete read one answer to what the range covers, so the clipboard holds exactly what the delete took:
  - That answer is `selection/range-coverage.ts :: coverRange` and then `rangeCoverage`. The first snaps table endpoints to whole rows, and takes a closed details whole when the range runs into its hidden body. The second says which blocks the range holds whole.
  - An endpoint on a block with no text position (a rule, or a table the range enters at its first row or leaves at its last) holds that block whole. An endpoint in text always keeps its block, even emptied.
  - The delete then truncates the endpoints it keeps at their offsets, removes what's held whole, merges what's left of the two endpoints into one re-parsed block (a table or a details title row never merges), and removes every container it emptied. It's one undo entry, and the cross-block state collapses.
- **Focused block or selected widget.** A whole-block-focus block that holds focus, or a selected inline widget, copies or cuts its own Markdown on Mod+C / Mod+X: the block's `raw`, or the widget's source slice. These route outside the keymap because a keydown carries no clipboard event.
- **Paste.** Always intercepted. Pasting text inside one block replaces the selection the way typing would (a pending break included, `editor.md` § The editing surface). Like a cut, it reads the selection the moment the event arrives, before a shown source hides. Pasting whole blocks, or pasting across blocks, deletes the selection first. The whole gesture collapses into one undo entry, and focus lands at the end of the pasted content, inside whichever block holds it once the fix-up has merged the text after the caret into the last pasted block. Undo puts the caret back where the paste began.

### The paste pipeline

Before anything is parsed, the **paste transforms** of the plugins this editor activated rewrite the clipboard text in install order: a content-keyed plugin hook for pre-parse conversions (GitHub-alert blockquotes to directive syntax, for instance). The rewrite runs wherever clipboard text reaches `parse()`, including the route for a range holding one block whole (a table, a rule), which bypasses the dispatcher. And one entry isn't a gesture: the instance's `insertMarkdown(md)` enters the surfaces' shared clipboard skeleton below the clipboard unwrap, so a programmatic insertion carries the transforms, the delete-selection-first rule, the single undo entry and the caret landing without a `ClipboardEvent` in sight.

The text is then parsed and routed by a single dispatcher (`src/lib/tree-operations/paste/dispatch.ts` :: `pasteDispatch`), which consults gates in this order:

1. **Reserved chrome forced inline.** A paste landing on a container's chrome leaf is flattened to one line and applied inline, ahead of everything below, because a multi-block clipboard must never split a node whose bytes live in its parent's opener line.
2. **Container-matching unwrap.** When the clipboard's top block declares `containerPaste` and a same-kind ancestor passes its `matchesAncestor` predicate (list: matching ordered flag; blockquote: any), splice the items into that ancestor rather than nesting a sub-container. An empty target is replaced; a non-empty one in cross-block context absorbs the first item into the target leaf, through the same write a keystroke takes, so the leaf's kind follows the joined bytes, and splices the rest as siblings.
3. **Sibling absorb.** For a clipboard top declaring `siblingAbsorb` (list) whose `matchesAncestor` accepts the nearest list ancestor, when the container match declined: splice the pasted items as siblings in the enclosing list, numbered on from the enclosing list's own count at that position (the items after them renumber in sequence), with each marker's glyph and number taken from the parent list (an item's own wider spacing stays: `*  b` lands as `-  b`). Final markers are computed _before_ the splice, a Svelte 5 reactivity requirement, not a stylistic one.
4. **Break-out.** Same gate, `matchesAncestor` rejecting (mismatched ordered flag): split the enclosing list at the target item and splice the pasted list between the halves, at the list's parent level.
5. **Surface forces inline.** A surface that declares no structural hook at all (code blocks) takes everything inline, so pasted Markdown stays verbatim.
6. **Scoped structural.** A surface may declare `onScopedStructuralPaste` and own the whole mutation at an ancestor scope: a table cell slices its table at the row and splices at the table's parent.
7. **Inline.** A single-paragraph clipboard replaces the selection (or goes in at the caret) through `src/lib/tree-operations/leaf-range.ts` :: `replaceRangeInLeaf`. A pasted line's own line ending is dropped where nothing you can see follows it on its line.
8. **Default structural.** Leading slice + pasted blocks + trailing slice.

Three byte-level rules ride the splice:

1. **The pasted blocks end their lines**, list items included, so a clipboard with no trailing newline can't mash its last item into the next one. The commit does that for every block a paste places (`editor.md` § Undo / redo).
2. **A clipboard's trailing blank line is content**, not packaging. It survives the paste as a separation, spent only where nothing in the splice already stands for it. The clipboard says _whether_ a line lands, never which one; the bytes are the document's own ending.
3. **The pasted lines take the document's ending**, its first line break (`src/lib/core/lines.ts` :: `documentLineEnding`). Every entry point normalizes the clipboard to LF, which is what the transforms and the inline hooks read, and the dispatcher writes the document's ending where the text becomes its bytes, so a CRLF document stays CRLF.

The paste modules depend on a `PasteCommitCoordinator` interface satisfied by an editor-actions factory, which is what keeps `tree-operations/paste/` from importing back into `editor-actions/`.
