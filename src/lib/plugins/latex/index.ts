// `MathRenderer` is re-exported type-only so a host can name it without pulling katex;
// the adapter itself lives at the `/renderer` subpath.
export { latexPlugin, type LatexPluginOptions } from './register';
export { MATH_INLINE, MATH_BLOCK, MATH_FENCE } from './latex-kind';
export type { MathRenderer } from './math-renderer';
export type { MathBlockLayout } from './math-layout';
