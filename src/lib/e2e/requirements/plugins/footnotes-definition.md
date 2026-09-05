# Feature: Plugin Container — Footnote Definition

The GFM `[^label]: content` definition is a first-party strip container in the
listItem mold. Its body is real child blocks (a paragraph, or a paragraph plus
further blocks); the `[^label]: ` marker is a dimmed, read-only ambient prefix the
first child paints before its own bytes. Editing, selection, and merge come from
the shared container factory; the definition is a container that unwraps inward and is
not a merge target outward, so a Backspace at its first child's start lifts that block
out with the marker staying on whatever is left, while a Backspace in the block below
concatenates nothing. This gate is behavioral — it reads the CST by path via
`window.__test`, the serialized bytes, and the rendered marker DOM.

## Happy paths

- definition renders as a container: the `?seed=footnotes` route mounts the `FootnoteDefinition` component (a `.footnote-def` box holding a `.block-list`), not the raw-markdown fallback
- ambient marker renders: the first child paints a dimmed `[^a]: ` marker (an `.md-marker`) before the body text, and the body itself is an editable paragraph child
- body edits round-trip: typing into the definition body updates the child bytes and the container's own raw rebuilds to `[^a]: <edited>` — the source stays byte-round-trippable
- type a definition from scratch: typing `[^b]: <body>` into an empty paragraph one keystroke at a time forms the container live (the block flips to a footnote definition with one paragraph child), crossing the transient inline reference widget the `[^b]` prefix mounts on its closing `]`

## Edge cases

- Backspace at the body's start unwraps the note: Backspace at offset 0 of a single-paragraph definition's body leaves a bare paragraph in the definition's slot with the caret at its start, and the reference that pointed at it keeps its number (numbering is over references, not definitions) rather than throwing
- one undo puts the note back: a single Ctrl+Z after the unwrap restores the seed bytes and the footnote-def kind
- a multi-block body lifts only its first block: Backspace at the first body block's start leaves that block loose above and `[^a]: ` on the rest; Backspace at the second block's start merges it into the first, marker untouched
- the note declines the block below it: Backspace at the start of the paragraph following a definition changes no bytes and lands the caret at the end of the note's last body leaf — a note is leaf-like outward, so body text never becomes note text
- one undo restores a body edit: after typing into the body, a single Ctrl+Z returns the source to the seed bytes

## User interactions

- typing / Backspace / Ctrl+Z are real keystrokes, each asserted against the CST by path, the serialized bytes, or the rendered marker DOM
- the ambient `[^label]: ` marker is a non-editable prefix span, so a raw-semantic caret offset of 0 lands after it (at the body's first character), exactly as a list marker does

## Miss-analysis

- The no-op Backspace: the suite asserted the bytes were UNCHANGED after the keystroke, which
  a dead key passes as readily as a correct delegation. An assertion that nothing happened is
  only a test when something is supposed to happen.

## Error cases

- the `[invariant:…]` console watcher stays silent and `getCapturedErrors()` is empty across every gesture (the strip-container staleness + state-consistency guards hold through the edit/undo churn)
