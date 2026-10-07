# Presentation: Shift+Enter at the end of a block

Shift+Enter at the end of a block opens an empty line under the text, with the caret on it, in
every mode that edits. Nothing is written yet. A hard break in Markdown is a backslash at the end
of a line, and a backslash with no next line is just a backslash, so the break's bytes go in with
the first thing that lands on the new line, whichever way it arrives. Anything else (a click
elsewhere, a caret key that takes the caret off the line, the block losing focus) drops the line
and leaves the bytes alone.

Miss-analysis: the break used to be written straight away as a trailing backslash and read back
from the bytes, and every test typed a letter after it through the key route. So nobody saw that a
backslash typed by hand reads as a break (#522), that punctuation, a paste or an IME commit wrote
an escape instead, or that a second Shift+Enter escaped the first one and sent the caret back up
(#614).

## Happy paths

- `abc def`, End, Shift+Enter twice, then `x`: nothing is written until the `x`, which lands on the
  third line, `abc def\` / `\` / `x`. Source and live mode.

The other ways in write the break the same way: a punctuation key (`abc\` / `-`, not an escape), a
paste and an IME commit, in source and live mode. Those are pinned below the browser, in
`src/lib/test/blocks/text/pending-break-spend.test.ts`; the composed rows after a hidden closer
below still drive a real composition.

## Edge cases

- `see C:`, End, type `\` then `U`: `see C:\U`. A typed backslash is a backslash. Source and live
  mode.
- live, `a **bold**`, `an *it*` and `` via `code` ``, Shift+Enter at the end, then an IME commit
  of `か`: the line stays drawn while you compose, and the run starts it (`a **bold**\` / `か`),
  outside the construct. Miss-analysis: every composed row ran on a plain paragraph, where the
  composition lands on the right side of the text whether the line is drawn or not.
- Caret keys on the open line have their own file, `pending-break-keys.md`.
- live, `abc def`, Shift+Enter at the end, `x`, Backspace: the line is emptied. The next Backspace
  deletes something rather than being swallowed (#690).

## User interactions

- Shift+Enter at the end, then a click in another block: the source is unchanged and the first
  block draws no extra line. Source and live mode.
