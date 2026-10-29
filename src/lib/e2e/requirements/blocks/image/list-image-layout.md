# Feature: List/blockquote layout for image-bearing paragraphs

A list item's marker (`- `, `1. `) beside a paragraph that contains an image
widget sits at the paragraph's top, on its first line (at a leading picture's top,
the way Docs and Notion place it), and an image-only paragraph leaves no empty
line below its picture.

## Happy paths

- List item containing only an image: the `- ` marker's top edge aligns with the image's top edge
- List item containing only an image: the rendered list-item height is close to the image height (no large empty trailing line below the image)
- Nested list item containing an image: the image inherits the parent list's nesting indent (its left edge is right of the outer item's left edge)

## Edge cases

- A paragraph with text before/after an inline image is unaffected: text continues to flow normally rather than being forced into a flex row
- A top-level image with no container marker around it keeps default block layout (no flex)
- List item holding a wrapped image (`- [![pic](x)](url)`, `- *![pic](x)*`, and the strong/strikethrough equivalents): the item's marker is still held at the paragraph's top, even though the widget renders inside the wrapper rather than directly under the paragraph. Left on the picture's baseline, the marker sits at the picture's bottom
- Inline markers (`*`, `[]()`, escape, hard break) inside an image-bearing list-item paragraph stay in normal flow: only the item's marker is held at the top
- Inline markers in a non-list image paragraph stay in normal flow: a paragraph with no container marker gets none of this treatment at all
