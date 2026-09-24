# Feature: checks and plugin reads follow the `plugins` prop

An editor draws the inline syntax of the plugins its `plugins` prop lists and nothing else, so a
check that reparses a candidate write has to read the same syntax, or it refuses a write the
user can see is fine. `/test/plugins/activation?reads` mounts the two-editor page in live mode:
the first editor lists emoji and latex, the second lists neither, both list the toc, over the seed `# Title $*x*$`,
`[[toc]]`, `a :smile: b` and `a $x$ b`.

Miss-analysis: every link-card, pending-mark and edge-typing spec mounted one editor with every
installed plugin active, so a check reading every plugin agreed with the render; and no plugin
spec ran under an editor that left a plugin out, so a plugin's own inline read did too.

## Edge cases

- select `a :smile: b` in the editor without emoji and press Ctrl/Cmd+K: the link card opens, since the editor draws the shortcode as text (regression #432: the wrap check parsed with every installed plugin and refused the emoji it found)
- in the editor without latex, put the caret after the `x` of `a $x$ b`, press Ctrl/Cmd+B, and type `y`: the source reads `a $x**y**$ b` (regression #432: the check reparsed the candidate as math and dropped the bold)
- the toc label of `# Title $*x*$` reads `Title $x$` in the editor without latex, which draws the stars as emphasis, and `Title $*x*$` in the editor with latex, which draws the math source (regression #433: a plugin's inline read scanned with every installed plugin, so both labels read the math source)

## User interactions

- the link scenario is a click on the paragraph, Home, Shift+End, then Ctrl/Cmd+K; the bold one is a click, Home, four ArrowRight presses, Ctrl/Cmd+B, then typing; the toc one only reads each pane's rendered list
