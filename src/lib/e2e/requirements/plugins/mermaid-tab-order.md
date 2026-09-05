# Feature: a plugin whole-block kind's declared surface is not a tab stop

`whole-block-tab-traversal.md` pins the rule on the built-in separator, which declares `tabindex=-1`
in its own markup and so satisfies it by hand. This file pins the same rule where it is CARRIED by
the platform: a plugin kind whose render states each declare a focusable surface of their own.

The rule is one **editing** stop per block, not one stop: mermaid's toolbar buttons are
plugin-authored interactive chrome and keep their own stops by design. What must not be a stop is
the diagram surface — non-editable, no input door, the state whole-block focus exists to avoid.

Mermaid supplies five such surfaces across its render states (empty, no-renderer, error, viewport,
loading), and only one exists at a time, so a demotion applied once at mount reaches whichever
state happened to be showing and no other.

Fixture: `/test/plugins?seed=mermaid`, a rendered diagram between two paragraphs.

## Happy paths

- The rendered `.mermaid-viewport` reports `tabindex=-1` once the block has been entered
- Shift+Tab from the paragraph below lands on the editing host, never on the viewport
- Continuing Shift+Tab from the host walks the toolbar buttons and leaves the block; no press
  parks on the viewport

## Edge cases

- The diagram's edit textarea keeps `tabindex` untouched: it IS an editing host, and demoting it
  would make edit mode unreachable by keyboard

## Miss-analysis

- The one-tab-stop rule lived as prose beside the proxy's `tabIndex = 0`, and the only spec that
  measured a tab order drove the built-in separator, whose markup already satisfies it. Nothing
  read a SUPPLIED surface's tabindex, so both kinds that declare `0` (mermaid, the opaque-container
  fixture) passed every green test in the repo while parking focus where no byte can be typed.
