# Feature: a live selection over a title's whole text is the title

In live mode a selection over the whole text of a `:::` row (End then Shift+Home, a triple click, the selection API from the row's first byte) is the title, for every gesture: a delete clears the title and keeps `:::tip `, and a cut, a copy and a drag take the title alone.

## Happy paths

- `:::tip Title` over a body, live, the row selected whole, then Ctrl+X: `:::tip `, the clipboard `Title`; Ctrl+V puts the document back. The same for a triple click and for the selection API. Miss-analysis: the whole-text rule's rows checked the bytes a delete leaves, and no row read the clipboard of a cut over a title, whose copy came from the range-edit core while the cut came from the row's own write.
- The same row cut and pasted back in a generic `:::foo`, in a quote, in a list item, and on the inner row of a `::::note` holding a `:::tip`.
- The row selected whole, then Ctrl+C, then a paste into a paragraph: the paragraph gains `Title`, as text.
- The row selected whole and dragged to the end of a paragraph below: the paragraph gains `Title`, and the row keeps `:::tip `.

## Controls (a removal that breaks the row unwraps the box: `title-row-unwrap.md`)

- In source mode the row selected whole (Shift+End), then Backspace or a cut: the box goes with its closing line, `body` stays; the clipboard holds `:::tip Title`.
- In live mode `:::tip ` selected alone, then Backspace: `Title`, a blank line, `body`.
