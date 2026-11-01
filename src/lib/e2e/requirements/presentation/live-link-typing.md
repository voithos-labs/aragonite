# Feature: typing into and over a link's text in live mode

Live mode hides a link's brackets and destination, so the only thing on screen is its text. Typing
there follows Google Docs: a caret inside the text types linked text, a selection inside it typed
over stays linked, and a selection that touches either end of the text, typed over, gives text
that isn't linked. Replacing all of it removes the link; replacing part of it keeps the rest
linked to the same destination. A caret at the link's end never extends it. The editor writes
every edit over a selection itself, since the browser edits the selection as the DOM holds it,
and its ends can sit on either side of a hidden bracket. A reference whose label is its own text
(`[foo]`, `[foo][]`) is spelled `[text][foo]` before its text changes, so it keeps its
destination and the definition stays as written. Driven on `/test/editor` via
`?presentationMode=live` with real clicks, arrows, typing, Backspace, paste and `Mod+Z`.

Miss-analysis (#809, #807): no spec typed over a link's text. The one unit row over a link's whole
text pinned it as the link's new text, so only the first letter stayed linked; no row put a link at
a block's or cell's start, where the browser's own edit took the hidden `[` with it; and no row
edited a shortcut or collapsed reference's text.

## Happy paths

- a caret inside the text, `a b` typed: every letter and the space join the link
- a selection inside the text touching neither end, typed over: the typed text stays linked
- a selection touching the text's start, typed over: the typed text lands before the link, and the
  rest stays linked to the same destination
- a selection touching the text's end, typed over: the typed text lands after the link
- all of the text typed over: the link and its destination go, every typed letter alike
- a caret at the link's end, typed at: the text lands outside the link
- each of those, for a link mid-paragraph, at a paragraph's start, at a heading's start and at a
  table cell's start, writes the same bytes around the link

## Edge cases

- a selection from inside the link to past its end, typed over, Backspaced or pasted over: the part
  before stays linked and the typed or pasted text lands after it
- a selection from before the link into it, the same three ways: the part after stays linked and
  the typed or pasted text lands before it
- a selection over the whole link and text on both sides, typed over: no bracket or destination
  byte is left behind
- a paragraph or heading that is only a link, selected with Ctrl+A or a triple click, then typed
  over: the link goes and the heading stays a heading

## References

- a shortcut or collapsed reference, typed into at a caret: written `[exama bple][example]`, the
  definition line untouched
- the same reference with its start typed over: the rest is written `[mple][example]`

## Undo

- part of the text typed over, then one undo: the link is back as it was, since a key typed over a
  selection joins the typing burst
- the first letter typed inside a shortcut reference, then one undo: the respelled reference goes
  back to `[example]`, since the respelling is that keystroke's own write
