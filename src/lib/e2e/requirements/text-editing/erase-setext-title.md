# Feature: erasing a setext heading's title

A setext heading's underline (`===` or `---`) sits under its title and no presentation mode draws
it. Once the title's last line is empty, the underline would underline nothing: `===` would show
up as a paragraph and `---` as a divider. So the underline goes with the title, the way an emptied
ATX heading gives up its `#`, and what is left is an empty paragraph. That holds for every edit
that empties the title, not only typing. Driven on `/test/editor` with real keys and a real mouse;
the source, the block kinds and the caret are what each scenario checks.

Miss-analysis: the typing cases all left text in the title, and no case erased it. Then the rule
went in where the block reads its own text back, and every erase case typed the title away, so
the edits that write the bytes without that read (a range delete, a cut, a paste, a drop) were
never asked about.

## Happy paths

- End then Backspace until the title is gone, in source and live mode, under a `===`, a `---` and a ten-dash underline: the heading becomes an empty paragraph and the underline goes with it (`Plan\n===\n\nnext\n` becomes `\nnext\n`, two paragraphs and no divider); the caret stays in the empty paragraph
- on `Plan\n---\n\nnext\n`, in both modes, each edit that empties the title leaves no divider, puts the caret in what is left, and one undo puts the title and its underline back as a setext heading:
  - End then Backspace until the title is gone: `\nnext\n`, the caret at the start of the empty paragraph
  - Home, a shift-click at the end of `next`, then Backspace: `\n`, one empty paragraph with the caret in it
  - End, Shift+Home, then Ctrl+X: `\nnext\n`, the caret at the start of the empty paragraph
  - End, Shift+Home, then pasting a single space: ` \nnext\n`, the caret after the space
  - a double-click on the title, then dragging it to the start of `next`: `\nPlannext\n`, the caret after the dropped `Plan`

## Edge cases

- a two-line title whose second line is erased, in both modes: the title's last line is empty, so the underline goes and the first line stays as a paragraph (`Plan\nmore\n---\n` becomes `Plan\n\n`, one paragraph and no divider). Where the caret lands is not pinned here: a paragraph's emptied last line has the same open question (#467)
- the undo cases are at the top level only: inside a list or a quote the erase takes two undos (#471)

## User interactions

- a real click, then keys, a shift-click or a drag; the caret, the input and the clipboard go through the browser
- assertions read the source, the block kinds and the caret through the bridge

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)
