# Feature: an HTML block joining its neighbour

An HTML block can change what it reads as without changing kind, and when it does, the editor has to see it while you type, the way a reload would. Two ways it happens:

- A `<div>` line right under a paragraph starts an HTML block of its own, but a `<span>` line can't (CommonMark only lets a short list of block tags cut a paragraph off). So retyping `div` as `span` turns two blocks into one paragraph.
- A comment, a `<pre>`, a `<?` or a `<![CDATA[` block reads on until its closer, blank lines and all. Break the closer (or retype `div` as `pre`) and the block swallows whatever sits below it, even with a blank line in between.

## Happy paths

- source mode, `foo\n<div>\n`, a real click into the `<div>` line, End, ArrowLeft, three Shift+ArrowLefts to select `div`, then `span` typed over it: the source is `foo\n<span>\n`, one block on screen and in the tree, a paragraph, and a reload reads the same tree. Typing over the selection matters, since Backspacing `div` away passes through `<>`, which isn't HTML at all and joins the paragraph for a different reason.
- source mode, `<!-- note -->\n\nText\n`, a click into the comment, End, Backspace: the source is `<!-- note --\n\nText\n`, one HTML block on screen and in the tree, and the reload agrees.
- source mode, `<div>\n\nfoo\n`, `div` selected the same way and `pre` typed over it: the source is `<pre>\n\nfoo\n`, one HTML block, and the reload agrees.
- live mode, each of the three above with the same keys: the same source, the same one block. These run against the tree in `same-kind-write-joins.test.ts`, which is mode-independent.

## Edge cases

- inside a list item, `- a\n\n  <!-- x -->\n\n  b\n`, a click into the comment, End, Backspace: the source is `- a\n\n  <!-- x --\n\n  b\n`, and a reload reads the same tree.
- a paste: `<div>\n\nfoo\n`, `div` selected, `pre` pasted over it: the source is `<pre>\n\nfoo\n`, one HTML block, and the reload agrees. An HTML block has no paste handling of its own, so the paste reports falling through to the default (the `paste-dispatch` dev warning, expected here).

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)

## Miss-analysis

- GH #638: a keystroke that keeps its block's kind asked its neighbours only when one of the two kinds was on a list of kinds that read the lines below them, and the HTML block's own first line deciding whether it cuts the paragraph off wasn't on anyone's list. No case typed in the lower block of a flush pair.
- the blank-line cases: the fix for #638 asked only joins with no blank line in them, and every case it was checked against was flush, so nothing left an HTML block open over a blank line.
