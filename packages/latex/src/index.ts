// `MathRenderer` is re-exported type-only so a host can name it without pulling katex;
// the adapter itself lives at the `/renderer` subpath.
export { latex, type LatexOptions } from './latex-plugin';
export type { MathRenderer, MathRender } from './math-renderer';
export type { MathBlockLayout } from './math-layout';
