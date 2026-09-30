# Feature: an HTML block that stops interrupting joins the paragraph above

A `<div>` line right under a paragraph starts an HTML block of its own, but a `<span>` line can't
(CommonMark only lets a short list of block tags cut a paragraph off). So retyping `div` as `span`
turns two blocks into one paragraph, and the editor has to see that while you type, the way a
reload would. Nothing about the written block's kind changes along the way, which is what makes it
easy to miss.

## Happy paths

- source mode, `foo\n<div>\n`, a real click into the `<div>` line, End, ArrowLeft, three Shift+ArrowLefts to select `div`, then `span` typed over it: the source is `foo\n<span>\n`, one block on screen and in the tree, a paragraph, and a reload reads the same tree. Typing over the selection matters, since Backspacing `div` away passes through `<>`, which isn't HTML at all and joins the paragraph for a different reason.
- live mode, the same keys: the same source, one paragraph, and the reload agrees.

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)

## Miss-analysis

- GH #638: a keystroke that keeps its block's kind asked its neighbours only when one of the two kinds was on a list of kinds that read the lines below them, and the HTML block's own first line deciding whether it cuts the paragraph off wasn't on anyone's list. No case typed in the lower block of a flush pair.
