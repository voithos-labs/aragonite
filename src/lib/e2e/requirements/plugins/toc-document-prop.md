# Feature: TOC block, the `document` prop's named consumer

A `toc` leaf takes the exact line `[[toc]]` and renders a `<nav>` list of the document's
headings (`heading` and `setextHeading`), each heading's text stripped of its markers through
the descriptor's `getContentRange`. It is render-primary: at rest the view is the heading list,
a click shows the raw `[[toc]]` source in a contenteditable, and a blur brings the list back.
The heading list is derived from `BlockComponentProps.document`, so this dogfood is the running
proof that the prop is delivered, stays live, and reaches nested blocks. Driven through real
mouse and keyboard.

## Opener strictness (globally registered: must not misfire in sibling specs)

The opener takes only the exact line `[[toc]]`. It declines an indented ` [[toc]]` and a
`[[toc]] trailing` line, and both fall through to a paragraph. Matching exactly is what keeps
this process-wide opener out of every other plugin spec's document. (The byte-level recognition
cases are pinned in the `toc-round-trip` unit suite; this file covers the behavior the user
sees.)

## Happy paths

- A top-level `[[toc]]` renders a `<nav>` list of the document's headings above it: the two ATX
  headings and the one setext heading, each as its text with the markers stripped, and no
  `[[toc]]` source is shown while the list is the view
- Clicking the block away from an entry, on its accent border or padding, since clicking an
  entry navigates instead, shows the raw `[[toc]]` source as editable text, and the tree is
  untouched, because only what is shown changed

## User interactions

- Editing a heading above the `[[toc]]` updates the list as you type, because the `document`
  prop is a live view of the tree rather than a copy taken at mount
- Show the source, type into it, delete back to `[[toc]]`, then blur: the list returns and
  `getSource()` is byte-identical to before, because an edit that nets out to nothing changes
  only what is shown, and the render-primary commit only fires when the text really changed

## Edge cases

- **Nested depth (the check on the nested path):** a `[[toc]]` inside a blockquote renders the
  document's top-level headings and updates when one is edited. The prop is delivered through
  editor context, so it has to reach a nested `BlockHost` on the container's render path, and a
  top-level scenario alone cannot pin that it survives nesting
- **Byte round-trip:** a document containing `[[toc]]` loads and serializes byte-identically
  through the editor, asserted by `getSource()` equality
