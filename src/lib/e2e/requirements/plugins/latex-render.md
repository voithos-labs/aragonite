# Feature: LaTeX math renders once

KaTeX's `htmlAndMathml` output carries a visual half (`.katex-html`) and an
accessibility half (`.katex-mathml`) that `katex/dist/katex.min.css` collapses to a
1px box. The stylesheet is a dependency of the default `katexRenderer` engine and is
imported by the module that owns it, so every route installing `latexPlugin` inherits
it. Without it both halves paint: the render followed by the TeX source echoed as
plain text.

## Happy paths

- Inline `$…$` math: the widget shows exactly one `.katex-html` render; the `.katex-mathml` box is clipped to ≈1px while the HTML half keeps glyph-sized layout.
- Block `$$…$$` math: the same single-render contract holds on the display-mode path.

## Error cases

- Regression pin: the stylesheet loaded on no route (the original bug) fails both scenarios — the MathML half lays out at full glyph size beside the render.
