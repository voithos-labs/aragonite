# Friction log

Friction that is real and reproduced but is not a defect: a convention nobody wrote down, a
doc that sends you the wrong way, a boundary that reads as arbitrary until someone explains
it. Defects go to [GitHub Issues](https://github.com/voithos-labs/aragonite/issues); this
file is for everything else, the stuff that only exists for a person who does not already
know the codebase.

Entries come from cold-start probes (sessions where someone who has never seen the repo
tries to get something done) and from anyone who trips. **If you trip over something while
getting oriented, write it down here before you understand it.** Sounds backwards, isn't:
the moment you work out why a thing is the way it is, the friction goes invisible to you,
permanently, same as it is to me. Retired entries stay in the table for the same reason,
so the finding doesn't get rediscovered as new.

## Open

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

## Retired

| Friction                                                                                                                                          | Retired by                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| No dev-warning taxonomy: console output was undifferentiated, and nothing said what fails                                                         | `067a08f6b` (warnings.md)                                        |
| The dirty-tree convention was unwritten, so an uncommitted call site read as precedent                                                            | `5a0904937` (CONTRIBUTING quickstart)                            |
| The reveal road was a chain of nine names in one paragraph, with no picture of the flow                                                           | `56e69b60d` (map diagram)                                        |
| Keyboard and chord dispatch had no single explanation of tiers, `Mod` folding, or the manifest                                                    | `14325665e`                                                      |
| The miss-analysis convention did not say where a unit-level one lives                                                                             | `d4cffb6df`, `e89934ced`                                         |
| `docs/design/editor.md` gave no reading tier, so orientation read as all-or-nothing                                                               | `d4cffb6df`                                                      |
| The consumer guide listed no keyboard shortcut table                                                                                              | `12cbc45db`                                                      |
| `consumer-smoke` ran on pull requests and `main` only, so a `dev` break surfaced on someone else's PR                                             | `0d46e7413` (consumer-smoke.yml)                                 |
| `docs/design/invariants.md` was a catalog unreadable in plain text: cells ran past a thousand characters, a wall in any editor, terminal, or diff | `2f865eb60` (the catalog reshape: index tables, per-entry prose) |
