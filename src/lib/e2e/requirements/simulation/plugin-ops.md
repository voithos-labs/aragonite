# Feature: Plugin-container ops (note-taking simulation)

A loaded-ops session over a mixed document holding a `:::note` callout and an
open `<details>` collapsible, with prose and a list between them. The gesture
vocabulary drives real edits across both plugin containers while the note
simulation's oracle stack — structured error + invariant-console watcher, live-CST
round-trip, nested BlockListState audit — re-checks after every move. This is the
first time the continuous corruption net exercises the plugin surface; before it,
the opaque-container and reserved-chrome invariants were observable only through
the scripted per-feature plugin specs.

The session runs with a standing decoration source installed (`?seed=sim`), so the
oracle stack also watches the decoration engine re-run on every edit. The source is
view-only — a mark on a fixture word — so it changes no source, CST, or undo state;
its only job is to keep the engine live under the corruption net.

## Happy paths

- editing the callout title (its reserved chrome) rewrites the container's own
  opener bytes — the container raw is rebuilt from children, never left stale
- typing in a callout body paragraph and in a details body paragraph round-trips
  and keeps the document a single container at the root, not a torn tree
- Enter in a callout body splits it into a new body child; Enter in a details
  summary descends into the body without minting a block or moving the root
- collapsing a `<details>` rewrites `<details open>` to `<details>` and unmounts
  the body; expanding restores both; every toggle leaves the tree consistent
- a read-only plugin global command — doc-stats' `Mod+Shift+S` chord — reads the
  per-instance EditorContext and republishes `window.__docStats` mid-session while
  leaving the document and the undo stack byte-identical

## Edge cases

- merge-from-below into a COLLAPSED details refuses the hidden body: the source is
  unchanged and the caret parks on the summary (the collapse-aware merge walk)
- merge-from-below into an OPEN details folds the block below into the last body
  child, the normal deep-leaf merge
- a container edit lands mid-document, never the end-of-document append the
  expectation tracker predicts, so each gesture resyncs from observed state
- undo and redo around a callout split, and undo after a cross-container merge,
  each leave the containers uncorrupted

## User interactions

- chrome and body edits use a real pointer click into the target block followed by
  per-character keyboard typing
- the collapse toggle is a real click on the summary's toggle control; the session
  settles on `aria-expanded` flipping before continuing
- the global command is a real `Mod+Shift+S` keyboard chord; the session poisons the
  published record, presses the chord, and settles on this editor's block count
  recovering before asserting the source and undo stack are unchanged
- a cross-container selection is a real click-drag from the callout body, across
  the list and both container boundaries, to the details summary; it is copied,
  the caret repositioned to the trailing paragraph, and pasted
- undo / redo use real cross-platform shortcuts around forced batch boundaries

## Error cases

- no console, page, or structured editor error fires across the whole session,
  including the `[invariant:…]` channel the opaque-container and reserved-chrome
  guards warn on
- the live serializer round-trips the current CST at every oracle checkpoint
- the nested-state audit finds no BlockListState desync after any container edit,
  collapse, cross-boundary merge, cross-container paste, or undo
