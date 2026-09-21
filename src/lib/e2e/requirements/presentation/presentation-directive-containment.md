# Feature: preview-block directive-body containment (presentation mode 2)

In `presentationMode="preview-block"`, only the single focused leaf shows its
Markdown source, and a container's own markers never toggle. This pins that rule
across a plugin `:::name` directive container: focusing a body leaf shows that
leaf's own inline markers, but the directive fences (`.directive-marker`) belong
to the container and stay hidden. Runs on `/test/plugins` for the directive
grammar, with `__test.setPresentationMode('preview-block')`. Fixture: `:::foo\nBody with
**bold** here.\n:::\n`.

## Happy paths

- with nothing focused, both the directive fences and the body leaf's inline
  markers are hidden (rendered look)
- focusing the directive body leaf shows its own inline markers (the `**` in the
  caret's block) as source

## Edge cases

- the directive `:::foo` fence stays hidden even while the body leaf is focused:
  it is the container's own marker, not the focused leaf's source, so the path
  that shows nothing holds

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)
