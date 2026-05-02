# Feature: List/blockquote layout for image-bearing paragraphs

The ambient marker (`- `, `> `, etc.) on a paragraph that contains an image
widget aligns at the image's bottom-left (Obsidian-style), and image-only
paragraphs avoid the empty trailing line-box that contenteditables would
otherwise leave below a block-level child.

## Happy paths

- List item containing only an image: the `- ` marker's bottom edge aligns with the image's bottom edge (Obsidian-style)
- List item containing only an image: the rendered list-item height is close to the image height (no large empty trailing line below the image)
- Nested list item containing an image: the image inherits the parent list's nesting indent (its left edge is right of the outer item's left edge)

## Edge cases

- A paragraph with text before/after an inline image is unaffected: text continues to flow normally rather than being forced into a flex row
- A top-level image with no surrounding ambient marker keeps default block layout (no flex)
