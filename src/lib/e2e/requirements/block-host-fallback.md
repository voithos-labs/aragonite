# Feature: BlockHost no-component fallback

A block kind that has a descriptor but no registered component must render a
visible raw-editable block, not nothing. The node still serializes — no silent
display-drop.

## Happy paths

- orphan kind renders visibly: a top-level node whose kind has no component shows a non-empty block (contenteditable raw surface), not an empty wrapper
- orphan kind still serializes: getSource() retains the orphan node's raw text after it renders via the fallback
