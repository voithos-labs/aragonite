# Feature: footnotes navigate from the keyboard in reading mode

In reading mode there is no caret, so a keyboard user reaches a footnote the way they reach any
link: by Tab. The `[^label]` reference and the definition's `[^label]` marker are both links with
a name and a tab stop there, and Enter (or Space) runs the same jump a click does. In the editing
modes neither takes a tab stop, since a stop inside an editable block would interrupt the caret,
and Ctrl/Cmd+click stays the gesture (`footnotes-navigation.md`).

The navigation document has the references at block 0, deep filler, then the definitions, so each
jump has to mount its target.

## Happy paths

- **Reading mode, reference:** Tab from the referencing paragraph focuses the reference, named
  `Footnote 1`; Enter mounts its definition and brings it into view
- **Reading mode, the way back:** Tab from the definition's text focuses its marker, named
  `Back to reference a` after the label it shows; Enter mounts the referencing block and brings it
  into view
- **Reading mode, axe:** a document holding references and definitions has no new violations

## Edge cases

- **Live mode:** neither the reference nor the marker carries a `tabindex`, and Shift+Tab from
  the last definition lands on the first definition's editing surface, then on the referencing
  paragraph's, never on a marker or a reference

## Error cases

- Every jump scenario asserts the editor's error channel stayed empty

## Miss-analysis

- Every navigation scenario drove a pointer, and the interactive-range API could express no link
  role or key, so the keyboard half of the feature had neither a way to exist nor a test to fail.
- The live-mode case pressed Tab inside a paragraph, where Tab inserts a tab and focus never
  moves, so it passed whatever the markup said; Shift+Tab leaves the block natively.
