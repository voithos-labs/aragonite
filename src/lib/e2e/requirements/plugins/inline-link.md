# Feature: an inline construct that reads as a built-in link keeps its own bytes

The `inline-link` harness plugin reads `[[target|text]]` through an `inline()` construct with
`as: 'link'`: the editor treats it as a link (the card, the live split, the edge rule), and its
`write` turns an edit back into `[[…|…]]`. Seed `inline-link`: block 0 `See [[note|Shown]] here`,
block 1 `After`, in live mode.

## Happy paths

- In live mode the link shows `Shown` and hides the rest of its bytes.
- Mod+K inside the text opens the link card; a new URL committed there writes `[[page|Shown]]`.
- A new text committed in the card writes `[[note|Other]]`.

## Edge cases

- Enter inside the text cuts at the claim's edge, its bytes whole in one block.
- Two paragraphs pasted inside the text land at the claim's edge, its bytes whole:
  `See [[note|Shown]]one` over `two here`.
- Backspace through the whole text takes the claim whole, leaving no bracket behind.
- A range from inside the text past its end deletes only what shows: `[[note|Sh]]re`.
- A letter typed at either edge of the text lands outside the link, as at a built-in link.
- Mod+B over a range crossing the link's edge writes no GFM over the claim.
- A letter typed in a text that also spells the start of its target (`[[notebook|note]]`) lands in the text: `[[notebook|noXte]]`.

Miss-analysis: the arm's first rows called the byte writers directly, so nothing drove the card,
the live split or the edge rule over a link whose bytes aren't GFM. And every row's text appeared
once in its claim, so none asked which run of the bytes is the text: the first one won, and a
letter typed in `[[notebook|note]]` wrote the target. The Enter row passed for a claim cut at its
text's edge, inside it, which a link survives and a paste doesn't: no row pasted there.
