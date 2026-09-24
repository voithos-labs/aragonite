# Feature: erasing a setext heading's title

A setext heading's underline (`===` or `---`) sits under its title and no presentation mode draws
it. Once the title's last line is empty, the underline would underline nothing: `===` would show
up as a paragraph and `---` as a divider. So the underline goes with the title, the way an emptied
ATX heading gives up its `#`, and what is left is an empty paragraph. Driven on `/test/editor`
with real keys; the source, the block kinds and the caret are what each scenario checks.

Miss-analysis: the typing cases all left text in the title, and no case erased it.

## Happy paths

- End then Backspace until the title is gone, in source and live mode, under a `===`, a `---` and a ten-dash underline: the heading becomes an empty paragraph and the underline goes with it (`Plan\n===\n\nnext\n` becomes `\nnext\n`, two paragraphs and no divider); the caret stays in the empty paragraph

## Edge cases

- a two-line title whose second line is erased, in both modes: the title's last line is empty, so the underline goes and the first line stays as a paragraph (`Plan\nmore\n---\n` becomes `Plan\n\n`, one paragraph and no divider). Where the caret lands is not pinned here: a paragraph's emptied last line has the same open question
- one undo after erasing the title puts the title and its underline back, and the block is a setext heading again

## User interactions

- a real click, then End and Backspace; the caret and the input go through the browser
- assertions read the source, the block kinds and the caret through the bridge

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)
