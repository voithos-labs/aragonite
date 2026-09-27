# Feature: Backspace into a heading item

A list item can hold a heading (`- # Plan`, or a title with a `===` line under it). Backspace at the start of the item after it joins that item's text onto the heading, the same as it would onto a paragraph. Checked in live mode, where the markers are hidden.

Miss-analysis: every list Backspace test had a paragraph in the previous item, so nothing tried the heading the merge also targets, and the join threw instead of merging.

## Happy paths

- `- # Plan` then `- next`, Backspace at the start of `next`: the source reads `- # Plannext`, and a key typed next lands between `Plan` and `next`
- `- Plan` over `  ===` then `- next`, the same Backspace: the source reads `- Plannext` with the `===` line still under it, and the next key lands at the join
