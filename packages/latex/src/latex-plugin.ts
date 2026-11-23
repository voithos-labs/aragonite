/**
 * The latex plugin: `$…$` inline math and display math in its two fences, drawn by the renderer
 * its options name (`katexRenderer` from `./renderer`, or any of your own). Without a renderer
 * each formula shows its source. Every editor running it keeps its own renderings.
 */
import { definePlugin, type CodeHighlighter } from '@voithos-labs/aragonite/plugin';
import { mathInline } from './math-inline';
import { mathBlock } from './math-block';
import { mathRenders } from './math-renders';
import { isMathBlockLayout, type MathBlockLayout } from './math-layout';
import type { MathRenderer } from './math-renderer';

export interface LatexOptions {
	renderer?: MathRenderer;
	/** How a math block opens for editing; the block's own toggle cycles from there. */
	blockLayout?: MathBlockLayout;
}

/** `math` is the block's own fence, so the code block's picker offers it and writes it whole. */
const MATH_FENCE: CodeHighlighter = { languages: () => [{ name: 'math' }], highlight: () => null };

export const latex = definePlugin<LatexOptions>({
	name: 'latex',
	version: '0.11.5',
	editor: '0.11.5',
	defaults: { blockLayout: 'split' },
	contributes({ renderer, blockLayout }) {
		const renders = mathRenders(renderer);
		// An unknown layout keeps the default rather than leaving the editor without its renderer.
		const layout = isMathBlockLayout(blockLayout) ? blockLayout : 'split';
		return {
			inlines: [mathInline(renders)],
			blocks: [mathBlock({ renders, layout })],
			code: MATH_FENCE
		};
	}
});
