# Text editing: a typed letter lands at the caret on every engine

A letter typed at a caret goes where the caret is, whatever is beside it, on Chromium, Firefox and
WebKit. Every row runs four times: by the key and as a soft keyboard sends it (the `insertText`
alone, no keydown), in source and live mode. Firefox's soft-keyboard column is the harness's own
`beforeinput` plus `execCommand` (`e2e/insert-text.ts`), since Firefox over BiDi has no such input,
so it says what the editor does with the event, not what the engine would.

## Happy paths

- `lead` then a picture, Ctrl+End, a letter: it lands after the picture
- the same, End, a letter: after the picture
- the same, the editor's own caret placed at the block's end: after the picture
- the same, a click right of the picture: after the picture
- a picture alone on its line, a click right of it: after the picture
- a picture opening the block, the caret before it: the letter lands before the picture

## Edge cases

- `lead &copy;`, a click right of the entity: after the entity
- `lead $x^2$` with the math plugin, a click right of the formula: after the formula
- `lead HIDDEN` with a replace decoration over `HIDDEN`, Ctrl+End: after the decoration's bytes
- `hello` with a widget decoration at its end, Ctrl+End: after `hello`
- `lead<br>`, the caret before the line break: the letter lands before it (Firefox inserts nothing
  there by itself)
- a table cell `Left<br>`, the caret before the line break: the same
- a link typed to completion at a line's end (`plain tail [ab](u)`), then a letter: it lands after
  the `)`, never inside the link text, where Chromium and WebKit aim it
- `abc`, Shift+Enter at its end, a letter: it lands on the line Shift+Enter opened

## User interactions

- a picture selected whole by a click on it, a letter: the letter replaces the picture (`lead Z`).
  WebKit's soft-keyboard row is skipped: Playwright's WebKit sends no input while the page holds no
  selection, and a selected picture holds none

## What a reverted fix reds

The browser's own insert lands right at most of these spots, so turning the editor's decision off
leaves those rows green; a write that lands somewhere else (the typed write aimed at offset 0, or
one past the caret for the picture that opens the block) reds the rows the editor writes itself. On
Chromium the replace decoration's rows never reach that write, since the caret there sits in text.
The rows that red with the decision off are the selected picture by soft keyboard (Chromium
writes at the block's start, Firefox writes nothing) and the line break that ends a paragraph or a
cell on Firefox. The link typed to completion stays green with it off too: Chromium and WebKit aim
the letter inside the link text, and the read-back still lands it after the `)`. The unit rows in
`test/blocks/editable/typed-insert.test.ts` for a target aimed away from the caret are the ones that
red there.

## Miss-analysis

- Each route that typed beside a widget was tested for the engine shape it was written for, and no
  row typed with a soft keyboard over a selected picture, so text a phone's keyboard sent there
  went to the block's start or nowhere.
