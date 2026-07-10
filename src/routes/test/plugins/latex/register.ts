/**
 * The LaTeX plugin: inline `$…$` math and block `$$…$$` display math (kind +
 * opener + the render-primary `BlockMath` component). `latexPlugin({ renderer })`
 * swaps the inline math engine; block math keeps its own (dogfood) renderer. The
 * plugin unit installs this setup once per process, so it runs unguarded.
 */

import {
	definePlugin,
	registerBlockComponent,
	defineBlockComponent,
	declaredPluginKind,
	type EditorPlugin
} from '$lib/plugin';
import { registerMathInline, registerMathBlock, MATH_BLOCK } from './latex-kind';
import { katexRenderer, type MathRenderer } from './math-renderer';
import BlockMath from './BlockMath.svelte';

export function latexPlugin(options?: { renderer?: MathRenderer }): EditorPlugin {
	return definePlugin({
		name: 'latex',
		setup() {
			registerMathInline(options?.renderer ?? katexRenderer);
			registerMathBlock();
			registerBlockComponent(declaredPluginKind(MATH_BLOCK), defineBlockComponent(BlockMath));
		}
	});
}
