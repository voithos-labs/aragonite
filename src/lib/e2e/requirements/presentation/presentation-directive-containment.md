# Feature: preview-block directive-body containment (presentation mode 2)

In `presentationMode="preview-block"`, only the single focused leaf shows its
Markdown source. This pins that rule across a plugin `:::name` directive
container, whose opener line is its own first row: focusing a body leaf shows
that leaf's own inline markers, while the opener line's `:::foo` shows only when
the caret is on that line. Runs on `/test/plugins` for the directive grammar,
with `EditorPage.setPresentationMode('preview-block')`. Fixture: `:::foo\nBody with
**bold** here.\n:::\n`.

## Happy paths

- with nothing focused, both the opener line's `:::foo` and the body leaf's inline
  markers are hidden (rendered look)
- focusing the directive body leaf shows its own inline markers (the `**` in the
  caret's block) as source

## Edge cases

- the opener line's `:::foo` stays hidden while the body leaf is focused: it is
  another block's marker, not the focused leaf's source
- the caret on the opener line shows its `:::foo`, and the body's markers hide again

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)
