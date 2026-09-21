# Feature: conformance browser sweep: focus, selection paint, search paint

The closure matrix declares three DOM-only cells per kind (`focus`, `selectionPaint`,
`searchPaint`). The headless battery records them as `boundary`; this sweep runs them in a real
browser. It is driven from the live registry: every registered kind that declares a
`conformanceFixture` is swept, a kind that depends on its context and declares no fixture never
appears, and a new kind joins the moment it registers with a fixture. Each kind's fixture is
loaded between two plain neighbour paragraphs, so focus and selection have blocks to cross into
and out of.

The sweep proves that the three behaviours are present or degrade gracefully, one kind at a
time. It is not a behavioural suite: the per-kind specs still own the depth.

## Focus walk

- implemented: with the caret in the paragraph above, ArrowDown enters the kind's block (or, for a container, its child subtree) and carries on out to the paragraph below; a marker typed in the block it stops in appears there, so the block can be walked through and traps no caret.
- not supported (transparent or non-focusable): the walk reaches the paragraph below without the block ever taking focus, so it is skipped rather than trapping. (No enrolled kind declares this today; the branch is there for a future kind.)
- the same walk runs a second time under `live`, the mode that hides markers: the outcome per kind is identical, and what this pass adds is the shared fixture's watch for `[invariant:…]` console messages, since a kind that renders nothing but markers gets a caret put in it and a byte typed with the dev-mode check G1.33 watching. The mode is read from the editor's `data-presentation` attribute before the loop, because a mode that never applied would repeat the source pass under a live-sounding name.

## Selection paint

- implemented: a cross-block selection extended with Shift+ArrowDown from the paragraph above into the block paints at least one sized selection overlay inside the block's subtree (an endpoint rect or a middle cover rect). A kind that falls back or does not support this would paint a full-block cover instead of a partial one; no enrolled kind declares that today.

## Search paint

- implemented, measurable text: searching for a token drawn from the block paints at least one match overlay inside the block's subtree.
- implemented, a render-primary leaf showing its rendered form (`mathBlock`, `toc`): the source renders through a component with no measurable text node, so `createEditableLeaf` covers the rendered block box while the source stays hidden; the token is found and paints a cover overlay through the same `implemented` path as a kind with measurable text.
- not supported (`thematicBreak`): a token shared by the two neighbour paragraphs paints on them but never inside the block, and Enter navigation cycles between the neighbours without the active match landing on the block, so it is skipped and traps nothing.

## Enrolment and reachability

- Every registered kind with a `conformanceFixture` is swept.
- Enrollment covers a floor of known kinds (paragraph, heading, table, blockquote, mermaid, mathBlock, toc, callout, admonition): a kind quietly dropped from the bridge fails the floor instead of disappearing from the column tests. The floor is a subset assertion, so new kinds can enroll without touching it.
- Loading each kind's document waits for exact source equality rather than checking for a substring, because every sweep document carries both filler paragraphs and the previous kind's stale document can satisfy a substring wait.
- Every enrolled kind mounts a node from its own fixture. No kind may be unreachable: a fixture nothing claims means a lost registrar, or a directive name a second plugin took, and both are regressions.
- Each load clears the document to empty first, so a kind whose fixture is byte-identical to the previous kind's (`list`/`listItem`, `table`/`tableRow`) still gets a real reload rather than inheriting the typed change from the previous round. The document every kind is measured in is exactly three blocks, neighbour and fixture and neighbour, with nothing left over from an earlier load, so the cost of the walk and the index of the located block are the same for the first swept kind and the last, whether the file runs whole or filtered.

## Miss-analysis

- Order dependence (issue #66): every test ran the file whole or ran a single test filtered, and nothing compared the two. A counter that grew with every load, across all three column tests, made each document longer than the last, so the sweep blew its walking budget only when the tests ran in sequence. No test asserted that a sweep load's document shape is independent of how many loads came before it, and what carried the counter (leading blank lines) was documented as inert whitespace when in fact the parser turns a leading blank run into paragraph blocks.
