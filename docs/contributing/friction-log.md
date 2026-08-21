# Friction log

## What this is

Contributor-experience friction that is real and reproduced, but is not a defect: a convention
nobody wrote down, a doc that sends you the wrong way, a seam that reads as arbitrary until someone
explains it. Defects go to [GitHub Issues](https://github.com/voithos-labs/aragonite/issues). This
file is for everything else, the stuff that only exists for a person who does not already know the
codebase.

Entries come from cold-start probes and from anyone who hits one. **If you trip over something
while getting oriented, write it down here before you understand it.** That sounds backwards and it
isn't. The moment you work out why the seam is the way it is, the friction goes invisible to you,
permanently, the same way it is invisible to me. A retired entry earns its keep for the same
reason: it stops the finding from being rediscovered as new.

## Open

**`docs/design/invariants.md` is a catalog you cannot read in a plain-text view.** Its table cells
run to hundreds of characters, plenty of them past a thousand, so a row that reads fine in a
rendered browser view is an unbroken wall in an editor, a terminal, or a diff. The catalog is
correct and load-bearing, which is exactly why the reading cost matters: it is the document you
most need to read, in the place you can least read it. Closing it means a shape that survives both
views, most likely a short table plus per-entry prose below it, not shorter statements.

**The cross-block keydown twin is documented in the code but not on the road that leads to it.**
The first-press arm and the already-cross-block arm carry the identical chord set, and the source
says so at the entry arm. The codebase map's cross-block row does not, so a contributor who arrives
through the map (which is the intended route) adds a chord to one arm and finds out about the
second only if they happen to scroll. This is the sibling-path shape the rules name, sitting in the
one place the rules do not point at it. Yes, I see the irony.

**`RefSlots` hides its reactive contract behind an accessor pair.** The type is a `get` and a `set`
over a scope's ref array, and its header explains why object identity is load-bearing. What it does
not say is whether a `get` participates in reactivity. That is the first question anyone writing
against it will have, and the signature does not answer it.

**"An entry-level issue names the field, not the shape."** Our `good first issue` bodies tend to
describe the architectural shape a fix has to respect, which is the right content for the ledger
and precisely the wrong content for somebody's first contribution: the reader cannot tell which
file to open, or when they are done. The convention worth writing down is that an entry-level body
names one concrete edit site and one acceptance signal, with the shape as background rather than as
the task.

**`consumer-smoke` is the one gate no `dev` commit runs.** It is correct, and it catches what
nothing else can, but CI triggers it on `pull_request` and `push: main` only, while the working
branch is `dev`. So a break introduced there surfaces weeks later on whatever dependabot PR happens
next, wearing that PR's name and burning that PR's reviewer: a stale fixture in the consumer
example sat red for a fortnight exactly that way. Closing it means either a `dev` trigger (the
matrix is long) or a cheap subset a contributor is told to run before pushing anything that touches
`examples/consumer` or a published barrel.

## Retired

| Friction                                                                                       | Retired by                            |
| ---------------------------------------------------------------------------------------------- | ------------------------------------- |
| No dev-warning taxonomy: console output was undifferentiated, and nothing said what fails      | `94ed069d1` (warnings.md)             |
| The dirty-tree convention was unwritten, so an uncommitted call site read as precedent         | `19fd77792` (CONTRIBUTING quickstart) |
| The reveal road was a chain of nine names in one paragraph, with no picture of the flow        | `2b018af9b` (map diagram)             |
| Keyboard and chord dispatch had no single explanation of tiers, `Mod` folding, or the manifest | `60fb8ca49`                           |
| The miss-analysis convention did not say where a unit-level one lives                          | `5776d03cc`, `2703ffba9`              |
| `docs/design/editor.md` gave no reading tier, so orientation read as all-or-nothing            | `5776d03cc`                           |
| The consumer guide listed no keyboard shortcut table                                           | `9c4b35804`                           |
