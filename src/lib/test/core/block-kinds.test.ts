import { describe, it, expect } from 'vitest';
import { ALL_BLOCK_KINDS } from '../../core/nodes';
import { getAllRegisteredKinds } from '../../schema/block-kind-descriptor';

describe('BLOCK_KIND_TABLE — union-derived kind manifest', () => {
	// The Record<BlockKind, true> type already enforces table == union at compile
	// time; this count is the runtime tripwire that forces a conscious bump (and a
	// "does this kind need a descriptor/component?" check) when the union grows.
	it('enumerates all 15 block kinds', () => {
		expect(ALL_BLOCK_KINDS).toHaveLength(15);
	});

	it('agrees with the descriptor registry (table ↔ registry)', () => {
		expect([...ALL_BLOCK_KINDS].sort()).toEqual([...getAllRegisteredKinds()].sort());
	});
});
