# Feature: Image popover draft discard

An alt draft the user has not committed belongs to the image the popover opened on. When the
document takes that image away while the draft is open, the draft is dropped, and nothing is
written over whatever now sits where the image was.

## Edge cases

- The host swaps the `source` prop to a document holding another image at the same position
  while an alt draft is open: the popover closes, the new document's bytes stay exactly as
  given, and no page error fires
- The host swaps to a document holding the same image in the same place, with an alt draft open:
  the field closes and the new document's bytes stay exactly as given. The image keeps its
  widget here, so only the swap closing its menus drops the draft
- An undo taken through the editor's command while an alt draft is open takes the image away and
  brings another image to its position: the draft is dropped and the source reads as the undo
  left it

## Miss-analysis

- A source swap wrote the old document's alt draft over the new document's image: every popover
  case changed the document through the user or undo, and no spec swapped the `source` prop
  under an open popover
- A swap to the same image in the same place still wrote the draft into the new document: the
  swap spec's incoming image had different bytes, so the widget remounted and dropped the draft
  on its own, and nothing swapped under a widget that stays mounted
