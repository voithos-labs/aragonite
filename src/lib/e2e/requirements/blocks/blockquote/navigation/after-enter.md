# Feature: Blockquote Navigation — After Enter

Navigation across the transient empty inner paragraph created by Enter.

## After Enter (create empty inner paragraph)

- Enter at end of first inner paragraph creates a new empty paragraph; ArrowDown from the empty paragraph lands on the next (formerly second) inner paragraph
- Enter at end of first inner paragraph creates a new empty paragraph; ArrowUp from the empty paragraph lands on the first inner paragraph
- Repeatedly: after multiple Enter presses creating multiple empty paragraphs, navigation crosses each empty paragraph correctly
- Regression: structural ops inside a blockquote previously produced stale `innerBlockRefs` because splicing directly on `$state` proxies during a keyed `{#each}` re-render left shifted/re-mounted children unable to rebind their slots. After a split, ArrowDown from the shifted child position must still traverse to the next inner paragraph — not to a stale ref or a null focus target.
- Parser constraint: there is no Markdown source that loads directly to a `{"1", "", "2"}` child layout. CommonMark collapses blank `>` lines into paragraph separators, so the empty middle child only exists as a transient CST state produced by a real `splitBlock`. Tests covering that state must build it via an actual Enter press.
