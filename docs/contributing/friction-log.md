# Friction log

## What this is

Contributor-experience friction that is real and reproduced, but is not a defect: a convention
nobody wrote down, a doc that sends you the wrong way, a seam that reads as arbitrary until someone
explains it. Defects go to [GitHub Issues](https://github.com/voithos-labs/aragonite/issues); this
is for everything that only shows up when a person who does not already know the codebase tries to
work in it.

Entries come from cold-start probes and from anyone who hits one. **If you trip over something
while getting oriented, add it here.** The value is in recording it before it becomes invisible to
you, and a retired entry keeps the same finding from being rediscovered as new.

## Open

**`docs/design/invariants.md` is a catalog you cannot read in a plain-text view.** Its table cells
run to hundreds of characters, many of them past a thousand, so a row that reads acceptably in a
rendered browser view is an unbroken wall in an editor, a terminal, or a diff. The catalog is
correct and load-bearing, which is exactly why the reading cost matters. Closing it means a shape
that survives both views, most likely a short table plus per-entry prose below it, not shorter
statements.

**The cross-block keydown twin is documented in the code but not on the road that leads to it.**
The first-press arm and the already-cross-block arm carry the identical chord set, and the source
says so at the entry arm. The codebase map's cross-block row does not, so a contributor who arrives
through the map (the intended route) adds a chord to one arm and learns about the second only if
they happen to scroll. This is the sibling-path shape the rules name, sitting in the one place the
rules do not point at it.

**`RefSlots` hides its reactive contract behind an accessor pair.** The type is a `get` and a `set`
over a scope's ref array, and its header explains why object identity is load-bearing. What it does
not say is whether a `get` participates in reactivity, which is the first question anyone writing
against it has, and the answer is not derivable from the signature.

**"An entry-level issue names the field, not the shape."** Our `good first issue` bodies tend to
describe the architectural shape a fix must respect, which is the right content for the ledger and
the wrong content for a first contribution: the reader cannot tell which file to open or when they
are done. The convention worth writing down is that an entry-level body names one concrete edit
site and one acceptance signal, with the shape as background rather than as the task.

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
