import { describe, it, expect } from 'vitest';
import { ALL_BLOCK_KINDS } from '../../core/nodes';
import { getAllRegisteredKinds } from '../../schema/block-kind-descriptor';

describe('BLOCK_KIND_TABLE: union-derived kind manifest', () => {
	it('agrees with the descriptor registry (table ↔ registry)', () => {
		expect([...ALL_BLOCK_KINDS].sort()).toEqual([...getAllRegisteredKinds()].sort());
	});
});
