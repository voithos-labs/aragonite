# Feature: checks and plugin reads follow the `plugins` prop

An editor draws the inline syntax of the plugins its `plugins` prop lists and nothing else, so a
check that reparses a candidate write has to read the same syntax, or it refuses a write the
user can see is fine. `/test/plugins/activation?reads` mounts the two-editor page in live mode:
the first editor lists emoji and latex, the second lists neither, both list the toc and footnotes, over the seed
`# Title $*x*$`, `[[toc]]`, `a :smile: b`, `a $x$ b`, `n $[^x]$ m [^y]` and the definitions of `x` and `y`.

Miss-analysis: every link-card, pending-mark and edge-typing spec mounted one editor with every
installed plugin active, so a check reading every plugin agreed with the render; and no plugin
spec ran under an editor that left a plugin out, so a plugin's own inline read did too.

## Edge cases

- select `a :smile: b` in the editor without emoji and press Ctrl/Cmd+K: the link card opens, since the editor draws the shortcode as text (regression #432: the wrap check parsed with every installed plugin and refused the emoji it found)
- in the editor without latex, put the caret after the `x` of `a $x$ b`, press Ctrl/Cmd+B, and type `y`: the source reads `a $x**y**$ b` (regression #432: the check reparsed the candidate as math and dropped the bold)
- the toc label of `# Title $*x*$` reads `Title $x$` in the editor without latex, which draws the stars as emphasis, and `Title $*x*$` in the editor with latex, which draws the math source (regression #433: a plugin's inline read scanned with every installed plugin, so both labels read the math source)
- the references in `n $[^x]$ m [^y]` draw `1` and `2` in the editor without latex, and the one reference the editor with latex draws reads `1` (the editor without latex drew `x` and `1` when its footnote references were handed no reader and numbered with every plugin; miss-analysis: the unit handed the reader straight to the numbering function, and no spec drew a footnote reference under an editor that left a plugin out)
- Ctrl+click on the `[^x]` definition marker in the editor without latex puts the caret in `n $[^x]$ m [^y]` (reading with every plugin, the jump back finds no reference inside the dollars; same miss-analysis)

## User interactions

- the link scenario is a click on the paragraph, Home, Shift+End, then Ctrl/Cmd+K; the bold one is a click, Home, four ArrowRight presses, Ctrl/Cmd+B, then typing; the toc and numbering ones only read each pane's rendered text
