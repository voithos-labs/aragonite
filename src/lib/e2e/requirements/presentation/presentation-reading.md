# Feature: reading mode (presentation-mode rung 1)

`presentationMode="reading"` on `<Editor>` hides Markdown markers with CSS scoped
to an attribute on the root (the DOM keeps every marker node, so offsets survive),
writes no document bytes (contenteditable off, and paste, cut, commands and the
checkbox all blocked), and keeps the reading affordances live: selection, copy,
mouse navigation, link activation. The one interactive affordance is the
`<details>` disclosure, which changes view state and so writes nothing; it is
pinned separately in `presentation-reading-details.md`, and the inert task
checkbox below is the contrast that keeps the line at "what it writes" rather than
"whether it responds". Navigation is by mouse, since a read-only document has no
keyboard caret to move through it. `'source'` stays byte-identical to the behavior
before this mode existed. Driven on `/test/editor` via the header "Reading mode"
toggle (a real click) and the `?presentationMode=reading` query param; source
stability is asserted through the `window.__test` bridge.

## Happy paths

- entering reading mode sets `data-presentation="reading"` on the editor root;
  source mode carries no `data-presentation` attribute
- inline and block-own markers (`**`, `#`) are hidden from paint in reading
  mode (computed `display: none`) while their text nodes remain in the DOM
- an ordered list's marker prefix (`1.`) stays visible in reading mode; bullet
  items hide their `- ` and show a rendered bullet instead
- toggling back to source restores markers and editing (typing commits again)

## Edge cases

- the marker DOM is hidden, never omitted: the hidden marker text still exists
  in the block's textContent (the coordinate-space contract)
- round-trip: after entering and leaving reading mode with interactions in
  between, the source is byte-identical to what it was before the mode switch
- toggling to reading while a block is focused mid-edit commits and closes any
  open source first, since the switch counts as a blur, and fires no invariant
- an open replace row (Ctrl+H) collapses on a switch to reading, since replace is
  an edit and is blocked, and returns on the switch back to source

## User interactions

- typing printable characters in reading mode: source unchanged
- Enter / Backspace / Delete with a caret or selection: source unchanged,
  block count unchanged
- Enter / Tab in a focused code block: source unchanged, because a code block is its own
  dispatch site and supplies the mode getter itself, so its kind's commands do nothing just
  as the paragraph's do
- paste (Ctrl+V) into a focused block: source unchanged
- cut (Ctrl+X) over a selection: source unchanged (degrades to copy)
- undo chord (Ctrl+Z) after a pre-flip edit: source unchanged (history is inert
  in reading mode)
- task checkbox click: source unchanged (the checkbox is visible but inert), because a toggle
  would rewrite the document, which is why this one stays blocked while the details disclosure
  does not
- mouse selection across text then copy (Ctrl+C): clipboard receives the
  selected text
- select-and-copy over a marker-bearing span copies the rendered text (hidden
  markers are excluded from the native selection payload)
- plain click on a link: `onLinkActivate` fires with the resolved href (a
  rendered document's links click, since there is no caret to place)

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)
