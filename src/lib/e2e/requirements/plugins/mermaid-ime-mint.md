# Feature: AltGr and IME input at a focused diagram creates a paragraph below

The plugin's route to the whole-block editing host. The container factory wires that host, not
the block component, so a plugin kind that declares `blockFocus: 'whole-block'` and hands the
factory a `getFocusEl` gets AltGr and IME input for free, and a mistake in the factory shows up
here and nowhere in the built-in suites.

The diagram is the harder half of the contract: the element it declares for focus is replaced on
every redraw, so the host lives in the block's frame instead, and its edit textarea is a declared
element that owns its own caret and has to keep it.

Fixture: `Above text` / a mermaid fence / `tail text`.

## Happy paths

- Focused diagram, an AltGr-shaped `insertText` of `€`: a paragraph `€` sits between the diagram
  and `tail text`, and the diagram's own bytes are unchanged
- Focused diagram, a composition committed as `日本`: the same new paragraph, with the composed
  text

## Edge cases

- The host survives a redraw: after an edit changes the code and the diagram re-renders, a
  composition at the refocused block still creates the paragraph
- And focus settles on the host rather than on the newly drawn diagram. The redraw hands focus
  back to the element it replaced, and that hand-off declines an arrival whose `relatedTarget`
  is the host, so a recovery written for anything wider than that element, such as the whole
  frame, leaves focus on the diagram with AltGr and IME dropped. Driven by letting things settle
  and then making an AltGr insert, because the assertion taken mid-gesture above passes either
  way
- The diagram's edit textarea keeps its own caret and IME: opening edit mode focuses the
  textarea rather than the host, and typing there edits the draft instead of creating a
  paragraph

## User interactions

- Click a toolbar button, then click the diagram: focus reaches the editing host and an
  AltGr-shaped insert still creates the paragraph. The hand-off from the declared element
  exempts exactly one arrival, the host's own tab-out, and a wider exemption leaves a click made
  after the toolbar sitting on the diagram, where AltGr and IME are dropped exactly as they were
  before the fix

## Miss-analysis

- The plugin whole-block suites asserted focus by strict identity on the declared diagram
  element, which is exactly the element the fix moves focus off, and nothing asserted that a
  printable character arriving through the browser's own editing events reached this path at all
- The toolbar-click scenario: the block's own frame was never treated as a focus arrival of its
  own, so a check written for "anything inside the box" looked the same as one written for the
  single arrival that can trap focus, and the keydown path still created the paragraph in the
  state it broke
- The settled-focus scenario: the redraw pin asserted focus the instant the new SVG appeared,
  while the component's own recovery was still one `tick` away, so it passed under a recovery
  that leaves focus on the diagram. An assertion made mid-gesture measures the gesture, not its
  outcome
