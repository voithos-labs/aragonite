# Feature: Unclosed-fence auto-close on structural escape

Leaving an unclosed fenced code block via Enter to author a new block below mints the
closing fence into the code node's raw, so the live tree converges with a reload (GFM
lazy continuation no longer absorbs the trailing blocks into the open fence). The close
and the new block's creation land as one undo entry.

## Happy paths

- escape below an unclosed fence closes it: type into an unclosed fence, Enter past the
  trailing blank line to a new paragraph, type text — the source gains a closing fence
  line before the new block, and `parseConverged()` holds
- the closed fence and the new paragraph are distinct live blocks that survive a reparse
  (block count is stable across serialize→parse)
- nested escape stays scoped: a fence inside a blockquote auto-closes within the quote and
  the new paragraph lands inside it — the container raw rebuilds cleanly and `parseConverged()`
  holds

## Edge cases

- undo is atomic: one Ctrl+Z after the escape restores the open fence AND removes the
  created paragraph together (a single entry, not two)
- a fence that is already closed does not gain a second closer on Enter-exit (the
  closed-fence exit path is untouched)
