# Feature: LaTeX acceptance axes (A1 / A2 / A5 / A7)

Falsifiable acceptance criteria for the first-party LaTeX extension, each mapped to
the design spec's Goal-2 axis id. A2 and A5's adapter proof are unit axes
(`math-renderer.test.ts`); the browser-only axes live in `latex-acceptance.spec.ts`.

## A1 — reveal transition (flagship): no view-jump, no caret loss

- Block reveal then fold on a scrolling document: scroll position holds through both
  the reveal and the fold.
- Block fold re-renders the display at its exact prior geometry (zero net shift).
- Inline reveal → edit → commit: the caret lands at the widget's trailing edge, so a
  char typed after commit falls past the widget, not at a block edge.
- Inline round-trip does not shift the following block vertically.

## A2 — render memoized (flagship, unit)

- Editing one equation re-renders only it; untouched equations stay cache hits.
- A full re-render pass over N equations after the first adds zero renders (flat to 75+).

## A5 — invalid math is legible, never a raw strip

- Invalid inline math renders a legible "error" message through the live widget path.
- KaTeX's raw `.katex-error` source strip never reaches the DOM.

## A7 — multiline environments render (table stakes)

- `aligned`, `cases`, `align*`, `array`, `matrix`, `gather` each render as display
  KaTeX with no error node (one fixture per environment).
- `\\` line breaks render (exercised where `\\` is meaningful, e.g. `\substack`).
