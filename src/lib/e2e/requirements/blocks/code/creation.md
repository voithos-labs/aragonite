# Feature: Code Block Creation via Typing

Typing ``` in a paragraph re-parses the block as a fenced code block, unclosed for as long as the
opener line is being typed. The bare fence completes (opener, one empty body line, closer) the
moment the caret leaves the opener line: on Enter in source mode, and as the caret arrives in the
marker-hiding modes, where the rail's picker then asks for a language. This file covers the
user's first keystrokes after the kind change, where a naive mix of code-block conveniences and
fence-mode logic produces surprising results.

## Happy paths

- type ``` then Enter: the paragraph becomes a fenced code block, and Enter completes it with the
  caret on the empty body line, so the next typed text is the body (Enter is not swallowed, and
  not reinterpreted as "exit")
- type ```then a fourth`: the fourth backtick does not auto-pair — the unclosed fence is the user's in-progress opener, and extra backticks must not gain a phantom companion

## Edge cases

- backtick auto-pair is suppressed on the empty body line of an unclosed fence: typing never
  leaves that shape behind (the completion runs first), so it is loaded, as a document saved
  mid-fence is, and a backtick typed there stays solo
- once the fence is closed (user typed a terminating ``), normal backtick auto-pair resumes: ` ` `inside the body expands to` ` ` as in a closed fence
