# Feature: the keys around a table of contents

A `[[toc]]` block shows its heading list until the caret comes in, then its one line of source.
The list gives the caret nowhere to sit, so the block's edges take a gap caret: a document that
starts with an outline can still be typed above it. These rows hold the keys and clicks around
the block. Driven by real keys and clicks in a three-block document, the
outline first or last.

Miss-analysis: the outline's specs read its list and its navigation, and no row walked the caret
into, out of and around the block, so nothing held the key table when the block's maker changed.

## The outline first

- ArrowUp from the start of the heading below puts the caret at the start of the outline's source
- ArrowUp again puts a gap caret above the outline
- A letter typed at that gap caret becomes a paragraph above the outline
- Enter at that gap caret puts an empty paragraph above the outline, with the caret in it
- Backspace at that gap caret changes nothing, and the gap caret stays
- ArrowDown from that gap caret goes back to the start of the outline's source
- A click just above the outline puts a gap caret above it

## The outline last

- ArrowDown from the end of the paragraph above puts the caret at the end of the outline's source
- ArrowDown again puts the caret in a new empty paragraph below
- A click just below the outline puts the caret in a new empty paragraph below
- ArrowUp from the outline's source goes back to the end of the paragraph above

## In the open source

- Backspace at the end of the source deletes its last character, and the document's bytes wait
  for the caret to leave
- Enter at the end of the source opens an empty paragraph below with the caret in it, as Enter
  does at the end of any one-line block
