# Feature: live-mode link card, the create half of Mod+K

`Mod+K` over a selection is the other half of the chord (#119): where a caret inside a link enters
the card, a range over plain text opens it in create mode and writes `[text](url)` on commit. The
document stays byte-identical until Enter, so Escape needs no cleanup pass and costs no undo entry.
Driven on `/test/editor` via `?presentationMode=live` with real Shift+Arrow selections, real typing
and a real `Mod+Z`; the source is what each scenario checks against. The card's own behavior, from
anchoring to the focus trap, Escape restore and remove-link, is `live-link-card.md`; the
consumption contract is `live-link-card-chord.md`.

## Happy paths

- `Mod+K` over a plain-text selection in a text block opens the card in create mode: URL field
  empty and focused, the document byte-identical. The construct is written only on commit, so an
  Escape needs no cleanup pass and no second undo entry (wrapping first and editing afterwards
  would either strand a construct with an empty destination or cost two undos)
- Enter with a non-empty URL writes `[selected text](url)` over the range through the same
  one-commit write path every card write uses; the caret lands at the construct's start, and one
  `Mod+Z` removes the whole thing
- Escape from a create card writes nothing and restores the selection live, not a collapsed caret

## Edge cases

- the chord pressed deep in a scrolled document keeps the scroll where it was (nudging down by the
  card's own height only when the selection sits at the bottom edge and the card opens below it),
  and the card lands in view beside the selection. The field takes focus before the host has placed
  the anchor, which still sits at the editor's origin at that moment: a focus that scrolls carried
  the viewport to the top of the document, and the card, placed a frame later, was nowhere on
  screen, so the keypress read as doing nothing (miss-analysis: every card scenario ran on a
  document short enough to need no scroll, so a chord whose only symptom is where the viewport ends
  up had nothing to fail)
- the selection survives the create card taking the screen. Focusing the URL field moves the native
  selection into the field, so "stays painted" is not a contract any browser keeps; instead the
  range is kept in the same saved-caret store the editor's own UI uses when it borrows focus,
  Escape restores it live, and commit is the only path that collapses it, at the construct
- a selection overlapping any other inline construct's bytes declines to create: wrapping inside
  `**bold**` or across an existing link is a policy question the card does not answer, so no card
  opens and not a byte moves. One shape is handled before create is even asked: a range lying
  wholly inside a link the card can edit takes the edit path and enters that link's card, since
  create would decline bytes the construct already owns and leave the keypress doing nothing
- a selection inside a table cell declines to create: a cell's raw bytes carry pipe escapes, which
  is a wrapping policy of its own; the chord stays consumed
- a selection spanning two blocks declines to create: no single block holds the range, and the
  block-local offsets the handler would read are made up, because a block's own DOM-to-offset
  traversal reports an endpoint in another block as the end of the traversal. The chord stays
  consumed, taken by the cross-block handler before dispatch (miss-analysis: every create case
  drove a range the caller had really measured inside one block, so the one class of input the
  handler cannot trust was never fed to it)
- Enter over an empty URL in create mode does nothing: the card stays open holding its focus
  rather than closing without having written anything, and Open stays disabled on the same empty
  draft

## User interactions

- The range is built by real Shift+Arrow keypresses from a real click, never a programmatic
  selection
- Undo is a real `Mod+Z`, never a programmatic history call

## Error cases

- every decline is byte-identical: the source after the chord is the source before it
- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)
