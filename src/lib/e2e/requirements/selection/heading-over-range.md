# Feature: A heading key over a range re-kinds the blocks it reaches

Mod+digit over a selection across blocks gives every text block the selection reaches the heading level the key sets inside one block, deletes nothing, keeps the selection and undoes in one step. A block with no text (a divider, a code block, a table) keeps its bytes. Each row clicks the start, Shift+clicks the end, presses Mod+2 and then undoes, in source and live mode.

Miss-analysis: the heading key over a range removed the range first, and the rows pinned that removal (`## ` where the blocks stood), so no row asked for the blocks' text to stay.

## Happy paths

- Mod+2 from the middle of a paragraph, over a heading, to the middle of a paragraph: all three become level-2 headings (`## first`, `## head`, `## body`); the paragraph past the end stays.
- Mod+2 over two list items: each item's text becomes a heading inside its item (`- ## one\n- ## two`).

## Edge cases

- Mod+2 over a divider and a code block between two paragraphs: the paragraphs become headings, the divider and the code block keep their bytes.
- Mod+2 over a callout's body from its first line: both body paragraphs become headings and the opening row stays (`::::note\n## alpha\n\n## beta\n::::`).
