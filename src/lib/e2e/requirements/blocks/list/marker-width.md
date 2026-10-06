# Feature: a space left at a list item's content start

A list item's marker is the bullet (or number) plus every space after it, so `-  b` has a three-character marker and a paragraph that just says `b`. When a keystroke leaves a space at the start of an item's first line, the bytes stay as typed, and the editor reads them the way a reload of the file would: the space joins the marker.

## Happy paths

- Load `- a b`, Backspace after `a`: the source is `-  b`, the item's marker is `-  `, and the live tree matches a reload; a letter typed next lands after the widened marker (`-  zb`)
- Load `- [ ] a b`, the same Backspace: the source is `- [ ]  b` and the checkbox takes the space (`[ ]  `)
- Load `- a b`, Enter after `a`: the source is `- a\n-  b`, the new item's marker is `-  `, and the live tree matches a reload

## Edge cases

- Load `- a b\n  c`, the same Backspace: the second line keeps its two spaces and still reads as part of the item's paragraph
- Load `- a b\n  - sub`, the same Backspace: the nested list sits left of the wider marker now, so it reads as the list's next item, in the editor as on reload
- Load `- a b\n\n  c`, the same Backspace, then undo: the loaded bytes come back, read as they were

## Miss-analysis

- The editor kept the old marker and a paragraph starting with a space, where a reload reads a wider marker (and, with lines below it, sometimes a different list). Every list test typed words into items; none left whitespace at an item's content start, the one place a keystroke changes what the marker reads as.
- Enter built the new item from the old one's marker and never read its first line back, so `-  b` kept a `- ` marker. The rows above only rewrote an item that already existed; none made a new one whose first line starts with a space.
