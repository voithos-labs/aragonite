# Feature: Inline Editing, Typing Between Two Tildes

A tilde pairs only as a double run, so the auto-pair never writes `~|~`: two single tildes are bytes the user wrote, and a key between them keeps both.

## Edge cases

- A space typed between the two tildes of `a~~b` writes `a~ ~b`, in source and in live (regression: `a~ b`, one tilde gone; miss-analysis: the empty-pair rows used the pairs each delimiter writes, and none put a caret between two single tildes)
- Backspace between the two tildes of `a~~b` takes one tilde, `a~b`, in source and in live (regression: `ab`, both taken)
