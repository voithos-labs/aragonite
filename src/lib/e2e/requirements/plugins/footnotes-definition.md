# Feature: Plugin Container — Footnote Definition

The GFM `[^label]: content` definition is a first-party strip container in the
listItem mold. Its body is real child blocks (a paragraph, or a paragraph plus
further blocks); the `[^label]: ` marker is a dimmed, read-only ambient prefix the
first child paints before its own bytes. Editing, selection, and merge come from
the shared container factory; the definition itself is `not-mergeable`, so a
Backspace at its first child's start delegates upward instead of unwrapping the
container into loose paragraphs. This gate is behavioral — it reads the CST by
path via `window.__test`, the serialized bytes, and the rendered marker DOM.

## Happy paths

- definition renders as a container: the `?seed=footnotes` route mounts the `FootnoteDefinition` component (a `.footnote-def` box holding a `.block-list`), not the raw-markdown fallback
- ambient marker renders: the first child paints a dimmed `[^a]: ` marker (an `.md-marker`) before the body text, and the body itself is an editable paragraph child
- body edits round-trip: typing into the definition body updates the child bytes and the container's own raw rebuilds to `[^a]: <edited>` — the source stays byte-round-trippable
- type a definition from scratch: typing `[^b]: <body>` into an empty paragraph forms the container live (the block flips to a footnote definition with one paragraph child)

## Edge cases

- Backspace at the body's start delegates up, no paragraph soup: Backspace at offset 0 of the first child leaves the definition a single footnote-def block (never a run of loose paragraphs), the source byte-identical, and moves the caret to the end of the prose above
- one undo restores a body edit: after typing into the body, a single Ctrl+Z returns the source to the seed bytes

## User interactions

- typing / Backspace / Ctrl+Z are real keystrokes, each asserted against the CST by path, the serialized bytes, or the rendered marker DOM
- the ambient `[^label]: ` marker is a non-editable prefix span, so a raw-semantic caret offset of 0 lands after it (at the body's first character), exactly as a list marker does

## Error cases

- the `[invariant:…]` console watcher stays silent and `getCapturedErrors()` is empty across every gesture (the strip-container staleness + state-consistency guards hold through the edit/undo churn)
