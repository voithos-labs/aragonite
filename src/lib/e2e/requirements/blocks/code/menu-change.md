# Feature: Code block, the gutter menus on `menuChange`

The code block's side gutter opens two menus, the host's overflow menu and the language picker,
and both report on `menuChange` so a host's selection chrome steps aside for them.

## Happy paths

- A click on the overflow button (with host items supplied) opens the menu and the channel reads
  `true`; Escape closes it and the channel reads `false`.
- A click on the language chip opens the picker and the channel reads `true`; Escape closes it
  and the channel reads `false`.

## Edge cases

- Clicking the chip while the overflow menu is open swaps one menu for the other in one click:
  the channel reads `true` once and stays open through the swap, then reads `false` once when
  Escape closes the picker.

## Miss-analysis

- The silent gutter menus (#370) shipped because no spec opened the overflow menu at all, and
  the event was emitted only from the right-click menu's own open state.
