/**
 * Idempotent registration entry for the LaTeX extension: inline `$…$` math and
 * block `$$…$$` display math (kind + opener + the render-primary `BlockMath`
 * component). Safe to import more than once — each half guards on live registry
 * state, so HMR re-evaluation re-registers cleanly rather than throwing. Mirrors
 * `details/register.ts`.
 */

import {
	registerBlockComponent,
	defineBlockComponent,
	isBlockComponentRegistered,
	declaredPluginKind
} from '$lib/plugin';
import { registerMathInline, registerMathBlock, MATH_BLOCK } from './latex-kind';
import BlockMath from './BlockMath.svelte';

export function registerLatex(): void {
	registerMathInline();
	registerMathBlock();
	if (!isBlockComponentRegistered(MATH_BLOCK)) {
		registerBlockComponent(declaredPluginKind(MATH_BLOCK), defineBlockComponent(BlockMath));
	}
}
