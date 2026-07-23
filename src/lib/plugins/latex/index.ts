// LaTeX plugin — public entry. `latexPlugin({ renderer })` teaches the editor
// inline `$…$` and block `$$…$$` math; the kind constants let a host address them.
// The renderer engine is injected (the `katexRenderer` adapter lives at the
// `/renderer` subpath), so the `MathRenderer` type is re-exported type-only —
// importable without pulling katex.
export { latexPlugin } from './register';
export { MATH_INLINE, MATH_BLOCK, MATH_FENCE } from './latex-kind';
export type { MathRenderer } from './math-renderer';
