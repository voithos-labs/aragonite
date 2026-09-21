# Feature: Plugin Container, Footnote Definition

The GFM `[^label]: content` definition is a built-in container whose marker is stripped from its
children, built like `listItem`. Its body is real child blocks (a paragraph, or a paragraph plus
further blocks), and the `[^label]: ` marker is a dimmed, read-only prefix the first child paints
in front of its own bytes. Editing, selection and merging come from the shared container
factory. The definition unwraps from the inside and never absorbs a block from outside, so
Backspace at the start of its first child lifts that block out with the marker staying on
whatever is left, while Backspace in the block below joins nothing. These checks read behavior:
the tree read by path through `window.__test`, the serialized bytes, and the rendered marker in
the DOM.

## Happy paths

- definition renders as a container: the `?seed=footnotes` route mounts the `FootnoteDefinition` component (a `.footnote-def` box holding a `.block-list`) rather than falling back to raw markdown
- the marker renders: the first child paints a dimmed `[^a]: ` marker (an `.md-marker`) in front of the body text, and the body itself is an editable paragraph child
- body edits round-trip: typing into the definition body updates the child's bytes and the container rebuilds its own raw text to `[^a]: <edited>`, so the source still round-trips
- type a definition from scratch: typing `[^b]: <body>` into an empty paragraph one keystroke at a time forms the container as you go (the block becomes a footnote definition with one paragraph child), passing through the brief inline reference widget that the `[^b]` prefix mounts on its closing `]`

## Edge cases

- Backspace at the start of the body unwraps the note: Backspace at offset 0 of a single-paragraph definition's body leaves a bare paragraph in the definition's place with the caret at its start, and the reference that pointed at it keeps its number, since numbering counts references rather than definitions, instead of throwing
- one undo puts the note back: a single Ctrl+Z after the unwrap restores the seed bytes and the footnote-definition kind
- a body of several blocks lifts only its first block: Backspace at the start of the first body block leaves that block loose above and `[^a]: ` on the rest; Backspace at the start of the second block merges it into the first, leaving the marker untouched
- the note declines the block below it: Backspace at the start of the paragraph following a definition changes no bytes and puts the caret at the end of the note's last body leaf. From the outside a note behaves like a leaf, so body text never becomes note text
- one undo restores a body edit: after typing into the body, a single Ctrl+Z returns the source to the seed bytes

## User interactions

- typing, Backspace and Ctrl+Z are real keystrokes, each asserted against the tree read by path, the serialized bytes, or the rendered marker in the DOM
- the `[^label]: ` marker is a non-editable prefix span, so a caret offset of 0 in the raw text lands after it, at the body's first character, exactly as a list marker does

## Miss-analysis

- The Backspace that should do nothing: the suite asserted the bytes were unchanged after the
  keystroke, which a key that does nothing passes just as easily as correct behavior. An
  assertion that nothing happened is only a test when something is supposed to happen.

## Error cases

- the `[invariant:…]` console watcher stays silent and `getCapturedErrors()` is empty across every gesture, so the checks for a stale stripped container and for state consistency hold through the editing and undoing
