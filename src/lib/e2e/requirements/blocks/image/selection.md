# Feature: Image widget selection

## Happy paths

- Click on widget enters widget-selected state (overlay portal with popover and resize handles renders at the widget's bounds)
- Click on text outside widget exits selected state

## User interactions

- ArrowLeft from caret at right boundary enters selected state
- ArrowLeft while selected: caret moves to left boundary, widget deselects
- ArrowRight from caret at left boundary enters selected state
- ArrowRight while selected: caret moves to right boundary, widget deselects
- ArrowLeft from left boundary exits the paragraph (or moves into preceding text)
- Escape deselects the widget

## Edge cases

- Selecting a different widget replaces the previous selection
- Cross-block selection clears widget selection
