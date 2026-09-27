# Feature: a press in a preview mode lands where it was aimed

Both preview modes show a block's markers once it has focus: prose shows its `**` and `#`,
a code block shows its fence lines. The browser focuses a block on the press itself, and
then works out where the caret goes, so a reveal that paints on focus moves the text under
the pointer before the browser looks. So which block shows its markers doesn't change while
the button is down: the caret or the selection's anchor lands on the character you pressed
on, and the markers show once the button comes up.

## Happy paths

- Drag from inside an unfocused code block (preview-block and preview-inline): the
  selection's anchor is the character you pressed on, and the fence lines show after the
  release.
- Drag from inside an unfocused paragraph with bold text (preview-block): the anchor is the
  character you pressed on, and the `**` markers show after the release.

## Miss-analysis

- Every click test in the preview modes checked the caret inside a range of offsets wide
  enough to swallow the shifted markers (`presentation-preview-block.spec.ts`), and none
  pressed and dragged, where the anchor shows the shift exactly.
