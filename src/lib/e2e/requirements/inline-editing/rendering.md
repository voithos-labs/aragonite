# Feature: Inline Editing — Rendering

How loaded inline-formatted content renders in the DOM (bold, italic, code, links, nesting).

## Happy paths

- bold text renders with <strong>: loading **bold** produces a <strong> element
- italic text renders with <em>: loading _italic_ produces an <em> element
- inline code renders with markers: loading `code` shows backtick markers and code content
- link renders with <a>: loading [text](url) produces an <a> element

## Edge cases

- nested formatting renders: **bold _and italic_** produces nested strong/em elements
