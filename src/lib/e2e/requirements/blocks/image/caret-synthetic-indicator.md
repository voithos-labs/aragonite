# Feature: Synthetic caret indicator at widget boundary

When a click-snap places the cursor at a `contenteditable=false`-adjacent position, Chromium often can't render a native caret. The editor paints a blinking synthetic caret on the matching widget edge (`md-snap-after` / `md-snap-before` class) so the user has visual confirmation of where typing will land.

Exactly one caret paints for one caret position. Where the cursor lands in a text node the editor can see the native caret and withholds the synthetic; at an element-level offset it cannot see it, and Chromium renders one there often enough to double up — so the block's own caret is suppressed for as long as the synthetic is up. The rule and its mechanism are kind-agnostic; the inline-math twin (on a route with plugins installed) is `plugins/latex-inline-caret-paint.md`.

## Happy paths

- A snap-target widget renders a synthetic caret on the matching edge with an `::before` overlay (absolute-positioned, ~1.5px thin)
- The block's native caret goes transparent while the synthetic is painted, and comes back when the snap clears
- The dark starts at the PRESS, not at the click: the press seats the browser's caret before the click arms the synthetic one, and at the element-level offset beside the island Chromium paints it at the line box's height — a taller stroke for the length of the press, then the synthetic (the flash a text-height widget like an emoji showed). A press that seats in a text node keeps the native caret
  - Miss-analysis: every indicator test read the paint once the click had completed, so the window between the press and the click, where the browser's caret is the only one on screen, was never observed
- Synthetic appears after Enter splits the paragraph and the user clicks an image-only block
- The synthetic caret survives the browser dropping its range: no range at all is the state the indicator exists for, and the click's offset is still where typing goes
  - Miss-analysis: every indicator test read the paint while a range was live, so nothing said what the paint does once the browser holds no range, the one state the feature was built for
- No block paints a synthetic caret while a cross-block range is up: the editor's own range owns the position
  - Miss-analysis: the cross-block specs assert the overlay and the image specs assert the paint, and no test had ever held both at once

## Edge cases

- Inline images surrounded by text don't get the synthetic caret — the live caret in the adjacent text node is already visible
- Arrow-left into a widget boundary in trailing text does not show the synthetic — the live caret in the text node is already visible
- Click that lands the cursor in trailing text does not show the synthetic
- The synthetic caret clears as soon as the user types (intercept consumes the snap target)
- The synthetic caret clears when the user clicks into a different paragraph (next snap call resets the offset)
- The synthetic caret clears when arrow keys move the caret away
