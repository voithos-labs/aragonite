# Feature: A widget's own drag is not the editor's

A rendered diagram pans under a held drag. That drag belongs to the widget, so the editor's
pointer handlers have to leave it alone: no whole-block range is started, no selection overlay is
painted, and focus stays on the block the user is working in. The diagram claims the press through
its drawing's `keep` rather than the editor inferring it from the kind, and never stops it: a
drawing is mounted inside the editor, so a stopped press would never reach the editor's handlers at
all. The diagram only claims while its pan is armed, so an unfocused one is still the editor's to
answer.

Fixture (loaded per test): a paragraph `Above text`, one ` ```mermaid ` fence and a paragraph
`tail text`, or the broken-fence document for the error-card case.

## Happy paths

- Click the diagram to focus it, then drag inside it: the canvas transform moves by the drag's
  distance, the editor reports no cross-block selection, no selection overlay is mounted, and
  the active element is still inside the block
- The same drag inside the focus view's overlay pans it and paints no range

## Edge cases

- A press and drag out of an unfocused diagram into the block below still starts a cross-block
  range and pans nothing: the diagram has no gesture to protect until it is focused
- A drag on a broken diagram's error card, which claims no press, still selects the block whole:
  what decides is the claimed press, not the kind
- A drag that starts in prose and ends on the diagram is unaffected, since only the element the
  press landed on is read; that contract is pinned in `mermaid-pointer-selection-bytes.md`

## Miss-analysis

- 2026-09 (#328): every mermaid pointer spec drove a click, or a drag that started outside the
  diagram, so no test ever held a drag whose press landed on the rendered face. The general gap
  is that a widget gesture and an editor gesture sharing one press had no test asserting both
  outcomes at once: the pan was pinned on its transform, the range handler on its bytes, and
  neither on the other doing nothing.
- When mermaid moved to `svelteBlock`, its stopped presses hid a drag out of the diagram from the
  editor; these rows caught it, and no row said a drawing must not stop a press, so G1.252 names
  any drawing that does.
