# Feature: One Edit Event per Op — Paste Sites

Paste-dispatch sites that route through `applyStructuralResult`, `applyContainerMatchingPaste`, and `applyContainerMatchingMerge` each emit a deterministic event count.

## Migrated sites covered

- Paste structural content inside a list item (nested paste): exactly one edit event — the nested-paste commit.
- Paste a matching list into a list with a matching ancestor and empty target (container-matching paste): exactly one edit event — the container-matching commit.
- Paste a matching list over a non-empty target in a cross-block context (container-matching merge): exactly two edit events — the cross-block range delete, then the merge-paste commit. Each commit is one op.
