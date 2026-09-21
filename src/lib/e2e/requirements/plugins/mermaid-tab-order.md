# Feature: a plugin whole-block kind's declared surface is not a tab stop

`whole-block-tab-traversal.md` pins the rule on the built-in separator, which declares
`tabindex=-1` in its own markup and so satisfies it by hand. This file pins the same rule where
the editor itself has to carry it: a plugin kind whose render states each declare a focusable
element of their own.

The rule is one **editing** stop per block, not one stop in total: mermaid's toolbar buttons are
controls the plugin wrote and keep their own stops by design. What must not be a stop is the
diagram itself, which is not editable, has nothing to type into, and is the state whole-block
focus exists to avoid.

Mermaid supplies five such elements across its render states (empty, no renderer, error,
rendered diagram, loading), and only one exists at a time, so setting `tabindex` once at mount
reaches whichever state happened to be showing and no other.

Fixture: `/test/plugins?seed=mermaid`, a rendered diagram between two paragraphs.

## Happy paths

- The rendered `.mermaid-viewport` reports `tabindex=-1` once the block has been entered
- Shift+Tab from the paragraph below lands on the editing host, never on the diagram
- Carrying on with Shift+Tab from the host walks the toolbar buttons and leaves the block, and
  no press stops on the diagram

## Edge cases

- The diagram's edit textarea keeps its `tabindex` untouched: it is an editing host, and taking
  it out of the tab order would make edit mode unreachable by keyboard

## Miss-analysis

- The one-editing-stop rule lived as prose beside the proxy's `tabIndex = 0`, and the only spec
  that measured a tab order drove the built-in separator, whose markup already satisfies it.
  Nothing read the tabindex of an element supplied by a kind, so both kinds that declare `0`,
  mermaid and the opaque-container fixture, passed every green test in the repo while leaving
  focus where no byte can be typed.
