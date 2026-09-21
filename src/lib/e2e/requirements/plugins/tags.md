# Feature: in-body tags as inline widgets

`#tag` written in prose renders as a chip carrying its own bytes. The harness plugin
(`routes/test/plugins/tags`) reproduces limestone's integration value for value — a bare `#`
trigger, a recognizer that opens a tag only at a block's start, after whitespace or after `(`, and
a widget registered with `revealSource` and `claimsActivationClick` — so what this battery pins is
what that app gets. Seed `tags`: a tag mid-prose and a nested `#work/admin` in block 0, a tag
OPENING block 1, a tag inside a heading's content in block 2, and a plain typing target in block 3.

## Happy paths

- The seed renders every tag and the source keeps the literal `#name` bytes.
- A tag typed live renders as soon as its name lands.
- A tag inside a heading's content renders, and the heading is still a heading.

## The heading opener contests the same character

- A tag OPENING a line stays a paragraph and paints at paragraph size. `#` at a line's start is
  the heading opener's, and a bare `#` is CommonMark's empty heading, so without this a line that
  begins with a tag reads as a title while the name is being typed.

## What is not a tag

- A bare `#`, an all-digit name (`#123`, an issue reference or a heading anchor) and a mid-word
  hash (`C#sharp`) mint no widget.

## User interactions

- A drag that STARTS on a tag selects, in either direction, and paints nothing into the document.
  The island is `contenteditable=false`, so the browser starts no selection from it; the editor's
  own session paints the range, anchored at the tag's raw edge on the press's side.
- That drag reveals nothing. A reveal belongs to a click, and a release that travelled is a drag's
  end: revealing there would unmount the island the drag just painted a range across.
- A click on a tag reveals its source for editing, and the chip returns when focus leaves.
- Ctrl/Cmd-click is the activation gesture, which a host turns into navigation; the harness widget
  records it.

## Error cases

- zero `[invariant:…]` console fires across the battery (asserted through `capturedErrors`)
