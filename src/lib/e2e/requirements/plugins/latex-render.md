# Feature: LaTeX math renders once

KaTeX's `htmlAndMathml` output carries a visual half (`.katex-html`) and an accessibility half
(`.katex-mathml`) that `katex/dist/katex.min.css` collapses to a 1px box. That stylesheet is a
dependency of the default `katexRenderer` and is imported by the module that owns it, so every
route installing `latexPlugin` gets it. Without it both halves paint: the render, followed by the
TeX source repeated as plain text.

## Happy paths

- Inline `$…$` math: the widget shows exactly one `.katex-html` render, and the `.katex-mathml` box is clipped to about 1px while the HTML half keeps its glyph-sized layout.
- Block `$$…$$` math: the same single render holds on the display-mode path.

## Error cases

- The regression this pins: with the stylesheet loaded on no route, which was the original bug, both scenarios fail, because the MathML half lays out at full glyph size beside the render.
