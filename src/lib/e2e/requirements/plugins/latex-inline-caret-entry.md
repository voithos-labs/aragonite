# Feature: Inline math: moving the caret sideways into a formula shows its source

Moving the caret sideways against an inline-math widget opens its source for editing, the way
Obsidian does. The caret never lands in the invisible widget-selected state math used to fall
into: ArrowLeft and Backspace from the trailing edge, and ArrowRight and Delete from the leading
edge, all show the editable `$…$` source at the edge that was entered, and the keypress that
enters changes nothing in the tree, so it pushes no undo entry. Whether a kind shows its source
or gets selected is decided in one place, from the kind's `revealSource` flag: images keep
select-then-step (pinned in `blocks/image/caret-arrows-horizontal.md` and `backspace-delete.md`)
and the kinds that can show a source do that.

Seed (`?seed=math`): `Before $x^2$ after` in block [0], and a `Next` paragraph in [1].
Cross-block scenarios load their own two-block seeds.

## Happy paths

- caret to the right of the widget, ArrowLeft: the source is shown at the trailing edge with the
  bytes unchanged, and a typed character lands after the closing `$`
- caret to the left of the widget, ArrowRight: the source is shown at the leading edge, and a
  typed character lands before the opening `$`

## Edge cases

- walking the caret left out of the shown source, past its leading boundary, closes it back to
  the rendered widget with the source unchanged
- Backspace to the right of the widget shows the source fully intact rather than silently
  deleting the whole widget; the next Backspace visibly eats the trailing `$`
- Delete to the left of the widget shows the source at the leading edge; the next Delete eats
  the opening `$`
- Shift+ArrowLeft over the widget extends a real selection, one that is not collapsed, without
  showing anything: a selection sweep never opens a source

## User interactions

- ArrowRight from the block above onto a block that starts with math: the source is shown at the
  leading edge, the edge the move arrived at
- ArrowLeft from the block below onto a block that ends with math: the source is shown at the
  trailing edge
- all gestures are real keyboard input; which way the caret faces is verified by typing a marker
  character, the source being shown by the widget count dropping to zero, and the bytes staying
  put by the serialized source

## Error cases

- the keypress that enters pushes no undo entry and changes no bytes, since only what is shown
  changes
