# Feature: Plugin Admonitions, dogfood battery

The admonitions plugin's one box type, `admonitions/admonition`, answers five `:::` names
(`note`/`tip`/`important`/`warning`/`caution`), and its data is the name. Child 0 is the editable
title row; the opener line carries the name and the title, and the editor writes the box's other
lines around its children after every edit.

The seed (`?seed=admonitions`) holds a heading, an untitled `:::important`, a titled
`:::tip Pro tip` and a titled `:::caution Heads up`, a convertible top-level `> [!CAUTION]`
alert, and a `> [!NOTE]` inside a code fence.
The harness has a "Convert GitHub alerts" button that runs `getSource()`
through the transform and back into `source`. The checks read the tree and the source by path
through `window.__test`; the interactions are real keyboard and mouse. The behavior when the
plugin is not installed has unit tests (`fallback.test.ts`) and is deliberately not repeated
here.

## Happy paths

- kinds render distinctly: the important, tip and caution admonitions each render a box
  carrying its own `data-kind`, so the user can tell the kinds apart
- title rendering: a titled admonition's opener line shows its title after the `:::tip`; an
  untitled one shows its bare `:::important` in source mode, and where that line is hidden
  (reading mode) the capitalized kind name stands in as a placeholder (`Important`)

## User interactions

- typing on the opener line: real keyboard input at the end of the untitled `:::important` line
  writes `:::important Read me` and the box stops flagging the title empty; the source
  round-trips stable
- `Mod+7` cycles the kind: a real chord on the tip admonition advances it to `:::important` (the
  source changes and exactly one `replaceBlock` edit op fires), and one `Ctrl+Z` restores
  `:::tip`, so each keypress is one undoable commit; round-trips stable
- convert button: clicking it rewrites the top-level `> [!CAUTION]` blockquote to a `:::caution`
  admonition and leaves the fenced `> [!NOTE]` byte-identical (never `:::note`, since only a
  real top-level blockquote alert converts), then disables itself because nothing convertible is
  left; the converted document round-trips stable

## Regressions

- Letters typed at the start of an opener line, reached by ArrowDown from a paragraph flush above
  the admonition: in source mode they land where they were typed (`qw:::tip`); in both modes every
  other line stands once, the tree is the one a reload reads, and undo restores the document. The
  admonition's lines were written twice and the heading under it was lost. Miss-analysis: no test
  typed in an opener line's `:::name` with a block flush against the container; every row typed
  in the title, or had a blank line above.
- Backspace or Delete inside the opener line's marker, same document: in source mode the one
  character goes (`::tip`); in both modes no line is doubled and the tree is the one a reload reads.
