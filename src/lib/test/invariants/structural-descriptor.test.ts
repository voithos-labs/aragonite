import { describe, it, expect } from 'vitest';
import {
	checkIdsChildrenLockstep,
	checkStructuralDescriptor
} from '$lib/invariants/structural-descriptor';

// G1.36. Miss-analysis: the descriptor vocabulary had no predicate at all — every producer was
// trusted to derive a fitting window, and the one consumer clamps a negative count to an empty
// splice, so a wrong window left no trace anywhere a test could read it.

describe('checkStructuralDescriptor', () => {
	it('passes the shapes a settle actually mints', () => {
		expect(checkStructuralDescriptor({ op: 'noop' }, 0)).toBeNull();
		expect(checkStructuralDescriptor({ op: 'delete', at: 1, count: 2 }, 3)).toBeNull();
		expect(checkStructuralDescriptor({ op: 'insert', at: 3, count: 2 }, 3)).toBeNull();
		expect(
			checkStructuralDescriptor({ op: 'replace', at: 0, count: 3, newCount: 1 }, 3)
		).toBeNull();
	});

	it('fires on a negative slot count, which the applicator would splice away as empty', () => {
		const violation = checkStructuralDescriptor(
			{ op: 'replace', at: 1, count: 2, newCount: -1 },
			4
		);
		expect(violation?.code).toBe('structural-descriptor-bounds');
	});

	it('fires on a window reaching past the array it syncs', () => {
		expect(checkStructuralDescriptor({ op: 'delete', at: 2, count: 3 }, 3)?.code).toBe(
			'structural-descriptor-bounds'
		);
		expect(
			checkStructuralDescriptor({ op: 'replace', at: 0, count: 2, newCount: 1 }, 1)?.code
		).toBe('structural-descriptor-bounds');
	});
});

describe('checkIdsChildrenLockstep', () => {
	it('fires on either direction of a drift, and passes on equality', () => {
		expect(checkIdsChildrenLockstep('seam', 2, 2)).toBeNull();
		expect(checkIdsChildrenLockstep('seam', 2, 1)?.code).toBe('ids-children-lockstep');
		expect(checkIdsChildrenLockstep('seam', 1, 2)?.code).toBe('ids-children-lockstep');
	});
});
