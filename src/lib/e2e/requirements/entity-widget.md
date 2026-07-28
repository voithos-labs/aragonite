# Feature: decoded-entity atomic widget

A visibly-rendering character reference (`&copy;`, `&#169;`, `&#xA9;`) renders as
an atomic inline widget showing its decoded glyph (`©`). The raw bytes stay the
source of truth: they ride `data-source-*`, so the caret treats the entity as one
character, delete removes it whole, and copy/serialize reproduce the reference.

This is the **first executable pin of `deleteGranularity: 'atomic'`** — the atomic
delete scenario below is what proves that policy value is honored, not inert.

## Happy paths

- type `&copy;` into prose: the © glyph appears as a `[data-inline-widget]`, and
  the serialized source is the literal `&copy;` (round-trip, never `©`)
- reading mode: the glyph still renders (widgets are atomic islands in every
  presentation mode, the image-widget precedent)
- entity inside a table cell: the cell renders the glyph widget

## User interactions

- caret at the entity's leading edge, ArrowRight once: the caret steps to the
  trailing edge in a single press (the glyph is walked over like a character), no
  select state
- caret at the entity's trailing edge, ArrowLeft once: the caret steps back to the
  leading edge in a single press
- two adjacent entities (`&copy;&reg;`), no cushioning text: the caret steps over
  each in one press, landing at the boundary between them
- caret adjacent to the entity, one Backspace: the whole reference is removed in a
  single press (no reveal, no select step); one undo restores it exactly
- select across the entity and copy: the clipboard holds the raw bytes (`&copy;`),
  never the decoded glyph

## Edge cases

- `&nbsp;` (decodes to U+00A0, whitespace): keeps its literal-source span, NOT a
  widget — an invisible atomic island would be a caret trap
