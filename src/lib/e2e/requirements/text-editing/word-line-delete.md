# Text editing: a word or line delete takes the same bytes on every engine

A word delete (Ctrl+Backspace, Option+Backspace on a Mac) and a line delete at a caret are written
by the editor, by the Unicode word rule and the line's edges, so Chromium, Firefox and WebKit take
the same bytes. A word is read the way the screen shows it: a marker live mode hides is no word of
its own, and a widget is one character.

## Happy paths

- `foo bar` and two spaces, word Backspace at the end: `foo `, and one undo puts it back
- `foo bar`, word Delete at the start: `bar` (a Mac keeps the space: ` bar`)
- a code block's `let value`, word Backspace after `value`: `let `

## Edge cases

- a full stop between letters ends a word on every engine: word Delete at the start of
  `foo.bar, baz` leaves `.bar, baz`, and word Backspace before `baz` in a code body's `foo.bar baz`
  leaves `foo.baz`
  - Miss-analysis: every row ran words without punctuation inside them, so nothing showed Firefox's
    and WebKit's segmenters joining `foo.bar` where Chromium's cuts it
- `a &copy;`, word Backspace after the entity: the entity goes whole, as Backspace takes it
- live mode, each of these leaves the same bytes as selecting the same visible text with
  Shift+ArrowLeft and pressing Delete:
  - `**one two three** x`, after `two`
  - `a **bold** c`, after the hidden closer
  - `a &copy;word c`, after `word`
  - `**bold** x`, word Delete at the start: `bold` and the space after it (`bold` alone on a Mac)

## User interactions

- the key: the platform's word modifier with Backspace or Delete
- a line delete as a script sends it (the `beforeinput` alone): to the line start in a one-line
  paragraph empties it; to the line end on a code block's first line takes that line's text and
  leaves the next line; to the line start at the end of a paragraph that wraps leaves the lines
  above, never all of it
- a line delete to the line end past a widget or a replace decoration closing the line takes it
  (`lead ![x]`, `lead HIDDEN` under a replace decoration), and one to the line start of a line a
  picture opens after a hard break takes the picture and stops at the break
  - Miss-analysis: no line-delete row ended at a widget, and a point on a widget's box resolves
    before it on Firefox (a picture) and on every engine (a replace decoration)

## Error cases

- zero `[invariant:…]` console fires across every row (automatic via the shared e2e fixture); the
  collapsed-delete check (G1.132) fires if a word or line delete reaches `input` undecided

## Miss-analysis

- Word and line deletes were the browser's, read back afterwards, so each engine's own word rule
  decided the bytes and no row compared them.
