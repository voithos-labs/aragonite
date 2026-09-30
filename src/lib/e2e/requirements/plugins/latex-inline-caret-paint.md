# Feature: One caret per caret position at an inline-math widget edge

A click past a widget with no text node after it lands the caret at an element-level offset, where the editor draws a caret of its own because Chromium's is unreliable there. Unreliable cuts both ways: when Chromium does paint one, both are live at the same position and the user sees two carets, the real one plus a shorter one hugging the widget boundary.

The rule, how it works and which way the caret is restored live with the image pins (`blocks/image/caret-synthetic-indicator.md`), and the fix does not depend on the kind. This file is the counterpart on a plugin kind, because the widget a consuming app hit this on was inline math and the image suite runs on a route with no plugins installed.

## Happy paths

- Clicking past a math widget at the end of a line shows the drawn indicator and suppresses the block's browser caret, so only one caret can be live at that position

## Notes

- The pixel cannot be asserted: a control run showed that Playwright screenshots never capture a browser caret at all, headed or headless in Chromium. What can be asserted, and what the defect was, is that both sources of a caret were live at once, so the test asserts that only one of them ever is.
