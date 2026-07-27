# Feature: Synthetic caret indicator at widget boundary

When a click-snap places the cursor at a `contenteditable=false`-adjacent position, Chromium often can't render a native caret. The editor paints a blinking synthetic caret on the matching widget edge (`md-snap-after` / `md-snap-before` class) so the user has visual confirmation of where typing will land.

Exactly one caret paints for one caret position. Where the cursor lands in a text node the editor can see the native caret and withholds the synthetic; at an element-level offset it cannot see it, and Chromium renders one there often enough to double up — so the block's own caret is suppressed for as long as the synthetic is up.

## Happy paths

- A snap-target widget renders a synthetic caret on the matching edge with an `::before` overlay (absolute-positioned, ~1.5px thin)
- The block's native caret goes transparent while the synthetic is painted, and comes back when the snap clears
- Synthetic appears after Enter splits the paragraph and the user clicks an image-only block

## Edge cases

- Inline images surrounded by text don't get the synthetic caret — the live caret in the adjacent text node is already visible
- Arrow-left into a widget boundary in trailing text does not show the synthetic — the live caret in the text node is already visible
- Click that lands the cursor in trailing text does not show the synthetic
- The synthetic caret clears as soon as the user types (intercept consumes the snap target)
- The synthetic caret clears when the user clicks into a different paragraph (next snap call resets the offset)
- The synthetic caret clears when arrow keys move the caret away
