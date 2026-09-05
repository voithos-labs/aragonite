import { type SimContext } from '../invariants';

// The mount/reveal census a gesture settles on: a promotion, a widget swap, or a definition
// materializing is observable as the matching node count reaching `count`, and nothing else.

export async function waitForNodeCount(
	ctx: SimContext,
	selector: string,
	count: number
): Promise<void> {
	await ctx.page.waitForFunction(
		({ sel, n }) => document.querySelectorAll(sel).length === n,
		{ sel: selector, n: count },
		{ timeout: 2000, polling: 16 }
	);
}
