# Feature: reading mode (presentation-mode rung 1)

`presentationMode="reading"` on `<Editor>` hides Markdown markers via
root-attribute-scoped CSS (the DOM keeps every marker node — offsets survive),
writes no document bytes (contenteditable off, paste/cut/commands/checkbox
gated), and keeps the reading affordances live: selection, copy, mouse
navigation, link activation. The one interactive affordance is the `<details>`
disclosure, which flips view state and so writes nothing — pinned separately in
`presentation-reading-details.md`; the inert task checkbox below is the contrast
that keeps the line at "what it writes", not "whether it responds". (Navigation is by mouse — a read-only surface has no
keyboard caret to traverse with.) `'source'` stays byte-identical to pre-mode
behavior. Driven on `/test/editor` via the header "Reading mode" toggle (a real
click) and the `?presentationMode=reading` query param; source stability is
asserted through the `window.__test` bridge.

## Happy paths

- entering reading mode sets `data-presentation="reading"` on the editor root;
  source mode carries NO `data-presentation` attribute
- inline and block-own markers (`**`, `#`) are hidden from paint in reading
  mode (computed `display: none`) while their text nodes remain in the DOM
- ordered-list ambient markers (`1.`) stay visible in reading mode; bullet
  items hide their `- ` and show rendered bullet chrome instead
- toggling back to source restores markers and editing (typing commits again)

## Edge cases

- the marker DOM is hidden, never omitted: the hidden marker text still exists
  in the block's textContent (the coordinate-space contract)
- round-trip: after entering and leaving reading mode with interactions in
  between, the source is byte-identical to what it was before the mode flip
- toggling to reading while a block is focused mid-edit commits/folds first
  (blur-class flip) and fires no invariant
- an open replace row (Ctrl+H) collapses on a flip to reading (replace is an edit,
  gated inert) and returns on the flip back to source

## User interactions

- typing printable characters in reading mode: source unchanged
- Enter / Backspace / Delete with a caret or selection: source unchanged,
  block count unchanged
- paste (Ctrl+V) into a focused block: source unchanged
- cut (Ctrl+X) over a selection: source unchanged (degrades to copy)
- undo chord (Ctrl+Z) after a pre-flip edit: source unchanged (history is inert
  in reading mode)
- task checkbox click: source unchanged (checkbox visible but inert) — a toggle WOULD rewrite the document, which is why this one stays gated while the details disclosure does not
- mouse selection across text then copy (Ctrl+C): clipboard receives the
  selected text
- select-and-copy over a marker-bearing span copies the rendered text (hidden
  markers are excluded from the native selection payload)
- plain click on a link: `onLinkActivate` fires with the resolved href (a
  rendered document's links click — no caret to place)

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)
