import { type SimContext } from '../invariants';

// The counts a gesture waits on: a block changing kind, a widget swapping in, or a definition
// appearing all show up as the matching node count reaching `count`, and nothing else does.

export async function waitForNodeCount(
	ctx: SimContext,
	selector: string,
	count: number
): Promise<void> {
	await ctx.page.waitForFunction(
		({ sel, n }) => document.querySelectorAll(sel).length === n,
		{ sel: selector, n: count },
		{ timeout: 5000, polling: 16 }
	);
}
