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
- implemented, render-primary leaf widget (`mathBlock`, `toc`): the token is found and navigable but paints no rect — the source is not a measurable text node. This is the ledgered gap (`docs/issues.md`); the sweep pins the current degraded behaviour and flags if painting is later wired.
- not-supported (`thematicBreak`): a token shared by the two neighbour paragraphs paints on them but never inside the block, and Enter navigation cycles between the neighbours without the active match landing on the block — skip, no trap.

## Enrolment and reachability

- Every registered kind with a `conformanceFixture` is swept.
- `admonition` is unreachable on this route: its `:::note` fixture is shadowed by the co-registered callout dogfood (which claims `:::note` first), so no admonition node mounts; the callout `note` entry sweeps the same container-directive behaviours. Any other unreachable kind is a regression.
