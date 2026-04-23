# Feature: cross-block clipboard — structural paste discriminator (single-paragraph vs multi-block)

## Happy paths

- Pasting a markdown list at the end of a paragraph creates a list block below the paragraph with no items dropped.
- Pasting a markdown list inside a list item preserves all pasted items alongside the original items.
- Pasting a heading at the end of a paragraph creates a heading block below the paragraph.
- Cross-block paste of multi-block clipboard content into a list-item selection lands every pasted block; selected items are removed and the untouched tail item survives.
