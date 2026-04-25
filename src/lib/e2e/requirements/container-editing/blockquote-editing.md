# Feature: Container Block Editing — Blockquote Editing

Plain content editing inside blockquotes — typing, multi-paragraph round-trip, and the double-Enter exit.

## Happy paths

- blockquote content editable: click into blockquote, type text, source updates with `> ` prefix
- blockquote source round-trips: editing inside blockquote preserves `> ` prefix structure
- blockquote with multiple paragraphs: multi-paragraph blockquote renders and edits correctly

## Edge cases

- blockquote double-Enter exit keeps caret visible: Enter to create empty line, Enter again exits blockquote with cursor in a usable block (regression: caret disappeared)
