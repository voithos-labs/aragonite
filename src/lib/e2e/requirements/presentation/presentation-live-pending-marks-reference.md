# Feature: live-mode pending marks beside a reference link

A paragraph holding a reference link draws that link from the document's link definitions. The
pending-mark rewrite checks each candidate against what the block draws, so its check has to read
the candidate with the same definitions, or every candidate reads the link as plain brackets and
is refused. Driven on `/test/editor` via `?presentationMode=live` with a real chord and a real
keystroke; the source is the reference, plus the rendered `strong`.

Miss-analysis: the pending-mark scenarios used inline links and autolinks, which read the same with
or without the definitions, and no fixture held a reference link beside the caret.

## Happy paths

- `see [text][ref] here` with its definition below, caret at the end of the line, `Mod+B` then a
  keystroke: the byte lands wrapped, `here**y**` in the source, and renders inside a `strong`
