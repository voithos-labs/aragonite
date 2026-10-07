# Feature: Editor Smoke Tests

Verifies the test harness, bridge, and basic editor lifecycle. One test walks all of it, since every other spec leans on the same mount and `loadContent` anyway.

## Happy paths

- the editor mounts and the bridge answers: the `.editor` element is visible and `getSource()` returns a non-empty string
- loadContent replaces the document: a second call fully replaces the first, and `getSource()` shows only the second
- loadContent with multiple blocks: the block count matches the expected structure

## Edge cases

- empty document: `loadContent('')` produces at least 1 editable block (the editor never renders zero blocks)
