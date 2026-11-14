# Clipboard: a line ending pasted at a container's last paragraph

A clipboard's last line ending lands as Enter does where it lands. At the end of a container's last paragraph that is an empty line inside the container, with the caret on it, never a line outside it.

## Happy paths

- `> alpha\n\nAfter\n`, caret at the end of `alpha`, paste `one\n`: `> alphaone\n>\n>\n\nAfter\n`, and a typed `Z` lands on the empty quoted line: `> alphaone\n>\n> Z\n\nAfter\n`
- The same in an alert (`> [!NOTE]`): `> [!NOTE]\n> alphaone\n>\n> Z\n\nAfter\n`
- In a callout's body: the empty line stays above the closing `:::`, a blank line kept over it: `:::note\nalphaone\n\nZ\n:::\n\nAfter\n`
- A footnote the footnotes plugin draws as one block takes the empty line under it, as Enter there does: `[^1]: alphaone\n\nZ\n\nAfter\n`
- In a quote inside a list item: the empty quoted line stays in the item: `- > alphaone\n  >\n  > Z\n- after\n`
- In an open details body: the empty line stays above `</details>`: `alphaone\n\nZ\n</details>`
- A quote pasted with its line ending into a quote joins it, and its ending is the quote's empty line: `> alpha` + `> one\n` gives `> alphaone\n>\n> Z\n>\n> after\n`

## Miss-analysis

- The ending rows put the caret in a top-level block or a list item, and the one quote host had a line under the paragraph, so no row asked where the ending's line lands at a container's end; the core rows ran in jsdom alone, which takes no caret in a details body.
