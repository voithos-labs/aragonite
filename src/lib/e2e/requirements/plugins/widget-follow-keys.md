# Feature: a follow widget's keys

An `inline()` widget with `click: 'follow'` that holds focus follows on Enter or Space, wherever a
plain click on it would follow: always in reading mode, and in an editing mode only where the host
lets a plain click follow links. The key has to be aimed at the widget itself, its element or its
first tab stop. A control the widget holds (a button) keeps its own keys and clicks. The harness is
`routes/test/plugins/follow-keys`: an `@home` chip whose first tab stop is its own span, holding a
button, with `linkClick: 'plain'` and a toggle back to the modifier click.

## Happy paths

- **Reading mode:** Enter, then Space, on the focused chip each follow it once
- **Live mode, plain link click:** Enter on the focused chip follows

## Edge cases

- **Source mode, plain link click:** Enter on the focused chip follows nothing, since a plain click
  there edits
- **Live mode, modifier link click:** Enter on the focused chip follows nothing

## User interactions

- **The chip's button, reading mode:** Enter and Space on it press the button, and nothing follows
- **A click on the chip's button, reading mode:** it presses the button, and nothing follows

## Error cases

- **An IME key, reading mode:** an Enter the IME owns (key code 229) follows nothing

## Miss-analysis

- The keys moved from the footnotes drawing to the editor, which listened on the widget's whole
  element: every row drove the footnote's own tab stop, so a key aimed at a control inside a
  widget, and a widget focusable while editing, had no row.
