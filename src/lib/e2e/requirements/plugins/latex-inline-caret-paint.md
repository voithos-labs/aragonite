# Feature: One caret per caret position at an inline-math widget edge

A click past a widget with no trailing text node lands the caret at an element-level offset, where the editor paints a synthetic caret because Chromium's own is unreliable there. Unreliable cuts both ways: when Chromium does paint one, both are live at the same position and the user sees two carets — the real one plus a shorter artifact hugging the widget boundary.

The rule, its mechanism and the restore direction live with the image pins (`blocks/image/caret-synthetic-indicator.md`); the fix is kind-agnostic. This file is the plugin-surface twin, because the widget the consumer hit it on was inline math and the image suite runs on a route with no plugins installed.

## Happy paths

- Clicking past a trailing math widget shows the synthetic indicator AND suppresses the block's native caret, so exactly one caret can be live at that position

## Notes

- The pixel is not assertable: a control run established that Playwright screenshots never capture a native caret at all, in headed or headless Chromium. What is assertable — and what the defect was — is that both caret sources were live at once, so the pin asserts the mutual exclusion.
