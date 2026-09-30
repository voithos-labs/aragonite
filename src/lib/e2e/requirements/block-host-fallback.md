# Feature: BlockHost no-component fallback

A block kind that has a descriptor but no registered component must render a
visible raw-editable block, not nothing. The node still serializes, so nothing is
silently dropped from the display.

## Happy paths

- orphan kind renders visibly: a top-level node whose kind has no component shows a non-empty block (its raw text in a contenteditable), not an empty wrapper
- orphan kind still serializes: `getSource()` retains the orphan node's raw text after it renders via the fallback
