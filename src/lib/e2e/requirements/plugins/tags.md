# Feature: in-body tags as inline widgets

`#tag` written in prose renders as a chip carrying its own bytes. The harness plugin
(`routes/test/plugins/tags`) reproduces limestone's integration value for value: a bare `#`
trigger, a recognizer that opens a tag only at the start of a block, after whitespace or after
`(`, and a widget registered with `revealSource` and `claimsActivationClick`. So what this
battery pins is what that app gets. Seed `tags`: a tag mid-prose and a nested `#work/admin` in
block 0, a tag opening block 1, a tag inside a heading's content in block 2, and a plain place
to type in block 3.

## Happy paths

- The seed renders every tag and the source keeps the literal `#name` bytes.
- A tag typed live renders as soon as its name lands.
- A tag inside a heading's content renders, and the heading is still a heading.

## The heading opener contests the same character

- A tag opening a line stays a paragraph and paints at paragraph size. A `#` at the start of a
  line belongs to the heading opener, and a bare `#` is CommonMark's empty heading, so without
  this a line that begins with a tag would read as a title while the name is being typed.

## What is not a tag

- A bare `#`, a name of digits only (`#123`, an issue reference or a heading anchor) and a hash
  inside a word (`C#sharp`) create no widget.

## User interactions

- A drag that starts on a tag selects, in either direction, and paints nothing into the
  document. The widget is `contenteditable=false`, so the browser starts no selection from it;
  the editor's own drag paints the range, anchored at the tag's raw edge on the side the click
  landed.
- That drag shows no source. Showing the source belongs to a click, and a release that moved is
  the end of a drag: opening it there would unmount the widget the drag just painted a range
  across.
- A click on a tag shows its source for editing, and the chip comes back when focus leaves.
- Ctrl/Cmd-click is the activation gesture, which a host turns into navigation; the harness
  widget records it.

## Error cases

- no `[invariant:…]` console messages across the battery (asserted through `capturedErrors`)
