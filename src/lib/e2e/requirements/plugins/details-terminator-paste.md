# Feature: details terminator escape at the paste door

Paste builds nodes before any byte sink sees them, so the `<details>` container's
`bodyWrite` escape must land inside the paste path itself (GH #40). A `</details>`-bearing
clipboard pasted into a details body must not terminate the container.

Miss-analysis: every terminator-collision suite drove the node-ops byte sinks (typing,
split, cross-block delete); no spec pasted a `</details>`-bearing clipboard into a details
body, the door the realistic copy-off-GitHub gesture takes.

## Happy paths

- Pasting a multi-block clipboard holding a stray `</details>` line into the body: the
  container survives, the line lands escaped (`&lt;/details>`), the document round-trips,
  no errors captured.
- Pasting a complete balanced `<details>…</details>` example into the body: nests as a
  details child verbatim, nothing escaped, the document round-trips.

## Edge cases (unit-covered: terminator-collision-paste, search-replace-details-escape)

- Passthrough spellings (` </details>`) escape on paste even though the recognizer never
  sees them.
- A structural paste splitting a mid-line tag escapes the stranded half (split-door parity).
- A paste at the document root, or into a container with no `bodyWrite`, stays byte-verbatim.
- Search/replace templates landing a tag in a details body or summary escape the same way.
