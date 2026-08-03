# Feature: conformance browser sweep — focus, selection paint, search paint

The closure matrix declares three DOM-only cells per kind (`focus`, `selectionPaint`,
`searchPaint`). The headless battery records them as `boundary`; this sweep executes them
in a real browser. It is driven from the live registry — every registered kind that declares
a `conformanceFixture` is swept, a chrome/context-dependent kind (no fixture) never appears,
and a new kind is enrolled the moment it registers with a fixture. Each kind's fixture is
loaded sandwiched between two plain neighbour paragraphs so focus and selection have blocks
to cross into and out of.

The sweep proves presence/degradation of the three behaviours per kind — it is not a
behavioural suite; the per-kind specs keep owning depth.

## Focus walk

- implemented: caret in the paragraph above, ArrowDown enters the kind's block (or, for a container, its child subtree) and continues out to the paragraph below; a marker typed in the landing block appears there — the block is traversable, no caret trap.
- not-supported (transparent / non-focusable): the walk reaches the paragraph below without the block ever taking focus — skipped, not trapped. (No enrolled kind currently declares this; the branch guards a future kind.)

## Selection paint

- implemented: a cross-block selection extended with Shift+ArrowDown from the paragraph above into the block paints at least one sized selection overlay within the block's subtree (endpoint or middle cover rects). A fallback/not-supported kind would paint a full-block cover instead of a partial trap — no enrolled kind currently declares that.

## Search paint

- implemented, measurable text: searching a token drawn from the block paints at least one match overlay within the block's subtree.
- implemented, folded render-primary leaf (`mathBlock`, `toc`): the source renders through a component with no measurable text node, so `createEditableLeaf` covers the rendered block box while folded — the token is found and paints a cover overlay through the same `implemented` path as a measurable-text kind.
- not-supported (`thematicBreak`): a token shared by the two neighbour paragraphs paints on them but never inside the block, and Enter navigation cycles between the neighbours without the active match landing on the block — skip, no trap.

## Enrolment and reachability

- Every registered kind with a `conformanceFixture` is swept.
- Enrollment covers a known-kind floor (paragraph, heading, table, blockquote, mermaid, mathBlock, toc, callout, admonition): a kind silently dropped from the bridge fails the floor instead of vanishing from the column tests. The floor is a subset assertion — new kinds enroll without touching it.
- Loading each kind's document settles on exact source equality, not a substring probe — every sweep document carries both filler paragraphs, so a substring wait is satisfiable by the previous kind's stale document.
- Every enrolled kind mounts a node from its own fixture. No kind is allowed to be unreachable: an unclaimed fixture means a lost registrar or a directive name a second plugin took, and both are regressions.
- Each load clears the document to empty first, so a kind whose fixture is byte-identical to the previous kind's (`list`/`listItem`, `table`/`tableRow`) still gets a real reload rather than inheriting the prior iteration's typed mutation. The document every kind is measured in is exactly three blocks — neighbour, fixture, neighbour — with no per-load residue, so the walk cost and the located block index are the same for the first swept kind and the last, whether the file runs whole or filtered.

## Miss-analysis

- Order dependence (issue #66): every test ran the file whole or a single test filtered, and nothing compared the two — a per-load counter that grew across all three column tests made each document longer than the last, so the sweep's walk blew its budget only in sequence. No test asserted that a sweep load's document shape is independent of how many loads preceded it, and the counter's carrier (leading blank lines) was documented as inert trivia when the parser materializes a leading blank run as paragraph blocks.
