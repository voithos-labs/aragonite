# Feature: blocks a plugin draws with `draw`

A ` ```field ` box (`fencedBlock`, `edit: 'box'`, `routes/test/plugins/drawn`) edits its two-line
body in a field of its own and takes the caret through `Drawn.focus`, handing it back with
`ctx.leave`; leaving the field writes its text as the fence's body (`Draft.body`). It leaves
Escape unhandled. The seed puts a paragraph above it and one below.

## Happy paths

- ArrowDown from the line above: the caret enters the field's first line at the column it had.
- ArrowUp from the line below: the caret enters the field's last line at the column it had.
- ArrowUp on the field's first line: the caret leaves into the line above at the field caret's column.
- ArrowDown on the field's last line: the caret leaves into the line below at the field caret's column.

## Edge cases

- ArrowRight at the end of the line above enters the field at its start; ArrowLeft there leaves back to that line's end.
- ArrowLeft at the start of the line below enters the field at its end; ArrowRight there leaves back to that line's start.
- The caret at an offset inside the field, Alt+ArrowDown moves the box down a block and Ctrl+Z puts it back, with the caret at that same offset in the field.
- After typing in the line above (which moves the box's bytes with no redraw), typing in the field and leaving it with ArrowUp writes the field's text into the fence's body, and one Ctrl+Z takes it back out.

## The field's unwritten text (`Drawn.save`)

Miss-analysis: the fixture wrote only on blur and no row ran an undo with text typed in it, so an undo that reached the editor lost the text. The field writes through `Draft.body` when it leaves or when the editor calls its `save`, and while it holds unwritten text it keeps Ctrl+Z, as mermaid's box does. Each row types a `!` at the end of the line above first.

- Text typed in the field, then an undo the editor runs with focus still in the field (a toolbar's `runCommand('history.undo')`): the bytes keep the `!`, the field shows its body as written, and a redo writes the typed text. Leaving the field after the undo writes nothing.
- Text typed in the field, then a click into the line below and Ctrl+Z there: the undo takes the field's text back out (the field wrote it as it left), and a redo writes it again.
- Text typed in the field, then Ctrl+Z in it: the field's own undo takes the typing back, and the editor's undo stack still holds the one step for the `!`.
- Text typed in the field, then a switch to live mode: the text is written as one undo step, which the next undo takes back out.
- Text typed in the field, then a switch to reading mode: the text is written as one undo step, and kept on the way back to source mode, where the next undo takes it back out.
- Text typed in the field, then a host toolbar button that runs the editor's undo, one keeping focus off itself and one taking it: the bytes keep the `!`, the field shows its body as written, and a redo writes the typed text.
- Text typed in the field, then a new document loaded: nothing of the typed text is written.

## An open field scrolled out of the window

Miss-analysis: no row scrolled a box away while its field held text, so the field's blur write, made while windowing removed the block, ran inside the render and was lost (0.11.5's diagram box kept it).

- Text typed in the field, then the editor scrolled to its end: the field's block leaves the window, its text is written as the field leaves, and it is one undo step. In Firefox and WebKit no blur reaches a removed field, so nothing is written and the text is lost, as on 0.11.5.

## The field's menu row (`Drawn.handle`)

The field type's own command `drawn/focus-field` focuses the field through the handle its drawing declares.

- Run on the field's block, it focuses the field.
- Run on the field's block once the field is scrolled out of the window, it declines and nothing takes focus.
- Run on a block of another drawn type (the `shown` fence), which doesn't place it, it declines and the field takes no focus.

## Two boxes back to back

Two ` ```field ` boxes with nothing between them open no gap caret (each opens only the edge above it), so the way to a paragraph between them is the box focused whole. The field's drawing doesn't handle Escape, so the editor does.

- Escape in the first field focuses its box whole (the field loses focus, the block keeps it); Enter there opens a paragraph between the two boxes, and typing lands in it.

## A fence drawn as a preview (`edit: 'source'`)

A ` ```shown ` fenced block (`fencedBlock`, same harness) draws a preview of its body until the caret comes in.

- Clicking the preview shows the fence's text in its place and hides the preview.
- Typing in the shown text and clicking away writes it, and one Ctrl+Z takes all of it back.

## The drag ghost's name

Miss-analysis: only the old block descriptor named a ghost, so no maker's type had a drag row.

- Dragging the ` ```field ` box by its handle shows the name its type declares (`dragLabel: 'A field box'`), not its body.
- Dragging the ` ```shown ` fence, whose type declares none, shows its first words, `preview: hello`.

## A container drawn as a box (`container`)

A `%>` container (`container`, same harness) draws a bordered box and places the editor's children inside it.

- Typing at the end of its child writes ` more` with the `%> ` marker kept, and one Ctrl+Z takes it back out.
- Enter at the end of its child opens a second child inside the box: typing there writes a new line with the marker below a marked blank line (`%>`), as a quote does, and the caret is in that second child.
- Typing three characters at the end of its child writes them into the child, and the drawing's `update` runs exactly once per character.
- A box holding 400 children mounts only the children near the viewport, with a spacer for the rest inside its own box; scrolling to the end mounts the last child and unmounts the first.

## A text block with chrome, and a box drawn whole

An `@@ ` memo (`lineBlock`, `edit: 'text'`) draws a badge before the editor's text, and a `[[badge]]` box (`lineBlock`, `edit: 'box'`, no editing surface of its own) is drawn whole. Each test loads its own document.

- Typing at the end of the memo writes the character into the memo's line and nothing of its badge; Ctrl+Z (Cmd+Z on a Mac) takes it back out.
- A selection swept from the first paragraph to the end of the document paints the badge with one box over exactly the element it drew, edge for edge.
- In a document long enough to window, scrolling the badge out of the rendered range tears its drawing down once, and scrolling back draws it again.
- ArrowDown from column 10 of a paragraph onto the badge, ArrowRight out to the start of the paragraph below, then ArrowDown: the caret lands at the start of the next paragraph, not back at column 10, since a sideways exit ends the column the vertical run kept. Miss-analysis: the arrow exit a box shares with a container leaving by an arrow tells the caret memory which key left, and no row pressed a second arrow after the exit, so dropping that line kept every suite green.
