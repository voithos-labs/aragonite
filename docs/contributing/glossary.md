# Glossary

Open this when a word in the code or the docs doesn't parse. First the terms the editor is built on, then the made-up words a few symbol names still carry. Everything else is meant to be plain English (meant to be).

## Terms you need

| Word | What it means |
| --- | --- |
| chrome | The parts of a block that aren't its content: fences, markers, a title row, borders, buttons. `reservedChrome` declares a child leaf that holds one, like a title. |
| commit | Two meanings. In the editor, one change to the tree with its undo snapshot and reparse. Otherwise a git commit, and the commit gate is the test run before one. |
| container, leaf | A container holds child blocks (blockquote, list, list item, table, table row, plugin containers). A leaf doesn't. |
| CST | Concrete syntax tree: the parsed Markdown, where every node keeps its own slice of the source, markers included. The single source of truth. |
| descriptor | The record each block kind registers, saying how it merges, edits and renders (`BlockKindDescriptor`). |
| guard | A dev-mode check of an invariant, off in production. A `G1.28` number is catalogued in `docs/design/invariants.md`, a `VR-5` tag (a windowing hazard) in `docs/design/virtual-rendering.md`. |
| kind | The string on a node that says what block it is (`paragraph`, `table`, a plugin's name). Every registry looks things up by it. |
| live mode | The presentation mode that hides every marker standing over content and stays editable. |
| opener | The parser function that recognizes one kind's syntax (`BlockOpener`). |
| path | Child indices from the document root down to a block. `[2, 0]` is the first child of the third block. |
| raw | A node's own source bytes, markers included. Serializing reads it. |
| reveal | Two meanings. Showing a construct's hidden source while the caret is in it (a formula's TeX), or windowing scrolling a block into its mounted range. |
| scope | One block list: the document root's, or one container's children. Each windows on its own and commits through its own `CommitScope`. |
| surface | A contenteditable element plus the component code that owns it, like a text block's editable area or a table cell (`createEditableSurface`). |
| trivia | Bytes that carry no content: blank and whitespace-only lines. `leadingTrivia` is the blank lines before a node. |
| unshare | Copy a node before writing it, along with its spine (the chain of parents up to the root), so the undo snapshot keeps the old one. |
| walk | Reading a block's DOM text in order, to turn a place in it into a raw offset and back. A walk offset counts characters that way, marker prefix included (`browser/offsets.ts`). |
| windowing | Rendering only the blocks near the viewport. The unmounted ones stand behind spacers, empty divs with their height. |

## Words in symbol names

| Word | What it means | Where you'll see it |
| --- | --- | --- |
| ambient | The marker prefix a container draws in front of its first child's text (a footnote's `[^label]: `). On screen, not editable. | `AmbientPrefix`, `buildAmbientSpan` |
| dialect | Which convention a path is written in: document-absolute, or relative to a container. | `commit-path-dialect` |
| door, funnel | The one entry point every path for an operation goes through. | `composeExpandDoor`, `copyThroughFunnel` |
| fold | Closing a construct's shown source before an edit. Also a container collapsing or merging after a structural change. | `RevealFold`, `publishAncestryFolds` |
| island | An inline widget the caret can't enter (an image, a formula, an emoji). | `data-decoration-island`, `island-dom.ts` |
| ladder, rung | An ordered list where the first entry that applies wins, and one entry in it, usually an inline syntax handler at one priority. | `ladderToken`, `registerWikiRung` |
| mint | Create an id, a node or a command at the one place allowed to. A second create throws. | `mintCommandId` |
| oracle | The estimator that guesses a block's height before it's measured. | `HeightOracle`, `createHeightOracle` |
| peel | Strip one layer of markers (a `> `, a list marker, an emphasis run) off a line or a range. | `peeledToContent` |
| rail | The code block's side gutter, holding the language chip and the copy button. | `CodeBlockRail` |
| seam | The join between two blocks, or the boundary between two pieces of code. | `JoinSeam` |
| seat | Where the caret sits or a typed byte goes, or putting the caret there. | `edge-seat.ts`, `compositionSeat` |
| settle | Recompute what a structural edit left stale: blank lines, the joins between neighbours, a container's kind. | `checkSettledOnce` |

## Adding a word

A word with no plain-English reading goes in the table at the top of `src/lib/test/invariants/lint/comment-house-words.test.ts`, with its inflections and the phrase to write instead. From then on the test quotes that phrase wherever the word turns up. A word plain English already has (fold, surface) stays off that table, since it would flag real sentences. Where a symbol's name forces a banned word, gloss it in three words or fewer at first use, and give it a row above.
