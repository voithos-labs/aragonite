/**
 * Idempotent registration entry for the LaTeX extension's inline half. Safe to
 * import more than once — `registerMathInline` guards on the live declared-kind
 * set, so HMR re-evaluation re-registers cleanly rather than throwing. Mirrors
 * `callout/register.ts`.
 */

import { registerMathInline } from './latex-kind';

export function registerLatex(): void {
	registerMathInline();
}
