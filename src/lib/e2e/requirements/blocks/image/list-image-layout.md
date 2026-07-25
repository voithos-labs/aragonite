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
- List item holding a wrapped image (`- [![pic](x)](url)`, `- *![pic](x)*`, and the strong/strikethrough equivalents): the ambient marker is still pinned out of flow and still sits at the image's bottom edge, even though the widget renders inside the wrapper rather than directly under the paragraph. Unpinned, the marker rides the paragraph's first line box and the bullet renders a full image-height above where it belongs
- Inline markers (`*`, `[]()`, escape, hard break) inside an image-bearing list-item paragraph stay in normal flow — only the ambient marker is pinned
- Inline markers in a non-list image paragraph stay in normal flow: a paragraph with no ambient marker gets no pinning treatment at all
