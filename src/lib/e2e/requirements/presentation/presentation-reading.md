# Feature: reading mode (presentation-mode rung 1)

`presentationMode="reading"` on `<Editor>` hides Markdown markers via
root-attribute-scoped CSS (the DOM keeps every marker node — offsets survive),
makes the whole surface inert (contenteditable off, paste/cut/commands/checkbox
gated), and keeps the reading affordances live: selection, copy, mouse
navigation, link activation. (Navigation is by mouse — a read-only surface has no
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

## User interactions

- typing printable characters in reading mode: source unchanged
- Enter / Backspace / Delete with a caret or selection: source unchanged,
  block count unchanged
- paste (Ctrl+V) into a focused block: source unchanged
- cut (Ctrl+X) over a selection: source unchanged (degrades to copy)
- undo chord (Ctrl+Z) after a pre-flip edit: source unchanged (history is inert
  in reading mode)
- task checkbox click: source unchanged (checkbox visible but inert)
- mouse selection across text then copy (Ctrl+C): clipboard receives the
  selected text
- select-and-copy over a marker-bearing span copies the rendered text (hidden
  markers are excluded from the native selection payload)
- plain click on a link: `onLinkActivate` fires with the resolved href (a
  rendered document's links click — no caret to place)

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)
