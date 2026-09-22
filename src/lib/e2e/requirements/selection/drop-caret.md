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

## Error cases

- hold over a thematic break, which holds no character position: no caret, and the release leaves
  the document byte-identical
