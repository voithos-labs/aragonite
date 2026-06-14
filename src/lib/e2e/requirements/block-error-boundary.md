# Feature: Per-block error boundary

A block whose component throws during render must not blank the document; the
failing block degrades to a recoverable fallback and the editor emits an `error`
event.

## Happy paths

- A block that throws on render shows the failed-block fallback (`[data-failed-block]`) containing its raw source.
- Blocks before and after the failed block render and remain editable.
- The editor emits one `error` event with `origin: "render"` when a block throws.

## Edge cases

- Serialized source is unaffected by a render failure (the failed block's own raw still round-trips).
