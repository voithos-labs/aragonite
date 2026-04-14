# Feature: Blockquote Navigation

Arrow-key navigation inside and across blockquote boundaries, both before and after various structural edits. Ensures the focus-delegation chain (TextEditableBlock → BlockquoteBlock.nestedActions.moveFocus → Editor.moveFocus) stays correct after every edit pattern.

## Basic traversal (baseline — must work without prior edits)

- ArrowDown from first inner paragraph lands on second inner paragraph
- ArrowUp from second inner paragraph lands on first inner paragraph
- ArrowDown from the last inner paragraph exits the blockquote to the next top-level block
- ArrowUp from the first inner paragraph exits the blockquote to the previous top-level block
- ArrowDown from a paragraph before the blockquote enters the blockquote's first inner paragraph
- ArrowUp from a paragraph after the blockquote enters the blockquote's last inner paragraph

## After Enter (create empty inner paragraph)

- Enter at end of first inner paragraph creates a new empty paragraph; ArrowDown from the empty paragraph lands on the next (formerly second) inner paragraph
- Enter at end of first inner paragraph creates a new empty paragraph; ArrowUp from the empty paragraph lands on the first inner paragraph
- Repeatedly: after multiple Enter presses creating multiple empty paragraphs, navigation crosses each empty paragraph correctly
- Regression: structural ops inside a blockquote previously produced stale `innerBlockRefs` because splicing directly on `$state` proxies during a keyed `{#each}` re-render left shifted/re-mounted children unable to rebind their slots. After a split, ArrowDown from the shifted child position must still traverse to the next inner paragraph — not to a stale ref or a null focus target.
- Parser constraint: there is no Markdown source that loads directly to a `{"1", "", "2"}` child layout. CommonMark collapses blank `>` lines into paragraph separators, so the empty middle child only exists as a transient CST state produced by a real `splitBlock`. Tests covering that state must build it via an actual Enter press.

## After Backspace (delete empty inner paragraph)

- Delete an empty inner paragraph via Backspace; ArrowDown from the preceding paragraph lands on the paragraph that was after the deleted one
- Delete an empty inner paragraph via Backspace; ArrowUp from the succeeding paragraph lands on the paragraph that was before the deleted one
- Regression: same stale-ref hazard as the split case — after merging the empty middle back into its predecessor, ArrowDown from the merge target must traverse correctly to the surviving next child.

## After U2 unwrap

- Rule U2 unwrap (Backspace at start of first inner paragraph) lifts it out of the blockquote; ArrowDown from the lifted block lands on the shrunk blockquote's new first inner paragraph
- Rule U2 unwrap; ArrowUp from the shrunk blockquote's first inner paragraph lands on the lifted block

## Boundary crossing

- Paragraph before a blockquote: ArrowDown enters the blockquote
- Paragraph after a blockquote: ArrowUp enters the blockquote
- Both work after any of the above edits

## Nested blockquote operations

- `> > deep` + ArrowDown / ArrowUp between the inner paragraphs
- After U2 unwrap of the inner blockquote, navigation through the surviving outer blockquote still works

## Long edit permutations

- Multiple unrelated edits (create, type, delete, navigate) in sequence do not leak state that breaks navigation at the end of the sequence
