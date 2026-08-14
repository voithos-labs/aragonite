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
- The diagram's edit textarea keeps its own caret and IME — opening edit mode focuses the
  textarea, not the host, and typing there edits the draft rather than minting a paragraph

## Miss-analysis

- The plugin whole-block suites asserted focus by strict identity on the declared viewport, which
  is exactly the element the fix moves focus off; nothing asserted that a printable arriving
  through the browser's editing doors reached the mint on the plugin route at all
