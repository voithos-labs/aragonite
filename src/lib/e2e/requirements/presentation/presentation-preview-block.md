# Feature: block-granular live preview — rendering (presentation-mode rung 2)

`presentationMode="preview-block"` on `<Editor>` is a LIVE editing mode: every
block hides its Markdown markers (rendered look) EXCEPT the one whose leaf holds
the caret, which renders exactly as `'source'` does. Hiding is CSS keyed on
`data-focused`, set by the editor's focus tracker on the focused block's host —
CSS-only, no render-path branch, so the marker DOM stays intact (offsets survive)
and the caret's DOM anchor survives a reveal. Driven on `/test/editor` via the
header "Block preview" toggle (a real click) and `?presentationMode=preview-block`.

Containment rule: only the single focused LEAF shows source. Container chrome
(blockquote border, directive gutter) never toggles; a focused list item shows its
own ambient marker as source while sibling items stay rendered.

## Happy paths

- entering preview-block sets `data-presentation="preview-block"` on the editor
  root; source mode carries NO `data-presentation` attribute
- an unfocused paragraph/heading hides its inline and block-own markers (`**`,
  `#`) from paint (computed `display: none`) while the text nodes stay in the DOM
- clicking into a block reveals that block's markers (it becomes focused) and
  leaves every other block's markers hidden
- an unfocused code block hides its fences; focusing it shows them, and its
  `textContent` still equals its raw (read-back safe)

## Edge cases

- the marker DOM is hidden, never omitted: a hidden block's textContent still
  contains every marker byte (the coordinate-space contract)
- containment: focusing one list item shows its ambient marker as source with no
  rendered bullet (the `::before` chrome is suppressed — no doubled `- •`) while a
  sibling item keeps its rendered bullet chrome
- a block mounting into view is unfocused, so it mounts with markers hidden

## User interactions

- click into an unfocused marker-bearing paragraph mid-word: the caret lands at
  the content offset under the click (the hidden leading markers are counted, so
  the caret sits in the content region, not shifted onto a marker), and that
  block's markers reveal
- arrow-key traversal from one block to the next flips marker visibility cleanly:
  the block left shows markers hide, the block entered reveals

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)
