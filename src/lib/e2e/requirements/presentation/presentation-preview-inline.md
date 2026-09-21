# Feature: inline-granular live preview, construct reveal (presentation-mode rung 3)

`presentationMode="preview-inline"` on `<Editor>` is a live editing mode. Unfocused
blocks behave exactly as `preview-block` (markers hidden, rendered look). Inside
the focused block, each inline construct's markers (emphasis `**`/`*`, strikethrough
`~~`, inline-code ticks, link brackets and url, image alt syntax) stay hidden until
the caret enters the construct's inclusive `[start, end]` range; entering shows the
markers of every construct enclosing the caret, and leaving hides them again. Hiding
is CSS keyed on `data-construct-*` attributes plus a class derived from the caret.
The marker DOM stays intact, so raw offsets survive every mode switch. Block-own
prefixes (heading `## `, code fences) show with block focus, as in `preview-block`.
Driven on `/test/editor` via the header "Inline preview" toggle and
`?presentationMode=preview-inline`.

## Happy paths

- entering preview-inline sets `data-presentation="preview-inline"` on the editor
  root; source mode carries no `data-presentation` attribute
- an unfocused block hides its markers exactly as preview-block does (rendered look)
- in the focused block, a construct's markers stay hidden while the caret sits in
  plain text outside it; the block-own prefix (heading `## `) is visible
- stepping the caret into `**bold**` shows its `**` markers; stepping out hides
  them again

## Edge cases

- marker DOM is hidden, never omitted: the focused block's textContent contains
  every marker byte while the markers are hidden
- inclusive edges: the caret at a construct's start or end offset already shows
  it, so an arrow step about to enter marker text always lands in visible text
- nested constructs: with the caret inside the italic of `**bold *italic* tail**`,
  both wrappers' markers are shown (every enclosing construct, not the innermost only)
- stepping the caret never skips or doubles: arrowing character by character across
  `a **b** c` visits every raw offset exactly once, shows the markers on the way in
  and hides them after

## User interactions

- click into a construct's content: every construct enclosing the caret shows its
  markers, and the caret does not move
- sweeping across constructs: arrowing left-to-right through `_a_ b `c` shows and
  hides each construct in sequence, never two separate constructs at once
- toggling back to source shows every marker again; toggling to reading hides all
  markers and hides anything currently shown

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)
