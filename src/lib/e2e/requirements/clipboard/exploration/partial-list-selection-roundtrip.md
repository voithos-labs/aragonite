# Clipboard Exploration: Partial List Selection Round-trip

Partial (mid-word) selection within a list, copy, and paste. Ensures the paste produces a clean, non-nested output even though a plain-text clipboard can't perfectly round-trip partial list selections.

## Happy paths

- Mid-word to mid-word selection across multiple list items, Ctrl+C+V: original content survives; output has no nested-list indentation artifacts.

## Edge cases

- Partial selection within a single list item (no cross-block): inline paste splices at caret.

## Known limitations

- Exact 3-item round-trip from mid-word partial selection is not achievable via plain-text clipboard (inherent semantic loss — clipboard content doesn't carry container context). The paste produces a single list item with multi-line content rather than the original three separate items. Workaround for users: select from `offset 0` (full item start) instead of mid-word to get the structural round-trip.
