# Feature: typing that grows a `:::` fence

A `:::` container's fence is as long as the longest colon line inside it needs. Typing a closing line in a body, or a colon on a nested opener row, makes the outer fence grow, and the editor reads the container again. Each key leaves the caret where it typed and the tree as a reload would read it.

Driven on `/test/plugins?seed=admonitions`, every row in source and in live mode, each asserting the exact caret and the bytes.

## Happy paths

- `:::note` with a body: Enter at the body's end, then `:::`: the fence grows to `::::`, the `:::` line stays a body line, and the caret stays after its third colon.
- A colon typed at a nested `:::tip` row's start: both fences grow by one, the caret after the colon.
- A colon typed after a nested row's third colon: the same, the caret after the new colon.

## Regressions

- A fence that grew threw the caret to the outer row's byte 0, and the next letter unmade the outer callout. Miss-analysis: every relanding row was a strip container (a quote, a list), whose byte map the old helper answered; for a `:::` container it answered nothing and the fallback was byte 0.
