# Feature: Code Block Creation via Typing

Typing ``` in a paragraph re-parses the block as a fenced code block, unclosed for as long as the
opener line is being typed. The bare fence completes (opener, one empty body line, closer) the
moment the caret leaves the opener line: on Enter in source mode, and as the caret arrives in the
modes that hide markers, where the picker in the code block's side gutter then asks for a
language. This file covers the user's first keystrokes after the block changes kind, where a
careless mix of the code block's conveniences and fence-mode logic gives surprising results.
Backtick auto-pair against an unclosed or closed fence is a byte rule pinned by
`src/lib/test/blocks/code/code-backtick-autopair.test.ts`.

## Happy paths

- type ``` then Enter: the paragraph becomes a fenced code block, and Enter completes it with the
  caret on the empty body line, so the next typed text is the body (Enter is not swallowed, and
  not reinterpreted as "exit")
