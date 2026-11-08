import { describe, it, expect } from 'vitest';
import {
	checkChildSpansLockstep,
	checkIdsChildrenLockstep,
	checkStructuralDescriptor,
	checkWriteInWindow
} from '#lib/invariants/structural-descriptor.js';
import { parse } from '#lib/core/parser.js';
import type { CstNode } from '#lib/core/nodes.js';

// A structural descriptor's window must fit the array it syncs, since the one consumer clamps a
// negative count to an empty splice and a wrong window leaves no trace (G1.36).
// Miss-analysis: every producer was trusted to derive a fitting window, and nothing checked one.

describe('checkStructuralDescriptor', () => {
	it('passes the shapes a settle actually creates', () => {
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

// Miss-analysis: the check counted a list's span bounds and never placed them, so a splice that left
// later items' spans stale reached every byte lookup with no dev warning.
describe('checkChildSpansLockstep over a list', () => {
	it('passes the spans a parse stores, and fires on an item whose bounds sit off its bytes', () => {
		const list = parse('- a\n- bb\n- c\n').children[0] as CstNode;
		expect(checkChildSpansLockstep(list)).toBeNull();
		list.childSpans![3] += 1;
		expect(checkChildSpansLockstep(list)?.detail).toMatchObject({ item: 1 });
	});
});

describe('checkIdsChildrenLockstep', () => {
	it('fires on either direction of a drift, and passes on equality', () => {
		expect(checkIdsChildrenLockstep('seam', 2, 2)).toBeNull();
		expect(checkIdsChildrenLockstep('seam', 2, 1)?.code).toBe('ids-children-lockstep');
		expect(checkIdsChildrenLockstep('seam', 1, 2)?.code).toBe('ids-children-lockstep');
	});
});

describe('checkWriteInWindow', () => {
	const window = { op: 'replace', at: 1, count: 2, newCount: 1 } as const;

	it('passes a write inside the replaced window, and any change that replaces none', () => {
		expect(checkWriteInWindow(window, 1)).toBeNull();
		expect(checkWriteInWindow(window, 2)).toBeNull();
		expect(checkWriteInWindow({ op: 'noop' }, 0)).toBeNull();
	});

	it('fires on a write on either side of the window', () => {
		expect(checkWriteInWindow(window, 0)?.code).toBe('write-in-window');
		expect(checkWriteInWindow(window, 3)?.code).toBe('write-in-window');
	});
});
