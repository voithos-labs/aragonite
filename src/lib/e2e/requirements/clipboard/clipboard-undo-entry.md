# Feature: a cut or paste is its own undo entry

Typing in one block groups into one undo entry until a pause. A cut or a paste ends that run:
one Ctrl+Z takes back the cut or paste alone, and the typing before it and after it each undo on
their own. The rule holds wherever the paste comes from (Ctrl+V, a menu's Paste, the
`insertMarkdown` call), since they all run the one paste step every editable block shares.

## Happy paths

- Type `xy` in a paragraph, then Ctrl+V at once: Ctrl+Z removes the pasted text and keeps `xy`
- The same in a code block's body and in a table cell
- Ctrl+V in a paragraph, then type `z` at once: Ctrl+Z removes `z` and keeps the paste, a
  second Ctrl+Z removes the paste, and two redos put back the paste, then the `z`
- The same in a code block's body and in a table cell
- Type `xy`, select the `y` with Shift+ArrowLeft, Ctrl+X at once: Ctrl+Z puts the `y` back and
  keeps `xy`, in a paragraph, a code block and a table cell
- Select the `b` with Shift+ArrowLeft, Ctrl+X, then type `z` at once: Ctrl+Z removes `z` and keeps
  the cut, a second Ctrl+Z puts the `b` back, in a paragraph, a code block and a table cell
- Type `xy` in a paragraph, then right-click it and pick Paste at once: Ctrl+Z removes the pasted
  text and keeps `xy`; the same through a table cell's menu
- Type `xy`, then paste over a range across two blocks, cut that range, or paste a grid into a
  table cell, and type `z`: the first Ctrl+Z removes `z`, the second the paste or cut, keeping `xy`

## Miss-analysis

- An inline paste and an in-block cut joined the typing burst before them, so one Ctrl+Z took
  back both (#613). Every paste and cut undo test waited past the typing pause, or pasted with no
  typing before it, so none saw the burst still open.
