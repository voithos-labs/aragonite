# Feature: List/blockquote layout for image-bearing paragraphs

A container's marker (a list item's `- ` or `1. `, a footnote's `[^1]: `) goes where the first line
of its paragraph tells it to. If that line holds only pictures, the marker sits at the pictures'
top, the way Docs and Notion place it. If there's text on that line too, the marker sits on the
line's baseline next to the text, which is how a browser draws `<li><img> text</li>`. Either way an
image-only paragraph leaves no empty line below its picture.

## Happy paths

- List item containing only an image: the `- ` marker's top edge aligns with the image's top edge
- List item containing only an image: the rendered list-item height is close to the image height (no large empty trailing line below the image)
- Nested list item containing an image: the image inherits the parent list's nesting indent (its left edge is right of the outer item's left edge)
- List item with text on the picture's line (`- lead ![pic] after text`, `- ![pic] after text`), in source and live mode: the marker sits beside the text, its middle inside the text's line
  - Miss-analysis: every marker row held a picture alone on its line, a shape block-laid pictures forced, so no row put text beside a picture once they sat inline
- A footnote definition holding only a picture (`[^1]: ![pic]`), in source and live mode: its `[^1]: ` marker sits at the picture's top, as a list item's does; with text after the picture it sits beside the text
  - Miss-analysis: the screenshots that retired the old marker rule held no container that draws its marker inside the paragraph

## Edge cases

- A paragraph with text before/after an inline image is unaffected: text continues to flow normally rather than being forced into a flex row
- A top-level image with no container marker around it keeps default block layout (no flex)
- List item holding a wrapped image (`- [![pic](x)](url)`, `- *![pic](x)*`, and the strong/strikethrough equivalents): the item's marker is still held at the paragraph's top, even though the widget renders inside the wrapper rather than directly under the paragraph. Left on the picture's baseline, the marker sits at the picture's bottom
- Inline markers (`*`, `[]()`, escape, hard break) inside an image-bearing list-item paragraph stay in normal flow: only the item's marker is held at the top
- Inline markers in a non-list image paragraph stay in normal flow: a paragraph with no container marker gets none of this treatment at all
