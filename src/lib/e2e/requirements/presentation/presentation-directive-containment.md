# Feature: preview-block directive-body containment (presentation-mode rung 2)

In `presentationMode="preview-block"`, only the single focused LEAF shows its
Markdown source. Container chrome never toggles. This pins that rule across a
plugin `:::name` directive container: focusing a body leaf reveals that leaf's own
inline markers, but the directive fences (`.directive-marker`) belong to the
container and stay hidden. Runs on `/test/plugins` for the directive grammar, with
`__test.setPresentationMode('preview-block')`. Fixture: `:::foo\nBody with
**bold** here.\n:::\n`.

## Happy paths

- with nothing focused, both the directive fences and the body leaf's inline
  markers are hidden (rendered look)
- focusing the directive body leaf reveals its own inline markers (the `**` under
  the caret's block) as source

## Edge cases

- the directive `:::foo` fence stays hidden even while the body leaf is focused —
  it is container chrome, not the focused leaf's own source, so the no-reveal path
  holds

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)
