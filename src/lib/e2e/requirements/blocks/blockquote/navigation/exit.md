# Feature: Blockquote Navigation, Exit on Empty Trailing Line

Pressing Enter on the empty last paragraph of a blockquote leaves the quote
instead of adding another line inside it, and creates the blank line the caret
lands on. The source left behind must drop the empty continuation marker, at
every nesting depth alike.

## Happy paths

- Top-level quote: Enter on the empty trailing line lands the cursor on a new blank below the quote; the source has no stranded empty `>` line.

## Edge cases

- Nested quote (depth 2): exiting the inner quote rebuilds the outer quote's raw; no stranded empty `> >` line survives. (The inner quote rebuilt its own raw text but left the outer quote's out of date, leaking `> >`.)
- Deeply nested quote (depth 3): exiting the innermost quote rebuilds the full ancestor chain; no stranded `> > >` line survives. That tells a rebuild of the whole chain apart from a patch of one level.
- Each Enter leaves one level, the same convention outdenting a list follows, so a quote nested N deep takes N presses to reach the document.
- After any exit the source round-trips (`serialize(parse(source)) === source`).
