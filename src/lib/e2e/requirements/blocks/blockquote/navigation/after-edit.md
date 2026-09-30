# Feature: Blockquote Navigation, After a Structural Edit

Navigation once a structural edit has rebuilt the quote. All four kinds of edit share one hazard: splicing directly on `$state` proxies during a keyed `{#each}` re-render leaves children that shifted or re-mounted unable to register themselves at their new list position, so `innerBlockRefs` goes out of date and an arrow key lands on an old reference or on no focus target at all.

## After Enter (create empty inner paragraph)

- Enter at end of first inner paragraph creates a new empty paragraph; ArrowDown from the empty paragraph lands on the next (formerly second) inner paragraph
- Enter at end of first inner paragraph creates a new empty paragraph; ArrowUp from the empty paragraph lands on the first inner paragraph
- Repeatedly: after multiple Enter presses creating multiple empty paragraphs, navigation crosses each empty paragraph correctly
- How the fixture is built: `> 1` / `>` / `>` / `> 2` does load to a `{"1", "", "2"}` child layout, where the second blank `>` line is an empty paragraph and the first one separates them, but these tests build the empty middle with a real Enter press, because what they guard is the re-render the split itself causes, which a loaded document never runs.

## After Backspace (delete empty inner paragraph)

- Delete an empty inner paragraph via Backspace; ArrowDown from the preceding paragraph lands on the paragraph that was after the deleted one
- Delete an empty inner paragraph via Backspace; ArrowUp from the succeeding paragraph lands on the paragraph that was before the deleted one

## After U2 unwrap

- Rule U2 unwrap (Backspace at start of first inner paragraph) lifts it out of the blockquote; ArrowDown from the lifted block lands on the shrunk blockquote's new first inner paragraph
- Rule U2 unwrap; ArrowUp from the shrunk blockquote's first inner paragraph lands on the lifted block

## Long edit permutations

- Multiple unrelated edits (create, type, delete, navigate) in sequence do not leak state that breaks navigation at the end of the sequence
