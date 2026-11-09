# Feature: Paint from a plugin value

A plugin's `paint(block)` returns marks, widgets, replaced ranges and block classes for one block.
The editor asks only for the blocks of text it has on screen and keeps a block's answer while the
block's bytes stay the same, so an edit asks again only for the block it changed.

## What an edit changes in the tree

- Typing in a paragraph, a list item's paragraph or a quote's second paragraph changes only that
  block and its containers; every other block keeps its node and its bytes
- A byte splice into each of the same three blocks changes only it and its containers

## What a keystroke measures again

- With a whole-document source marking every block, typing in one block measures no other
  block's marks again

## What a plugin's paint is asked for

- With a painted mark on each of 30 blocks, a keystroke asks only the edited block's paint again
  and measures only its marks
- In a 25,000-item list, item 3,500's paint is asked once it's scrolled into view, never before,
  and not again after scrolling away and back; the list and its items, which hold blocks, aren't
  asked at all
- `repaint` of one block asks only that block; `repaint()` asks every mounted block and no other

## A painted mark's handlers

- In a paragraph, a quote's second line and a table cell, a mark painted at a word's document
  bytes covers exactly that word, and hovering it hands `hover` those bytes
- In each of the three, the keyboard's activate chord hands `activate` those bytes
- A click on a mark with `click` runs before the caret lands: as the handler runs, the caret is
  where it was; `preventDefault` keeps it there, and without it the caret lands where the press was

## Widget, replace and block paint

- A widget, a replaced range with a class, block classes and attributes, and a badge each land;
  the views get the paint they came from and follow it through a repaint, and everything leaves
  when the paint returns nothing, the bytes untouched
