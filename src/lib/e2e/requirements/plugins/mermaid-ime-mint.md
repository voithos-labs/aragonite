# Feature: AltGr and IME input at a focused diagram mints a paragraph below

The plugin route for the whole-block editing host. The container factory — not the block
component — wires the host, so a plugin kind that declares `blockFocus: 'whole-block'` and hands
the factory a `getFocusEl` gets AltGr and IME input for free; a factory miss shows up here and
nowhere in the built-in suites.

The diagram is the harder half of the contract: its declared focus surface is replaced on every
redraw, so the host lives in the chrome box instead, and its edit textarea is a declared surface
that owns its own caret and must keep it.

Fixture: `Above text` / a mermaid fence / `tail text`.

## Happy paths

- Focused diagram, an AltGr-shaped `insertText` of `€`: a paragraph `€` sits between the diagram
  and `tail text`, and the diagram's own bytes are unchanged
- Focused diagram, a composition committed as `日本`: the same mint, with the composed text

## Edge cases

- The host survives a redraw: after an edit changes the code and the diagram re-renders, a
  composition at the refocused block still mints
- And focus SETTLES on the host, not on the new viewport. The redraw hands focus back to the
  surface it replaced, and the hand-off declines an arrival whose `relatedTarget` is the host, so
  a recovery scoped wider than that surface (the whole chrome box) leaves focus on the viewport
  with AltGr and IME dropped. Driven with a settle and a following AltGr insert, because the
  in-flight assertion above passes either way
- The diagram's edit textarea keeps its own caret and IME — opening edit mode focuses the
  textarea, not the host, and typing there edits the draft rather than minting a paragraph

## User interactions

- Click a toolbar button, then click the diagram: focus reaches the editing host and an
  AltGr-shaped insert still mints. The hand-off from the declared surface exempts exactly one
  arrival, the host's own tab-out; a wider exemption leaves a post-toolbar click sitting on the
  viewport, where AltGr and IME are dropped exactly as before the fix

## Miss-analysis

- The plugin whole-block suites asserted focus by strict identity on the declared viewport, which
  is exactly the element the fix moves focus off; nothing asserted that a printable arriving
  through the browser's editing doors reached the mint on the plugin route at all
- The toolbar-click scenario: the block's own chrome was never treated as a distinct focus
  arrival, so a guard written for "anything inside the box" looked equivalent to one written for
  the single arrival that can trap focus, and the keydown mint still worked in the state it broke
- The settled-focus scenario: the redraw pin asserted focus the instant the new SVG appeared,
  while the component's own recovery was still one `tick` away, so it passed under a recovery
  that parks focus on the viewport. An assertion made mid-flight measures the gesture, not its
  outcome
