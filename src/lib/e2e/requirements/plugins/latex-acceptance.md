# Feature: LaTeX acceptance axes (A1 / A2 / A5 / A7)

Acceptance criteria for the built-in LaTeX extension that can each be proved false, each mapped
to the design spec's Goal-2 axis id. A2's memoization and A5's adapter proof have unit tests
(`math-renderer.test.ts`); the axes that need a browser, including A2's pin on editing one
equation of many and re-rendering, live in `latex-acceptance.spec.ts`.

## A1, reveal transition (flagship): no view-jump, no caret loss

- Showing a block's source and closing it again on a scrolling document: the scroll position
  holds through both.
- Closing the source re-renders the display at exactly the geometry it had before, so nothing
  shifts.
- Showing an inline formula's source, editing it and committing: the caret lands at the widget's
  trailing edge, so a character typed after the commit falls past the widget rather than at a
  block edge.
- An inline round-trip does not move the following block up or down.

## A2: render memoized (flagship)

- Editing one equation re-renders only that equation; the untouched ones stay cache hits (unit).
- A full re-render pass over many equations adds no renders after the first, flat to 75 and
  beyond (unit).
- In a live document with many different block equations, showing one, editing its source and
  committing raises only that block's render count and never remounts it; the other blocks keep
  both their mount id and their render count (e2e).

## A5: invalid math is legible, never a raw strip

- Invalid inline math renders a readable "error" message through the live widget path.
- KaTeX's own `.katex-error` source strip never reaches the DOM.

## A7: multiline environments render (table stakes)

- `aligned`, `cases`, `align*`, `array`, `matrix` and `gather` each render as display KaTeX with
  no error node, one fixture per environment.
- `\\` line breaks render, exercised where `\\` means something, such as `\substack`.
