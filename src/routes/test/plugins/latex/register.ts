/**
 * Idempotent registration entry for the LaTeX extension: inline `$…$` and block
 * `$$…$$` math. Safe to import more than once — each half guards on its live
 * declared-kind set, so HMR re-evaluation re-registers cleanly rather than
 * throwing. Mirrors `callout/register.ts`.
 */

import { registerMathInline, registerMathBlock } from './latex-kind';

export function registerLatex(): void {
	registerMathInline();
	registerMathBlock();
}
