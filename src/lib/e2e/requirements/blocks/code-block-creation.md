# Feature: Code Block Creation via Typing

Typing ``` in a paragraph re-parses the block as a fenced code block. The newly created fence is unclosed. This file covers the user's first keystrokes after the kind change, where a naive mix of code-block conveniences and fence-mode logic produces surprising results.

## Happy paths

- type ``` then Enter: the paragraph becomes an unclosed fenced code block; Enter inserts a newline inside the body (it is not swallowed or reinterpreted as "exit")
- type ``` then a fourth `: the fourth backtick does not auto-pair — the unclosed fence is the user's in-progress closer, and extra backticks must not gain a phantom companion

## Edge cases

- backtick auto-pair is still suppressed on an empty body line of an unclosed fence: even after Enter moves into the body, extra backticks stay solo because the fence is still unclosed
- once the fence is closed (user typed a terminating ```), normal backtick auto-pair resumes: `` ` `` inside the body expands to `` `` `` as in a closed fence
