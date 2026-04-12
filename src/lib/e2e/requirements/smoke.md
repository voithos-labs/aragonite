# Feature: Editor Smoke Tests

Verifies the test harness, bridge, and basic editor lifecycle.

## Happy paths
- editor container visible: after goto(), .editor element is present
- test bridge functional: getSource() returns non-empty string
- loadContent replaces document: loading new markdown updates getSource()
- loadContent with multiple blocks: block count matches expected structure

## Edge cases
- empty document: loadContent('') produces at least 1 editable block (editor never renders zero blocks)
- loadContent called twice: second call fully replaces first content
