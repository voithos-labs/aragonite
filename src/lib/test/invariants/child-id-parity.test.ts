import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import type { CstNode } from '$lib/core/nodes';
import { checkChildIdParity } from '$lib/invariants/child-id-parity';

/** `- a` over a nested `- b` list: a list, its item, and the item's own list. */
function nestedList(): CstNode {
	const list = parse('- a\n  - b\n').children[0];
	const item = list.children![0];
	list.childIds = ['i0'];
	item.childIds = item.children!.map((_, i) => `c${i}`);
	return list;
}

describe('checkChildIdParity', () => {
	it('passes a tree whose keyed containers hold one id per child', () => {
		expect(checkChildIdParity(nestedList())).toBeNull();
	});

	it('fires on a nested container whose ids fell behind its children, naming where', () => {
		const list = nestedList();
		list.children![0].childIds!.pop();

		const violation = checkChildIdParity(list);

		expect(violation?.code).toBe('child-id-parity');
		expect(violation?.message).toMatch(/\[0\] listItem: 1 child ids for 2 children/);
	});

	it('passes a container that never mounted, unless every container was seeded', () => {
		const list = nestedList();
		const inner = list.children![0].children![1];
		expect(inner.childIds).toBeUndefined();

		expect(checkChildIdParity(list)).toBeNull();
		expect(checkChildIdParity(list, { everyKeyed: true })?.code).toBe('child-id-parity');
	});
});
