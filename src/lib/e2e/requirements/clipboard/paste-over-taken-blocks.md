# Feature: a paste over blocks taken whole

A range from a divider through a heading takes both blocks whole and leaves no text of its own. A
paste over it lands where they were, as blocks of their own, the way a typed letter opens its own
paragraph there. Fixture: the editor harness, both modes; the range set through the test bridge.

## Happy paths

- One line pasted: it stands in a paragraph of its own above `last`, never joined to it
- Two paragraphs pasted: both stand apart from `last`, a blank line between

## Miss-analysis

- The paste kept the old landing until its own was ruled, so every row pasted where text already
  stood, and none pasted over blocks taken whole, where the last pasted block joined the paragraph
  after it.
