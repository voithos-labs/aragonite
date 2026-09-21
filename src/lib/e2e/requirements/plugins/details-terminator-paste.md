# Feature: details terminator escape at the paste door

Paste builds its nodes before any byte-writing code sees them, so the `<details>` container's
`bodyWrite` escape has to happen inside the paste path itself (GH #40). A clipboard carrying a
`</details>` line, pasted into a details body, must not close the container.

Miss-analysis: every suite for colliding terminators drove the byte-writing paths of the node
ops (typing, split, cross-block delete); no spec pasted a clipboard carrying `</details>` into a
details body, which is the path a realistic copy from GitHub takes.

## Happy paths

- Pasting a multi-block clipboard holding a stray `</details>` line into the body: the container
  survives, the line lands escaped (`&lt;/details>`), the document round-trips, and no errors
  are captured.
- Pasting a complete, balanced `<details>…</details>` example into the body: it nests as a
  details child verbatim, nothing is escaped, and the document round-trips.

## Edge cases (unit-covered: terminator-collision-paste, search-replace-details-escape)

- Spellings that pass through unrecognized (` </details>`) are escaped on paste even though the
  recognizer never sees them.
- A structural paste that splits a tag mid-line escapes the half left behind, the same way the
  split path does.
- A paste at the document root, or into a container with no `bodyWrite`, stays byte-verbatim.
- Search and replace templates that land a tag in a details body or summary are escaped the same
  way.
