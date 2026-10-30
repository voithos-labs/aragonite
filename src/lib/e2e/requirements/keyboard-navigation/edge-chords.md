# Feature: Keyboard Navigation, Cmd+Arrow as an edge key

On a Mac, where Home and End scroll the page, the line and block edges are Cmd+Left, Cmd+Right,
Cmd+Up and Cmd+Down. The editor reads Cmd+Arrow as an edge key everywhere, never as a step across
blocks. Where each edge key lands is `requirements/caret/motion-class.md`.

## Edge cases

- Cmd+Up on a paragraph's first line keeps the caret in its block instead of stepping to the block
  above, as a plain ArrowUp would
- Cmd+Left at a block's start keeps the caret in its block instead of stepping to the block before
- Cmd+Up in a table cell keeps the caret in its cell instead of stepping to the cell above
- Ctrl+Left on Windows and Linux still steps one word, never to the line start, even in a
  paragraph opening with an image

## User interactions

- each row sends its chord literally on every engine, so the Cmd+Arrow reading runs on every Linux
  push, not only on the macOS run

## Miss-analysis

- Five editor sites each compared Home or End, so Cmd+Arrow on a Mac reached none of them, and
  Cmd+Up hopped a block. Every spec pressed Home and End, and the one macOS run read Home as a
  scroll, so nothing ever sent Cmd+Arrow.
