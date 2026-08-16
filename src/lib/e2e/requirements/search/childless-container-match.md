# Feature: Search inside a childless opaque container

A childless opaque container (a render-primary plugin block like mermaid) carries its text
in its own raw — there are no leaf children for the scanner to reach. Search scans that raw
like a leaf: matches are found, painted through the container shim's `measurePartialRects`
(the decoration overlay's childless route), and navigable. Replace rewrites them too: the path
substitutes into a private clone's raw and reparses, so the kind re-derives its own metadata and
nothing goes stale. The one decline is kind-stability — a substitution that breaks the opener line
comes back as a different kind, and a diagram must not silently become a plain code block (issue
#41). Lives in the search area but drives the plugins harness, since only plugin kinds produce
childless opaque containers.

## Happy paths

- Querying a string that exists only inside an off-screen mermaid block's source finds the
  match (count reads 1 / 1), paints a `.match-overlay` inside that block's host, and
  navigating (Enter) scrolls the block into the editor viewport with the active overlay on it.
- Replace All over one prose match + one mermaid match rewrites both: the mermaid's own raw
  carries the replacement, the block is still the mermaid kind afterwards, and the bar reads
  `2 replaced`.

## Edge cases

- A query matching the fence's info string (`mermaid` → `js`) is declined for the container and
  applied to the prose: the fence keeps its opener and its kind, the declined match survives the
  rescan (count re-reads 1 / 1), and `replacedCount` reports 1.

## Miss-analysis

- The original defect shipped because the issues ledger itself encoded a wrong premise
  ("the match is found and navigable, only its highlight is missing") and no test queried
  text that lived only inside a childless container's raw — the scan gap was invisible to
  every leaf-based search spec. This file pins the container-raw query directly.
