# Feature: live-mode link card — the create half of Mod+K

`Mod+K` over a selection is the other half of the chord (#119): where a caret inside a link ENTERS
the card, a range over plain text opens it in CREATE mode and mints `[text](url)` on commit. The
document stays byte-identical until Enter, so Escape needs no cleanup pass and costs no undo entry.
Driven on `/test/editor` via `?presentationMode=live` with real Shift+Arrow selections, real typing
and a real `Mod+Z`; the SOURCE is the oracle. The card's own surface — anchoring, focus trap, Escape
restore, remove-link — is `live-link-card.md`; the consumption contract is `live-link-card-chord.md`.

## Happy paths

- `Mod+K` over a plain-text selection in a text block opens the card in CREATE mode: URL field
  empty and focused, the document byte-identical — the construct is minted only on commit, so an
  Escape needs no cleanup pass and no second undo entry (a wrap-then-edit two-step would strand an
  empty-destination construct or cost two undos)
- Enter with a non-empty URL mints `[selected text](url)` over the range through the same
  one-commit write seam every card write uses; the caret lands at the construct's start, and one
  `Mod+Z` removes the whole mint
- Escape from a create card writes nothing and restores the SELECTION live, not a collapsed caret

## Edge cases

- the selection survives the create card borrowing the screen. Design choice: focusing the URL
  field moves the native selection into the field, so "stays painted" is not a contract any
  browser keeps — instead the range rides the caret-restore slot (the mechanism built for chrome
  that borrows focus), Escape restores it live, and commit is the only path that collapses it, at
  the construct
- a selection overlapping any other inline construct's bytes declines create — wrapping inside
  `**bold**` or across an existing link is a policy question the card does not answer; no card
  opens and not a byte moves
- a selection inside a table cell declines create: cell raw carries pipe escapes, a wrap policy of
  its own; the chord stays consumed
- a selection SPANNING two blocks declines create: no block hosts the range, and the block-local
  offsets the arm would read are fabricated — a block's own DOM walk reports an endpoint in
  another block as end-of-walk. The chord stays consumed, taken by the cross-block arm before
  dispatch (miss-analysis: every create case drove a range the caller had really measured inside
  one block, so the one input class the arm cannot trust was never fed to it)
- Enter over an empty URL in create mode is inert — the card stays open holding its focus rather
  than closing having minted nothing, and Open stays disabled on the same empty draft

## User interactions

- The range is built by real Shift+Arrow presses from a real click, never a programmatic selection
- Undo is a real `Mod+Z`, never a programmatic history call

## Error cases

- every decline is byte-identical: the source after the chord is the source before it
- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)
