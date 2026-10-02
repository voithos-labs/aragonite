// Two chains through one list, rebuilt in turn: the first one's item spills a line its list must
// read whole, and the list, rebuilt once by the second, keeps both writes and reads as its bytes.
// Miss-analysis: no test sent a spill across two chains, so dropping the whole-read hand-off (and
// the second write a rebuild per chain loses) stayed green.
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { createSharingState } from '$lib/tree-operations/sharing';
import { ensureUnsharedPath } from '$lib/tree-operations/unshare';
import { rebuildUnsharedChain, sharedChainLevels } from '$lib/tree-operations/chain-rebuild';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { fixtureReading } from '$lib/test/harness/fixture-grammar';

/** Writes each leaf, then rebuilds every written chain as one pass. */
function writeThenRebuild(source: string, writes: [path: number[], raw: string][]): string {
	const doc = parse(source, { scope: 'document' });
	const sharing = createSharingState();
	const chains = writes.map(([path, raw]) => {
		const chain = ensureUnsharedPath(doc, path, sharing);
		chain[chain.length - 1].raw = raw;
		return chain;
	});
	const levels = sharedChainLevels(chains);
	const { grammar } = fixtureReading();
	chains.forEach((chain, i) => {
		rebuildUnsharedChain(doc, chain, sharing, [], grammar, undefined, levels[i]);
	});
	expect(describeConvergence(doc)).toBeNull();
	return serialize(doc);
}

describe('a spill in one chain reaches the list a later chain rebuilds', () => {
	// A leading space widens item 1's marker, so its sublist falls out of the item into the list.
	it('at the top level', () => {
		expect(
			writeThenRebuild('- a\n- x y\n  - sub\n- c\n- e\n- f\n', [
				[[0, 1, 0], ' y\n'],
				[[0, 3, 0], 'ee\n']
			])
		).toBe('- a\n-  y\n  - sub\n- c\n- ee\n- f\n');
	});

	it('inside a quote', () => {
		expect(
			writeThenRebuild('> - a\n> - x y\n>   - sub\n> - c\n> - e\n> - f\n', [
				[[0, 0, 1, 0], ' y\n'],
				[[0, 0, 3, 0], 'ee\n']
			])
		).toBe('> - a\n> -  y\n>   - sub\n> - c\n> - ee\n> - f\n');
	});
});
