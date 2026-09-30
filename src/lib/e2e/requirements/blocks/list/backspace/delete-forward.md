# Block: List, Forward Delete

Delete behavior at the end of list items.

## Delete (forward delete)

- Delete at end of a non-last item does nothing (list items sit side by side rather than continuing one another's prose, so forward delete never joins them)
- Delete at end of the last item delegates to the parent: a following paragraph merges into the last item's text
