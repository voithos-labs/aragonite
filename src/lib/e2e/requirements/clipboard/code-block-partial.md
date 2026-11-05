# Feature: Code block partial copy, literal clipboard

A fenced code block stores its opener, body and closer as one flat string, and a selection inside
it copies exactly the bytes it covers. A selection that takes in a fence line copies the fence too,
so a lone ` ``` ` can reach the clipboard; the editor doesn't trim it off.

## Happy paths

- Ctrl+A selects the entire code block display and copy preserves the full fence pair on the clipboard (round-trippable as a complete code block).
- A partial selection that includes the opening fence and some body lines copies the fence with them.
- A partial selection that includes body lines and the closing fence copies the fence with them.

## Edge cases

- A selection of the lone fence of an empty code block copies the bare ` ``` `.
- Pasting a whole copied code block into another code block keeps its body literal: the outer fence grows a backtick so the pasted fences stay text.

## User interactions

- Triple-click / Ctrl+A inside a code block then Ctrl+C: full block including fences on the clipboard.
- Click in the body, Shift+Arrow across a fence boundary, Ctrl+C: the fence comes along as selected.

## Miss-analysis

- Under Firefox on Windows the Ctrl+A copy wrote the fences and body with CRLF line breaks, since
  the copy took the browser's selection string as is. The suite ran on Chromium alone, whose
  string is LF.
