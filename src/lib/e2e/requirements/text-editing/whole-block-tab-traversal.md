# Feature: a whole-block kind is one tab stop

A `blockFocus: 'whole-block'` kind holds DOM focus on a hidden editing host mounted beside the
element the kind declares. Both are focusable, so the tab order would otherwise see two stops in
one block and leave the user on the declared element: not editable, taking no input, the state
whole-block focus exists to avoid. The host is the tab stop; the built-in separator is reachable by
pointer and by the editor, never by Tab.

Interactive controls a plugin draws (mermaid's toolbar buttons) are separate and correctly keep
their own stops; this file pins the built-in thematic break, which draws no controls of its own.

Tab itself never navigates out of a paragraph, since `block.insertTab` types a tab, so Shift+Tab is
the only tab gesture that reaches the block from a neighbour.

Fixture: `Before` / `---` / `After`.

## Happy paths

- Focused thematic break, Shift+Tab: focus is in the paragraph above after one keypress
- Focused thematic break, Tab: focus is in the paragraph below after one keypress

## User interactions

- Shift+Tab from the start of the paragraph below: focus lands on the editing host, not on the
  separator, because a block reachable by tab is a block that can take input

## Miss-analysis

- Nothing measured where focus went after a tab across a whole-block kind, in either direction:
  the whole-block suites assert the new paragraph and the arrow exits, and the a11y suite checks
  axe violations rather than traversal, so a second tab stop inside one block was invisible to all
  of them. Only Shift+Tab told the defect apart; the tab-entry scenario earns its place on the
  failure this fix could introduce instead: a separator and a host both at `tabindex=-1` leave the
  block unreachable by tab entirely, and nothing else would notice.
