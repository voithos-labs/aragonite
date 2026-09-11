/**
 * How a `$$` block lays out its source and preview while it is being edited. `split` (side by
 * side) is the default because it moves the page least; `stacked` suits long equations; `source`
 * shows no preview. A host picks the default through `latexPlugin({ blockLayout })`, and the
 * block's own toggle still cycles from there.
 */
export type MathBlockLayout = 'split' | 'stacked' | 'source';

export const MATH_BLOCK_LAYOUTS: readonly MathBlockLayout[] = ['split', 'stacked', 'source'];

export function isMathBlockLayout(value: unknown): value is MathBlockLayout {
	return MATH_BLOCK_LAYOUTS.includes(value as MathBlockLayout);
}

/**
 * The starting layout: this editor's per-instance plugin options first (`{ plugin, options:
 * { blockLayout } }`), then the factory's own default (`latexPlugin({ blockLayout })`), then
 * `split`. An unknown value falls through rather than throwing.
 */
export function resolveDefaultLayout(
	options: unknown,
	fallback: MathBlockLayout = 'split'
): MathBlockLayout {
	const declared = (options as { blockLayout?: unknown } | undefined)?.blockLayout;
	return isMathBlockLayout(declared) ? declared : fallback;
}
