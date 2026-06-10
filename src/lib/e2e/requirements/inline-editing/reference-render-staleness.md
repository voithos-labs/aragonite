# Feature: Inline Editing — Reference Render Staleness

When a link-reference definition (LRD) changes elsewhere in the document, an
unedited reference block that resolves through it must re-render its `<a href>`
to the new target — not keep the stale one. The render path re-parses the
block's raw with the live resolver but must invalidate its render memo on
resolver change for reference-bearing blocks.

## Happy paths

- reference resolves on load: loading `See [click][go].` with `[go]: https://old.com` renders block 0's `<a>` with href `https://old.com`

## Edge cases

- editing only the LRD URL updates an unedited reference block's rendered href: changing the LRD target to `https://new.com` (without touching block 0) re-renders block 0's `<a href>` to `https://new.com`
- removing the LRD reverts the reference to plain text: deleting the LRD line re-renders block 0 with no `<a>` element
