# Feature: deleting the only text of the last item

An item at the very end of the document has no line ending, so once its text is gone the marker is all that's left of it. The marker stays in the source, so saving and opening the file again shows the same empty item you're looking at.

## User interactions

- Load `- **a**` in source mode, select the text, press Backspace: the source is `- `, one bullet still shows, a reload of that source still shows one bullet, and a typed character lands in it
- The same in live mode, loading `- a` (deleting all of `- **a**`'s text in live mode leaves `- ****`, so that item never empties)
- The same with Delete instead of Backspace, in both modes
- The same with a cut instead of Backspace, in both modes

## Edge cases

- Load `- a\n- b`, select `b`, Backspace: the source is `- a\n- ` and a reload still shows two bullets
- Load `- a\n- b\n- c`, select `c`, Backspace, then Backspace at the start of `b`: the source is `- ab\n- `, two bullets show, a reload still shows two, and a typed character lands in the second
- Load `- [ ] a`, select `a`, Backspace: the source is `- [ ] ` and a reload still shows a task item
- Load `> a`, select `a`, Backspace: the source is `> `, the marker as spelled, and a reload still shows a quote

## Miss-analysis

- GH #685: the dev check that a rebuilt container reads back as itself skipped any container with no bytes, which is exactly the shape that loses the item, and every emptying test ended its item with a line ending, which keeps the marker.
- GH #685, the join: the list join re-read its items without the editor's empty paragraphs, and the census of those reads only searched for one function name.
