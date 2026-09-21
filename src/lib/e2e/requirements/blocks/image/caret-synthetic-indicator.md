# Feature: Synthetic caret indicator at widget boundary

When a click-snap places the cursor at a `contenteditable=false`-adjacent position, Chromium often cannot render a caret of its own. The editor paints a blinking synthetic caret on the matching widget edge (`md-snap-after` / `md-snap-before` class) so the user can see where typing will land.

Exactly one caret paints for one caret position. Where the cursor lands in a text node the editor can see the browser's caret and holds its own back; at an element-level offset it cannot see it, and Chromium renders one there often enough to double up, so the block's own caret is hidden for as long as the synthetic one is up. The rule and the way it works hold for every kind; the matching case for inline math (on a route with plugins installed) is `plugins/latex-inline-caret-paint.md`.

## Happy paths

- A snap-target widget renders a synthetic caret on the matching edge with an `::before` overlay (absolute-positioned, ~1.5px thin)
- The block's own caret goes transparent while the synthetic one is painted, and comes back when the snap clears
- The block's caret goes dark from the pointer-down, not from the click: the pointer-down places the browser's caret before the click sets the synthetic one up, and at the element-level offset beside the widget Chromium paints it at the line box's height, a taller stroke for as long as the button is down, then the synthetic one (the flash a text-height widget like an emoji showed). A pointer-down that lands in a text node keeps the browser's caret
  - Miss-analysis: every indicator test read the paint once the click had completed, so the window between the pointer-down and the click, where the browser's caret is the only one on screen, was never observed
- Synthetic appears after Enter splits the paragraph and the user clicks an image-only block
- The synthetic caret survives the browser dropping its range: no range at all is the state the indicator exists for, and the click's offset is still where typing goes
  - Miss-analysis: every indicator test read the paint while a range was live, so nothing said what the paint does once the browser holds no range, the one state the feature was built for
- No block paints a synthetic caret while a cross-block range is up: the editor's own range owns the position, wherever its ends landed. The state that gets here is a range whose focus falls back on the offset the snap set, where the caret sits exactly where the snap put it and nothing about its position says the paint should go
  - Miss-analysis: the cross-block specs check the overlay and the image specs check the paint, and no test had ever held both at once; the first attempt at one drove a press-and-move drag, whose own pointerdown clears the paint before a range exists, so it passed on every version of the code
- A click that lands in another block clears the synthetic caret, before any range exists

## Edge cases

- Inline images surrounded by text don't get the synthetic caret: the live caret in the adjacent text node is already visible
- Arrow-left into a widget boundary in trailing text does not show the synthetic caret: the live caret in the text node is already visible
- Click that lands the cursor in trailing text does not show the synthetic caret
- The synthetic caret clears as soon as the user types (the keydown branch consumes the snap target)
- The synthetic caret clears when the user clicks into a different paragraph (next snap call resets the offset)
- The synthetic caret clears when arrow keys move the caret away
