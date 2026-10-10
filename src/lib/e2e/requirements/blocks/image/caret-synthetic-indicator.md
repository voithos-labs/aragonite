# Feature: the caret beside an inline widget

When a click lands the caret at a `contenteditable=false`-adjacent position, Chromium often can't draw a caret of its own there. So the editor draws it: the drawn caret's one bar, in its `widget` state, on the widget's edge the click meant, so you can see where typing will land.

Exactly one caret shows for one caret position. Where the caret lands in a text node, the browser's position is good and the usual caret shows (on a fine pointer that's the drawn one, `caret/drawn-caret.md`). At an element-level offset beside the widget, Chromium sometimes paints one anyway, so the editable's own caret stays hidden for as long as the bar draws there. The rule holds for every kind; the matching case for inline math (on a route with plugins installed) is `plugins/latex-inline-caret-paint.md`.

## Happy paths

- A click past an image draws one caret: the bar, 1.5px wide, 4px clear of the image's frame and 4px short of its top and bottom
- The browser's caret goes dark from the pointer-down, not from the click: the pointer-down places the browser's caret before the click says which edge it meant, and at the element-level offset beside the widget Chromium paints it at the line box's height, a taller stroke for as long as the button is down. Nothing shows until the click, then the bar does. A pointer-down that lands in a text node shows exactly one caret, the drawn one
  - Miss-analysis: every indicator test read the caret once the click had completed, so the window between the pointer-down and the click, where the browser's caret is the only one on screen, was never observed
- In live mode, an image inside a link or emphasis gets the same bar as a bare one when you click past it. The click finds the image through its wrapper, so the bar has to as well
  - Miss-analysis: every indicator test clicked past a bare image, so nothing saw the paint read only the block's top-level inlines while the click read nested ones too
- The bar shows after Enter splits the paragraph and you click past the image-only block
- The bar survives the browser dropping its range: no range at all is the state it exists for, and the click's offset is still where typing goes
  - Miss-analysis: every indicator test read the bar while a range was live, so nothing said what happens once the browser holds no range, the one state the feature was built for
- No bar draws at a widget edge while a cross-block range is up: the editor's own range owns the position, wherever its ends landed. The state that gets here is a range whose focus falls back on the offset the click set, where the caret sits exactly where the click put it and nothing about its position says the bar should go
  - Miss-analysis: the cross-block specs check the overlay and the image specs check the bar, and no test had ever held both at once; the first attempt at one drove a press-and-move drag, whose own pointerdown clears the edge before a range exists, so it passed on every version of the code
- A click past a widget in a second block moves the bar there; it never shows in two blocks
- A click that lands in another block clears the bar, before any range exists
- A block windowed out with the bar in it (focus gone, then scrolled far away) leaves exactly one caret at the next click past a widget elsewhere, and scrolling back brings no bar back into the first block
  - Miss-analysis: the old per-block paint needed a sweep for a block that unmounted with its paint on, and no test ever unmounted one; the only check planted the leftover class by hand

## Edge cases

- Inline images surrounded by text don't get the bar: the caret in the adjacent text node is already visible
- Arrow-left into a widget boundary in trailing text doesn't draw the bar: the caret in the text node is already visible
- A click that lands the caret in trailing text doesn't draw the bar
- The bar clears as soon as you type, and the drawn text caret comes back
- The bar clears when you click into a different paragraph
- The bar clears when arrow keys move the caret away
