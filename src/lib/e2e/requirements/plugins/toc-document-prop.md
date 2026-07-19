# Feature: TOC block — the `document` prop's named consumer

A `toc` leaf claims the exact line `[[toc]]` and renders a `<nav>` list of the
document's headings (`heading` + `setextHeading`), each heading's text stripped of
its markers via the descriptor's `getContentRange`. It is render-primary: the folded
view is the heading list, a click reveals the raw `[[toc]]` source in a
contenteditable, and blur folds back. The heading list is derived from
`BlockComponentProps.document` — so this dogfood is the runtime proof that the prop
is delivered, live, and reaches nested depth. Driven through real mouse/keyboard.

## Opener strictness (globally registered — must not misfire in sibling specs)

The opener claims ONLY the exact line `[[toc]]`. It declines an indented ` [[toc]]`
and a `[[toc]] trailing` line — both fall through to a paragraph. Exact-match keeps
the process-wide opener inert for every other plugin spec's document. (Byte-level
recognition cases are pinned in the `toc-round-trip` unit suite; this file covers the
user-facing behavior only.)

## Happy paths

- A top-level `[[toc]]` renders a `<nav>` list of the document's headings above it:
  the two ATX headings and the one setext heading, each as its marker-stripped text,
  and no `[[toc]]` source is exposed while folded
- Clicking the folded list reveals the raw `[[toc]]` source as editable text; the CST
  is untouched by the reveal (a view toggle)

## User interactions

- Editing a heading above the `[[toc]]` updates the folded list live — the `document`
  prop is a live view of the CST, not a mount-time snapshot
- Reveal, type into the source, delete back to `[[toc]]`, then blur: the list returns
  and `getSource()` is byte-identical to before (a net-zero edit is a pure view toggle;
  the render-primary commit path only fires when the text actually changed)

## Edge cases

- **Nested depth (the sibling-path guard):** a `[[toc]]` inside a blockquote renders
  the document's top-level headings and updates when one is edited. The prop is
  delivered by editor context, so it must reach a nested `BlockHost` on the container
  render path — a top-level scenario alone cannot pin that it survives nesting
- **Byte round-trip:** a document containing `[[toc]]` loads and serializes
  byte-identically through the editor (`getSource()` equality)
