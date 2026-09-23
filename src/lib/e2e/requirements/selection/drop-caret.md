# Feature: the caret that says where a dragged selection will land

Holding a dragged selection over the editor has to show where releasing it will put the text.
The editor cancels the browser's own drop (`requirements/selection/selection-drag-drop.md`), and
cancelling takes the browser's own drop caret with it, so the editor draws one of its own at the
position the release will use. It is resolved the same way a single click resolves a caret, so
what the caret shows and where the text lands cannot disagree.

A drop the editor would cancel gets no caret at all, and that absence is the refusal the release
then carries out.

## Happy paths

- hold a dragged word over another paragraph: a caret stands at the offset the release lands at
  - Miss-analysis: every drop test read the bytes after the release, so nothing ever looked at
    the page while the button was still down and the whole hold had no coverage
- release: the caret goes, and the text lands where the caret stood

## Edge cases

- move the hold along the target line: one caret, which follows to the newer offset
- the caret is drawn over the text, so it never takes a hold of its own
- carry the hold out of the editor: the caret goes, and releasing it out there writes nothing
  - Miss-analysis: the clear was called undrivable under Playwright's synthetic mouse and left
    unclaimed, so the one handler with no test anywhere read as a known gap instead of a missing
    test
- hold with Ctrl down over a landing inside the dragged range: a caret, because a copy writes
  there, and the release lands the copy where it stood
  - Miss-analysis: the decline was written against the move alone, and no case held a modifier,
    so the copy it refused had nothing to disagree with

## Error cases

- hold over a thematic break, which holds no character position: no caret, and the release leaves
  the document byte-identical
- hold a payload carrying a line break over a landing past it: no caret, and the release leaves
  the document byte-identical
  - Miss-analysis: each decline was covered by reading the bytes after the release, so the three
    the caret mirrored read as coverage for all of them and the two it missed were never asked
- hold over a landing inside the dragged range itself: no caret, and the release leaves the
  document byte-identical
