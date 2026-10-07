/**
 * `katexRenderer` is the one-import way to supply `renderer`; without one, each formula shows its
 * source. The plugin installs this setup once per process, so it runs unguarded.
 */

import {
	definePlugin,
	registerBlockComponent,
	defineBlockComponent,
	declaredPluginKind,
	registerInsertEntry,
	type EditorPlugin
} from '#lib/plugin.js';
import { registerMathInline, registerMathBlock, MATH_BLOCK, MATH_FENCE } from './latex-kind';
import { mathSlot, type MathRenderer } from './math-renderer';
import { isMathBlockLayout, type MathBlockLayout } from './math-layout';
import BlockMath from './BlockMath.svelte';

export interface LatexPluginOptions {
	renderer?: MathRenderer;
	/** How a `$$` block opens for editing (`math-layout.ts`); an editor's
	 *  `{ plugin, options: { blockLayout } }` entry overrides it. */
	blockLayout?: MathBlockLayout;
}

/** What one editor reads: the renderer is process-wide, so only the layout varies per editor. */
export interface LatexEditorOptions {
	blockLayout: MathBlockLayout;
}

export function latexPlugin(options: LatexPluginOptions = {}): EditorPlugin {
	const { renderer } = options;
	return definePlugin<LatexEditorOptions>({
		name: 'latex',
		defaults: {
			blockLayout: isMathBlockLayout(options.blockLayout) ? options.blockLayout : 'split'
		},
		// An unknown layout keeps the default rather than breaking the block.
		parseOptions(raw) {
			const blockLayout = (raw as LatexPluginOptions | null)?.blockLayout;
			return isMathBlockLayout(blockLayout) ? { blockLayout } : {};
		},
		setup() {
			mathSlot.set(
				renderer ? ({ source, display }, { theme }) => renderer(source, { display, theme }) : null
			);
			registerMathInline();
			// registerMathBlock also registers the ```math fence kind; both render through BlockMath.
			registerMathBlock();
			const blockMath = defineBlockComponent(BlockMath);
			registerBlockComponent(declaredPluginKind(MATH_BLOCK), blockMath);
			registerBlockComponent(declaredPluginKind(MATH_FENCE), blockMath);
			registerInsertEntry({
				id: 'math',
				label: 'Math block',
				icon: 'sigma',
				keywords: ['math', 'latex', 'equation', 'tex'],
				markdown: '$$\n\n$$\n'
			});
		}
	});
}
