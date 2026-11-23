/**
 * Display math as one block type with GitHub's two fences: `$$` (on lines of its own, or the
 * whole block on one line) and ```` ```math ````. The editor reads, writes and draws the fence
 * lines; the block paints its formula as LaTeX and draws it through its editor's renderer.
 */
import { fencedBlock } from '@voithos-labs/aragonite/plugin';
import { svelteBlock } from '@voithos-labs/aragonite/svelte';
import BlockMath from './BlockMath.svelte';
import { MATH_EDITOR, type MathEditor } from './math-renders';
import { BLOCK_SAMPLES, DOLLAR_FENCE, LONE_FENCE, mathBlockLines } from './math-shape';

export function mathBlock(editor: MathEditor) {
	return fencedBlock({
		name: 'block',
		label: 'Math block',
		// A formula's source makes a poor name on the drag ghost.
		dragLabel: 'Equation',
		fence: [DOLLAR_FENCE, { info: 'math' }],
		interrupts: true,
		sample: BLOCK_SAMPLES,
		insert: {
			label: 'Math block',
			icon: 'sigma',
			keywords: ['math', 'latex', 'equation', 'tex'],
			insert: `${mathBlockLines('').join('\n')}\n`
		},
		// A lone fence can only open the pair, so the block forms as its second `$` is typed.
		complete: {
			on: 'both',
			line: LONE_FENCE,
			complete: () => ({ lines: mathBlockLines(''), caret: { line: 1, col: 0 } })
		},
		renderSource: (body, paint) => paint.code(body, 'latex'),
		draw: svelteBlock(BlockMath, { context: new Map([[MATH_EDITOR, editor]]) })
	});
}
