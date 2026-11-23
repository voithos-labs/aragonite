# Feature: a fenced block's fence lines

The editor draws a fenced block's fence lines: dimmed markers that the marker-hiding modes collapse, the same drawing the built-in code block makes of its own. A plugin's `%%%` block (`fencedBlock`, `edit: 'text'`, `routes/test/plugins/fence-lines`) paints only its body, and its clicks and arrows land on the lines the code block's land on. The seed is `before`, a code block, `between`, the `%%%` block, `after`.

## Happy paths

- A code block in source mode: a click on a fence line or a body line, and ArrowDown from the line above or ArrowUp from the line below, land on the line aimed at.
- The `%%%` block in source mode: the same clicks and arrows land as on the code block, line for line.
- A code block in live mode: its fence lines hide, so a click above the body lands on its first line and the arrows step from the body to the paragraphs around it.
- The `%%%` block in live mode: the same as the code block.
