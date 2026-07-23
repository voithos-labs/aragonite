/**
 * The LaTeX plugin: inline `$…$` math and block `$$…$$` display math (kind + opener
 * + the render-primary `BlockMath` component). `latexPlugin({ renderer })` injects
 * the math engine through the module seam — there is no baked-in default, so the
 * `renderer` option is required (the `katexRenderer` adapter is the one-import path).
 * The plugin unit installs this setup once per process, so it runs unguarded.
 */

import {
	definePlugin,
	registerBlockComponent,
	defineBlockComponent,
	declaredPluginKind,
	type EditorPlugin
} from '$lib/plugin';
import { registerMathInline, registerMathBlock, MATH_BLOCK, MATH_FENCE } from './latex-kind';
import { setMathRenderer, type MathRenderer } from './math-renderer';
import BlockMath from './BlockMath.svelte';

export function latexPlugin(options: { renderer: MathRenderer }): EditorPlugin {
	return definePlugin({
		name: 'latex',
		setup() {
			setMathRenderer(options.renderer);
			registerMathInline();
			// registerMathBlock co-registers the ```math fence kind; both render through BlockMath.
			registerMathBlock();
			const blockMath = defineBlockComponent(BlockMath);
			registerBlockComponent(declaredPluginKind(MATH_BLOCK), blockMath);
			registerBlockComponent(declaredPluginKind(MATH_FENCE), blockMath);
		}
	});
}
