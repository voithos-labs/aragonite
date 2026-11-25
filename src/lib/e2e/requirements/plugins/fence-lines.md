# Feature: a fenced block's fence lines

The editor draws a fenced block's fence lines: dimmed markers that the marker-hiding modes collapse, the same drawing the built-in code block makes of its own. A plugin's `%%%` block (`fencedBlock`, `edit: 'text'`, `routes/test/plugins/fence-lines`) paints only its body, and its clicks and arrows land on the lines the code block's land on. The seed is `before`, a code block, `between`, the `%%%` block, `after`.

## Happy paths

- A code block in source mode: a click at either end of a fence line or a body line, or in the padding above or below them, and ArrowDown from the line above or ArrowUp from the line below, land on the line aimed at.
- The `%%%` block in source mode: the same clicks and arrows land as on the code block, line for line.
- A code block in live mode: its fence lines hide, so every click lands on a body line (the first for a click above the body, the last for one below) and the arrows step from the body to the paragraphs around it.
- The `%%%` block in live mode: the same as the code block.

## Typed into a plugin's type

A ` ```math ` fenced block (`fencedBlock`, a picture that opens its text, no `renderSource`) gets its fence lines drawn too, and in live mode they hide.

- Three backticks, `math` and Enter typed in live mode at an empty line: once the block is the math type, the caret sits on its body line, never inside the info line, and the `x` typed next lands in the body. Miss-analysis: the fence lines were the author's to draw, so a type drawing none showed them in live mode with the caret inside the info line; no row typed a fence into a plugin's type.
