# Feature: Code Block Creation via Typing

Typing ``` in a paragraph re-parses the block as a fenced code block, unclosed for as long as the
opener line is being typed. The bare fence completes (opener, one empty body line, closer) the
moment the caret leaves the opener line: on Enter in source mode, and as the caret arrives in the
modes that hide markers, where the picker in the code block's side gutter then asks for a
language. This file covers the user's first keystrokes after the block changes kind, where a
careless mix of the code block's conveniences and fence-mode logic gives surprising results.

## Happy paths

- type ``` then Enter: the paragraph becomes a fenced code block, and Enter completes it with the
  caret on the empty body line, so the next typed text is the body (Enter is not swallowed, and
  not reinterpreted as "exit")
- type ```then a fourth`: the fourth backtick does not auto-pair, because the unclosed fence is the opener the user is still typing and extra backticks must not gain a partner nobody asked for

## Edge cases

- backtick auto-pair is turned off on the empty body line of an unclosed fence: typing never
  leaves that shape behind, since the completion runs first, so the test loads it the way a
  document saved mid-fence arrives, and a backtick typed there stays on its own
- once the fence is closed (the user typed a terminating ``), normal backtick auto-pair resumes: ` ` `inside the body expands to` ` ` as in a closed fence
