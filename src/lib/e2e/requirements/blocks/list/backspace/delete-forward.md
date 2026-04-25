# Block: List — Forward Delete

Delete behavior at the end of list items.

## Delete (forward delete)

- Delete at end of a non-last item is a no-op (list items are structural peers, not prose continuations — they do not concat via forward delete)
- Delete at end of the last item delegates to the parent: a following paragraph merges into the last item's text
