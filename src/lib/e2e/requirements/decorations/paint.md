# Feature: Paint from a plugin value

A plugin's `paint(block)` returns marks, widgets, replaced ranges and block classes for one block.
The editor asks only for the blocks it has on screen and keeps a block's answer while the block's
bytes stay the same, so an edit asks again only for the block it changed and the containers
around it.

## What an edit changes in the tree

- Typing in a paragraph, a list item's paragraph or a quote's second paragraph changes only that
  block and its containers; every other block keeps its node and its bytes
- A byte splice into each of the same three blocks changes only it and its containers
