# Feature: Search inside a childless opaque container

A childless opaque container (a render-primary plugin block like mermaid) carries its text
in its own raw — there are no leaf children for the scanner to reach. Search scans that raw
like a leaf: matches are found, painted through the container shim's `measurePartialRects`
(the decoration overlay's childless route), and navigable. Replace skips those matches — the opaque
raw is metadata-derived, so a generic substitution would drift from metadata (ledgered in
docs/issues.md) — and `replacedCount` reports only real replacements. Lives in the search
area but drives the plugins harness, since only plugin kinds produce childless opaque
containers.

## Happy paths

- Querying a string that exists only inside an off-screen mermaid block's source finds the
  match (count reads 1 / 1), paints a `.match-overlay` inside that block's host, and
  navigating (Enter) scrolls the block into the editor viewport with the active overlay on it.

## Edge cases

- Replace All over one prose match + one mermaid match rewrites only the prose one: the
  mermaid fence keeps its kind and source, the count re-reads 1 / 1 (the surviving mermaid
  match), and `replacedCount` reports 1.

## Miss-analysis

- The original defect shipped because the issues ledger itself encoded a wrong premise
  ("the match is found and navigable, only its highlight is missing") and no test queried
  text that lived only inside a childless container's raw — the scan gap was invisible to
  every leaf-based search spec. This file pins the container-raw query directly.
