# Feature: a plugin mark edits like a built-in one

The `highlight-mark` harness plugin lists `mark({ marker: '==', chord: 'Mod+Shift+h' })`. A mark
is a policy row and a delimiter run, so in live mode it should behave as `**` does. Seed
`highlight-mark`: block 0 `A ==bright== word`, block 1 `plain words here`.

## Happy paths

- In live mode the `==` runs are hidden and the text shows in the mark's element; source mode
  shows them.
- Selecting words and pressing the chord writes `==words==`; pressing it again unwraps them.

## Edge cases

- Enter inside the mark in live mode closes it before the cut and reopens it after.
- A letter typed at the mark's end in live mode joins it, as at the end of `**bold**`.
- Typing its run pairs it, as `~~` does, so the text typed next lands inside: `==hi==`.

Miss-analysis: before this lane a plugin's syntax was a widget or literal text, so no row asked a
plugin construct to edit like a mark.
