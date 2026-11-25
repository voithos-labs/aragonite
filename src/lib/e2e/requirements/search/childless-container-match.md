# Feature: Search over a block drawn as a picture of its source

Some blocks show a picture of their source instead of the source: a diagram, a math block in
either fence, a table of contents, a parrot, and a childless opaque container, the older shape
of the same thing. Search reads their source like a leaf's: matches are found, painted on the
block and navigable. Replace rewrites them too, as long as the block reads back as itself. A
substitution that would turn one into another block (a diagram into a code block, a formula into
paragraphs) is declined, wherever the block sits, and the matches beside it still land. This
file lives in the search area but drives the plugins harness, since only plugin types draw
pictures of their source.

## Happy paths

- Querying a string that exists only inside an off-screen mermaid block's source finds the
  match (count reads 1 of 1), paints a `.match-overlay` inside that block's host, and
  navigating (Enter) scrolls the block into the editor viewport with the active overlay on it.
- Replace All over one prose match + one mermaid match rewrites both: the diagram's source
  carries the replacement, the block is still a diagram afterwards, and the bar reads
  `2 replaced`.

## Edge cases

- A query matching the fence's info string (`mermaid` → `js`) is declined for the diagram and
  applied to the prose: the fence keeps its opener and its kind, the declined match survives the
  rescan (count re-reads 1 of 1), and `replacedCount` reports 1.
- Replace (not All) on the diagram's info-string match declines it, writes nothing and leaves no
  undo step.
- The same query on a diagram inside a quote, beside a prose match in that quote, inside a list
  item and inside an admonition: each diagram is declined and the prose match lands.
- A math block's `math` info string, its `$$` fence, a table of contents' name inside `[[toc]]`
  and a parrot's `parrot` are declined the same way, and the prose match beside them lands.
- A code block's info string replaced into `mermaid` still turns the code block into a diagram:
  only a block drawn as a picture keeps its kind.
- A regex replace whose match runs from the last diagram line through the closing fence
  (`B`, the line break and the three backticks, replaced with `C`) rewrites the diagram source
  and the closing fence comes back: the block below (`Tail`) stays a paragraph of its own instead
  of being swallowed into the diagram.

## Pinned below the browser

- The decline over a formula in a list item and in a quote, the count of a quote holding a prose
  match beside a declined one, a match inside a formula that still replaces, and a code block
  that may still become a formula: `test/editor-actions/search-replace.test.ts`.

## Miss-analysis

- The original defect shipped because the issues ledger itself encoded a wrong premise
  ("the match is found and navigable, only its highlight is missing") and no test queried
  text that lived only inside a childless container's raw: the gap in the scan was invisible to
  every leaf-based search spec. This file pins the container-raw query directly.
- The lost closing fence (#387) shipped because every mermaid write test went through the
  diagram's own code editor, and no replace query reached past the diagram source into the fence
  bytes, the one write path that hands the kind a truncated raw.
- A diagram became a code block under Replace All once mermaid moved from a childless container
  to a block drawn as a box: the rule keyed on being a container, and its rows ran on the old
  container fixture alone, so no row held the rule to what the block draws.
