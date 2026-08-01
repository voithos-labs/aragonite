# Feature: an inline widget's selection and a cross-block range are never live together

Selecting an inline widget clears the caret and any cross-block range, so the two selection
models never paint at once. The reverse ordering has the same rule: a gesture that opens a
cross-block range while a widget is selected ends the widget selection. Without it both states
are live, and every dispatch keyed on "is a widget selected" answers for a document-wide
selection the user is looking at.

Select-all is the gesture that reaches it: a widget's own keydown handler declines modifier
chords, so Mod+A runs the ordinary select-all and the second press goes document-wide.

## Happy paths

- Widget selected, Mod+A twice: the widget's overlay is gone and the cross-block range is live.
- In that state Mod+C copies the whole document, not the widget's slice.
- In that state Backspace deletes the whole document, not just the widget.

## Edge cases

- The document ends with the widget's own paragraph, so the cross-block focus endpoint hosts no
  caret and the chord's event dispatches at `<body>` — the route where the widget arm and the
  cross-block arm compete for the same event.

## Miss-analysis

- The editor-root clipboard seam gained a selected-widget arm ahead of its cross-block arm on the
  premise that the two states are mutually exclusive. The premise held only for the
  select-widget-then-range ordering, which is the only one the suite ever built; nothing drove a
  range open while a widget was already selected, and no test asserted the invariant itself
  rather than one consumer of it.
