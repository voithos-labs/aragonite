# Feature: Plain-mode editable leaf, the `%%` memo harness kind

A `memo` leaf built on `createEditableLeaf({ mode: 'plain' })` is an always-editable text area
that behaves like a built-in one: it commits to the tree per keystroke, batches undo the way
prose does, lets the arrow keys cross its block boundaries, and takes part in a selection swept
across blocks. Driven through real keyboard and mouse only, because the whole point is that a
plugin leaf behaves like a built-in text block. The seed is `Before` / `%% memo text` / `After`.

## Happy paths

- Typing into the memo commits per keystroke: the typed characters land in the node's raw text
  and round-trip stable
- Enter inside the memo inserts a literal newline. The second line no longer matches the `%%`
  recognizer, so the commit splits the block into a memo plus a paragraph, through the shared
  commit code the plain leaf uses

## User interactions

- ArrowRight from the end of the previous block enters the memo at its start; ArrowRight from
  the memo's end leaves for the next block; ArrowDown and ArrowUp cross it as well
- A selection swept from the block above, through the memo, into the block below becomes a
  cross-block selection covering all three

## Clipboard

The leaf handles copy, cut and paste exactly as every other editable area does
(`editor.md` § Clipboard). The shared editable core owns the clipboard, so a plugin leaf gets
the rule without wiring anything itself.

- A single-block paste is handled by the editor rather than the browser: only `text/plain` is
  taken, so HTML on the clipboard is stripped instead of landing as live markup, and multiline
  text keeps its newlines (the second line splits off as a paragraph through the shared commit
  code)
- A copy across blocks with the memo as the focused end reaches the shared collector, which
  reads the memo's own raw text plus the neighbor the selection swept, rather than copying one
  element on its own
- A cut across blocks with the memo as the focused end writes the same clipboard payload and
  deletes the swept range, collapsing the selection
- A paste over a selection across blocks anchored in the memo goes through the shared
  delete-then-paste, collapsing the selection and landing the pasted text as one undo entry

## Edge cases

- Undo batches like prose: a burst of typed characters undoes in one step, back to the text as
  it was before the typing
