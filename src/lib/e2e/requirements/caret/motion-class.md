# Caret: where a caret key lands

A caret key moves the caret to the same spot on every engine, because the editor decides it at the
keydown (`caret/caret-motion.ts`). A word key (Ctrl+Arrow, Option+Arrow on a Mac) lands where the
word delete ends, Home and End land on the editor's line edge, Ctrl+Home and Ctrl+End (Cmd+Up and
Down on a Mac) on the block's text edge, and a plain arrow crosses a span the caret can't stop inside
in one press. With Shift, each key selects what the matching delete takes. Every row runs on
Chromium, Firefox and WebKit; on macOS the rows press the Mac chords, and a forward word stops at
the word's end.

## Happy paths

- a word key lands where the word delete ends, press after press: a bold run in source and in live
  mode, punctuation (`foo.bar, baz-qux end`), an entity and a picture in a line, a word beside an
  entity, a picture or a formula, underscores on screen, a CRLF line ending, a code body, a table
  cell, a list item
- End lands past a trailing picture, and Ctrl+End too; Home lands before a leading picture, on a
  first line and on a line after a hard break; End from before a leading picture reaches the line's
  end
- End lands past a trailing replace decoration
- End stays before a trailing `<br>`, whose far side is the next line's start; Ctrl+End goes past it
- Home in a list item lands past its marker, in a live heading past its hidden `# `
- a picture opening a soft-wrapped line: from line 1's end (raw 17) Home lands at 0 and End stays;
  Home on line 2 lands before the picture, and a letter typed there goes before it
- a plain arrow crosses a decoded entity, a plugin emoji, a replace decoration, an entity in a cell,
  and a CRLF pair in prose and in a code body in one press, and Shift extends across the same span

## Edge cases

- a word key over a range in one block moves from the range's edge on its side (Left from its
  start, Right from its end), the way a plain arrow collapses it
- at the bound a word key faces, the key leaves the block as a plain arrow would
- End where WebKit and Firefox park the caret between `\r` and `\n`, then Shift+ArrowRight: the
  selection runs across the pair

## User interactions

- every Shift row: Shift plus the key, pressed as often as the row, then Backspace, leaves the same
  document as the matching delete pressed as often (the word delete, or the soft-line delete a
  Mac's Cmd+Backspace sends). A start beside a picture skips the check, since a delete there
  selects the picture, as the plain key does
- each edge row sends both spellings of its key, Home and End with their modifiers and the Mac's
  Cmd+Arrow, on every engine; on macOS the Home and End spelling of a row the browser moved for
  itself skips, since macOS scrolls on those keys
- from a selected picture, Home, Mod+Home and Mod+End leave the picture for the line's or block's
  edge, and each extend keeps the picture in the selection, anchored at its far edge
- on the line Shift+Enter opened at a block's end, Home keeps that line

## Error cases

- zero `[invariant:…]` console fires across every row, G1.163 (`caret-motion-decided`) included,
  which fires when the browser's own move runs after the editor's

## Miss-analysis

- Word keys, Home and End were the browser's, so each engine's own word rule and line edge reached
  the user: Firefox and WebKit skipped punctuation and crossed widgets their own way, Chromium's
  Home skipped a picture opening a wrapped line (#803), End stopped short of a trailing decoration.
  No row pressed a word key on more than one shape, and none on more than one engine.
- Engine census R2: every step-over row ran in Chromium, whose native arrow already crosses a
  non-editable widget and a CRLF pair in one press, and no gating run used WebKit or Firefox.
- Five editor sites each compared Home or End, so Cmd+Arrow on a Mac reached none of them: every
  spec pressed Home and End, and the one macOS run read Home as a scroll.
