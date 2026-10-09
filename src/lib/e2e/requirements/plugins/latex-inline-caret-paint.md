# Feature: One caret per caret position at an inline-math widget edge

A click past a widget with no text node after it lands the caret at an element-level offset, where the editor draws the caret itself because Chromium's is unreliable there. Unreliable cuts both ways: when Chromium does paint one, both are live at the same position and the user sees two carets, the real one plus a shorter one hugging the widget boundary.

The rule, how it works and which way the caret is restored live with the image pins (`blocks/image/caret-synthetic-indicator.md`), and none of it depends on the kind. This file is the counterpart on a plugin kind, because the widget a consuming app hit this on was inline math and the image suite runs on a route with no plugins installed.

## Happy paths

- Clicking past a math widget at the end of a line shows one caret: the drawn bar at the widget's edge, with the block's browser caret hidden

## Notes

- Playwright screenshots never capture the browser's caret in Chromium unless a test recolours it, so the check reads which carets are live (`caretsShowing`), and the bar's box against the widget's.
