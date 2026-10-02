/**
 * How a `$$` block lays out its source and preview while it is being edited. `split` (side by
 * side) is the default because it moves the page least; `stacked` suits long equations; `source`
 * shows no preview. A host picks the default through `latexPlugin({ blockLayout })` or an
 * editor's `{ plugin, options }` entry, and the block's own toggle cycles from there.
 */
export type MathBlockLayout = 'split' | 'stacked' | 'source';

export const MATH_BLOCK_LAYOUTS: readonly MathBlockLayout[] = ['split', 'stacked', 'source'];

export function isMathBlockLayout(value: unknown): value is MathBlockLayout {
	return MATH_BLOCK_LAYOUTS.includes(value as MathBlockLayout);
}
