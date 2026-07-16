# Feature: inline-granular live preview — construct reveal (presentation-mode rung 3)

`presentationMode="preview-inline"` on `<Editor>` is a LIVE editing mode. Unfocused
blocks behave exactly as `preview-block` (markers hidden, rendered chrome). Inside
the FOCUSED block, each inline construct's markers (emphasis `**`/`*`, strikethrough
`~~`, inline-code ticks, link brackets/url, image alt syntax) stay hidden until the
caret enters the construct's inclusive `[start, end]` range; entering reveals the
full chain of enclosing constructs' markers, leaving folds them back. Hiding is
CSS keyed on `data-construct-*` attributes plus a caret-derived reveal class —
the marker DOM stays intact, so raw offsets survive every flip. Block-own prefixes
(heading `## `, code fences) reveal with block focus, as in `preview-block`.
Driven on `/test/editor` via the header "Inline preview" toggle and
`?presentationMode=preview-inline`.

## Happy paths

- entering preview-inline sets `data-presentation="preview-inline"` on the editor
  root; source mode carries NO `data-presentation` attribute
- an unfocused block hides its markers exactly as preview-block does (rendered look)
- in the focused block, a construct's markers stay hidden while the caret sits in
  plain text outside it; the block-own prefix (heading `## `) is visible
- arrow-walking the caret into `**bold**` reveals its `**` markers; walking out
  folds them back to hidden

## Edge cases

- marker DOM is hidden, never omitted: the focused block's textContent contains
  every marker byte while the markers are folded
- inclusive edges: the caret AT a construct's start or end offset already reveals
  it, so an arrow step about to enter marker text always lands in visible text
- nested chain: with the caret inside the italic of `**bold *italic* tail**`, BOTH
  wrappers' markers are revealed (the full enclosing chain, not innermost-only)
- caret walk never skips or doubles: arrowing character by character across
  `a **b** c` visits every raw offset exactly once, reveals mid-walk, folds after

## User interactions

- click into a construct's content: its chain reveals around the caret without
  moving it
- cross-construct sweep: arrowing left-to-right through `_a_ b `c` reveals and
  folds each construct in sequence — never two disjoint constructs revealed at once
- toggling back to source shows every marker again; toggling to reading hides all
  markers and folds any reveal state

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)
