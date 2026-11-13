# Feature: a list pasted over a range from an item into the paragraph below

The removal joins the paragraph's tail to the item, the pasted items land at the caret it leaves, and the clipboard's last line ending opens the next item with the tail in it, as Enter does there.

## Happy paths

- `- alpha⟦\n\nbeta ⟧gamma` + `- x\n- y\n` is `- alphax\n- y\n- gamma`, the caret at `gamma`'s start; a typed `Z` gives `- Zgamma`.
- One item, `- x\n`: `- alphax\n- gamma`, the caret at `gamma`'s start; a typed `Z` gives `- Zgamma`.

Miss-analysis: the rows pinned a clipboard whose last line ending was dropped, so none asked where Enter would leave the tail.
