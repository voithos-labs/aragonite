# Feature: a removal that empties a fence

Delete over a range that runs from one fence into the body of the next takes the first fence whole and the second one's body, and the caret lands in what is left of the second: a fence with no body line. Every arrival in such a fence gets its body line back, so the next letter lands in the body. A removal's landing is not someone authoring a fence, so no language picker opens.

## Happy paths

- At the top level, the range from the first fence's opener into the second's body, Delete, then `q`: `~~~\nq\n~~~` in live and source mode, no picker
- The same with a language on the second fence: `~~~js\nq\n~~~`
- In a callout: `:::note\n~~~\nq\n~~~\n:::`, both modes (the first fence went whole, so no empty line stays where it stood)

## Edge cases

- A fence never focused before the range goes down (the caret waited in another block) and a fence focused first by a click give the same bytes (regression: live mode opened the picker on the landing and it took the letter for the never-focused fence, and dropped the letter past the hidden closer for the focused one; miss-analysis: the completion and the picker ran only on a block's first focus, and every picker row arrived by a click, an arrow or an insert, none by a removal's landing)

## User interactions

- Typing a fence's opener in live mode opens the picker on the new fence, with or without a language after it; Enter then puts the caret in the body and `q` lands there (unchanged)
