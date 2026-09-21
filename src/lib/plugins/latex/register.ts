/**
 * `renderer` is required because there is no built-in default; `katexRenderer` is the
 * one-import way to supply it. The plugin installs this setup once per process, so it runs
 * unguarded.
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
import { isMathBlockLayout, type MathBlockLayout } from './math-layout';
import BlockMath from './BlockMath.svelte';

export interface LatexPluginOptions {
	renderer: MathRenderer;
	/**
	 * How a `$$` block opens for editing: `split` (source beside the preview, the default),
	 * `stacked` (preview below), or `source` (no preview). Read when the plugin is defined, so it
	 * is the default for a plain install; an editor's `{ plugin, options: { blockLayout } }`
	 * entry overrides it. The block's own toggle cycles from whichever applies.
	 */
	blockLayout?: MathBlockLayout;
}

export function latexPlugin(options: LatexPluginOptions): EditorPlugin {
	const blockLayout = isMathBlockLayout(options.blockLayout) ? options.blockLayout : 'split';
	return definePlugin({
		name: 'latex',
		setup() {
			setMathRenderer(options.renderer);
			registerMathInline();
			// registerMathBlock also registers the ```math fence kind; both render through BlockMath.
			registerMathBlock();
			const blockMath = defineBlockComponent(BlockMath, () => ({ blockLayout }));
			registerBlockComponent(declaredPluginKind(MATH_BLOCK), blockMath);
			registerBlockComponent(declaredPluginKind(MATH_FENCE), blockMath);
		}
	});
}
