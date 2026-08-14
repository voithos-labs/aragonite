# Feature: a whole-block kind is one tab stop

A `blockFocus: 'whole-block'` kind holds DOM focus on a hidden editing host mounted beside its
declared surface. Both are focusable, so the tab order would otherwise see two stops in one block
and park the user on the declared surface — non-editable, no input door, the state whole-block
focus exists to avoid. The host is the tab stop; the built-in separator is reachable by pointer
and by the editor, never by Tab.

Plugin-authored interactive chrome (mermaid's toolbar buttons) is separate and correctly keeps its
own stops; this file pins the built-in thematic break, which renders no chrome of its own.

Tab itself never navigates out of a paragraph — `block.insertTab` types a tab — so the backward
press is the only tab gesture that reaches the block from a neighbour.

Fixture: `Before` / `---` / `After`.

## Happy paths

- Focused thematic break, Shift+Tab: focus is in the paragraph above after ONE press
- Focused thematic break, Tab: focus is in the paragraph below after ONE press

## User interactions

- Shift+Tab from the start of the paragraph below: focus lands on the editing host, not on the
  separator — a block reachable by tab is a block whose input doors are live

## Miss-analysis

- Nothing measured where focus went after a tab across a whole-block kind, in either direction:
  the whole-block suites assert the mint and the arrow exits, and the a11y suite checks axe
  violations rather than traversal, so a second tab stop inside one block was invisible to all of
  them. Only the backward press discriminated the defect; the tab-entry scenario earns its place
  on the failure mode this fix introduces instead — a separator and a host both at `tabindex=-1`
  leaves the block unreachable by tab entirely, and nothing else would notice.
